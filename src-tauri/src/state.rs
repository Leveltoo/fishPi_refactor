//! 应用共享状态：当前 `FishPi`、聊天室/私聊/通知句柄、会话与连接代次。
//!
//! 使用 `std::sync::Mutex`，从类型上禁止在持锁时 `.await` 网络。
//! token 只活在 `FishPi` 内部，不进入本模块可序列化快照。

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use fishpi_sdk::client::{ChatConnection, ChatRoomConnection, NoticeConnection};
use fishpi_sdk::FishPi;

use crate::dto::UserSummary;
use crate::error::AppError;

/// 进程内会话与连接状态。由 Tauri `manage` 注入 command，前端不能直接读取。
pub struct AppState {
    inner: Mutex<Inner>,
}

struct Inner {
    client: Option<FishPi>,
    session_generation: u64,
    chatroom: Option<ChatRoomConnection>,
    connection_generation: u64,
    user: Option<UserSummary>,
    credential_saved: bool,
    /// 按对端用户名（小写）各持一条私聊连接。
    chats: HashMap<String, ChatLink>,
    /// `chat().connect(None)`：全局 user-channel。
    global_chat: Option<ChatLink>,
    notice: Option<NoticeLink>,
    chat_generation_seq: u64,
    notice_generation: u64,
    /// attach 已挂、句柄尚未入库时的代次。回调按此过滤，避免首包被丢掉。
    pending_chats: HashMap<String, u64>,
    pending_global_chat: Option<u64>,
    pending_notice: Option<u64>,
}

struct ChatLink {
    connection: ChatConnection,
    generation: u64,
}

struct NoticeLink {
    connection: NoticeConnection,
    generation: u64,
}

/// 克隆出的已鉴权客户端。拿到后必须立刻结束对 `AppState` 的借用再发请求。
pub struct FishPiHandle {
    pub client: FishPi,
    pub session_generation: u64,
}

/// 锁外断开的全部活连接。登录替换与退出都走这里，避免漏拆私聊/通知。
pub struct LiveConnections {
    pub chatroom: Option<ChatRoomConnection>,
    pub chats: HashMap<String, ChatConnection>,
    pub global_chat: Option<ChatConnection>,
    pub notice: Option<NoticeConnection>,
}

impl LiveConnections {
    fn empty() -> Self {
        Self {
            chatroom: None,
            chats: HashMap::new(),
            global_chat: None,
            notice: None,
        }
    }

    /// 在锁外断开全部 socket。可重复调用（空集合是 no-op）。
    pub fn disconnect_all(self) {
        if let Some(mut connection) = self.chatroom {
            connection.disconnect();
        }
        for (_, mut connection) in self.chats {
            connection.disconnect();
        }
        if let Some(mut connection) = self.global_chat {
            connection.disconnect();
        }
        if let Some(mut connection) = self.notice {
            connection.disconnect();
        }
    }
}

/// `replace_session` 的结果：新代次，以及须在锁外断开的旧连接。
pub struct SessionReplacement {
    pub session_generation: u64,
    pub previous: LiveConnections,
}

/// `invalidate_session` 的结果：作废后的代次，以及须在锁外断开的旧连接。
pub struct SessionInvalidation {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub previous: LiveConnections,
}

/// 放入聊天室句柄后的代次，以及被替换下来、须在锁外断开的旧句柄。
pub struct ChatroomReplacement {
    pub connection_generation: u64,
    pub previous_chatroom: Option<ChatRoomConnection>,
}

/// 不含 token 的只读快照，供 `auth_me` 等查询使用。
#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub session_generation: u64,
    pub connection_generation: u64,
    pub user: Option<UserSummary>,
    pub credential_saved: bool,
    pub has_client: bool,
    pub has_chatroom: bool,
}

impl AppState {
    /// 创建空会话。代次从 0 起，登录/恢复成功后才会变成有效会话。
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                client: None,
                session_generation: 0,
                chatroom: None,
                connection_generation: 0,
                user: None,
                credential_saved: false,
                chats: HashMap::new(),
                global_chat: None,
                notice: None,
                chat_generation_seq: 0,
                notice_generation: 0,
                pending_chats: HashMap::new(),
                pending_global_chat: None,
                pending_notice: None,
            }),
        }
    }

    /// 克隆当前 `FishPi` 与会话代次后立即放锁。
    ///
    /// 登录后内存里必须是新的鉴权实例；未登录时返回 `None`。
    /// 异步结果回来后须用 `session_generation` 核对，防止旧请求覆盖新账户。
    pub fn clone_fishpi(&self) -> Option<FishPiHandle> {
        let inner = self.lock();
        inner.client.clone().map(|client| FishPiHandle {
            client,
            session_generation: inner.session_generation,
        })
    }

    /// 当前会话代次。换号、退出、恢复提交都会递增，使旧异步结果作废。
    pub fn session_generation(&self) -> u64 {
        self.lock().session_generation
    }

    /// 当前聊天室连接代次。断开或重建连接后递增，旧 WS 事件不得进入新连接。
    pub fn connection_generation(&self) -> u64 {
        self.lock().connection_generation
    }

    /// 当前用户摘要，不含 token。
    pub fn user_summary(&self) -> Option<UserSummary> {
        self.lock().user.clone()
    }

    /// 凭据是否已写入系统凭据存储。存储失败时为 false，表示仅本次会话。
    pub fn credential_saved(&self) -> bool {
        self.lock().credential_saved
    }

    /// 内存中是否持有客户端。不等于服务端 token 仍然有效。
    pub fn has_session(&self) -> bool {
        self.lock().client.is_some()
    }

    /// 是否已保存聊天室连接句柄。用于幂等 connect，检查本身不发起网络。
    pub fn has_chatroom_connection(&self) -> bool {
        self.lock().chatroom.is_some()
    }

    /// 指定用户是否已有私聊长连接。`user` 按大小写不敏感匹配。含尚未入库的 pending。
    pub fn has_user_chat(&self, user: &str) -> bool {
        let key = normalize_user(user);
        if key.is_empty() {
            return false;
        }
        let inner = self.lock();
        inner.chats.contains_key(&key) || inner.pending_chats.contains_key(&key)
    }

    /// 是否已有全局私聊/通知频道（`connect(None)`）。含 pending。
    pub fn has_global_chat(&self) -> bool {
        let inner = self.lock();
        inner.global_chat.is_some() || inner.pending_global_chat.is_some()
    }

    /// 是否已有通知长连接。含 pending。
    pub fn has_notice_connection(&self) -> bool {
        let inner = self.lock();
        inner.notice.is_some() || inner.pending_notice.is_some()
    }

    /// 指定用户私聊连接代次。含尚未入库的 pending，供 attach 后首包过滤。
    pub fn user_chat_generation(&self, user: &str) -> Option<u64> {
        let key = normalize_user(user);
        let inner = self.lock();
        inner
            .chats
            .get(&key)
            .map(|link| link.generation)
            .or_else(|| inner.pending_chats.get(&key).copied())
    }

    /// 全局 chat 连接代次。含 pending。
    pub fn global_chat_generation(&self) -> Option<u64> {
        let inner = self.lock();
        inner
            .global_chat
            .as_ref()
            .map(|link| link.generation)
            .or(inner.pending_global_chat)
    }

    /// 通知连接代次。含 pending。
    pub fn notice_generation(&self) -> Option<u64> {
        let inner = self.lock();
        inner
            .notice
            .as_ref()
            .map(|link| link.generation)
            .or(inner.pending_notice)
    }

    /// 读取不含 token 的会话快照，持锁时间仅限拷贝摘要。
    pub fn session_snapshot(&self) -> SessionSnapshot {
        let inner = self.lock();
        SessionSnapshot {
            session_generation: inner.session_generation,
            connection_generation: inner.connection_generation,
            user: inner.user.clone(),
            credential_saved: inner.credential_saved,
            has_client: inner.client.is_some(),
            has_chatroom: inner.chatroom.is_some(),
        }
    }

    /// 换上新的已鉴权 `FishPi`，递增会话代次并作废旧连接代次。
    ///
    /// 必须传入登录/恢复得到的新实例，不能沿用未登录客户端。
    /// 旧连接在返回值中带出，调用方在锁外 `disconnect`。
    pub fn replace_session(
        &self,
        client: FishPi,
        user: UserSummary,
        credential_saved: bool,
    ) -> SessionReplacement {
        let mut inner = self.lock();
        replace_session_locked(&mut inner, client, user, credential_saved)
    }

    /// 仅当当前会话代次仍是 `expected` 时发布新会话。
    ///
    /// 登录/恢复必须在 `.await` 前后核对代次：持锁时不能等网络，因此 CAS 只能在提交瞬间做。
    /// 代次已变说明中途有换号或退出，旧结果不得覆盖新账户。
    pub fn replace_session_if(
        &self,
        expected_generation: u64,
        client: FishPi,
        user: UserSummary,
        credential_saved: bool,
    ) -> Result<SessionReplacement, AppError> {
        let mut inner = self.lock();
        if inner.session_generation != expected_generation {
            return Err(AppError::session_superseded());
        }
        Ok(replace_session_locked(
            &mut inner,
            client,
            user,
            credential_saved,
        ))
    }

    /// 使当前会话失效：清空客户端与用户摘要，递增代次。
    ///
    /// 不删除系统凭据；持久退出由 command 在锁外调用 `credentials::delete`。
    /// 返回的旧连接须在锁外断开（聊天室 + 全部私聊 + 通知）。
    pub fn invalidate_session(&self) -> SessionInvalidation {
        let mut inner = self.lock();
        inner.session_generation = inner.session_generation.saturating_add(1);
        inner.connection_generation = inner.connection_generation.saturating_add(1);
        inner.chat_generation_seq = inner.chat_generation_seq.saturating_add(1);
        inner.notice_generation = inner.notice_generation.saturating_add(1);
        inner.client = None;
        inner.user = None;
        inner.credential_saved = false;
        let previous = take_live_connections(&mut inner);
        SessionInvalidation {
            session_generation: inner.session_generation,
            connection_generation: inner.connection_generation,
            previous,
        }
    }

    /// 保存聊天室连接句柄并递增连接代次。须在 `connect()` 完成后、锁外调用。
    ///
    /// 若要先挂 `on_all` 再入库，请改用 [`Self::reserve_connection_generation`] +
    /// [`Self::install_chatroom_connection`]：先 bump 代次，监听才能对上，首包才不会被丢掉。
    pub fn set_chatroom_connection(
        &self,
        connection: ChatRoomConnection,
    ) -> ChatroomReplacement {
        let mut inner = self.lock();
        inner.connection_generation = inner.connection_generation.saturating_add(1);
        let previous_chatroom = inner.chatroom.replace(connection);
        ChatroomReplacement {
            connection_generation: inner.connection_generation,
            previous_chatroom,
        }
    }

    /// 预先占用下一个连接代次，供 `on_all` 在句柄入库前使用。
    ///
    /// 转发回调用代次过滤。若等 `set_chatroom_connection` 才 bump，attach 到入库之间
    /// 的事件会因「事件代次 = current+1、状态代次仍是 current」被丢掉，首包窗口更大。
    pub fn reserve_connection_generation(&self) -> u64 {
        let mut inner = self.lock();
        inner.connection_generation = inner.connection_generation.saturating_add(1);
        inner.connection_generation
    }

    /// 把已注册监听的句柄放入 **reserve 得到的代次**，不再二次递增。
    ///
    /// 代次对不上或已经有句柄时把连接交回，调用方在锁外 `disconnect`。
    pub fn install_chatroom_connection(
        &self,
        expected_generation: u64,
        connection: ChatRoomConnection,
    ) -> Result<ChatroomReplacement, ChatRoomConnection> {
        let mut inner = self.lock();
        if inner.connection_generation != expected_generation || inner.chatroom.is_some() {
            return Err(connection);
        }
        let previous_chatroom = inner.chatroom.replace(connection);
        Ok(ChatroomReplacement {
            connection_generation: inner.connection_generation,
            previous_chatroom,
        })
    }

    /// 取出聊天室连接并作废连接代次。断开在锁外进行；无连接时仍递增代次以保证幂等失效。
    pub fn take_chatroom_connection(&self) -> Option<ChatRoomConnection> {
        let mut inner = self.lock();
        inner.connection_generation = inner.connection_generation.saturating_add(1);
        inner.chatroom.take()
    }

    /// 为即将建立的指定用户私聊占用代次，并记入 pending。
    ///
    /// 已有活连接时返回 `None`，调用方走幂等快照。会话已变则报错。
    pub fn reserve_user_chat(
        &self,
        user: &str,
        expected_session: u64,
    ) -> Result<Option<u64>, AppError> {
        let key = normalize_user(user);
        let mut inner = self.lock();
        if inner.session_generation != expected_session {
            return Err(AppError::session_superseded());
        }
        if inner.chats.contains_key(&key) || inner.pending_chats.contains_key(&key) {
            return Ok(None);
        }
        inner.chat_generation_seq = inner.chat_generation_seq.saturating_add(1);
        let generation = inner.chat_generation_seq;
        inner.pending_chats.insert(key, generation);
        Ok(Some(generation))
    }

    /// 为即将建立的全局 chat 占用代次。已有活连接时 `None`。
    pub fn reserve_global_chat(&self, expected_session: u64) -> Result<Option<u64>, AppError> {
        let mut inner = self.lock();
        if inner.session_generation != expected_session {
            return Err(AppError::session_superseded());
        }
        if inner.global_chat.is_some() || inner.pending_global_chat.is_some() {
            return Ok(None);
        }
        inner.chat_generation_seq = inner.chat_generation_seq.saturating_add(1);
        let generation = inner.chat_generation_seq;
        inner.pending_global_chat = Some(generation);
        Ok(Some(generation))
    }

    /// 为即将建立的通知连接占用代次。已有活连接时 `None`。
    pub fn reserve_notice_connection(
        &self,
        expected_session: u64,
    ) -> Result<Option<u64>, AppError> {
        let mut inner = self.lock();
        if inner.session_generation != expected_session {
            return Err(AppError::session_superseded());
        }
        if inner.notice.is_some() || inner.pending_notice.is_some() {
            return Ok(None);
        }
        inner.notice_generation = inner.notice_generation.saturating_add(1);
        let generation = inner.notice_generation;
        inner.pending_notice = Some(generation);
        Ok(Some(generation))
    }

    /// 取消尚未入库的用户私聊 pending。连接失败或会话被挤掉时调用。
    pub fn cancel_pending_user_chat(&self, user: &str, generation: u64) {
        let key = normalize_user(user);
        let mut inner = self.lock();
        if inner.pending_chats.get(&key).copied() == Some(generation) {
            inner.pending_chats.remove(&key);
        }
    }

    /// 取消尚未入库的全局 chat pending。
    pub fn cancel_pending_global_chat(&self, generation: u64) {
        let mut inner = self.lock();
        if inner.pending_global_chat == Some(generation) {
            inner.pending_global_chat = None;
        }
    }

    /// 取消尚未入库的通知 pending。
    pub fn cancel_pending_notice(&self, generation: u64) {
        let mut inner = self.lock();
        if inner.pending_notice == Some(generation) {
            inner.pending_notice = None;
        }
    }

    /// 入库指定用户的私聊句柄。会话已变、代次对不上或该用户已有连接时交回句柄。
    pub fn install_user_chat(
        &self,
        user: &str,
        expected_session: u64,
        expected_generation: u64,
        connection: ChatConnection,
    ) -> Result<u64, ChatConnection> {
        let key = normalize_user(user);
        let mut inner = self.lock();
        let pending_ok = inner.pending_chats.get(&key).copied() == Some(expected_generation);
        if inner.session_generation != expected_session
            || inner.chats.contains_key(&key)
            || !pending_ok
        {
            if inner.pending_chats.get(&key).copied() == Some(expected_generation) {
                inner.pending_chats.remove(&key);
            }
            return Err(connection);
        }
        inner.pending_chats.remove(&key);
        inner.chats.insert(
            key,
            ChatLink {
                connection,
                generation: expected_generation,
            },
        );
        Ok(expected_generation)
    }

    /// 入库全局 chat 句柄。会话已变、代次对不上或已有全局连接时交回句柄。
    pub fn install_global_chat(
        &self,
        expected_session: u64,
        expected_generation: u64,
        connection: ChatConnection,
    ) -> Result<u64, ChatConnection> {
        let mut inner = self.lock();
        let pending_ok = inner.pending_global_chat == Some(expected_generation);
        if inner.session_generation != expected_session
            || inner.global_chat.is_some()
            || !pending_ok
        {
            if inner.pending_global_chat == Some(expected_generation) {
                inner.pending_global_chat = None;
            }
            return Err(connection);
        }
        inner.pending_global_chat = None;
        inner.global_chat = Some(ChatLink {
            connection,
            generation: expected_generation,
        });
        Ok(expected_generation)
    }

    /// 入库通知句柄。会话已变、代次对不上或已有通知连接时交回句柄。
    pub fn install_notice_connection(
        &self,
        expected_session: u64,
        expected_generation: u64,
        connection: NoticeConnection,
    ) -> Result<u64, NoticeConnection> {
        let mut inner = self.lock();
        let pending_ok = inner.pending_notice == Some(expected_generation);
        if inner.session_generation != expected_session || inner.notice.is_some() || !pending_ok
        {
            if inner.pending_notice == Some(expected_generation) {
                inner.pending_notice = None;
            }
            return Err(connection);
        }
        inner.pending_notice = None;
        inner.notice = Some(NoticeLink {
            connection,
            generation: expected_generation,
        });
        Ok(expected_generation)
    }

    /// 取出指定用户私聊连接。无连接时返回 `None`（幂等）。
    pub fn take_user_chat(&self, user: &str) -> Option<ChatConnection> {
        let key = normalize_user(user);
        let mut inner = self.lock();
        inner.pending_chats.remove(&key);
        inner.chats.remove(&key).map(|link| link.connection)
    }

    /// 取出全局 chat 连接。
    pub fn take_global_chat(&self) -> Option<ChatConnection> {
        let mut inner = self.lock();
        inner.pending_global_chat = None;
        inner.global_chat.take().map(|link| link.connection)
    }

    /// 取出通知连接。
    pub fn take_notice_connection(&self) -> Option<NoticeConnection> {
        let mut inner = self.lock();
        inner.pending_notice = None;
        inner.notice.take().map(|link| link.connection)
    }

    /// 经已建立的用户连接发送私聊。没有连接时返回业务错误，禁止用 HTTP 假装成功。
    ///
    /// `ChatConnection::send` 是同步入队，持锁期间不 `.await`。
    /// 外层 `Err` 是「没连接」；内层是 SDK 入队结果，由 command 映射 `accepted` / `outcomeUnknown`。
    pub fn send_user_chat(
        &self,
        user: &str,
        content: &str,
    ) -> Result<Result<(), fishpi_sdk::utils::error::Error>, AppError> {
        let key = normalize_user(user);
        let inner = self.lock();
        let Some(link) = inner.chats.get(&key) else {
            return Err(AppError::business(
                "尚未连接该用户的私聊，请先打开会话后再发送",
            ));
        };
        Ok(link.connection.send(content))
    }

    /// 更新凭据是否已持久化。用于登录成功后写入 keyring 失败，仍保留本次会话。
    pub fn set_credential_saved(&self, saved: bool) {
        self.lock().credential_saved = saved;
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

fn normalize_user(user: &str) -> String {
    user.trim().to_ascii_lowercase()
}

fn take_live_connections(inner: &mut Inner) -> LiveConnections {
    inner.pending_chats.clear();
    inner.pending_global_chat = None;
    inner.pending_notice = None;
    LiveConnections {
        chatroom: inner.chatroom.take(),
        chats: inner
            .chats
            .drain()
            .map(|(key, link)| (key, link.connection))
            .collect(),
        global_chat: inner.global_chat.take().map(|link| link.connection),
        notice: inner.notice.take().map(|link| link.connection),
    }
}

fn replace_session_locked(
    inner: &mut Inner,
    client: FishPi,
    user: UserSummary,
    credential_saved: bool,
) -> SessionReplacement {
    inner.session_generation = inner.session_generation.saturating_add(1);
    inner.connection_generation = inner.connection_generation.saturating_add(1);
    inner.chat_generation_seq = inner.chat_generation_seq.saturating_add(1);
    inner.notice_generation = inner.notice_generation.saturating_add(1);
    let previous = take_live_connections(inner);
    inner.client = Some(client);
    inner.user = Some(user);
    inner.credential_saved = credential_saved;
    SessionReplacement {
        session_generation: inner.session_generation,
        previous,
    }
}
