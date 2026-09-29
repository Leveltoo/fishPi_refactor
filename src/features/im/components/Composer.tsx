import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { MentionList } from "@/features/overlay/MentionList";
import { insertMention, readMention } from "@/features/overlay/mention";
import { EmojiPanel } from "../../chatroom/components/EmojiPanel";
import { DEFAULT_EMOJIS } from "../../chatroom/defaultEmojis";
import { toMusicBox } from "../../chatroom/messageView";
import { isUploadableMedia, uploadMediaToMarkdown } from "../../../lib/upload";
import type { ReplyTarget } from "../types";

export type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  sendAvailable: boolean;
  onSend: (content: string) => Promise<boolean>;
  quote?: ReplyTarget | null;
  onClearQuote?: () => void;
  pendingMention?: string | null;
  onClearPendingMention?: () => void;
  pendingToken?: string | null;
  onClearPendingToken?: () => void;
  onClear?: () => void;
};

const IMAGE_URL_PATTERN =
  /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|avif)(?:\?\S*)?$/i;

const HEIGHT_MIN = 48;
const HEIGHT_MAX = 400;
const HEIGHT_DEFAULT = 80;

type EmojiSuggestion = {
  start: number;
  query: string;
  items: Array<{ name: string; url: string }>;
};

function isBareImageUrl(text: string): boolean {
  return IMAGE_URL_PATTERN.test(text.trim());
}

function htmlImageTokens(html: string): string[] {
  const matches = html.match(/src="([^"]+)"/g) ?? [];
  const tokens: string[] = [];
  for (const match of matches) {
    const url = match.slice(5, -1).trim();
    if (/^https?:\/\//i.test(url)) {
      tokens.push(`![图片](${url})`);
    }
  }
  return tokens;
}

function readStoredHeight(): number {
  const raw = Number(localStorage.getItem("message-height"));
  if (!Number.isFinite(raw) || raw <= 0) {
    return HEIGHT_DEFAULT;
  }
  return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(raw)));
}

/** 光标前 `:query`（未闭合、query≥1），从默认表情 keys 前缀匹配取前 5。 */
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

/**
 * 私聊输入区：引用 chip 仅展示，发送时拼进正文。
 * Enter 发送，Ctrl/Shift+Enter 换行；高度持久化 localStorage `message-height`。
 */
export function Composer({
  disabled,
  sending,
  pendingConfirm,
  sendAvailable,
  onSend,
  quote,
  onClearQuote,
  pendingMention,
  onClearPendingMention,
  pendingToken = null,
  onClearPendingToken,
  onClear,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [dismissedEmojiStart, setDismissedEmojiStart] = useState<number | null>(null);
  const [emojiPickIndex, setEmojiPickIndex] = useState(0);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [msgHeight, setMsgHeight] = useState<number>(() => readStoredHeight());
  const [resizing, setResizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const heightRef = useRef(msgHeight);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const rawMention = disabled ? null : readMention(draft, caret);
  const mention =
    rawMention && rawMention.start !== dismissedStart ? rawMention : null;
  const mentionStart = rawMention?.start ?? null;
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
    if (!pendingMention) {
      return;
    }
    const token = `@${pendingMention} `;
    setDraft((prev) => {
      if (prev.length === 0 || prev.endsWith(" ") || prev.endsWith("\n")) {
        return prev + token;
      }
      return `${prev} ${token}`;
    });
    onClearPendingMention?.();
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node) {
        node.focus();
        const end = node.value.length;
        node.setSelectionRange(end, end);
        setCaret(end);
      }
    });
  }, [pendingMention, onClearPendingMention]);

  useEffect(() => {
    if (!pendingToken) {
      return;
    }
    insertToken(pendingToken);
    onClearPendingToken?.();
  }, [pendingToken, onClearPendingToken]);

  useLayoutEffect(() => {
    heightRef.current = msgHeight;
    const node = textareaRef.current;
    if (node && !resizing) {
      node.style.height = `${msgHeight}px`;
    }
  }, [msgHeight, resizing]);

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
      const node = textareaRef.current;
      if (node) {
        node.style.height = `${clamped}px`;
      }
    }

    function flush(): void {
      raf = 0;
      if (pendingY == null || dragStartRef.current == null) {
        return;
      }
      const start = dragStartRef.current;
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

  async function submit(): Promise<void> {
    const base = draft.trim();
    if (base.length === 0 || disabled || sending) {
      return;
    }
    const accepted = await onSend(toMusicBox(base));
    if (accepted) {
      setDraft("");
      setCaret(0);
      setDismissedStart(null);
      onClearQuote?.();
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  function syncCaret(node: HTMLTextAreaElement): void {
    setCaret(node.selectionStart ?? node.value.length);
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
          emojiComplete.items[emojiPickIndex < total ? emojiPickIndex : 0];
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
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      insertNewline();
      return;
    }
    if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    void submit();
  }

  /** Ctrl+Enter：浏览器默认不换行，需在光标处插入。 */
  function insertNewline(): void {
    const node = textareaRef.current;
    if (node == null) {
      setDraft((prev) => `${prev}\n`);
      return;
    }
    const start = node.selectionStart ?? node.value.length;
    const end = node.selectionEnd ?? start;
    const next = node.value.slice(0, start) + "\n" + node.value.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      node.focus();
      const pos = start + 1;
      node.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

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

  function insertToken(token: string): void {
    setDraft((prev) => {
      if (prev.length === 0 || prev.endsWith(" ") || prev.endsWith("\n")) {
        return prev + token;
      }
      return `${prev} ${token}`;
    });
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node == null) {
        return;
      }
      node.focus();
      const end = node.value.length;
      node.setSelectionRange(end, end);
      setCaret(end);
    });
  }

  function insertAtCaret(text: string): void {
    const node = textareaRef.current;
    if (node == null || node.value !== draft) {
      setDraft((prev) => (prev.length === 0 ? text : `${prev}\n${text}`));
      return;
    }
    const start = node.selectionStart ?? node.value.length;
    const end = node.selectionEnd ?? start;
    const next = node.value.slice(0, start) + text + node.value.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      node.focus();
      const pos = start + text.length;
      node.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  async function appendUploadedMarkdown(files: File[]): Promise<void> {
    const media = files.filter(isUploadableMedia);
    if (media.length === 0 || uploadBusy || disabled) {
      return;
    }
    setUploadBusy(true);
    setPasteHint("上传中…");
    try {
      const markdown = await uploadMediaToMarkdown(media);
      if (markdown.length > 0) {
        insertAtCaret(markdown);
        setPasteHint("已上传并插入图片链接，发送后才发出");
      } else {
        setPasteHint("没有可上传的图片");
      }
    } catch (err) {
      setPasteHint(err instanceof Error ? err.message : "上传失败");
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

    const files = Array.from(clipboard.files ?? []);
    const hasImageFile = files.some(isUploadableMedia);
    if (hasImageFile) {
      event.preventDefault();
      void appendUploadedMarkdown(files);
      return;
    }

    const html = clipboard.getData("text/html");
    const plain = clipboard.getData("text/plain");
    if (html.length > 0) {
      const tokens = htmlImageTokens(html);
      if (tokens.length > 0) {
        event.preventDefault();
        const text = [plain.trim(), ...tokens].filter(Boolean).join("\n");
        insertAtCaret(text);
        setPasteHint(null);
        return;
      }
    }

    const trimmed = plain.trim();
    if (trimmed.length > 0 && isBareImageUrl(trimmed)) {
      event.preventDefault();
      insertAtCaret(`![图片](${trimmed})`);
      setPasteHint(null);
      return;
    }

    if (plain.length > 0) {
      setPasteHint(null);
    }
  }

  const placeholder = !sendAvailable
    ? "发送接口尚未接入，不会伪装发出"
    : disabled
      ? "当前无法发送"
      : "输入消息，Enter 发送，Ctrl+Enter 换行";

  return (
    <form className={`im-composer${resizing ? " is-resizing" : ""}`} onSubmit={onSubmit}>
      {pendingConfirm ? (
        <p className="im-pending" role="status">
          结果待确认。请求已发出，但未能确认服务端是否落成。请等待真实回显，不要重复发送。
        </p>
      ) : null}
      {quote != null ? (
        <div className="im-composer-quote" role="status">
          <p className="im-composer-quote-text" title={quote.body}>
            回复 {quote.displayName}
            <span>：{quote.body}</span>
          </p>
          {onClearQuote ? (
            <button
              type="button"
              className="im-composer-quote-close"
              aria-label="取消引用"
              onClick={onClearQuote}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="im-composer-toolbar">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="xs" disabled={disabled}>
              表情
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="chat-emoji-popover">
            <EmojiPanel disabled={disabled} onInsert={insertToken} />
          </PopoverContent>
        </Popover>
        {onClear ? (
          <Button type="button" variant="ghost" size="xs" onClick={onClear}>
            清屏
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled || uploadBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadBusy ? "上传中" : "图片"}
        </Button>
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
        {pasteHint ? (
          <p className="im-composer-paste-hint" role="status">
            {pasteHint}
          </p>
        ) : null}
        <span className="im-composer-toolbar-spacer" aria-hidden="true" />
      </div>
      <div
        className="im-composer-resize"
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
      <InputGroup className="im-composer-group">
        <div className="im-composer-field">
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
          <InputGroupTextarea
            id="im-input"
            ref={textareaRef}
            rows={3}
            value={draft}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => {
              setDraft(event.target.value);
              syncCaret(event.currentTarget);
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
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label="私聊内容"
            aria-expanded={mention != null || emojiComplete != null}
            aria-autocomplete="list"
          />
        </div>
        <InputGroupAddon align="block-end" className="im-composer-addon">
          <p className="im-composer-hint">
            发送成功只表示已接受，不会立刻插入本地气泡。
          </p>
          <InputGroupButton
            type="submit"
            size="sm"
            disabled={disabled || sending || draft.trim().length === 0}
          >
            {sending ? <Spinner /> : null}
            {sending ? "发送中" : "发送"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
