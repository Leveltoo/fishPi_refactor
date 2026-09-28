import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toast } from "sonner";
import type { ChatMessageDto } from "../../../lib/types";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { canReplyMessage, canRevokeMessage, isModeratorRole } from "../permissions";
import {
  dispatchRedpacketOpen,
  dispatchRedpacketSend,
  isRedpacketMessage,
  FISHPI_REDPACKET_EVENT,
  toRedpacketDetail,
  type FishpiRedpacketDetail,
} from "../redpacketEvents";
import { displayNameOf, messagePlainBody } from "../replyQuote";
import {
  asRich,
  safeCssColor,
  usernameShielded,
  viaLabel,
  type AlsoSaid,
} from "../messageView";
import type { ShieldRule } from "../chatroomApi";
import {
  playlistHasSong,
  playNeteaseSong,
  removeNeteaseSong,
} from "@/features/music";
import {
  chatroomMessageUrl,
  copyImageFromSrc,
  copyText,
  emojiCodeFromSrc,
  openPrivateChat,
} from "../userMenuActions";
import { UserContextMenu } from "./UserContextMenu";
import { userCardProps } from "../../usercard/hover";
import { MarkdownView } from "./MarkdownView";
import { ChatHtmlView, looksLikeHtml } from "./ChatHtmlView";
import { MusicCard } from "./MusicCard";
import { WeatherCard } from "./WeatherCard";

type MessageItemProps = {
  message: ChatMessageDto;
  alsoSaid: AlsoSaid[];
  showPlusOne: boolean;
  cared: boolean;
  careNames: ReadonlySet<string>;
  shield: ShieldRule[];
  selfUserName: string | null;
  selfRole: string | null;
  onReply: (message: ChatMessageDto) => void;
  onRevoke: (messageId: string) => Promise<void>;
  onPlusOne: (message: ChatMessageDto) => void;
  onMention: (userName: string) => void;
  onInsertToken?: (token: string) => void;
  onAddEmoji?: (url: string) => void;
  /** 该红包的领取人（用户名，按到达顺序去重）。 */
  redpacketWho?: string[];
  /** 用户名 → 在线列表头像；缺省时回退首字母。 */
  userAvatarMap?: Map<string, string>;
};

type MessageKind = ChatMessageDto["kind"];

function kindLabel(kind: MessageKind | string): string {
  switch (kind) {
    case "music":
      return "音乐";
    case "weather":
      return "天气";
    case "redpacket":
      return "红包";
    case "barrager":
      return "弹幕";
    case "custom":
      return "系统";
    case "unknown":
      return "未识别";
    default:
      return "";
  }
}

function specialSummary(message: ChatMessageDto): string {
  const hint = message.rawHint?.trim();
  if (hint) {
    return hint;
  }
  const text = message.text?.trim();
  if (text) {
    return text;
  }
  return "此消息仅作安全摘要展示，不渲染原始内容。";
}

function isSpecialKind(kind: MessageKind | string): boolean {
  return (
    kind === "music" ||
    kind === "weather" ||
    kind === "redpacket" ||
    kind === "barrager" ||
    kind === "custom" ||
    kind === "unknown"
  );
}

function isSystemKind(kind: MessageKind | string): boolean {
  return kind === "custom";
}

/** 旧 isImgOnly：HTML 开头，去掉换行后标签之间没有文本节点 → 只渲染图。 */
function isImgOnlySource(source: string): boolean {
  return (
    source.startsWith("<") &&
    looksLikeHtml(source) &&
    !source.replace(/\n/g, "").match(/>[^<]+?</g)
  );
}

function avatarLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "?";
}

/** 与 MusicCard 相同的网易云 id 提取。 */
function neteaseSongIdFrom(raw: string | undefined | null): string | null {
  if (raw == null) {
    return null;
  }
  const marker = "id=";
  let rest = raw;
  for (;;) {
    const index = rest.indexOf(marker);
    if (index < 0) {
      return null;
    }
    const after = rest.slice(index + marker.length);
    const match = /^(\d{1,20})/.exec(after);
    if (match != null) {
      return match[1];
    }
    rest = after;
  }
}

/**
 * 列表 memo：回调/筛选引用不稳定时按字段比，避免任意 state 更新拖垮整屏。
 * 与 CSS `content-visibility` 一起保证长列表不掉帧。
 */
function messageItemEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (
    prev.showPlusOne !== next.showPlusOne ||
    prev.cared !== next.cared ||
    prev.careNames !== next.careNames ||
    prev.shield !== next.shield ||
    prev.selfUserName !== next.selfUserName ||
    prev.selfRole !== next.selfRole ||
    prev.onReply !== next.onReply ||
    prev.onRevoke !== next.onRevoke ||
    prev.onPlusOne !== next.onPlusOne ||
    prev.onMention !== next.onMention ||
    prev.onInsertToken !== next.onInsertToken ||
    prev.onAddEmoji !== next.onAddEmoji ||
    prev.redpacketWho !== next.redpacketWho ||
    prev.userAvatarMap !== next.userAvatarMap ||
    prev.alsoSaid.length !== next.alsoSaid.length
  ) {
    return false;
  }
  for (let index = 0; index < prev.alsoSaid.length; index += 1) {
    if (prev.alsoSaid[index].id !== next.alsoSaid[index]?.id) {
      return false;
    }
  }
  if (prev.message === next.message) {
    return true;
  }
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id &&
    a.revoked === b.revoked &&
    a.md === b.md &&
    a.text === b.text &&
    a.rawHint === b.rawHint &&
    a.time === b.time &&
    a.userName === b.userName &&
    a.userNickname === b.userNickname &&
    a.userAvatarUrl === b.userAvatarUrl &&
    a.kind === b.kind &&
    asRich(a).color === asRich(b).color &&
    asRich(a).viaClient === asRich(b).viaClient
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  alsoSaid,
  showPlusOne,
  cared,
  careNames,
  shield,
  selfUserName,
  selfRole,
  onReply,
  onRevoke,
  onPlusOne,
  onMention,
  onInsertToken,
  onAddEmoji,
  redpacketWho,
  userAvatarMap,
}: MessageItemProps) {
  const [revoking, setRevoking] = useState(false);
  /** 右键点到的元素：必须用 state，否则菜单打开时不重渲染，图片/音乐项拿不到 target。 */
  const [msgTarget, setMsgTarget] = useState<Element | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [barrageIn, setBarrageIn] = useState(false);
  const mine =
    selfUserName != null &&
    selfUserName.length > 0 &&
    message.userName === selfUserName;
  const system = isSystemKind(message.kind);
  const redpacket = isRedpacketMessage(message);
  const allowReply = canReplyMessage(message);
  const allowRevoke = canRevokeMessage(message, selfUserName, selfRole);
  const moderator = isModeratorRole(selfRole);
  const canRevokeChain =
    moderator &&
    !message.revoked &&
    message.id !== "" &&
    /^\d+$/.test(message.id) &&
    alsoSaid.some((entry) => /^\d+$/.test(entry.id));
  const mdSource = message.md?.trim() ?? "";
  const textSource = message.text?.trim() ?? "";
  /** 与渲染分流同源：md 优先，空则 text。 */
  const bodySource = mdSource.length > 0 ? mdSource : textSource;
  const imgOnly =
    message.kind !== "barrager" &&
    !isSpecialKind(message.kind) &&
    isImgOnlySource(bodySource);

  /* 弹幕入场：挂载后补 is-in，触发一次性 CSS 动画。 */
  useEffect(() => {
    if (message.kind !== "barrager") {
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setBarrageIn(true);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [message.kind]);

  /* 长消息：渲染后正文 >200px 才可折叠；内容/图片尺寸变化时重测。 */
  useLayoutEffect(() => {
    if (imgOnly) {
      setOverflow(false);
      return;
    }
    const readTarget = (): Element | null =>
      contentRef.current?.querySelector(".chat-md, .chat-msg-plain") ?? null;
    const measure = (): void => {
      const target = readTarget();
      setOverflow(target != null && target.scrollHeight > 200);
    };
    measure();
    const target = readTarget();
    if (target == null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [imgOnly, message.id, message.md, message.text, message.revoked]);

  const className = [
    "chat-msg",
    mine ? "is-mine" : "",
    system ? "is-system" : "",
    message.revoked ? "is-revoked" : "",
    redpacket && !message.revoked ? "is-redpacket" : "",
    message.kind === "barrager" ? "is-barrager" : "",
    message.kind === "barrager" && barrageIn ? "is-in" : "",
    imgOnly ? "is-img-only" : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  const avatarSrc = sanitizeHttpUrl(message.userAvatarUrl);
  const name = displayNameOf(message);
  const copySource = messagePlainBody(message);
  const rich = asRich(message);
  const barragerColor =
    message.kind === "barrager" ? safeCssColor(rich.color) : null;
  const viaClient = rich.viaClient?.trim() ?? "";
  const visibleAlso = alsoSaid.filter(
    (user) => !usernameShielded(user.userName, shield),
  );
  const showUserMenu = !system && !mine && message.userName.length > 0;

  function captureMsgContext(event: { target: EventTarget | null }): void {
    const el = event.target instanceof Element ? event.target : null;
    setMsgTarget((prev) => (prev === el ? prev : el));
  }

  async function handleRevoke(): Promise<void> {
    if (!allowRevoke || revoking) {
      return;
    }
    setRevoking(true);
    try {
      await onRevoke(message.id);
    } finally {
      setRevoking(false);
    }
  }

  async function handleRevokeChain(): Promise<void> {
    if (!canRevokeChain || revoking) {
      return;
    }
    if (!window.confirm("是否确定批量撤回所有复读消息？")) {
      return;
    }
    setRevoking(true);
    try {
      for (const entry of alsoSaid) {
        if (/^\d+$/.test(entry.id)) {
          await onRevoke(entry.id);
        }
      }
      await onRevoke(message.id);
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopyMessage(): Promise<void> {
    if (/^\d+$/.test(message.id)) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<string>("chatroom_raw", {
          request: { messageId: message.id },
        });
        if (raw.trim().length > 0) {
          await copyText(raw);
          toast.success("已复制消息");
          return;
        }
      } catch {
        // 回落到本地 md / text。
      }
    }
    await copyText(copySource === "（空消息）" ? "" : copySource);
    toast.success("已复制消息");
  }

  function handleRedpacketClick(): void {
    if (message.revoked) {
      return;
    }
    dispatchRedpacketOpen(message);
  }

  /**
   * 猜拳红包手势（旧 gesture()）：复用现有 `fishpi:redpacket` 打开通道，
   * detail 里带 type/gesture（RedPacketHost.parseOpenEvent 已支持），不新增 IPC。
   * DTO 没有 who 字段，"我是否已领" 用 rawHint 的 已领 N/M 近似。
   */
  const rpHint = redpacket ? message.rawHint ?? "" : "";
  const rpProgress = /已领\s*(\d+)\s*\/\s*(\d+)/.exec(rpHint);
  const gestureVisible =
    redpacket &&
    rpHint.includes("【猜拳红包】") &&
    !mine &&
    !message.revoked &&
    (rpProgress == null ||
      Number(rpProgress[1]) < Number(rpProgress[2]));

  function pickGesture(gesture: 0 | 1 | 2): void {
    const detail: FishpiRedpacketDetail & {
      type: "rockPaperScissors";
      gesture: 0 | 1 | 2;
    } = {
      ...toRedpacketDetail(message),
      type: "rockPaperScissors",
      gesture,
    };
    window.dispatchEvent(new CustomEvent(FISHPI_REDPACKET_EVENT, { detail }));
  }

  function msgImageAction(): {
    kind: "emoji" | "image" | null;
    src: string;
    code: string | null;
  } {
    const target = msgTarget;
    if (target == null || target.nodeName.toLowerCase() !== "img") {
      return { kind: null, src: "", code: null };
    }
    const src = (target as HTMLImageElement).src;
    const classNameAttr = target.getAttribute("class") ?? "";
    if (classNameAttr.split(/\s+/).includes("emoji")) {
      return { kind: "emoji", src, code: emojiCodeFromSrc(src) };
    }
    return { kind: "image", src, code: null };
  }

  /**
   * 音乐消息始终给播放列表项；普通消息仅在点到 `.chat-music` 内时给出。
   * 对齐旧版「封面右键 → 加入/移出播放列表」，但不依赖 cover 的特殊 class。
   */
  function musicSongIdForMenu(): string | null {
    const inMusic =
      message.kind === "music" || msgTarget?.closest(".chat-music") != null;
    if (!inMusic) {
      return null;
    }
    const card = rich.music;
    if (card == null) {
      return null;
    }
    return neteaseSongIdFrom(card.source) ?? neteaseSongIdFrom(card.audioUrl);
  }

  const imageAction = msgImageAction();
  const musicSongId = musicSongIdForMenu();
  const musicInPlaylist =
    musicSongId != null ? playlistHasSong(musicSongId) : false;

  /** 红包卡：复制地址 + 再发一个（打开发送面板并带上对方）。 */
  function redpacketExtraItems(): ReactNode {
    if (!redpacket || message.revoked) {
      return null;
    }
    return (
      <>
        <ContextMenuItem
          disabled={!/^\d+$/.test(message.id)}
          onSelect={() => {
            void copyText(chatroomMessageUrl(message.id));
            toast.success("已复制红包地址");
          }}
        >
          复制红包地址
        </ContextMenuItem>
        {message.userName ? (
          <ContextMenuItem
            onSelect={() => {
              dispatchRedpacketSend({ userName: message.userName });
            }}
          >
            再发一个
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
      </>
    );
  }

  const userMenuBody = showUserMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="chat-msg-identity"
          onDoubleClick={() => openPrivateChat(message.userName)}
          title={message.userName}
          {...userCardProps(message.userName)}
        >
          <Avatar className="chat-msg-avatar size-[var(--chat-avatar)]">
            {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
            <AvatarFallback>{avatarLetter(name)}</AvatarFallback>
          </Avatar>
        </div>
      </ContextMenuTrigger>
      <UserContextMenu userName={message.userName} onMention={onMention} />
    </ContextMenu>
  ) : (
    <div className="chat-msg-identity" {...userCardProps(message.userName)}>
      <Avatar
        className="chat-msg-avatar size-[var(--chat-avatar)]"
        aria-hidden={avatarSrc ? true : undefined}
      >
        {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
        <AvatarFallback>{avatarLetter(name)}</AvatarFallback>
      </Avatar>
    </div>
  );

  const nameMenuBody = showUserMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className="chat-msg-name">{name}</span>
      </ContextMenuTrigger>
      <UserContextMenu userName={message.userName} onMention={onMention} />
    </ContextMenu>
  ) : (
    <span className="chat-msg-name">{name}</span>
  );

  return (
    <article className={className} data-msg-id={message.id}>
      {userMenuBody}
      <div className="chat-msg-body">
        {!system && message.kind !== "barrager" && (
          <header className="chat-msg-meta">
            {nameMenuBody}
            {cared ? <span className="chat-care-mark">关心</span> : null}
            {viaClient.length > 0 ? (
              <span
                className="chat-via"
                title={`${viaClient}${rich.viaVersion ? `@${rich.viaVersion}` : ""}`}
              >
                {viaLabel(viaClient)}
              </span>
            ) : null}
            <time className="chat-msg-time">{message.time}</time>
          </header>
        )}
        <div className="chat-msg-row">
          {!system && <span className="chat-msg-arrow" aria-hidden="true" />}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={
                  overflow && !expanded
                    ? "chat-msg-content is-collapsed"
                    : "chat-msg-content"
                }
                ref={contentRef}
                onContextMenuCapture={captureMsgContext}
              >
                {message.revoked ? (
                  <p className="chat-msg-revoked">此消息已撤回</p>
                ) : redpacket ? (
                  <>
                    <button
                      type="button"
                      className="chat-msg-redpacket"
                      onClick={handleRedpacketClick}
                    >
                      <Badge variant="default">{kindLabel(message.kind)}</Badge>
                      <p>{specialSummary(message)}</p>
                    </button>
                    {gestureVisible ? (
                      <div className="chat-gesture" title="猜猜我出什么呢~">
                        <button
                          type="button"
                          title="石头"
                          onClick={() => pickGesture(0)}
                        >
                          ✊
                        </button>
                        <button
                          type="button"
                          title="剪刀"
                          onClick={() => pickGesture(1)}
                        >
                          ✌️
                        </button>
                        <button
                          type="button"
                          title="布"
                          onClick={() => pickGesture(2)}
                        >
                          ✋
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : message.kind === "weather" ? (
                  <WeatherCard
                    card={rich.weather ?? { area: "", summary: "", days: [] }}
                    fallback={specialSummary(message)}
                  />
                ) : message.kind === "music" ? (
                  <MusicCard
                    card={
                      rich.music ?? {
                        title: "",
                        source: "",
                        coverUrl: "",
                        from: "",
                      }
                    }
                    fallback={specialSummary(message)}
                  />
                ) : message.kind === "barrager" ? (
                  <p
                    className="chat-msg-plain"
                    style={barragerColor ? { color: barragerColor } : undefined}
                  >
                    {message.text?.trim() || specialSummary(message)}
                  </p>
                ) : isSpecialKind(message.kind) ? (
                  <div className="chat-msg-special">
                    <Badge variant="outline">{kindLabel(message.kind)}</Badge>
                    <p>{specialSummary(message)}</p>
                  </div>
                ) : (() => {
                  const md = message.md?.trim() ?? "";
                  const text = message.text?.trim() ?? "";
                  // 服务端可能把 HTML 写进 md（引用块、强标签等）——旧版始终 v-html。
                  // react-markdown 不渲染 HTML，会把 <strong> 等当字面文本，故优先分流。
                  if (md.length > 0 && looksLikeHtml(md)) {
                    return <ChatHtmlView source={md} />;
                  }
                  if (md.length > 0) {
                    return <MarkdownView source={md} />;
                  }
                  if (text.length > 0 && looksLikeHtml(text)) {
                    return <ChatHtmlView source={text} />;
                  }
                  if (
                    text.length > 0 &&
                    (/!\[[^\]]*\]\([^)]+\)/.test(text) ||
                      /\[[^\]]+\]\([^)]+\)/.test(text) ||
                      /:[a-zA-Z0-9_+-]+:/.test(text))
                  ) {
                    return <MarkdownView source={text} />;
                  }
                  return (
                    <p className="chat-msg-plain">{text || "（空消息）"}</p>
                  );
                })()}
                {overflow ? (
                  <button
                    type="button"
                    className={
                      expanded ? "chat-msg-more is-expanded" : "chat-msg-more"
                    }
                    title={expanded ? "合并" : "展开"}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                    <span>{expanded ? "合并" : "展开"}</span>
                  </button>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="chat-menu" sideOffset={4}>
              {/* 顺序对齐旧 msgMenuShow */}
              {!mine && !system && !redpacket ? (
                <ContextMenuItem
                  onSelect={() => {
                    onMention(message.userName);
                  }}
                >
                  @{message.userName}
                </ContextMenuItem>
              ) : null}

              {musicSongId != null ? (
                <ContextMenuItem
                  onSelect={() => {
                    if (musicInPlaylist) {
                      if (removeNeteaseSong(musicSongId)) {
                        toast.success("已移出播放列表");
                      } else {
                        toast.warning("播放列表未就绪");
                      }
                      return;
                    }
                    if (playNeteaseSong(musicSongId)) {
                      toast.success("已交给播放列表");
                    } else {
                      toast.warning("播放列表未就绪，请先打开侧栏「播放列表」");
                    }
                  }}
                >
                  {musicInPlaylist ? "移出播放列表" : "加入播放列表"}
                </ContextMenuItem>
              ) : null}

              {allowReply ? (
                <ContextMenuItem
                  onSelect={() => {
                    onReply(message);
                  }}
                >
                  回复
                </ContextMenuItem>
              ) : null}

              {!system && !message.revoked && !redpacket ? (
                <ContextMenuItem
                  onSelect={() => {
                    onPlusOne(message);
                  }}
                >
                  复读一下
                </ContextMenuItem>
              ) : null}

              <ContextMenuItem
                disabled={!/^\d+$/.test(message.id)}
                onSelect={() => {
                  void copyText(chatroomMessageUrl(message.id));
                  toast.success("已复制地址");
                }}
              >
                复制地址
              </ContextMenuItem>

              {!system && !mine && message.userName.length > 0 && !redpacket ? (
                <ContextMenuItem
                  onSelect={() => {
                    dispatchRedpacketSend({ userName: message.userName });
                  }}
                >
                  发个专属红包给 {name}
                </ContextMenuItem>
              ) : null}

              {redpacketExtraItems()}

              {imageAction.kind === "emoji" && imageAction.code ? (
                <ContextMenuItem
                  onSelect={() => {
                    onInsertToken?.(imageAction.code ?? "");
                  }}
                >
                  {imageAction.code}
                </ContextMenuItem>
              ) : null}
              {imageAction.kind === "image" && imageAction.src ? (
                <>
                  <ContextMenuItem
                    onSelect={() => {
                      onAddEmoji?.(imageAction.src);
                    }}
                  >
                    添加表情
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      void copyImageFromSrc(imageAction.src);
                    }}
                  >
                    复制图片
                  </ContextMenuItem>
                </>
              ) : null}
              {!imageAction.kind ? (
                <ContextMenuItem
                  onSelect={() => {
                    void handleCopyMessage();
                  }}
                  disabled={copySource.length === 0 || copySource === "（空消息）"}
                >
                  复制消息
                </ContextMenuItem>
              ) : null}

              {allowRevoke || canRevokeChain ? (
                <ContextMenuSeparator />
              ) : null}
              {allowRevoke ? (
                <ContextMenuItem
                  variant="destructive"
                  disabled={revoking}
                  onSelect={() => {
                    void handleRevoke();
                  }}
                >
                  {revoking ? "撤回中" : "撤回"}
                </ContextMenuItem>
              ) : null}
              {canRevokeChain ? (
                <ContextMenuItem
                  variant="destructive"
                  disabled={revoking}
                  onSelect={() => {
                    void handleRevokeChain();
                  }}
                >
                  撤回复读
                </ContextMenuItem>
              ) : null}
            </ContextMenuContent>
          </ContextMenu>
        </div>
        {redpacket &&
        !message.revoked &&
        redpacketWho != null &&
        redpacketWho.length > 0 ? (
          <div className="chat-redpacket-who">
            {redpacketWho.map((userName) => {
              if (userName.length === 0) {
                return null;
              }
              const src = sanitizeHttpUrl(userAvatarMap?.get(userName));
              const inner = (
                <Avatar className="size-[22px]">
                  {src ? <AvatarImage src={src} alt="" /> : null}
                  <AvatarFallback>{avatarLetter(userName)}</AvatarFallback>
                </Avatar>
              );
              if (userName === selfUserName) {
                return (
                  <span
                    key={userName}
                    className="chat-redpacket-user"
                    title={userName}
                  >
                    {inner}
                  </span>
                );
              }
              return (
                <ContextMenu key={userName}>
                  <ContextMenuTrigger asChild>
                    <span
                      className="chat-redpacket-user"
                      title={userName}
                      {...userCardProps(userName)}
                    >
                      {inner}
                    </span>
                  </ContextMenuTrigger>
                  <UserContextMenu userName={userName} onMention={onMention} />
                </ContextMenu>
              );
            })}
            <span className="chat-redpacket-word">领取了</span>
          </div>
        ) : null}
        {showPlusOne ? (
          <button
            type="button"
            className="chat-plus-one"
            onClick={() => onPlusOne(message)}
          >
            +1
          </button>
        ) : null}
        {visibleAlso.length > 0 ? (
          <div className="chat-also">
            {visibleAlso.map((user) => {
              const src = sanitizeHttpUrl(user.userAvatarUrl);
              const label = user.userNickname.trim() || user.userName;
              const title =
                careNames.has(user.userName) && user.userName
                  ? `${label} · 关心`
                  : label;
              const inner = (
                <Avatar className="size-[22px]">
                  {src ? <AvatarImage src={src} alt="" /> : null}
                  <AvatarFallback>{avatarLetter(label)}</AvatarFallback>
                </Avatar>
              );
              if (!user.userName || user.userName === selfUserName) {
                return (
                  <span
                    key={user.id}
                    className={
                      careNames.has(user.userName)
                        ? "chat-also-user is-cared"
                        : "chat-also-user"
                    }
                    title={title}
                  >
                    {inner}
                  </span>
                );
              }
              return (
                <ContextMenu key={user.id}>
                  <ContextMenuTrigger asChild>
                    <span
                      className={
                        careNames.has(user.userName)
                          ? "chat-also-user is-cared"
                          : "chat-also-user"
                      }
                      title={title}
                      {...userCardProps(user.userName)}
                    >
                      {inner}
                    </span>
                  </ContextMenuTrigger>
                  <UserContextMenu
                    userName={user.userName}
                    onMention={onMention}
                  />
                </ContextMenu>
              );
            })}
            <span className="chat-also-word">也这么说</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}, messageItemEqual);
