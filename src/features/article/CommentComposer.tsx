import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Image as ImageIcon, Send, Smile } from "lucide-react";
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
import { toMusicBox } from "../chatroom/messageView";
import { isFileSrc, uploadLocalSources } from "../chatroom/pasteImages";
import { MentionList } from "../overlay/MentionList";
import { readMention, insertMention } from "../overlay/mention";
import { isImageFile, uploadMediaToMarkdown } from "../../lib/upload";
import { emojiCompletion, imageMarkdown, pastedImageSources } from "./commentInput";
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
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem("message-height"));
    return saved > 0 ? Math.min(400, Math.max(48, saved)) : 80;
  });
  const [resizing, setResizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCursorRef = useRef(0);
  const uploadLock = useRef(false);
  const submitLock = useRef(false);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const locked = disabled || !commentAvailable || pendingConfirm;
  const mention = locked ? null : readMention(draft, caret);
  const completion = mention || locked ? null : emojiCompletion(draft, caret);
  const completionKey = `${caret}:${draft.slice(0, caret)}`;
  const showMention = mention && dismissed !== completionKey;
  const showEmoji = completion && dismissed !== completionKey;

  useEffect(() => {
    if (!resizing) return;
    function move(event: PointerEvent) {
      if (!drag.current) return;
      const next = Math.min(400, Math.max(48, drag.current.height + event.clientY - drag.current.y));
      setHeight(next);
      localStorage.setItem("message-height", String(next));
    }
    function end() { drag.current = null; setResizing(false); }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [resizing]);

  function insertAtCursor(token: string): void {
    setDraft((prev) => {
      const at = Math.max(0, Math.min(lastCursorRef.current, prev.length));
      const next = prev.slice(0, at) + token + prev.slice(at);
      lastCursorRef.current = at + token.length;
      setCaret(lastCursorRef.current);
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

  async function appendUploaded(files: File[], local: string[] = []): Promise<void> {
    const media = files.filter(isImageFile);
    if ((media.length === 0 && local.length === 0) || uploadLock.current || locked) {
      return;
    }
    uploadLock.current = true;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const markdown = await uploadMediaToMarkdown(media);
      if (markdown.length > 0) {
        insertAtCursor(markdown);
      }
      if (local.length) {
        const localMarkdown = await uploadLocalSources(local);
        if (!localMarkdown) throw new Error("本地图片无法读取");
        insertAtCursor(localMarkdown);
      }
    } catch (err) {
      setUploadError(toUserErrorMessage(err));
    } finally {
      uploadLock.current = false;
      setUploadBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const clipboard = event.clipboardData;
    if (clipboard == null || locked || uploadBusy) {
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
    const sources = pastedImageSources(html);
    const remote = files.length ? "" : imageMarkdown(sources);
    const local = files.length ? [] : sources.filter(isFileSrc);
    if (files.length === 0 && remote.length === 0 && local.length === 0) {
      return;
    }
    event.preventDefault();
    if (remote.length > 0) {
      insertAtCursor(remote);
    }
    void appendUploaded(files, local);
  }

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (content.length === 0 || locked || sending || uploadBusy || submitLock.current) {
      return;
    }
    submitLock.current = true;
    try {
      const accepted = await onSend({
        content: toMusicBox(content),
        replyId: reply?.id,
        anonymous,
        visible,
      });
      if (accepted) {
        setDraft("");
        setCaret(0);
        lastCursorRef.current = 0;
        onClearReply();
      }
    } finally {
      submitLock.current = false;
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") setDismissed(completionKey);
    if (showEmoji && event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      chooseCompletion(completion.start, `:${completion.items[0].name}:`);
      return;
    }
    lastCursorRef.current = event.currentTarget.selectionStart ?? lastCursorRef.current;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }

  function chooseCompletion(start: number, token: string) {
    setDraft(draft.slice(0, start) + token + draft.slice(caret));
    const next = start + token.length;
    lastCursorRef.current = next;
    setCaret(next);
    setDismissed(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next, next);
    });
  }

  const placeholder = !commentAvailable
    ? "评论接口尚未接入，不会伪装发出"
    : !commentable
      ? "这篇帖子关闭了评论"
      : "说点什么";

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
          aria-label="匿名"
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
          aria-label="仅楼主可见"
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
      <div className="article-resize" role="separator" aria-label="调整输入框高度"
        aria-orientation="horizontal" onPointerDown={(event) => {
          if (locked) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height };
          setResizing(true);
        }} />
      {showMention ? <MentionList query={mention.query}
        onClose={() => setDismissed(completionKey)}
        onPick={(name) => {
          const inserted = insertMention(draft, mention.start, caret, name);
          chooseCompletion(mention.start, inserted.text.slice(mention.start, inserted.caret));
        }} /> : null}
      {showEmoji ? (
        <div className="article-emoji-complete" role="group" aria-label="表情补全">
          {completion.items.map((emoji) => (
            <Button key={emoji.name} type="button" variant="ghost" size="icon-sm"
              title={emoji.name} aria-label={emoji.name}
              onClick={() => chooseCompletion(completion.start, `:${emoji.name}:`)}>
              <img src={emoji.url} alt="" />
            </Button>
          ))}
        </div>
      ) : null}
      <Textarea
        id="article-comment-input"
        ref={textareaRef}
        rows={3}
        style={{ height }}
        value={draft}
        disabled={locked}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          setDismissed(null);
          setCaret(event.target.selectionStart);
          lastCursorRef.current = event.target.selectionStart ?? event.target.value.length;
        }}
        onSelect={(event) => {
          lastCursorRef.current = event.currentTarget.selectionStart ?? lastCursorRef.current;
          setCaret(event.currentTarget.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        aria-label="评论内容"
      />
      <div className="article-composer-bar">
        <Button
          type="submit"
          size="sm"
          disabled={locked || sending || uploadBusy || draft.trim().length === 0}
        >
          {sending ? <Spinner /> : <Send aria-hidden="true" />}
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
