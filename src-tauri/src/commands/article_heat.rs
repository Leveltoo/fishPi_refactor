//! 在看人数。
//!
//! 初始值只来自 `article().heat()`。实时加减只来自文章频道里
//! `type == articleHeat` 且 `operation` 为 `+` / `-` 的推送。
//! 其它帧忽略，不在本地伪造人数。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use fishpi_sdk::client::ArticleConnection;
use fishpi_sdk::domain::article::ArticleType;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::common::{ensure_same_session, require_client, require_nonempty};
use crate::dto::{
    ArticleHeatCloseRequest, ArticleHeatEvent, ArticleHeatResult, ArticleHeatWatchRequest,
    ArticleHeatWatchResult, ArticleIdRequest,
};
use crate::error::AppError;
use crate::state::AppState;

pub const EVENT_ARTICLE_HEAT: &str = "article://heat";

struct HeatWatch {
    generation: u64,
    article_id: String,
    session_generation: u64,
    connection: ArticleConnection,
}

fn heat_slot() -> &'static Mutex<Option<HeatWatch>> {
    static SLOT: Mutex<Option<HeatWatch>> = Mutex::new(None);
    &SLOT
}

fn heat_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: LazyLock<tokio::sync::Mutex<()>> =
        LazyLock::new(|| tokio::sync::Mutex::new(()));
    &GATE
}

fn next_generation() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(1);
    SEQ.fetch_add(1, Ordering::Relaxed)
}

fn pending_generation() -> &'static AtomicU64 {
    static PENDING: AtomicU64 = AtomicU64::new(0);
    &PENDING
}

fn begin_pending(generation: u64) {
    pending_generation().store(generation, Ordering::Release);
}

fn end_pending(generation: u64) {
    let _ = pending_generation().compare_exchange(
        generation,
        0,
        Ordering::AcqRel,
        Ordering::Acquire,
    );
}

fn generation_is_active(generation: u64) -> bool {
    pending_generation().load(Ordering::Acquire) == generation || watch_is_current(generation)
}

/// 拉取当前在看人数。失败不返回 0 冒充。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_heat(
    state: State<'_, AppState>,
    request: ArticleIdRequest,
) -> Result<ArticleHeatResult, AppError> {
    let id = require_nonempty(&request.id, "帖子 ID 不能为空")?;
    let (client, session_generation) = require_client(&state)?;
    let count = client.article().heat(id).await?;
    ensure_same_session(&state, session_generation)?;
    Ok(ArticleHeatResult {
        session_generation,
        count,
    })
}

/// 订阅文章频道。返回前注册完 `on_message`。
/// 先拆掉旧连接再连新的，避免两路 `+`/`-` 叠在同一个人次上。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_heat_watch(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ArticleHeatWatchRequest,
) -> Result<ArticleHeatWatchResult, AppError> {
    let _gate = heat_gate().lock().await;
    let id = require_nonempty(&request.id, "帖子 ID 不能为空")?;
    let article_type = article_type_from(request.article_type);
    let (client, session_generation) = require_client(&state)?;
    if let Some(mut previous) = take_current() {
        previous.connection.disconnect();
    }
    let mut connection = client.article().connect(id.clone(), article_type).await?;
    if state.session_generation() != session_generation {
        connection.disconnect();
        return Err(AppError::session_superseded());
    }

    let generation = next_generation();
    begin_pending(generation);
    let article_id = id.clone();
    let app_for_listener = app.clone();
    connection
        .on_message(move |value| {
            forward_heat(
                &app_for_listener,
                session_generation,
                generation,
                &article_id,
                &value,
            );
        })
        .await;

    if state.session_generation() != session_generation {
        end_pending(generation);
        connection.disconnect();
        return Err(AppError::session_superseded());
    }

    let previous = install(HeatWatch {
        generation,
        article_id: id,
        session_generation,
        connection,
    });
    end_pending(generation);
    if let Some(mut previous) = previous {
        previous.connection.disconnect();
    }
    Ok(ArticleHeatWatchResult {
        session_generation,
        watch_generation: generation,
    })
}

/// 按代次关闭监听。代次对不上就不动当前连接。
#[tauri::command(rename_all = "camelCase")]
pub async fn article_heat_close(request: ArticleHeatCloseRequest) -> Result<(), AppError> {
    let _gate = heat_gate().lock().await;
    if request.watch_generation == 0 {
        return Ok(());
    }
    if let Some(mut slot) = take_if(request.watch_generation) {
        slot.connection.disconnect();
    }
    Ok(())
}

fn forward_heat(
    app: &AppHandle,
    session_generation: u64,
    generation: u64,
    article_id: &str,
    value: &Value,
) {
    if !generation_is_active(generation) {
        return;
    }
    if let Some(app_state) = app.try_state::<AppState>() {
        if app_state.session_generation() != session_generation {
            end_pending(generation);
            if let Some(mut stale) = take_if(generation) {
                stale.connection.disconnect();
            }
            return;
        }
    }
    let Some(delta) = heat_delta(value) else {
        return;
    };
    if !generation_is_active(generation) {
        return;
    }
    let _ = app.emit(
        EVENT_ARTICLE_HEAT,
        ArticleHeatEvent {
            session_generation,
            article_id: article_id.to_string(),
            delta,
        },
    );
}

fn heat_delta(value: &Value) -> Option<i32> {
    delta_of(value).or_else(|| {
        let data = value.get("data")?;
        if let Some(text) = data.as_str() {
            let parsed = serde_json::from_str::<Value>(text).ok()?;
            return delta_of(&parsed);
        }
        delta_of(data)
    })
}

fn delta_of(value: &Value) -> Option<i32> {
    let kind = value.get("type").and_then(Value::as_str)?;
    if kind != "articleHeat" {
        return None;
    }
    match value.get("operation").and_then(Value::as_str) {
        Some("+") => Some(1),
        Some("-") => Some(-1),
        _ => None,
    }
}

fn article_type_from(value: Option<u8>) -> ArticleType {
    match value {
        Some(index) => ArticleType::from_index(i64::from(index)),
        None => ArticleType::Normal,
    }
}

fn install(slot: HeatWatch) -> Option<HeatWatch> {
    let mut guard = heat_slot().lock().unwrap_or_else(|err| err.into_inner());
    guard.replace(slot)
}

fn take_current() -> Option<HeatWatch> {
    let mut guard = heat_slot().lock().unwrap_or_else(|err| err.into_inner());
    guard.take()
}

fn take_if(generation: u64) -> Option<HeatWatch> {
    let mut guard = heat_slot().lock().unwrap_or_else(|err| err.into_inner());
    if guard
        .as_ref()
        .is_some_and(|slot| slot.generation == generation)
    {
        guard.take()
    } else {
        None
    }
}

fn watch_is_current(generation: u64) -> bool {
    let guard = heat_slot().lock().unwrap_or_else(|err| err.into_inner());
    guard
        .as_ref()
        .is_some_and(|slot| slot.generation == generation)
}
