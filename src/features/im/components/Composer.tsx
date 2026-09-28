import {
  useEffect,
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
import { EmojiPanel } from "../../chatroom/components/EmojiPanel";
import { isUploadableMedia, uploadMediaToMarkdown } from "../../../lib/upload";
import type { ReplyTarget } from "../types";

export type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  sendAvailable: boolean;
  /** 发送只收纯文本正文；usePrivateChat 不拼引用，quote 仅展示。 */
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

function isBareImageUrl(text: string): boolean {
  return IMAGE_URL_PATTERN.test(text.trim());
}

/** 从粘贴的 HTML 里抽出 http(s) 图片地址，转成 markdown 图片。 */
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

/**
 * 私聊输入区：工具条（表情 / 清屏 / 粘贴提示）+ 引用 chip + textarea + 发送。
 * Enter 发送、Shift+Enter 换行；结果待确认与 sendAvailable 语义保持不变。
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
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (content.length === 0 || disabled || sending) {
      return;
    }
    const accepted = await onSend(content);
    if (accepted) {
      setDraft("");
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  /** 表情插入：追加到草稿末尾（对齐 chatroom insertToken），并回焦。 */
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
    });
  }

  /** 粘贴插入：落在光标处；未聚焦时追加末尾。 */
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
    });
  }

  /** 粘贴 / 选择媒体文件 → 上传 → 插入 markdown。 */
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

    // 普通文本 / 已是 markdown 图片：交给浏览器默认粘贴进草稿。
    if (plain.length > 0) {
      setPasteHint(null);
    }
  }

  const placeholder = !sendAvailable
    ? "发送接口尚未接入，不会伪装发出"
    : disabled
      ? "当前无法发送"
      : "输入消息，Enter 发送，Shift+Enter 换行";

  return (
    <form className="im-composer" onSubmit={onSubmit}>
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
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
            >
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
      <InputGroup className="im-composer-group">
        <InputGroupTextarea
          id="im-input"
          ref={textareaRef}
          rows={3}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-label="私聊内容"
        />
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
