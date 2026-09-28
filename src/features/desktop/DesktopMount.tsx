import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commandError,
  configImport,
  desktopPrefsGet,
  desktopPrefsSet,
  reconnectNow,
  reconnectWatch,
  updateApply,
  updateCheck,
  updateOpenRelease,
  type ImportResult,
  type ReconnectReport,
  type UpdateApplyResult,
  type UpdateInfo,
  type WatchReport,
} from "./api";
import { loadOffline, mergeOffline, messagePreview, type OfflineSnapshot } from "./offline";
import "./panel.css";

const RECONNECT_EVENT = "desktop://reconnect";

/**
 * 设置页可挂载的桌面入口：检查更新、导入旧配置、重连状态、本地消息。
 * 父组件必须自己把它放进界面，本文件不改 AppShell。
 */
export function DesktopMount() {
  const [mirror, setMirror] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [applied, setApplied] = useState<UpdateApplyResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [watch, setWatch] = useState<WatchReport | null>(null);
  const [reconnect, setReconnect] = useState<ReconnectReport | null>(null);
  const [offline, setOffline] = useState<OfflineSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void desktopPrefsGet()
      .then((prefs) => {
        if (alive) {
          setMirror(prefs.updateMirror);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(commandError(err));
        }
      });
    void reconnectWatch()
      .then((report) => {
        if (alive) {
          setWatch(report);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(commandError(err));
        }
      });
    void loadOffline()
      .then((snapshot) => {
        if (alive) {
          setOffline(snapshot);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(commandError(err));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<ReconnectReport>(RECONNECT_EVENT, (event) => {
      setReconnect(event.payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const stops: Array<Promise<() => void>> = [];
    stops.push(
      listen<Record<string, unknown>>("chatroom://msg", (event) => {
        void mergeOffline({ scope: "chatroom", messages: [event.payload] })
          .then(setOffline)
          .catch((err: unknown) => setError(commandError(err)));
      }),
    );
    stops.push(
      listen<Record<string, unknown>>("chat://msg", (event) => {
        const peer = typeof event.payload.userName === "string" ? event.payload.userName : "";
        const message = event.payload.message;
        if (!peer || message == null || typeof message !== "object") {
          return;
        }
        void mergeOffline({ scope: "chat", peer, messages: [message] })
          .then(setOffline)
          .catch((err: unknown) => setError(commandError(err)));
      }),
    );
    return () => {
      for (const stop of stops) {
        void stop.then((fn) => fn());
      }
    };
  }, []);

  async function saveMirror(): Promise<void> {
    setError("");
    try {
      const prefs = await desktopPrefsSet({ updateMirror: mirror.trim() });
      setMirror(prefs.updateMirror);
    } catch (err: unknown) {
      setError(commandError(err));
    }
  }

  async function check(): Promise<void> {
    setBusy("check");
    setError("");
    setApplied(null);
    try {
      setUpdate(await updateCheck());
    } catch (err: unknown) {
      setUpdate(null);
      setError(commandError(err));
    } finally {
      setBusy("");
    }
  }

  async function apply(): Promise<void> {
    setBusy("apply");
    setError("");
    setApplied(null);
    try {
      const result = await updateApply();
      setApplied(result);
      if (!result.installed) {
        setError(result.message || "没有安装");
      }
    } catch (err: unknown) {
      setError(commandError(err));
    } finally {
      setBusy("");
    }
  }

  async function openRelease(): Promise<void> {
    if (!update?.tag) {
      return;
    }
    setError("");
    try {
      await updateOpenRelease(update.tag);
    } catch (err: unknown) {
      setError(commandError(err));
    }
  }

  async function importLegacy(): Promise<void> {
    setBusy("import");
    setError("");
    setImported(null);
    try {
      const result = await configImport();
      setImported(result);
      if (!result.found) {
        setError(result.message);
      }
      const prefs = await desktopPrefsGet();
      setMirror(prefs.updateMirror);
    } catch (err: unknown) {
      setError(commandError(err));
    } finally {
      setBusy("");
    }
  }

  async function reconnectOnce(): Promise<void> {
    setBusy("reconnect");
    setError("");
    try {
      setReconnect(await reconnectNow());
    } catch (err: unknown) {
      setError(commandError(err));
    } finally {
      setBusy("");
    }
  }

  const localLines = (offline?.chatroom ?? []).slice(-8).map(messagePreview);
  const chatCount = Object.keys(offline?.chats ?? {}).length;
  const failed = offline?.failed ?? [];

  return (
    <section className="parity-panel" aria-label="桌面">
      <section className="parity-section">
        <h2>检查更新</h2>
        <div className="parity-row">
          <button type="button" disabled={busy !== ""} onClick={() => void check()}>
            {busy === "check" ? "正在检查" : "检查更新"}
          </button>
          <button
            type="button"
            disabled={busy !== "" || update == null || update.upToDate}
            onClick={() => void apply()}
          >
            {busy === "apply" ? "正在下载" : "下载安装包"}
          </button>
          <button type="button" disabled={!update?.tag} onClick={() => void openRelease()}>
            打开发布页
          </button>
        </div>
        <label className="parity-row">
          更新镜像
          <input
            value={mirror}
            placeholder="留空则用 dgm.librejo.cn"
            onChange={(event) => setMirror(event.target.value)}
            onBlur={() => void saveMirror()}
          />
        </label>
        {update ? (
          <p className="parity-note">
            当前 {update.current}
            {update.upToDate
              ? "，已是最新"
              : `，最新 ${update.tag}${update.assetName ? `（${update.assetName}）` : ""}`}
          </p>
        ) : (
          <p className="parity-note">还没有检查。失败不会显示成已是最新。</p>
        )}
        {update && !update.upToDate ? <p className="parity-note">{update.body}</p> : null}
        {applied ? (
          <p className={applied.installed ? "parity-note" : "parity-error"}>
            {applied.installed ? "已安装" : "没有安装。"} {applied.message}
          </p>
        ) : null}
      </section>

      <section className="parity-section">
        <h2>导入旧客户端</h2>
        <div className="parity-row">
          <button type="button" disabled={busy !== ""} onClick={() => void importLegacy()}>
            {busy === "import" ? "正在读取" : "导入旧配置"}
          </button>
        </div>
        <p className="parity-note">
          只读 %APPDATA%\fishpi-app 和 %APPDATA%\fishpi 的 Local Storage。找不到不会当成导入成功。
        </p>
        {imported ? <p className="parity-note">{imported.message}</p> : null}
      </section>

      <section className="parity-section">
        <h2>重连</h2>
        <p className="parity-note">{watch?.message ?? "还没有注册系统监听。"}</p>
        <div className="parity-row">
          <button type="button" disabled={busy !== ""} onClick={() => void reconnectOnce()}>
            {busy === "reconnect" ? "正在尝试" : "重连一次"}
          </button>
        </div>
        {reconnect ? (
          <p className="parity-note">
            {reconnect.message} 聊天室：{reconnect.chatroom}。私聊：{reconnect.chat}。通知：
            {reconnect.notice}。
          </p>
        ) : null}
      </section>

      <section className="parity-section">
        <h2>本地消息</h2>
        <p className="parity-note">
          先显示已保存的记录。在线消息到达后才合并。离线发送失败保持失败。
        </p>
        {localLines.length === 0 ? <p className="parity-note">还没有本地聊天室记录。</p> : null}
        <p className="parity-note">本地私聊会话 {chatCount} 个。</p>
        <ul className="parity-list">
          {localLines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
        {failed.length === 0 ? null : (
          <ul className="parity-list">
            {failed.slice(-8).map((item) => (
              <li key={`${item.scope}-${item.peer}-${item.clientId}`}>
                发送失败：{item.preview || item.clientId}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error ? <p className="parity-error">{error}</p> : null}
    </section>
  );
}
