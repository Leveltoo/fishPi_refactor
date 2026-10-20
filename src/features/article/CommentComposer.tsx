import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmojiPanel } from "../chatroom/components/EmojiPanel";
import { toMusicBox } from "../chatroom/messageView";
import { isFileSrc, uploadLocalSources } from "../chatroom/pasteImages";
import { MentionList } from "../overlay/MentionList";
import { insertMention, readMention } from "../overlay/mention";
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
    if (pendingConfirm) {
      toast.error("结果未确认，请刷新后再发送");
    }
  }, [pendingConfirm]);

  useEffect(() => {
    if (!resizing) return;
    function move(event: PointerEvent) {
      if (!drag.current) return;
      const next = Math.min(
        400,
        Math.max(48, drag.current.height + event.clientY - drag.current.y),
      );
      setHeight(next);
      localStorage.setItem("message-height", String(next));
    }
    function end() {
      drag.current = null;
      setResizing(false);
    }
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
      if (node == null) return;
      node.focus();
      node.setSelectionRange(pos, pos);
    });
  }

  async function appendUploaded(
    files: File[],
    local: string[] = [],
  ): Promise<void> {
    const media = files.filter(isImageFile);
    if (
      (media.length === 0 && local.length === 0) ||
      uploadLock.current ||
      locked
    ) {
      return;
    }
    uploadLock.current = true;
    setUploadBusy(true);
    try {
      const markdown = await uploadMediaToMarkdown(media);
      if (markdown.length > 0) insertAtCursor(markdown);
      if (local.length) {
        const localMarkdown = await uploadLocalSources(local);
        if (!localMarkdown) throw new Error("本地图片无法读取");
        insertAtCursor(localMarkdown);
      }
    } catch (err) {
      toast.error(toUserErrorMessage(err));
    } finally {
      uploadLock.current = false;
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const clipboard = event.clipboardData;
    if (clipboard == null || locked || uploadBusy) return;
    lastCursorRef.current =
      event.currentTarget.selectionStart ?? lastCursorRef.current;
    const files: File[] = [];
    for (const item of Array.from(clipboard.items ?? [])) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (file != null) files.push(file);
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
    if (remote.length > 0) insertAtCursor(remote);
    void appendUploaded(files, local);
  }

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (
      content.length === 0 ||
      locked ||
      sending ||
      uploadBusy ||
      submitLock.current
    ) {
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
    lastCursorRef.current =
      event.currentTarget.selectionStart ?? lastCursorRef.current;
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
    ? "评论不可用"
    : !commentable
      ? "评论已关闭"
      : "说点什么";

  return (
    <form
      className={resizing ? "article-composer chat-editor is-resizing" : "article-composer chat-editor"}
      onSubmit={onSubmit}
      id="article-composer"
    >
      <section className="chat-toolbar">
        <Input
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
        <Button variant="ghost"
          type="button"
          className="msg-control"
          title={uploadBusy ? "上传中..." : "上传图片"}
          aria-label="上传图片"
          disabled={locked || uploadBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          <i
            className={uploadBusy ? "fa fa-spinner fa-spin" : "fa fa-picture-o"}
            aria-hidden="true"
          />
        </Button>
        <Button variant="ghost"
          type="button"
          className={emojiOpen ? "msg-control emoji-btn active" : "msg-control emoji-btn"}
          title="发表情"
          aria-label="发表情"
          aria-pressed={emojiOpen}
          disabled={locked}
          onClick={() => setEmojiOpen((value) => !value)}
        >
          <i className="fa fa-smile-o" aria-hidden="true" />
        </Button>
        <Button variant="ghost"
          type="button"
          className={anonymous ? "msg-control active" : "msg-control"}
          title="匿名"
          aria-label="匿名"
          aria-pressed={anonymous}
          disabled={locked}
          onClick={() => setAnonymous((value) => !value)}
        >
          <i className="fa-solid fa-mask" aria-hidden="true" />
        </Button>
        <Button variant="ghost"
          type="button"
          className={visible ? "msg-control active" : "msg-control"}
          title="仅楼主可见"
          aria-label="仅楼主可见"
          aria-pressed={visible}
          disabled={locked}
          onClick={() => setVisible((value) => !value)}
        >
          <i className="fa-solid fa-lock" aria-hidden="true" />
        </Button>
        {emojiOpen ? (
          <section className="emoji-form">
            <EmojiPanel
              disabled={locked}
              onInsert={(token) => {
                insertAtCursor(token);
                setEmojiOpen(false);
              }}
            />
          </section>
        ) : null}
        {showMention ? (
          <MentionList
            query={mention.query}
            onClose={() => setDismissed(completionKey)}
            onPick={(name) => {
              const inserted = insertMention(draft, mention.start, caret, name);
              chooseCompletion(
                mention.start,
                inserted.text.slice(mention.start, inserted.caret),
              );
            }}
          />
        ) : null}
        {showEmoji ? (
          <section className="article-emoji-complete" aria-label="表情补全">
            {completion.items.map((emoji) => (
              <Button variant="ghost"
                key={emoji.name}
                type="button"
                title={emoji.name}
                aria-label={emoji.name}
                onClick={() =>
                  chooseCompletion(completion.start, `:${emoji.name}:`)
                }
              >
                <img src={emoji.url} alt="" />
              </Button>
            ))}
          </section>
        ) : null}
      </section>
      <section
        className="chat-sender-resize"
        role="separator"
        aria-label="调整输入框高度"
        aria-orientation="horizontal"
        onPointerDown={(event) => {
          if (locked) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height };
          setResizing(true);
        }}
      >
        <hr />
      </section>
      <section className="chat-sender">
        <section className="chat-msg">
          <Textarea
            id="article-comment-input"
            ref={textareaRef}
            rows={3}
            className="article-comment-input"
            style={{ height }}
            value={draft}
            disabled={locked}
            placeholder={placeholder}
            onChange={(event) => {
              setDraft(event.target.value);
              setDismissed(null);
              setCaret(event.target.selectionStart);
              lastCursorRef.current =
                event.target.selectionStart ?? event.target.value.length;
            }}
            onSelect={(event) => {
              lastCursorRef.current = event.currentTarget.selectionStart ?? 0;
              setCaret(event.currentTarget.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label="评论内容"
          />
        </section>
        <Button variant="ghost"
          type="submit"
          className="chat-send"
          title="发送"
          aria-label="发送"
          disabled={
            locked || sending || uploadBusy || draft.trim().length === 0
          }
          style={{ height }}
        >
          <i
            className={sending ? "fa fa-spinner fa-spin" : "fa fa-paper-plane"}
            aria-hidden="true"
          />
        </Button>
        <section className="msg-more">
          {reply ? (
            <span className="article-reply-tag">
              回复：@{reply.userName}
              <Button variant="ghost"
                type="button"
                title="取消回复"
                aria-label="取消回复"
                onClick={onClearReply}
              >
                <i className="fa fa-times" aria-hidden="true" />
              </Button>
            </span>
          ) : null}
        </section>
      </section>
    </form>
  );
}
