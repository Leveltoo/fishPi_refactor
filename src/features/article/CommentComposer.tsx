import {
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Image as ImageIcon, Smile } from "lucide-react";
import {
  LockSimpleIcon,
  MaskHappyIcon,
  XIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { EmojiPanel } from "../chatroom/components/EmojiPanel";
import { isUploadableMedia, uploadMediaToMarkdown } from "../../lib/upload";
import { toUserErrorMessage } from "./errors";
import type { CommentReplyTarget, CommentSubmit } from "./types";

type CommentComposerProps = {
  disabled: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  commentAvailable: boolean;
  commentable: boolean;
  reply: CommentReplyTarget | null;
  onClearReply: () => void;
  onSend: (draft: CommentSubmit) => Promise<boolean>;
};

function htmlImageMarkdown(html: string): string {
  const matches = html.match(/src="([^"]+)"/g) ?? [];
  const tokens: string[] = [];
  for (const match of matches) {
    const url = match.slice(5, -1).trim();
    if (/^https?:\/\//i.test(url)) {
      tokens.push(`![图片](${url})`);
    }
  }
  return tokens.join("\n");
}

/**
 * 评论输入：回复、匿名、仅楼主可见、插图、表情。
 * 匿名 / 可见按界面传入，不写死 false。
 */
export function CommentComposer({
  disabled,
  sending,
  pendingConfirm,
  commentAvailable,
  commentable,
  reply,
  onClearReply,
  onSend,
}: CommentComposerProps) {
  const [draft, setDraft] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [visible, setVisible] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCursorRef = useRef(0);

  function insertAtCursor(token: string): void {
    setDraft((prev) => {
      const at = Math.max(0, Math.min(lastCursorRef.current, prev.length));
      const next = prev.slice(0, at) + token + prev.slice(at);
      lastCursorRef.current = at + token.length;
      return next;
    });
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      const pos = lastCursorRef.current;
      if (node == null) {
        return;
      }
      node.focus();
      node.setSelectionRange(pos, pos);
    });
  }

  async function appendUploaded(files: File[]): Promise<void> {
    const media = files.filter(isUploadableMedia);
    if (media.length === 0 || uploadBusy) {
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    try {
      const markdown = await uploadMediaToMarkdown(media);
      if (markdown.length > 0) {
        insertAtCursor(markdown);
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
    lastCursorRef.current =
      event.currentTarget.selectionStart ?? lastCursorRef.current;
    const files: File[] = [];
    for (const item of Array.from(clipboard.items ?? [])) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (file != null) {
          files.push(file);
        }
      }
    }
    const html = clipboard.getData("text/html");
    const remote = html.length > 0 ? htmlImageMarkdown(html) : "";
    if (files.length === 0 && remote.length === 0) {
      return;
    }
    event.preventDefault();
    if (remote.length > 0) {
      insertAtCursor(remote);
    }
    if (files.length > 0) {
      void appendUploaded(files);
    }
  }

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (content.length === 0 || disabled || sending) {
      return;
    }
    const accepted = await onSend({
      content,
      replyId: reply?.id,
      anonymous,
      visible,
    });
    if (accepted) {
      setDraft("");
      lastCursorRef.current = 0;
      onClearReply();
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    lastCursorRef.current = event.currentTarget.selectionStart ?? lastCursorRef.current;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }

  const locked = disabled || !commentAvailable;
  const placeholder = !commentAvailable
    ? "评论接口尚未接入，不会伪装发出"
    : !commentable
      ? "这篇帖子关闭了评论"
      : "写下评论，Ctrl+Enter 发送";

  return (
    <form className="article-composer" onSubmit={onSubmit} id="article-composer">
      {pendingConfirm ? (
        <p className="article-pending" role="status">
          结果待确认。请稍后查看是否已经成功，请勿重复提交。
        </p>
      ) : null}
      {reply ? (
        <div className="article-reply-chip">
          <p>
            回复 @{reply.userName}
            {reply.content.trim() ? (
              <span>：{stripPreview(reply.content)}</span>
            ) : null}
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={onClearReply}>
            <XIcon />
            取消
          </Button>
        </div>
      ) : null}
      <div className="article-composer-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            void appendUploaded(Array.from(event.target.files ?? []));
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={uploadBusy ? "上传中..." : "上传图片"}
          aria-label="上传图片"
          disabled={locked || uploadBusy}
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
              className={emojiOpen ? "is-active" : undefined}
              title="插表情"
              aria-label="插表情"
              disabled={locked}
            >
              <Smile aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="article-emoji-popover">
            <EmojiPanel
              disabled={locked}
              onInsert={(token) => {
                insertAtCursor(token);
                setEmojiOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={anonymous ? "is-active" : undefined}
          title="匿名"
          aria-pressed={anonymous}
          disabled={locked}
          onClick={() => setAnonymous((prev) => !prev)}
        >
          <MaskHappyIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={visible ? "is-active" : undefined}
          title="仅楼主可见"
          aria-pressed={visible}
          disabled={locked}
          onClick={() => setVisible((prev) => !prev)}
        >
          <LockSimpleIcon />
        </Button>
        {anonymous ? <span className="article-flag-hint">匿名</span> : null}
        {visible ? <span className="article-flag-hint">仅楼主可见</span> : null}
      </div>
      {uploadError ? (
        <p className="article-pending" role="status">
          {uploadError}
        </p>
      ) : null}
      <Textarea
        id="article-comment-input"
        ref={textareaRef}
        rows={3}
        value={draft}
        disabled={locked}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          lastCursorRef.current = event.target.selectionStart ?? event.target.value.length;
        }}
        onSelect={(event) => {
          lastCursorRef.current = event.currentTarget.selectionStart ?? lastCursorRef.current;
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        aria-label="评论内容"
      />
      <div className="article-composer-bar">
        <p className="article-composer-hint">
          评论发出后会刷新详情，不会在本地假装成功。
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={locked || sending || draft.trim().length === 0}
        >
          {sending ? <Spinner /> : null}
          {sending ? "发送中" : "发送"}
        </Button>
      </div>
    </form>
  );
}

function stripPreview(raw: string): string {
  const text = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 48) {
    return text;
  }
  return `${text.slice(0, 48)}…`;
}
