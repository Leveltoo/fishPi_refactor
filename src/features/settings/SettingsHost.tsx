import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import packageJson from "../../../package.json";
import {
  loadChatroomFilters,
  lookupUserName,
  saveChatroomFilters,
  type ChatroomFilters,
  type ShieldKind,
} from "@/features/chatroom/chatroomApi";
import {
  extensionChooseDirectory,
  extensionLoadTheme,
  extensionScan,
  type ExtensionItem,
} from "@/features/extension/api";
import { applyLegacyTheme } from "@/features/extension/theme";
import {
  commandError,
  desktopPrefsGet,
  desktopPrefsSet,
  updateApply,
  updateCheck,
  updateOpenRelease,
  type UpdateApplyResult,
  type UpdateInfo,
} from "../desktop/api";
import { clampMusicMode, MUSIC_MODE_OPTIONS } from "../music/modes";
import {
  getPlayerSnapshot,
  setPlayerMode,
  subscribePlayer,
} from "../music/playerStore";
import { OPACITY_PERCENT_MAX, OPACITY_PERCENT_MIN } from "./constants";
import { useDesktopSettings } from "./useDesktopSettings";
import "./settings.css";

const APP_VERSION = packageJson.version;
const FILTER_SAVE_DELAY_MS = 350;

const SHIELD_OPTIONS: Array<{ value: ShieldKind; text: string }> = [
  { value: "username", text: "用户" },
  { value: "content", text: "内容(支持正则)" },
  { value: "redpacket", text: "红包" },
];

function subscribePlayerMode(listener: () => void): () => void {
  return subscribePlayer(listener);
}

function playerModeSnapshot(): number {
  return getPlayerSnapshot().mode;
}

export function SettingsHost() {
  const desktop = useDesktopSettings();
  const settings = desktop.settings;
  const opacityPercent = Math.round(settings.opacity * 100);
  const musicMode = useSyncExternalStore(
    subscribePlayerMode,
    playerModeSnapshot,
    playerModeSnapshot,
  );

  const [mirror, setMirror] = useState("");
  const [extensionRoot, setExtensionRoot] = useState("");
  const [theme, setTheme] = useState("Default");
  const [themes, setThemes] = useState<ExtensionItem[]>([]);
  const [error, setError] = useState("");

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [applyResult, setApplyResult] = useState<UpdateApplyResult | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadPrefs(): Promise<void> {
      try {
        const prefs = await desktopPrefsGet();
        if (!alive) return;
        setMirror(prefs.updateMirror);
        setExtensionRoot(prefs.extensionRoot);
        setTheme(prefs.theme || "Default");
        setPlayerMode(clampMusicMode(prefs.musicMode));
        await loadThemes(prefs.extensionRoot, alive);
        await applyExtensionTheme(prefs.theme || "Default", prefs.extensionRoot, alive);
      } catch (err) {
        if (alive) setError(commandError(err));
      }
    }
    void loadPrefs();
    const stop = listen("desktop://prefs-changed", () => {
      if (alive) void loadPrefs();
    });
    return () => {
      alive = false;
      void stop.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    void runUpdateCheck(false);
  }, []);

  async function loadThemes(root: string, alive = true): Promise<void> {
    try {
      const scan = await extensionScan(root.trim() || undefined);
      if (alive) setThemes(scan.themes);
    } catch {
      if (alive) setThemes([]);
    }
  }

  async function applyExtensionTheme(
    nextTheme: string,
    root: string,
    alive = true,
  ): Promise<void> {
    try {
      if (nextTheme === "Default") {
        applyLegacyTheme("");
        return;
      }
      const loaded = await extensionLoadTheme(nextTheme, root.trim() || undefined);
      if (alive) applyLegacyTheme(loaded.css);
    } catch (err) {
      if (alive) setError(commandError(err));
    }
  }

  async function saveMirror(): Promise<void> {
    setError("");
    try {
      const prefs = await desktopPrefsSet({ updateMirror: mirror.trim() });
      setMirror(prefs.updateMirror);
    } catch (err) {
      setError(commandError(err));
    }
  }

  async function saveExtensionRoot(): Promise<void> {
    setError("");
    try {
      const prefs = await desktopPrefsSet({ extensionRoot: extensionRoot.trim() });
      setExtensionRoot(prefs.extensionRoot);
      await loadThemes(prefs.extensionRoot);
      await applyExtensionTheme(theme, prefs.extensionRoot);
    } catch (err) {
      setError(commandError(err));
    }
  }

  async function chooseExtensionRoot(): Promise<void> {
    try {
      const chosen = await extensionChooseDirectory(extensionRoot.trim() || undefined);
      if (chosen == null) return;
      setExtensionRoot(chosen);
      const prefs = await desktopPrefsSet({ extensionRoot: chosen });
      setExtensionRoot(prefs.extensionRoot);
      await loadThemes(prefs.extensionRoot);
      await applyExtensionTheme(theme, prefs.extensionRoot);
    } catch (err) {
      setError(commandError(err));
    }
  }

  async function selectTheme(next: string): Promise<void> {
    setTheme(next);
    try {
      const prefs = await desktopPrefsSet({ theme: next });
      setTheme(prefs.theme);
      await applyExtensionTheme(prefs.theme, extensionRoot);
    } catch (err) {
      setError(commandError(err));
    }
  }

  async function changeMusicMode(nextMode: number): Promise<void> {
    const next = clampMusicMode(nextMode);
    setPlayerMode(next);
    try {
      const prefs = await desktopPrefsSet({ musicMode: next });
      setPlayerMode(prefs.musicMode);
    } catch (err) {
      setError(commandError(err));
    }
  }

  async function runUpdateCheck(showError = true): Promise<void> {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    if (showError) setError("");
    try {
      setUpdate(await updateCheck());
    } catch (err) {
      if (showError) setError(commandError(err));
    } finally {
      setCheckingUpdate(false);
    }
  }

  function updateButton(): void {
    if (update != null && !update.upToDate) {
      setApplyResult(null);
      setUpdateOpen(true);
      return;
    }
    void runUpdateCheck(true);
  }

  async function applyUpdate(): Promise<void> {
    if (updating) return;
    setUpdating(true);
    setError("");
    try {
      const result = await updateApply();
      setApplyResult(result);
      if (!result.downloaded && !result.installed) {
        setError(result.message || "更新失败");
      }
    } catch (err) {
      setError(commandError(err));
    } finally {
      setUpdating(false);
    }
  }

  async function openRelease(): Promise<void> {
    if (!update?.tag) return;
    try {
      await updateOpenRelease(update.tag);
    } catch (err) {
      setError(commandError(err));
    }
  }

  const updateLabel = checkingUpdate
    ? "检查中..."
    : update?.upToDate
      ? "已是最新"
      : update != null
        ? "开始更新"
        : "检查更新";

  return (
    <div id="setting" className="legacy-settings" aria-busy={desktop.loading}>
      <article className="settings">
        <section className="app-version">
          <p>
            <b>当前版本：</b>
            <span>{APP_VERSION}</span>
          </p>
          <p>
            <button
              type="button"
              className="legacy-btn legacy-btn--success legacy-btn--small"
              disabled={checkingUpdate || updating || update?.upToDate === true}
              onClick={updateButton}
            >
              {updateLabel}
            </button>
          </p>
        </section>

        <p className="app-version">
          <label htmlFor="update-mirror">更新镜像：</label>
          <input
            id="update-mirror"
            className="legacy-input"
            value={mirror}
            placeholder="更新镜像域名"
            spellCheck={false}
            onChange={(event) => setMirror(event.target.value)}
            onBlur={() => void saveMirror()}
          />
        </p>

        <SettingsSection title="通用">
          <FormRow label="透明窗体">
            <div className="opacity-form">
              <LegacySwitch
                checked={settings.opacityEnabled}
                title="透明窗体"
                onChange={desktop.setOpacityEnabled}
              />
              <input
                className="legacy-slider"
                type="range"
                title="透明度"
                min={OPACITY_PERCENT_MIN}
                max={OPACITY_PERCENT_MAX}
                disabled={!settings.opacityEnabled}
                value={opacityPercent}
                onChange={(event) =>
                  desktop.setOpacity(Number(event.target.value) / 100)
                }
              />
            </div>
          </FormRow>
          <FormRow label="窗口置顶">
            <LegacySwitch
              checked={settings.alwaysOnTop}
              title="窗口置顶"
              onChange={desktop.setAlwaysOnTop}
            />
          </FormRow>
          <FormRow label="昨日活跃">
            <LegacySwitch
              checked={settings.autoReward}
              title="自动领取"
              onChange={(autoReward) => desktop.update({ autoReward })}
            />
          </FormRow>
          <FormRow label="网易音乐">
            <select
              className="legacy-select"
              value={String(clampMusicMode(musicMode))}
              onChange={(event) => void changeMusicMode(Number(event.target.value))}
            >
              {MUSIC_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormRow>
        </SettingsSection>

        <SettingsSection title="聊天室">
          <ChatroomFiltersSection
            redpackNotice={settings.redpackNotice}
            onRedpackNotice={(redpackNotice) => desktop.update({ redpackNotice })}
          />
        </SettingsSection>

        <SettingsSection title="消息">
          <FormRow label="消息提示">
            <div className="legacy-checkboxes">
              <Checkbox
                label="聊天室新消息"
                checked={settings.notifyChatroom}
                onChange={(notifyChatroom) => desktop.update({ notifyChatroom })}
              />
              <Checkbox
                label="私聊新消息"
                checked={settings.notifyChat}
                onChange={(notifyChat) => desktop.update({ notifyChat })}
              />
              <Checkbox
                label="提及了我"
                checked={settings.notifyAt}
                onChange={(notifyAt) => desktop.update({ notifyAt })}
              />
              <Checkbox
                label="收到回复"
                checked={settings.notifyReply}
                onChange={(notifyReply) => desktop.update({ notifyReply })}
              />
              <Checkbox
                label="系统公告"
                checked={settings.notifySys}
                onChange={(notifySys) => desktop.update({ notifySys })}
              />
              <Checkbox
                label="聊天室聊到了"
                checked={settings.notifyTalk}
                onChange={(notifyTalk) => desktop.update({ notifyTalk })}
              />
              <input
                className="legacy-input legacy-input--small talk-pattern"
                value={settings.notifyTalkPattern}
                placeholder="内容正则"
                onChange={(event) =>
                  desktop.update({ notifyTalkPattern: event.target.value })
                }
              />
            </div>
          </FormRow>
          <FormRow label="提示方式">
            <div className="legacy-checkboxes">
              <Checkbox
                label="新消息声音"
                checked={settings.notifySound}
                onChange={(notifySound) => desktop.update({ notifySound })}
              />
              <Checkbox
                label="系统消息(聊天室除外)"
                checked={settings.notifySystem}
                onChange={(notifySystem) =>
                  desktop.update({
                    notifySystem,
                    notifyEnabled: notifySystem || settings.notifyEnabled,
                  })
                }
              />
            </div>
          </FormRow>
        </SettingsSection>

        <SettingsSection title="快捷键">
          <FormRow label="老板键">
            <HotkeyInput value={settings.bossKey} onChange={desktop.setBossKey} />
          </FormRow>
        </SettingsSection>

        <SettingsSection title="扩展">
          <FormRow label="扩展目录">
            <div className="legacy-input-group">
              <input
                className="legacy-input"
                value={extensionRoot}
                placeholder="扩展加载根目录"
                spellCheck={false}
                onChange={(event) => setExtensionRoot(event.target.value)}
                onBlur={() => void saveExtensionRoot()}
              />
              <button
                type="button"
                className="legacy-input-group__append"
                title="选择扩展目录"
                aria-label="选择扩展目录"
                onClick={() => void chooseExtensionRoot()}
              >
                <i className="fa fa-folder-open" aria-hidden="true" />
              </button>
            </div>
          </FormRow>
          <FormRow label="主题">
            <select
              className="legacy-select"
              value={theme}
              onChange={(event) => void selectTheme(event.target.value)}
            >
              <option value="Default">默认</option>
              {theme !== "Default" &&
              !themes.some((item) => item.key === theme) ? (
                <option value={theme}>{theme}</option>
              ) : null}
              {themes.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.description || item.displayName || item.name}
                </option>
              ))}
            </select>
          </FormRow>
        </SettingsSection>

        {error || desktop.notice?.kind === "error" ? (
          <p className="settings-error" role="alert">
            {error || desktop.notice?.text}
          </p>
        ) : null}
      </article>

      {updateOpen && update ? (
        <section className="update-card" role="dialog" aria-modal="true" aria-label="检查更新">
          <header>{update.name || update.tag}</header>
          <section className="update-time">
            {formatDate(update.publishedAt)}
          </section>
          <section className="update-note">{update.body}</section>
          <footer>
            <button
              type="button"
              className="legacy-btn legacy-btn--success update-button"
              disabled={updating}
              onClick={() => void applyUpdate()}
            >
              {updating ? "下载中..." : "更新"}
            </button>
            {applyResult ? (
              <p className="update-result">{applyResult.message}</p>
            ) : null}
            {applyResult && !applyResult.downloaded && !applyResult.installed ? (
              <button
                type="button"
                className="legacy-btn legacy-btn--default"
                onClick={() => void openRelease()}
              >
                打开发布页
              </button>
            ) : null}
          </footer>
        </section>
      ) : null}
    </div>
  );
}

function ChatroomFiltersSection({
  redpackNotice,
  onRedpackNotice,
}: {
  redpackNotice: boolean;
  onRedpackNotice: (checked: boolean) => void;
}) {
  const [filters, setFilters] = useState<ChatroomFilters>({ shield: [], careUsers: [] });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [careDraft, setCareDraft] = useState("");
  const [error, setError] = useState("");
  const timer = useRef(0);
  const revision = useRef(0);

  useEffect(() => {
    let alive = true;
    async function refresh(): Promise<void> {
      const current = ++revision.current;
      try {
        const loaded = await loadChatroomFilters();
        if (alive && current === revision.current) {
          setFilters(loaded);
          setReady(true);
        }
      } catch (err) {
        if (alive && current === revision.current) {
          setReady(false);
          setError(commandError(err));
        }
      }
    }
    void refresh();
    const stop = listen<{ filtersSaved?: boolean }>("desktop://config-imported", (event) => {
      if (!event.payload?.filtersSaved) return;
      window.clearTimeout(timer.current);
      setReady(false);
      void refresh();
    });
    return () => {
      alive = false;
      revision.current += 1;
      window.clearTimeout(timer.current);
      void stop.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  async function persist(next: ChatroomFilters): Promise<void> {
    if (!ready) return;
    const current = revision.current;
    setBusy(true);
    try {
      const saved = await saveChatroomFilters(next);
      if (current === revision.current) {
        setFilters(saved);
        setError("");
      }
    } catch (err) {
      if (current === revision.current) setError(commandError(err));
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }

  function schedule(next: ChatroomFilters): void {
    setFilters(next);
    window.clearTimeout(timer.current);
    const current = revision.current;
    timer.current = window.setTimeout(() => {
      if (current === revision.current) void persist(next);
    }, FILTER_SAVE_DELAY_MS);
  }

  async function addCareUser(): Promise<void> {
    const name = careDraft.trim();
    if (!ready || !name || filters.careUsers.includes(name) || busy) return;
    setBusy(true);
    try {
      const found = await lookupUserName(name);
      if (found !== name) {
        toast.error("用户名不存在");
        return;
      }
      const saved = await saveChatroomFilters({
        ...filters,
        careUsers: [...filters.careUsers, name],
      });
      setFilters(saved);
      setCareDraft("");
    } catch (err) {
      setError(commandError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeCareUser(name: string): Promise<void> {
    if (!ready || busy) return;
    window.clearTimeout(timer.current);
    await persist({
      ...filters,
      careUsers: filters.careUsers.filter((item) => item !== name),
    });
  }

  return (
    <>
      <FormRow label="消息屏蔽">
        <div className="shield-list">
          {filters.shield.map((rule, index) => (
            <section className="shield-item" key={`${rule.type}-${index}`}>
              <select
                className="legacy-select shield-type"
                aria-label="屏蔽类型"
                value={rule.type}
                onChange={(event) => {
                  const type = event.target.value as ShieldKind;
                  schedule({
                    ...filters,
                    shield: filters.shield.map((item, itemIndex) =>
                      itemIndex === index
                        ? { type, value: type === "redpacket" ? "" : item.value }
                        : item,
                    ),
                  });
                }}
              >
                {SHIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.text}
                  </option>
                ))}
              </select>
              {rule.type !== "redpacket" ? (
                <input
                  className="legacy-input shield-value"
                  value={rule.value}
                  placeholder={rule.type === "username" ? "用户名" : "正则"}
                  onChange={(event) =>
                    schedule({
                      ...filters,
                      shield: filters.shield.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              ) : null}
              <button
                type="button"
                className="legacy-text-btn"
                title="删除"
                aria-label="删除屏蔽规则"
                onClick={() =>
                  schedule({
                    ...filters,
                    shield: filters.shield.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <i className="fa fa-trash-o" aria-hidden="true" />
              </button>
            </section>
          ))}
          <button
            type="button"
            className="shield-add"
            title="添加屏蔽"
            aria-label="添加屏蔽"
            onClick={() =>
              schedule({
                ...filters,
                shield: [...filters.shield, { type: "username", value: "" }],
              })
            }
          >
            <i className="fa fa-plus" aria-hidden="true" />
          </button>
        </div>
      </FormRow>
      <FormRow label="特别关心">
        <div className="care-users">
          {filters.careUsers.map((name) => (
            <span className="legacy-tag" key={name}>
              {name}
              <button
                type="button"
                title="移除"
                aria-label={`移除特别关心 ${name}`}
                onClick={() => void removeCareUser(name)}
              >
                <i className="ivu-icon ivu-icon-ios-close" aria-hidden="true" />
              </button>
            </span>
          ))}
          <div className="care-add">
            <button
              type="button"
              className="care-add__button"
              title="添加特别关心"
              aria-label="添加特别关心"
              disabled={busy || careDraft.trim().length === 0}
              onClick={() => void addCareUser()}
            >
              <i className="ivu-icon ivu-icon-ios-add" aria-hidden="true" />
            </button>
            <input
              className="care-add__input"
              value={careDraft}
              placeholder="用户名"
              onChange={(event) => setCareDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addCareUser();
                }
              }}
            />
          </div>
        </div>
      </FormRow>
      <FormRow label="红包提醒">
        <LegacySwitch
          checked={redpackNotice}
          title="红包提醒"
          onChange={onRedpackNotice}
        />
      </FormRow>
      {error ? <p className="settings-error">{error}</p> : null}
    </>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="legacy-divider">
        <span>{title}</span>
      </div>
      <div className="setting-form">{children}</div>
    </section>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="legacy-form-item">
      <div className="legacy-form-label">{label}</div>
      <div className="legacy-form-control">{children}</div>
    </div>
  );
}

function LegacySwitch({
  checked,
  title,
  onChange,
}: {
  checked: boolean;
  title: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      aria-label={title}
      className={checked ? "legacy-switch is-checked" : "legacy-switch"}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="legacy-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function HotkeyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setListening(false);
        return;
      }
      const combo = readHotkey(event);
      if (!combo) return;
      event.preventDefault();
      setListening(false);
      onChange(combo);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening, onChange]);

  return (
    <button
      type="button"
      className={listening ? "legacy-hotkey is-listening" : "legacy-hotkey"}
      aria-pressed={listening}
      onBlur={() => setListening(false)}
      onClick={() => setListening((current) => !current)}
    >
      {listening ? "请按下组合按键" : displayHotkey(value)}
    </button>
  );
}

function readHotkey(event: KeyboardEvent): string | null {
  if (
    event.key === "Control" ||
    event.key === "Shift" ||
    event.key === "Alt" ||
    event.key === "Meta"
  ) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("SUPER");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = hotkeyToken(event);
  if (!key || parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

function displayHotkey(value: string): string {
  return value
    .split("+")
    .map((part) => {
      const token = part.trim();
      return /^(SUPER|CMD|META|COMMAND)$/i.test(token) ? "Win" : token;
    })
    .filter(Boolean)
    .join("+");
}

function hotkeyToken(event: KeyboardEvent): string {
  if (event.key === " ") return "Space";
  if (event.key.length === 1) return event.key.toUpperCase();
  if (event.key.startsWith("Arrow")) return event.key.slice("Arrow".length);
  return event.key;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
