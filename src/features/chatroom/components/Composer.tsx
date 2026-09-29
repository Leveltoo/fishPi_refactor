import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Gift, Image as ImageIcon, Megaphone, RefreshCw, Send, Smile } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MentionList } from "@/features/overlay/MentionList";
import { insertMention, readMention } from "@/features/overlay/mention";
import { isUploadableMedia, uploadMediaToMarkdown } from "../../../lib/upload";
import { fetchChatroomBarrageCost, fetchChatroomRaw, sendChatroomBarrager, type BarrageCost } from "../chatroomApi";
import { DEFAULT_EMOJIS } from "../defaultEmojis";
import { dispatchRedpacketSend } from "../redpacketEvents";
import { safeCssColor, toMusicBox, topicQuote } from "../messageView";
import { isOutcomeUnknown, toUserErrorMessage } from "../toUserError";
import { EmojiPanel } from "./EmojiPanel";
import {
  formatReplyTemplate,
  type ReplyTarget,
} from "../replyQuote";
import {
  htmlImageSources,
  isFileSrc,
  remoteImageMarkdown,
  uploadLocalSources,
} from "../pasteImages";
import type { ClipboardEvent } from "react";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  selfUserName: string | null;
  replyTo: ReplyTarget | null;
  onClearReply: () => void;
  onSend: (content: string) => Promise<boolean>;
  /** 右键 @ / 表情短码待插入；消费后由父级 clear。 */
  pendingToken?: string | null;
  onClearPendingToken?: () => void;
  /** 清屏（旧版「消息清屏」）；未传时按钮 no-op。 */
  onClear?: () => void;
  /** 话题带出：有值时在 .chat-composer-more 显示可关闭 Tag，发送时附加正文。 */
  discussed?: string | null;
  onClearDiscussed?: () => void;
};

/** 对齐旧版 ColorPicker：任意颜色；空则走 SDK 默认色。 */
const BARRAGE_DEFAULT_COLOR = "#ffffff";

/** 对齐旧版：最大 32 字符。 */
const BARRAGE_MAX_LENGTH = 32;

const HEIGHT_MIN = 48;
const HEIGHT_MAX = 400;
const HEIGHT_DEFAULT = 80;

type EmojiSuggestion = {
  start: number;
  query: string;
  items: Array<{ name: string; url: string }>;
};

/** 光标前 `:query`（未闭合、query≥1），从默认表情 keys 前缀匹配取前 5 —— 对齐旧 getEmoji。 */
function readEmojiComplete(text: string, caret: number): EmojiSuggestion | null {
  const pos = caret < 0 ? 0 : caret > text.length ? text.length : caret;
  const before = text.slice(0, pos);
  const match = before.match(/:([^:]+?)$/);
  if (!match) {
    return null;
  }
  const query = match[1];
  if (query.length < 1) {
    return null;
  }
  const items = DEFAULT_EMOJIS.filter((emoji) => emoji.name.startsWith(query))
    .slice(0, 5)
    .map((emoji) => ({ name: emoji.name, url: emoji.url }));
  if (items.length === 0) {
    return null;
  }
  return { start: pos - match[0].length, query, items };
}

/** 读 localStorage `message-height`（旧版同名 key），非法值回落 80。 */
function readStoredHeight(): number {
  const raw = Number(localStorage.getItem("message-height"));
  if (!Number.isFinite(raw) || raw <= 0) {
    return HEIGHT_DEFAULT;
  }
  return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(raw)));
}

/**
 * 输入区：顶部图标工具条 → 拖拽调高 hr → textarea + 右侧等高发送钮 + .msg-more 话题 Tag。
 * 回复只在 chip 展示，发送时再拼接引用（原文优先 chatroom_raw）。
 * 输入 `@query` 弹出 overlay `MentionList`（任意位置且 @ 后有字符才触发）。
 * Enter 发送，Ctrl/Shift+Enter 换行；高度持久化 localStorage `message-height`（48–400）。
 */
export function Composer({
  disabled,
  sending,
  pendingConfirm,
  selfUserName,
  replyTo,
  onClearReply,
  onSend,
  pendingToken = null,
  onClearPendingToken,
  onClear,
  discussed = null,
  onClearDiscussed,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [dismissedEmojiStart, setDismissedEmojiStart] = useState<number | null>(null);
  const [emojiPickIndex, setEmojiPickIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [barrageOpen, setBarrageOpen] = useState(false);
  const [barrageText, setBarrageText] = useState("");
  const [barrageColor, setBarrageColor] = useState(BARRAGE_DEFAULT_COLOR);
  const [barrageBusy, setBarrageBusy] = useState(false);
  const [barrageCost, setBarrageCost] = useState<BarrageCost | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [msgHeight, setMsgHeight] = useState<number>(() => readStoredHeight());
  const [resizing, setResizing] = useState(false);
  const senderRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const appliedReplyIdRef = useRef<string | null>(null);
  const heightRef = useRef(msgHeight);
  /** 拖拽起点：Y 与高度，避免用 rect.bottom 反馈导致不跟手 */
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);
  /** 对齐旧 lastCursor：工具条/表情面板抢焦点后仍插回原光标。 */
  const lastCursorRef = useRef(0);
  const rawMention = disabled ? null : readMention(draft, caret);
  const mention =
    rawMention && rawMention.start !== dismissedStart ? rawMention : null;
  const mentionStart = rawMention?.start ?? null;
  /** 与 @ MentionList 互斥：有 mention 时不弹短码。 */
  const rawEmoji = disabled || mention != null ? null : readEmojiComplete(draft, caret);
  const emojiComplete =
    rawEmoji && rawEmoji.start !== dismissedEmojiStart ? rawEmoji : null;
  const emojiStart = rawEmoji?.start ?? null;
  const emojiKey = emojiComplete
    ? `${emojiComplete.start}|${emojiComplete.items.map((item) => item.name).join(",")}`
    : "";

  useEffect(() => {
    if (mentionStart == null) {
      setDismissedStart(null);
    }
  }, [mentionStart]);

  useEffect(() => {
    if (emojiStart == null) {
      setDismissedEmojiStart(null);
    }
  }, [emojiStart]);

  useEffect(() => {
    setEmojiPickIndex(0);
  }, [emojiKey]);

  /** 打开弹幕 Dialog 时拉一次费用；失败保持 null，文案回落不展示花费。 */
  useEffect(() => {
    if (!barrageOpen) {
      return;
    }
    let cancelled = false;
    fetchChatroomBarrageCost()
      .then((cost) => {
        if (!cancelled) {
          setBarrageCost(cost);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBarrageCost(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [barrageOpen]);

  useEffect(() => {
    if (emojiComplete == null) {
      return;
    }
    const start = emojiComplete.start;
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".chat-emoji-complete") != null) {
        return;
      }
      setDismissedEmojiStart(start);
    }
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [emojiComplete]);

  useEffect(() => {
    if (replyTo == null) {
      appliedReplyIdRef.current = null;
      return;
    }
    if (appliedReplyIdRef.current === replyTo.id) {
      return;
    }
    appliedReplyIdRef.current = replyTo.id;
    requestAnimationFrame(() => {
      const node =
        textareaRef.current ??
        document.querySelector<HTMLTextAreaElement>("#chatroom-input");
      if (node == null) {
        return;
      }
      node.focus();
      const pos = lastCursorRef.current;
      node.setSelectionRange(pos, pos);
    });
  }, [replyTo]);

  useEffect(() => {
    if (!pendingToken) {
      return;
    }
    insertAtLastCursor(pendingToken);
    onClearPendingToken?.();
  }, [pendingToken, onClearPendingToken]);

  /**
   * 高度只写 sender 一个节点；textarea / 发送钮 CSS height:100% 跟随。
   * 拖拽中（resizing）不碰 React 状态，避免父级重渲染用旧 msgHeight 盖掉 DOM。
   */
  useLayoutEffect(() => {
    if (resizing || senderRef.current == null) {
      return;
    }
    senderRef.current.style.height = `${msgHeight}px`;
  }, [msgHeight, resizing]);

  /**
   * 拖拽调高：mousedown 记「起点 Y + 起点高度」，move 只改 sender 高度（rAF 合帧），
   * up 才 setState + localStorage。
   */
  useEffect(() => {
    if (!resizing) {
      return;
    }
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    let raf = 0;
    let pendingY: number | null = null;

    function applyHeight(height: number): void {
      const clamped = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(height)));
      heightRef.current = clamped;
      if (senderRef.current) {
        senderRef.current.style.height = `${clamped}px`;
      }
    }

    function flush(): void {
      raf = 0;
      if (pendingY == null || dragStartRef.current == null) {
        return;
      }
      const start = dragStartRef.current;
      // 向上拖增高（对齐旧版：高度随光标上移变大）
      applyHeight(start.height + (start.y - pendingY));
      pendingY = null;
    }

    const onMove = (ev: MouseEvent): void => {
      pendingY = ev.clientY;
      if (raf === 0) {
        raf = requestAnimationFrame(flush);
      }
    };
    const onUp = (): void => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (pendingY != null && dragStartRef.current != null) {
        const start = dragStartRef.current;
        applyHeight(start.height + (start.y - pendingY));
      }
      localStorage.setItem("message-height", String(heightRef.current));
      dragStartRef.current = null;
      setMsgHeight(heightRef.current);
      setResizing(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = prevCursor;
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  function beginResize(clientY: number): void {
    dragStartRef.current = { y: clientY, height: heightRef.current };
    setResizing(true);
  }

  function clearReply(): void {
    onClearReply();
  }

  async function submit(): Promise<void> {
    const base = draft.trim();
    if (base.length === 0 || disabled || sending) {
      return;
    }
    let content = toMusicBox(base);
    if (replyTo != null) {
      let raw = replyTo.body === "（空消息）" ? "" : replyTo.body;
      if (/^\d+$/.test(replyTo.id)) {
        try {
          const fetched = await fetchChatroomRaw(replyTo.id);
          if (fetched.trim().length > 0) {
            raw = fetched;
          }
        } catch {
          // 回落本地 md/text。
        }
      }
      content = `${formatReplyTemplate(replyTo, selfUserName, raw)}${content}`;
    }
    if (discussed != null && discussed.length > 0) {
      content += `\r\n${topicQuote(discussed)}`;
      onClearDiscussed?.();
    }
    const accepted = await onSend(content);
    if (accepted) {
      setDraft("");
      setCaret(0);
      lastCursorRef.current = 0;
      setDismissedStart(null);
      onClearReply();
      onClearDiscussed?.();
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  function syncCaret(node: HTMLTextAreaElement): void {
    const pos = node.selectionStart ?? node.value.length;
    setCaret(pos);
    lastCursorRef.current = pos;
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (mention != null) {
      return;
    }
    if (emojiComplete != null) {
      const total = emojiComplete.items.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setEmojiPickIndex((current) => (current + 1) % total);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setEmojiPickIndex((current) => (current - 1 + total) % total);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedEmojiStart(emojiComplete.start);
        return;
      }
      if (
        event.key === "Enter" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const item =
          emojiComplete.items[
            emojiPickIndex < total ? emojiPickIndex : 0
          ];
        if (item) {
          pickEmoji(item.name);
        }
        return;
      }
    }
    if (event.key !== "Enter") {
      return;
    }
    if (event.nativeEvent.isComposing) {
      return;
    }
    // Ctrl/Shift+Enter 换行：不拦默认行为；裸 Enter 才发送（对齐旧 onEnter/onCtrlEnter）
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void submit();
  }

  /** 用 `:code:` 替换光标前的 `:query`，光标落在插入之后。 */
  function pickEmoji(name: string): void {
    if (emojiComplete == null) {
      return;
    }
    const token = `:${name}:`;
    const pos = Math.min(caret, draft.length);
    const next = draft.slice(0, emojiComplete.start) + token + draft.slice(pos);
    const nextCaret = emojiComplete.start + token.length;
    setDraft(next);
    setCaret(nextCaret);
    lastCursorRef.current = nextCaret;
    setDismissedEmojiStart(null);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node == null) {
        return;
      }
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function pickMention(userName: string): void {
    if (mention == null) {
      return;
    }
    const next = insertMention(draft, mention.start, caret, userName);
    setDraft(next.text);
    setCaret(next.caret);
    lastCursorRef.current = next.caret;
    setDismissedStart(mention.start);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node == null) {
        return;
      }
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  }

  function insertAtLastCursor(token: string): void {
    setDraft((prev) => {
      const at = Math.max(0, Math.min(lastCursorRef.current, prev.length));
      const next = prev.slice(0, at) + token + prev.slice(at);
      lastCursorRef.current = at + token.length;
      return next;
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      const pos = lastCursorRef.current;
      setCaret(pos);
      if (el == null) {
        return;
      }
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function insertToken(token: string): void {
    insertAtLastCursor(token);
  }
  function onSendRedpacket(): void {
    dispatchRedpacketSend(
      selfUserName ? { userName: selfUserName } : {},
    );
  }

  /** 发弹幕：走 `chatroom_barrager`。不本地伪造弹幕，不自动重试。 */
  async function submitBarrage(): Promise<void> {
    const content = barrageText.trim();
    if (content.length === 0 || disabled || barrageBusy) {
      return;
    }
    setBarrageBusy(true);
    try {
      const color = safeCssColor(barrageColor);
      const result = await sendChatroomBarrager({
        content,
        ...(color != null ? { color } : {}),
      });
      if (result.outcomeUnknown) {
        toast.warning("结果待确认。请等待回显，不要重复发送。");
        return;
      }
      if (result.accepted) {
        toast.success("弹幕已接受，稍后会出现在聊天流");
        setBarrageText("");
        setBarrageOpen(false);
        return;
      }
      toast.error("弹幕未被接受，请稍后再试");
    } catch (err) {
      if (isOutcomeUnknown(err)) {
        toast.warning("结果待确认。请等待回显，不要重复发送。");
        return;
      }
      toast.error(toUserErrorMessage(err));
    } finally {
      setBarrageBusy(false);
    }
  }

  async function appendUploadedMarkdown(files: File[]): Promise<void> {
    const media = files.filter(isUploadableMedia);
    if (media.length === 0 || uploadBusy) {
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    try {
      const markdown = await uploadMediaToMarkdown(media);
      if (markdown.length > 0) {
        setDraft((prev) => {
          const pos = Math.max(0, Math.min(lastCursorRef.current, prev.length));
          const next = prev.slice(0, pos) + markdown + prev.slice(pos);
          lastCursorRef.current = pos + markdown.length;
          return next;
        });
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          const pos = lastCursorRef.current;
          setCaret(pos);
          if (el == null) {
            return;
          }
          el.focus();
          el.setSelectionRange(pos, pos);
        });
        toast.success("已上传并插入图片链接，发送后才发出");
      }
    } catch (err) {
      setUploadError(toUserErrorMessage(err));
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const clipboard = event.clipboardData;
    if (clipboard == null || disabled) {
      return;
    }

    lastCursorRef.current = event.currentTarget.selectionStart ?? lastCursorRef.current;

    const itemFiles: File[] = [];
    for (const item of Array.from(clipboard.items ?? [])) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (file != null) {
          itemFiles.push(file);
        }
      }
    }
    const files = itemFiles.length > 0 ? itemFiles : Array.from(clipboard.files ?? []);
    const hasImageFile = files.some(isUploadableMedia);
    const html = clipboard.getData("text/html");
    const srcs = html.length > 0 ? htmlImageSources(html) : [];
    const remote = remoteImageMarkdown(srcs);
    const localSrcs = srcs.filter(isFileSrc);

    if (!hasImageFile && remote.length === 0 && localSrcs.length === 0) {
      return;
    }

    event.preventDefault();
    if (remote.length > 0) {
      insertAtLastCursor(remote);
    }
    const toUpload = [
      ...files.filter(isUploadableMedia),
    ];
    void (async () => {
      if (localSrcs.length > 0) {
        try {
          const markdown = await uploadLocalSources(localSrcs);
          if (markdown.length > 0) {
            insertAtLastCursor(
              markdown.startsWith("\n") || lastCursorRef.current === 0
                ? markdown
                : `\n${markdown}`,
            );
          }
        } catch (err) {
          setUploadError(toUserErrorMessage(err));
        }
      }
      if (toUpload.length > 0) {
        await appendUploadedMarkdown(toUpload);
      }
    })();
  }

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      {pendingConfirm && (
        <Alert className="chat-pending-alert">
          <AlertDescription>
            结果待确认。请求已发出，但未能确认服务端是否落成。请等待真实回显，不要重复发送。
          </AlertDescription>
        </Alert>
      )}
      {replyTo != null && (
        <div className="chat-reply-chip">
          <p className="chat-reply-chip-text">
            回复 {replyTo.displayName}
            <span>：{replyTo.body}</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={clearReply}
          >
            取消
          </Button>
        </div>
      )}
      <Label className="visually-hidden" htmlFor="chatroom-input">
        消息内容
      </Label>

      <div className="chat-composer-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            void appendUploadedMarkdown(Array.from(event.target.files ?? []));
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="chat-composer-tool"
          title="消息清屏"
          aria-label="消息清屏"
          onClick={() => onClear?.()}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="chat-composer-tool"
          title={uploadBusy ? "上传中..." : "上传图片"}
          aria-label="上传图片"
          disabled={disabled || uploadBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadBusy ? <Spinner /> : <ImageIcon aria-hidden="true" />}
        </Button>
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={emojiOpen ? "chat-composer-tool is-active" : "chat-composer-tool"}
              title="发表情"
              aria-label="发表情"
              disabled={disabled}
            >
              <Smile aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="chat-emoji-popover">
            <EmojiPanel
              disabled={disabled}
              onInsert={(token) => {
                insertToken(token);
                setEmojiOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="chat-composer-tool"
          title="发弹幕"
          aria-label="发弹幕"
          disabled={disabled}
          onClick={() => setBarrageOpen(true)}
        >
          <Megaphone aria-hidden="true" />
        </Button>
        {/* 对齐旧版 MessageBox：居中 Modal「发个弹幕」，32 字 + 颜色 + 说明 */}
        <Dialog open={barrageOpen} onOpenChange={setBarrageOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>发个弹幕</DialogTitle>
              <DialogDescription>
                {barrageCost != null ? (
                  <>
                    发送弹幕每次将花费 <strong>{barrageCost.cost}</strong>{" "}
                    {barrageCost.unit}；最大长度 {BARRAGE_MAX_LENGTH} 字符。
                  </>
                ) : (
                  <>最大长度 {BARRAGE_MAX_LENGTH} 字符。</>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="chatroom-barrage-color">颜色</Label>
                <div className="chat-barrage-color">
                  <input
                    id="chatroom-barrage-color"
                    type="color"
                    value={
                      /^#[0-9a-fA-F]{6}$/.test(barrageColor)
                        ? barrageColor
                        : BARRAGE_DEFAULT_COLOR
                    }
                    disabled={disabled || barrageBusy}
                    onChange={(event) => {
                      setBarrageColor(event.target.value);
                    }}
                    aria-label="弹幕颜色"
                  />
                  <Input
                    value={barrageColor}
                    placeholder="#ffffff"
                    disabled={disabled || barrageBusy}
                    onChange={(event) => {
                      setBarrageColor(event.target.value);
                    }}
                    aria-label="弹幕颜色值"
                  />
                </div>
                {barrageColor.trim().length > 0 &&
                safeCssColor(barrageColor) == null ? (
                  <p className="text-xs text-muted-foreground">
                    颜色含 url/expression 等不安全值，发送时将忽略。
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="chatroom-barrage">弹幕内容</Label>
                <Input
                  id="chatroom-barrage"
                  value={barrageText}
                  maxLength={BARRAGE_MAX_LENGTH}
                  placeholder="弹幕"
                  disabled={disabled || barrageBusy}
                  onChange={(event) => {
                    setBarrageText(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitBarrage();
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {barrageText.length}/{BARRAGE_MAX_LENGTH}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={barrageBusy}
                onClick={() => setBarrageOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  disabled || barrageBusy || barrageText.trim().length === 0
                }
                onClick={() => {
                  void submitBarrage();
                }}
              >
                {barrageBusy ? <Spinner /> : null}
                {barrageBusy ? "发送中" : "发送弹幕"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="chat-composer-tool"
          title="发红包"
          aria-label="发红包"
          disabled={disabled}
          onClick={onSendRedpacket}
        >
          <Gift aria-hidden="true" />
        </Button>
      </div>

      <div
        ref={senderRef}
        className="chat-composer-sender"
      >
        {/* 输入框上边框即拖拽热区（叠在 sender 顶边，含 hr 与 textarea 上沿） */}
        <div
          className="chat-composer-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整输入框高度"
          title="拖拽调整输入框高度"
          onMouseDown={(event) => {
            event.preventDefault();
            beginResize(event.clientY);
          }}
        >
          <hr />
        </div>
        <div className="chat-composer-field">
          {mention != null ? (
            <MentionList
              query={mention.query}
              onPick={pickMention}
              onClose={() => {
                setDismissedStart(mention.start);
              }}
            />
          ) : null}
          {emojiComplete != null ? (
            <ul className="chat-emoji-complete" role="listbox" aria-label="表情短码补全">
              {emojiComplete.items.map((item, index) => {
                const active =
                  index ===
                  (emojiPickIndex < emojiComplete.items.length ? emojiPickIndex : 0);
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      className={active ? "is-active" : undefined}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onMouseEnter={() => setEmojiPickIndex(index)}
                      onClick={() => pickEmoji(item.name)}
                    >
                      <img src={item.url} alt="" />
                      <span>:{item.name}:</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <textarea
            ref={textareaRef}
            id="chatroom-input"
            className="chat-composer-input"
            spellCheck={false}
            value={draft}
            disabled={disabled}
            placeholder={disabled ? "当前无法发送" : "简单聊聊"}
            aria-expanded={mention != null || emojiComplete != null}
            aria-autocomplete="list"
            onChange={(event) => {
              setDraft(event.target.value);
              syncCaret(event.target);
            }}
            onClick={(event) => {
              syncCaret(event.currentTarget);
            }}
            onKeyUp={(event) => {
              syncCaret(event.currentTarget);
            }}
            onSelect={(event) => {
              syncCaret(event.currentTarget);
            }}
            onBlur={(event) => {
              syncCaret(event.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
        <Button
          type="submit"
          variant="default"
          className="chat-send"
          title="发送"
          aria-label="发送"
          disabled={disabled || sending || draft.trim().length === 0}
        >
          {sending ? <Spinner /> : <Send aria-hidden="true" />}
        </Button>
        {discussed != null && discussed.length > 0 ? (
          <div className="chat-composer-more">
            <button
              type="button"
              className="chat-composer-tag"
              title="移除话题带出"
              aria-label={`移除话题带出 ${discussed}`}
              onClick={() => onClearDiscussed?.()}
            >
              #{discussed}#
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : null}
      </div>

      {uploadBusy || uploadError ? (
        <p className="chat-composer-status">
          {uploadBusy ? "上传中…" : uploadError}
        </p>
      ) : null}
    </form>
  );
}
