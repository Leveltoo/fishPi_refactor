import {
  Bell,
  Leaf,
  ListMusic,
  MessageSquare,
  MessagesSquare,
  Minus,
  Network,
  PenLine,
  Pin,
  Plus,
  Search,
  Settings,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActivityHost } from "@/features/activity";
import { useWindowLiveness } from "@/features/activity/useWindowLiveness";
import { ArticleHost } from "@/features/article";
import { BreezemoonHost } from "@/features/breezemoon";
import { PrivateChatHost } from "@/features/im";
import { useImUnreadTotal } from "@/features/im/unreadBus";
import { OverlayHost } from "@/features/overlay";
import { RedPacketHost } from "@/features/redpacket";
import { DesktopMount, ExtensionMount, PlaylistMount } from "@/features/desktop/mounts";
import { SettingsHost } from "@/features/settings";
import {
  invokeAlwaysOnTop,
  invokeSettingsSet,
  normalizeSettings,
} from "@/features/settings/api";
import { DEFAULT_SETTINGS } from "@/features/settings/constants";
import {
  currentDesktopSettings,
  publishDesktopSettings,
  subscribeDesktopSettings,
} from "@/features/settings/settingsStore";
import { FishMark } from "./FishMark";
import { HeaderMusic } from "./HeaderMusic";
import { OPEN_IM_EVENT, OPEN_SETTINGS_EVENT } from "../../lib/nav";
import {
  subscribeHeaderTitle,
  type HeaderTitleDetail,
} from "../../lib/headerTitle";
import { LivenessEdge } from "./LivenessEdge";
import { avatarInitial, displayName, type ShellUser } from "./session-snapshot";
import { useAutoReward } from "./useAutoReward";
import { useMessageNotices } from "./useMessageNotices";
import { useStartupUpdateCheck } from "./useStartupUpdateCheck";
import { WarnBroadcastDialog } from "./WarnBroadcast";
import {
  closeMainWindow,
  hideMainToTray,
  toggleWindowOpacity,
} from "./windowActions";
import "./AppShell.css";

type AppShellProps = {
  user: ShellUser;
  persistWarning?: string;
  loggingOut?: boolean;
  onLogout: () => void;
  children: ReactNode;
};

type MainPage =
  | "chatroom"
  | "im"
  | "article"
  | "breezemoon"
  | "activity"
  | "music"
  | "settings";

const MAIN_NAV: { id: MainPage; label: string; Icon: LucideIcon }[] = [
  { id: "chatroom", label: "聊天室", Icon: MessageSquare },
  { id: "im", label: "私聊", Icon: MessagesSquare },
  { id: "article", label: "帖子", Icon: PenLine },
  { id: "breezemoon", label: "清风明月", Icon: Leaf },
  { id: "activity", label: "活动（签到/通知）", Icon: Bell },
  { id: "music", label: "播放列表", Icon: ListMusic },
];

const PAGE_TITLES: Record<MainPage, string> = {
  chatroom: "聊天室",
  im: "私聊",
  article: "帖子",
  breezemoon: "清风明月",
  activity: "活动",
  music: "播放列表",
  settings: "设置",
};

function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="shell-tooltip">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function navClass(active: boolean, current = false) {
  if (active && current) return "shell__nav-item is-active is-current";
  if (active) return "shell__nav-item is-active";
  return "shell__nav-item";
}

/** 顶栏右键粘贴：写入当前聚焦的 input/textarea/contenteditable；无焦点则读剪贴板不抛错。 */
async function pasteIntoActiveElement(): Promise<void> {
  const target = document.activeElement as
    | (HTMLInputElement | HTMLTextAreaElement & { isContentEditable?: boolean })
    | null;
  const editable =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !target.readOnly) ||
    (target != null && "isContentEditable" in target && target.isContentEditable);
  try {
    const text = await navigator.clipboard.readText();
    if (!editable || target == null || text.length === 0) {
      return;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const { selectionStart, selectionEnd, value } = target;
      const start = selectionStart ?? value.length;
      const end = selectionEnd ?? start;
      target.value = value.slice(0, start) + text + value.slice(end);
      const caret = start + text.length;
      target.setSelectionRange(caret, caret);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    document.execCommand("insertText", false, text);
  } catch {
    // 剪贴板权限不足：静默（与旧版 role paste 失败一致）
  }
}

function WinCtrlButton({
  label,
  className,
  Icon,
  customIcon,
  onClick,
  pressed,
}: {
  label: string;
  className?: string;
  Icon?: LucideIcon;
  /** 旧版透明钮是虚线圆 span，不是图标字 */
  customIcon?: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
}) {
  const classes = ["shell__win-btn"];
  if (className) {
    classes.push(className);
  }
  if (pressed) {
    classes.push("is-on");
  }
  return (
    <button
      type="button"
      className={classes.join(" ")}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {customIcon ?? (Icon ? <Icon /> : null)}
    </button>
  );
}

export function AppShell({
  user,
  persistWarning,
  loggingOut = false,
  onLogout,
  children,
}: AppShellProps) {
  const [page, setPage] = useState<MainPage>("chatroom");
  const [alwaysOnTop, setAlwaysOnTop] = useState(DEFAULT_SETTINGS.alwaysOnTop);
  const [settingsOpacity, setSettingsOpacity] = useState(
    DEFAULT_SETTINGS.opacity,
  );
  const [opacityEnabled, setOpacityEnabled] = useState(
    DEFAULT_SETTINGS.opacityEnabled,
  );
  const unread = useImUnreadTotal();
  const liveness = useWindowLiveness();
  const { broadcast, dismissBroadcast } = useMessageNotices(user.userName);
  useAutoReward();
  useStartupUpdateCheck();
  const name = displayName(user);
  const avatarSrc = user.userAvatarUrl || undefined;
  const [titleOverride, setTitleOverride] = useState<HeaderTitleDetail | null>(
    null,
  );
  const pageTitle =
    titleOverride?.page === page && titleOverride.title
      ? titleOverride.title
      : PAGE_TITLES[page];

  useEffect(() => {
    return subscribeDesktopSettings((snapshot) => {
      setAlwaysOnTop(snapshot.settings.alwaysOnTop);
      setSettingsOpacity(snapshot.settings.opacity);
      setOpacityEnabled(snapshot.settings.opacityEnabled);
    });
  }, []);

  useEffect(() => subscribeHeaderTitle(setTitleOverride), []);

  useEffect(() => {
    document.title = `摸鱼派 - ${pageTitle}`;
  }, [pageTitle]);

  useEffect(() => {
    function onOpenIm(): void {
      setPage("im");
    }
    function onOpenSettings(): void {
      setPage("settings");
    }
    window.addEventListener(OPEN_IM_EVENT, onOpenIm);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    return () => {
      window.removeEventListener(OPEN_IM_EVENT, onOpenIm);
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    };
  }, []);

  const onMinimize = useCallback(() => {
    void hideMainToTray();
  }, []);

  const onToggleOpacity = useCallback(() => {
    void toggleWindowOpacity(opacityEnabled, settingsOpacity).then(
      setOpacityEnabled,
    );
  }, [opacityEnabled, settingsOpacity]);

  const onTogglePin = useCallback(() => {
    void (async () => {
      const next = !alwaysOnTop;
      try {
        const result = await invokeAlwaysOnTop(next);
        setAlwaysOnTop(next);
        if (result.status === "ok") {
          const base = currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
          const settings = normalizeSettings({ ...base, alwaysOnTop: next });
          publishDesktopSettings({ ready: true, settings });
          void invokeSettingsSet(settings);
        }
      } catch {
        setAlwaysOnTop(next);
      }
    })();
  }, [alwaysOnTop]);

  const onClose = useCallback(() => {
    void closeMainWindow();
  }, []);

  return (
    <>
      <div className="shell">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <header className="shell__header">
              <div className="shell__header-title">
                <FishMark />
                <span className="shell__header-title-text">
                  摸鱼派 - {pageTitle}
                </span>
              </div>

              <div className="shell__header-mid">
                <HeaderMusic />

                <div
                  className="shell__header-slot shell__header-slot--cx shell__header-cx"
                  aria-hidden="true"
                >
                  <span className="shell__header-icon">
                    <Network />
                  </span>
                  <span className="shell__header-cx-status">
                    model stream · idle
                  </span>
                  <span className="shell__header-icon">
                    <Waves />
                  </span>
                </div>

                <div className="shell__header-slot shell__header-slot--ding">
                  <div className="shell__header-search">
                    <Search />
                    <span>搜索或提问 (Ctrl+Shift+F)</span>
                  </div>
                </div>

                <div className="shell__header-slot shell__header-slot--feishu shell__header-crumb">
                  <span className="shell__header-crumb-title">全部会话</span>
                  <span className="shell__header-pill shell__header-pill--ghost">
                    另存为
                  </span>
                  <span className="shell__header-pill">
                    <Plus />
                    新建
                  </span>
                </div>
              </div>

              <div
                className="shell__win-ctrl"
                title={
                  liveness != null && Number.isFinite(liveness)
                    ? `已摸鱼${Math.round(liveness)}%`
                    : undefined
                }
              >
                <WinCtrlButton label="最小化" Icon={Minus} onClick={onMinimize} />
                <WinCtrlButton
                  label="透明窗体"
                  className="win-opacity-btn"
                  customIcon={<span className="cirle-empty" aria-hidden="true" />}
                  pressed={opacityEnabled}
                  onClick={onToggleOpacity}
                />
                <WinCtrlButton
                  label="窗口置顶"
                  className="win-pin-btn"
                  Icon={Pin}
                  pressed={alwaysOnTop}
                  onClick={onTogglePin}
                />
                <WinCtrlButton
                  label="关闭"
                  className="is-close"
                  Icon={X}
                  onClick={onClose}
                />
              </div>
            </header>
          </ContextMenuTrigger>
          {/* 对齐旧版 header 默认菜单：复制 / 粘贴 */}
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => {
                void document.execCommand("copy");
              }}
            >
              复制
              <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void pasteIntoActiveElement();
              }}
            >
              粘贴
              <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <div className="shell__body">
          <aside className="shell__rail" aria-label="主导航">
            <div className="shell__brand" title="摸鱼派">
              <FishMark />
            </div>

            <nav className="shell__nav" aria-label="功能">
              {MAIN_NAV.map(({ id, label, Icon }) => {
                const current = page === id;
                return (
                  <RailTip key={id} label={label}>
                    <button
                      type="button"
                      className={navClass(current, current)}
                      aria-current={current ? "page" : undefined}
                      onClick={() => setPage(id)}
                    >
                      <Icon />
                      {id === "im" && unread > 0 ? (
                        <span className="shell__unread" aria-hidden="true">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      ) : null}
                      <span className="visually-hidden">
                        {label}
                        {id === "im" && unread > 0
                          ? `，${unread > 99 ? "99+" : unread} 条未读`
                          : ""}
                      </span>
                    </button>
                  </RailTip>
                );
              })}
            </nav>

            <Separator className="shell__rail-sep" />

            <div className="shell__account">
              <RailTip label="设置">
                <button
                  type="button"
                  className={navClass(page === "settings", page === "settings")}
                  aria-current={page === "settings" ? "page" : undefined}
                  onClick={() => setPage("settings")}
                >
                  <Settings />
                  <span className="visually-hidden">设置</span>
                </button>
              </RailTip>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="shell__account-trigger"
                  aria-label={`账号菜单：${name}`}
                  disabled={loggingOut}
                >
                  <Avatar className="shell__avatar">
                    <AvatarImage src={avatarSrc} alt="" />
                    <AvatarFallback aria-hidden="true">
                      {avatarInitial(user)}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  sideOffset={8}
                  className="shell-account-menu"
                >
                  <DropdownMenuLabel>{name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={loggingOut}
                    onSelect={() => onLogout()}
                  >
                    {loggingOut ? "退出中" : "退出"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </aside>

          <section className="shell__main">
            {persistWarning ? (
              <Alert className="shell__warning" role="status">
                <AlertDescription>{persistWarning}</AlertDescription>
              </Alert>
            ) : null}
            <div className="shell__content">
              <div className="shell__page" hidden={page !== "chatroom"}>
                {children}
              </div>
              <div className="shell__page" hidden={page !== "im"}>
                <PrivateChatHost />
              </div>
              <div className="shell__page" hidden={page !== "article"}>
                <ArticleHost />
              </div>
              <div className="shell__page" hidden={page !== "breezemoon"}>
                <BreezemoonHost />
              </div>
              <div className="shell__page" hidden={page !== "activity"}>
                <ActivityHost />
              </div>
              <div className="shell__page" hidden={page !== "music"}>
                <PlaylistMount />
              </div>
              <div
                className="shell__page shell__page--stack"
                hidden={page !== "settings"}
              >
                <SettingsHost />
                <DesktopMount />
                <ExtensionMount />
              </div>
            </div>
          </section>
        </div>
      </div>
      <RedPacketHost />
      <OverlayHost />
      <LivenessEdge percent={liveness} />
      <WarnBroadcastDialog broadcast={broadcast} onClose={dismissBroadcast} />
    </>
  );
}
