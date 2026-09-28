import { useEffect, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  loadChatroomFilters,
  lookupUserName,
  saveChatroomFilters,
  type ChatroomFilters,
  type ShieldKind,
  type ShieldRule,
} from "@/features/chatroom/chatroomApi";
import {
  BRIDGE_GAP_COPY,
  OPACITY_MAX,
  OPACITY_MIN,
  OPACITY_STEP,
  THEME_OPTIONS,
} from "./constants";
import { compileTalkPattern } from "./talkPattern";
import { useDesktopSettings } from "./useDesktopSettings";
import "./settings.css";

/**
 * 设置页宿主：无必填 props。命令缺失时本地可改，不假装已写入系统。
 */
export function SettingsHost() {
  const desktop = useDesktopSettings();
  const opacityPercent = Math.round(desktop.settings.opacity * 100);
  const talkPattern = compileTalkPattern(desktop.settings.notifyTalkPattern);

  return (
    <div className="settings" id="setting">
      <header className="settings-head">
        <p className="settings-kicker">桌面</p>
        <h1 className="settings-title">设置</h1>
        <p className="settings-lead">
          内置主题仍走受控 CSS 变量。本机扩展目录里的主题文件在本页下方加载，不拉取远程样式。
        </p>
      </header>

      {desktop.notice ? (
        <Alert
          className={
            desktop.notice.kind === "error"
              ? "settings-alert settings-alert--error"
              : desktop.notice.kind === "ok"
                ? "settings-alert settings-alert--ok"
                : "settings-alert"
          }
        >
          <WarningIcon />
          <AlertTitle>
            {desktop.notice.kind === "gap"
              ? BRIDGE_GAP_COPY
              : desktop.notice.kind === "ok"
                ? "通知"
                : "未能写入系统"}
          </AlertTitle>
          <AlertDescription>{desktop.notice.text}</AlertDescription>
        </Alert>
      ) : null}

      {desktop.loading ? (
        <p className="settings-loading">
          <Spinner />
          正在读取设置
        </p>
      ) : (
        <div className="settings-body">
          <section className="settings-section" aria-labelledby="settings-theme">
            <h2 id="settings-theme" className="settings-section__title">
              外观
            </h2>
            <div className="settings-themes" role="radiogroup" aria-label="主题">
              {THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={
                    desktop.settings.themeId === theme.id
                      ? "settings-theme is-active"
                      : "settings-theme"
                  }
                  role="radio"
                  aria-checked={desktop.settings.themeId === theme.id}
                  data-theme-preview={theme.id}
                  onClick={() => {
                    if (desktop.settings.themeId !== theme.id) {
                      desktop.setTheme(theme.id);
                    }
                  }}
                >
                  <span className="settings-theme__swatch" aria-hidden="true" />
                  <span className="settings-theme__label">{theme.label}</span>
                  <span className="settings-theme__blurb">{theme.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="settings-window">
            <h2 id="settings-window" className="settings-section__title">
              窗口
            </h2>
            <ToggleRow
              label="窗口置顶"
              description="保持主窗口在其他窗口之上。"
              pressed={desktop.settings.alwaysOnTop}
              onPressedChange={desktop.setAlwaysOnTop}
            />
            <div className="settings-row">
              <div className="settings-row__copy">
                <div className="settings-row__label" id="settings-opacity-label">
                  窗口透明度
                </div>
                <p className="settings-row__hint">
                  有效范围 30%–100%。当前 {opacityPercent}%。
                </p>
              </div>
              <input
                className="settings-range"
                type="range"
                min={OPACITY_MIN}
                max={OPACITY_MAX}
                step={OPACITY_STEP}
                value={desktop.settings.opacity}
                aria-labelledby="settings-opacity-label"
                onChange={(event) => {
                  desktop.setOpacity(Number(event.target.value));
                }}
              />
            </div>
            <ToggleRow
              label="关闭到托盘"
              description="点关闭时隐藏到托盘，而不是退出。由 Bridge 读配置生效。"
              pressed={desktop.settings.closeToTray}
              onPressedChange={desktop.setCloseToTray}
            />
          </section>

          <section className="settings-section" aria-labelledby="settings-hotkey">
            <h2 id="settings-hotkey" className="settings-section__title">
              快捷键
            </h2>
            <HotkeyRow
              label="老板键"
              description="全局隐藏或显示主窗口。经设置保存后由 Rust 注册。"
              value={desktop.settings.bossKey}
              onChange={desktop.setBossKey}
            />
          </section>

          <section className="settings-section" aria-labelledby="settings-notify">
            <h2 id="settings-notify" className="settings-section__title">
              通知
            </h2>
            <ToggleRow
              label="系统通知"
              description="允许桌面端弹出系统通知。权限失败时不会假装已发送。"
              pressed={desktop.settings.notifyEnabled}
              onPressedChange={desktop.setNotifyEnabled}
            />
            <div className="settings-row">
              <div className="settings-row__copy">
                <div className="settings-row__label">测试通知</div>
                <p className="settings-row__hint">用来确认系统通知权限。</p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={desktop.notifyTesting}
                onClick={() => {
                  void desktop.testNotify();
                }}
              >
                {desktop.notifyTesting ? "发送中" : "发送测试"}
              </Button>
            </div>
            <p className="settings-row__hint">
              关闭的类别不响、也不弹。系统消息还要打开上面的总开关。
            </p>
            <ToggleRow
              label="聊天室新消息"
              description="别人在聊天室发言时提示。自己的消息不提示。"
              pressed={desktop.settings.notifyChatroom}
              onPressedChange={(notifyChatroom) =>
                desktop.update({ notifyChatroom })
              }
            />
            <ToggleRow
              label="私聊新消息"
              description="收到闲置私聊时提示。"
              pressed={desktop.settings.notifyChat}
              onPressedChange={(notifyChat) => desktop.update({ notifyChat })}
            />
            <ToggleRow
              label="提及了我"
              description="未读的 @ 通知。"
              pressed={desktop.settings.notifyAt}
              onPressedChange={(notifyAt) => desktop.update({ notifyAt })}
            />
            <ToggleRow
              label="收到回复"
              description="未读的回复和评论。"
              pressed={desktop.settings.notifyReply}
              onPressedChange={(notifyReply) =>
                desktop.update({ notifyReply })
              }
            />
            <ToggleRow
              label="系统公告"
              description="未读的系统公告列表，不是紧急弹窗。"
              pressed={desktop.settings.notifySys}
              onPressedChange={(notifySys) => desktop.update({ notifySys })}
            />
            <ToggleRow
              label="聊天室聊到了"
              description="聊天室正文命中下面的正则时提示。"
              pressed={desktop.settings.notifyTalk}
              onPressedChange={(notifyTalk) => desktop.update({ notifyTalk })}
            />
            <div className="settings-row">
              <div className="settings-row__copy">
                <label className="settings-row__label" htmlFor="settings-talk-pattern">
                  内容正则
                </label>
                <p className="settings-row__hint">
                  {talkPattern === "invalid"
                    ? "这不是合法正则，匹配时会忽略并提示，不会把这段文字当代码执行。"
                    : "空正则不匹配任何消息。"}
                </p>
              </div>
              <Input
                id="settings-talk-pattern"
                className="settings-text"
                value={desktop.settings.notifyTalkPattern}
                placeholder="内容正则"
                spellCheck={false}
                onChange={(event) => {
                  desktop.update({ notifyTalkPattern: event.target.value });
                }}
              />
            </div>
            <ToggleRow
              label="新消息声音"
              description="类别打开时播放一声短提示。关闭则不响。"
              pressed={desktop.settings.notifySound}
              onPressedChange={(notifySound) =>
                desktop.update({ notifySound })
              }
            />
            <ToggleRow
              label="系统消息"
              description="类别打开且总开关打开时弹出系统通知。聊天室消息也会走这一项。"
              pressed={desktop.settings.notifySystem}
              onPressedChange={(notifySystem) =>
                desktop.update({ notifySystem })
              }
            />
          </section>

          <section className="settings-section" aria-labelledby="settings-reward">
            <h2 id="settings-reward" className="settings-section__title">
              活跃
            </h2>
            <ToggleRow
              label="自动领取昨日活跃"
              description="登录成功后尝试一次。默认关闭。失败不会显示成已领取。"
              pressed={desktop.settings.autoReward}
              onPressedChange={(autoReward) => desktop.update({ autoReward })}
            />
          </section>

          <ChatroomFiltersSection />
        </div>
      )}

      {desktop.saving ? (
        <p className="settings-status" role="status">
          正在保存
        </p>
      ) : null}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  pressed,
  onPressedChange,
}: {
  label: string;
  description: string;
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <div className="settings-row__label">{label}</div>
        <p className="settings-row__hint">{description}</p>
      </div>
      <Button
        type="button"
        className="settings-toggle"
        variant={pressed ? "default" : "outline"}
        aria-pressed={pressed}
        onClick={() => onPressedChange(!pressed)}
      >
        {pressed ? "开" : "关"}
      </Button>
    </div>
  );
}

const SHIELD_OPTIONS: Array<{ value: ShieldKind; text: string }> = [
  { value: "username", text: "用户" },
  { value: "content", text: "内容(支持正则)" },
  { value: "redpacket", text: "红包" },
];

/**
 * 聊天室屏蔽 / 特别关心：与聊天室 FilterPanel 共用 chatroom-filters.json。
 * 不复制规则语义，只调 chatroomApi 的 get/set。
 */
function ChatroomFiltersSection() {
  const [shield, setShield] = useState<ShieldRule[]>([]);
  const [careUsers, setCareUsers] = useState<string[]>([]);
  const [careDraft, setCareDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadChatroomFilters()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setShield(loaded.shield);
        setCareUsers(loaded.careUsers);
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取聊天室屏蔽失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next: ChatroomFilters): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveChatroomFilters(next);
      setShield(saved.shield);
      setCareUsers(saved.careUsers);
      toast.success("已保存屏蔽与特别关心");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addCare(): Promise<void> {
    const name = careDraft.trim();
    if (name.length === 0 || careUsers.includes(name) || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await lookupUserName(name);
      if (found !== name) {
        setError("用户名不存在");
        toast.error("用户名不存在");
        return;
      }
      const ok = await persist({
        shield,
        careUsers: [...careUsers, name],
      });
      if (ok) {
        setCareDraft("");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "添加失败";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="settings-section"
      aria-labelledby="settings-chat-filters"
    >
      <h2 id="settings-chat-filters" className="settings-section__title">
        消息屏蔽 / 特别关心
      </h2>
      <p className="settings-row__hint">
        仅存本机 chatroom-filters.json，不写登录凭据。也可在聊天室顶栏「屏蔽」里编辑。
      </p>
      {error ? (
        <p className="settings-row__hint settings-filter-error" role="status">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="settings-loading">
          <Spinner />
          正在读取屏蔽规则
        </p>
      ) : (
        <>
          <div className="settings-row__label">消息屏蔽</div>
          <ul className="settings-filter-list">
            {shield.length === 0 ? (
              <li className="settings-filter-empty">暂无屏蔽规则</li>
            ) : (
              shield.map((rule, index) => (
                <li
                  key={`${rule.type}-${index}`}
                  className="settings-filter-row"
                >
                  <select
                    className="settings-filter-select"
                    value={rule.type}
                    aria-label="屏蔽类型"
                    onChange={(event) => {
                      const type = event.target.value as ShieldKind;
                      setShield((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, type } : item,
                        ),
                      );
                    }}
                  >
                    {SHIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.text}
                      </option>
                    ))}
                  </select>
                  {rule.type === "redpacket" ? (
                    <span className="settings-filter-readonly">全部红包</span>
                  ) : (
                    <Input
                      className="settings-text settings-filter-value"
                      value={rule.value}
                      placeholder={rule.type === "username" ? "用户名" : "正则"}
                      onChange={(event) => {
                        const value = event.target.value;
                        setShield((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value } : item,
                          ),
                        );
                      }}
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setShield((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      );
                    }}
                  >
                    删除
                  </Button>
                </li>
              ))
            )}
          </ul>
          <div className="settings-filter-actions">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setShield((current) => [
                  ...current,
                  { type: "username", value: "" },
                ]);
              }}
            >
              加一条屏蔽
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                void persist({ shield, careUsers });
              }}
            >
              {busy ? "保存中" : "保存屏蔽"}
            </Button>
          </div>

          <div className="settings-row__label">特别关心</div>
          <div className="settings-filter-care">
            {careUsers.length === 0 ? (
              <span className="settings-filter-empty">暂无特别关心</span>
            ) : (
              careUsers.map((name) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void persist({
                      shield,
                      careUsers: careUsers.filter((item) => item !== name),
                    });
                  }}
                >
                  {name} ×
                </Button>
              ))
            )}
          </div>
          <form
            className="settings-filter-actions"
            onSubmit={(event) => {
              event.preventDefault();
              void addCare();
            }}
          >
            <Input
              className="settings-text settings-filter-value"
              value={careDraft}
              placeholder="用户名"
              onChange={(event) => setCareDraft(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || careDraft.trim().length === 0}
            >
              添加关心
            </Button>
          </form>
        </>
      )}
    </section>
  );
}

function HotkeyRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setListening(false);
        return;
      }
      const combo = readHotkey(event);
      if (!combo) {
        return;
      }
      event.preventDefault();
      setListening(false);
      onChange(combo);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [listening, onChange]);

  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <div className="settings-row__label">{label}</div>
        <p className="settings-row__hint">{description}</p>
      </div>
      <Button
        type="button"
        variant={listening ? "default" : "outline"}
        aria-pressed={listening}
        onBlur={() => setListening(false)}
        onClick={() => setListening((current) => !current)}
      >
        {listening ? "按下组合键" : value}
      </Button>
    </div>
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
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.metaKey) {
    parts.push("Win");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  const key = hotkeyToken(event);
  if (!key || parts.length === 0) {
    return null;
  }
  parts.push(key);
  return parts.join("+");
}

function hotkeyToken(event: KeyboardEvent): string {
  const { key } = event;
  if (key === " ") {
    return "Space";
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  if (key.startsWith("Arrow")) {
    return key.slice("Arrow".length);
  }
  return key;
}
