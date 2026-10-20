import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { invokeAuthMe } from "../../../lib/tauri";
import { appendCloudEmoji, loadCloudEmoji } from "../../chatroom/chatroomApi";
import { cloudEmojiUrl } from "../../chatroom/cloudEmojiLogic";
import { isOutcomeUnknown, toUserErrorMessage } from "../../chatroom/toUserError";
import {
  copyImageFromSrc,
  copyText,
  emojiCodeFromSrc,
  openMemberProfile,
  sendExclusiveRedpacket,
} from "../../chatroom/userMenuActions";
import { userCardProps } from "../../usercard/hover";
import { looksLikeHtml } from "../../chatroom/components/ChatHtmlView";
import { openSafeExternalUrl } from "../../../lib/markdown";

import type { PrivateMessageDto } from "../types";
import { MarkdownBody } from "./MarkdownBody";

type MessageBubbleProps = {
  message: PrivateMessageDto;
  selfUserName: string | null;
  onRevoke?: (messageId: string) => Promise<void> | void;
  onQuote?: (message: PrivateMessageDto) => void;
  onMention?: (userName: string) => void;
  onInsertToken?: (token: string) => void;
  onJump?: (messageId: string) => void;
};

function messageBody(message: PrivateMessageDto, onJump?: (messageId: string) => void) {
  if (message.revoked) {
    return <p className="im-msg-revoked">此消息已撤回</p>;
  }
  const html = message.text?.trim() || "";
  const source = looksLikeHtml(html) ? html : message.md?.trim() || html;
  if (source.length === 0) {
    return <p className="im-msg-plain">（空消息）</p>;
  }
  return <MarkdownBody source={source} onJump={onJump} />;
}

export function MessageBubble({
  message,
  selfUserName,
  onRevoke,
  onQuote,
  onMention,
  onInsertToken,
  onJump,
}: MessageBubbleProps) {
  const [revoking, setRevoking] = useState(false);
  const [addingFace, setAddingFace] = useState(false);
  const [contextEl, setContextEl] = useState<Element | null>(null);
  const faceBusyRef = useRef(false);
  const faceEpochRef = useRef(0);
  useEffect(() => () => {
    faceEpochRef.current += 1;
    faceBusyRef.current = false;
  }, []);
  const mine =
    selfUserName != null &&
    selfUserName.length > 0 &&
    message.userName === selfUserName;
  const name = message.userNickname?.trim() || message.userName;
  const body = message.text || message.md || "";
  const imageOnly = looksLikeHtml(body) &&
    new DOMParser().parseFromString(body, "text/html").body.textContent?.trim() === "" &&
    /<img\b/i.test(body);
  const className = ["im-msg", mine ? "is-mine" : "", imageOnly ? "is-image-only" : ""].filter(Boolean).join(" ");
  const canRevoke = mine && !message.revoked && onRevoke != null;
  const avatarHref = sanitizeHttpUrl(message.userAvatarUrl);
  const letter = name.trim().slice(0, 1) || "?";
  const copyBody = message.md?.trim() || message.text?.trim() || "";
  const avatarContext = contextEl?.closest(".im-avatar") != null;
  const selectedTextRef = useRef("");

  function captureContext(event: { target: EventTarget | null }): void {
    selectedTextRef.current = window.getSelection()?.toString() ?? "";
    setContextEl(event.target instanceof Element ? event.target : null);
  }

  const targetImg =
    !avatarContext && contextEl != null && contextEl.nodeName.toLowerCase() === "img"
      ? (contextEl as HTMLImageElement)
      : null;
  const emojiCode =
    targetImg && (targetImg.getAttribute("class") ?? "").includes("emoji")
      ? emojiCodeFromSrc(targetImg.src)
      : null;

  async function handleRevoke(): Promise<void> {
    if (!canRevoke || revoking || onRevoke == null) {
      return;
    }
    setRevoking(true);
    try {
      await onRevoke(message.id);
    } finally {
      setRevoking(false);
    }
  }

  async function addFace(url: string): Promise<void> {
    const safe = cloudEmojiUrl(url);
    if (!safe || !selfUserName || faceBusyRef.current) return;
    faceBusyRef.current = true;
    const epoch = faceEpochRef.current;
    setAddingFace(true);
    let generation = 0;
    try {
      const [owner, snapshot] = await Promise.all([invokeAuthMe(), loadCloudEmoji()]);
      generation = owner.sessionGeneration;
      if (epoch !== faceEpochRef.current || generation <= 0 ||
          owner.user?.userName !== selfUserName || snapshot.sessionGeneration !== generation) return;
      const current = await invokeAuthMe();
      if (epoch !== faceEpochRef.current || current.sessionGeneration !== generation ||
          current.user?.userName !== selfUserName) return;
      if (snapshot.urls.includes(safe)) {
        toast.info("表情已在收藏中");
        return;
      }
      const next = await appendCloudEmoji(snapshot, [safe]);
      const after = await invokeAuthMe();
      if (epoch !== faceEpochRef.current || next.sessionGeneration !== generation ||
          after.sessionGeneration !== generation || after.user?.userName !== selfUserName) return;
      if (next.urls.includes(safe)) toast.success("已加入收藏");
      else toast.error("收藏未确认，请打开收藏刷新查看。");
    } catch (err) {
      const current = await invokeAuthMe().catch(() => null);
      if (epoch !== faceEpochRef.current || current?.user?.userName !== selfUserName ||
          (generation > 0 && current.sessionGeneration !== generation)) return;
      if (isOutcomeUnknown(err)) toast.warning("结果待确认，请打开收藏刷新查看，勿重复提交。");
      else toast.error(toUserErrorMessage(err));
    } finally {
      if (epoch === faceEpochRef.current) {
        faceBusyRef.current = false;
        setAddingFace(false);
      }
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          className={className}
          data-msg-id={message.id}
          onContextMenuCapture={captureContext}
        >
          <Avatar
            className="im-avatar size-[35px]"
            {...userCardProps(message.userName)}
          >
            {avatarHref ? <AvatarImage src={avatarHref} alt="" /> : null}
            <AvatarFallback>{letter}</AvatarFallback>
          </Avatar>
          <div className="im-msg-body">
            <header className="im-msg-meta">
              <span className="im-msg-name">{name}</span>
              {message.time ? (
                <time className="im-msg-time">{message.time}</time>
              ) : null}
              {canRevoke ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="im-msg-revoke"
                  disabled={revoking}
                  onClick={() => {
                    void handleRevoke();
                  }}
                >
                  {revoking ? "撤回中" : "撤回"}
                </Button>
              ) : null}
            </header>
            <div className="im-msg-content">{messageBody(message, onJump)}</div>
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onQuote && !avatarContext && !message.revoked ? (
          <ContextMenuItem
            onSelect={() => {
              onQuote(message);
            }}
          >
            回复
          </ContextMenuItem>
        ) : null}
        {!mine && !avatarContext && onMention && !message.revoked ? (
          <ContextMenuItem
            onSelect={() => {
              onMention(message.userName);
            }}
          >
            @{message.userName}
          </ContextMenuItem>
        ) : null}
        {emojiCode && onInsertToken ? (
          <ContextMenuItem
            onSelect={() => {
              onInsertToken(emojiCode);
            }}
          >
            {emojiCode}
          </ContextMenuItem>
        ) : null}
        {targetImg && !emojiCode ? (
          <>
            <ContextMenuItem
              disabled={addingFace}
              onSelect={() => {
                void addFace(targetImg.src);
              }}
            >
              添加表情
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void copyImageFromSrc(targetImg.src, targetImg);
              }}
            >
              复制图片
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuItem
          disabled={selectedTextRef.current.length === 0}
          onSelect={() => {
            void copyText(selectedTextRef.current);
          }}
        >
          复制
        </ContextMenuItem>
        {!avatarContext ? (
          <ContextMenuItem disabled={!copyBody} onSelect={() => { void copyText(copyBody); }}>
            复制消息
          </ContextMenuItem>
        ) : null}
        {contextEl?.closest("a") ? (
          <>
            <ContextMenuItem onSelect={() => { void copyText(contextEl.closest("a")?.href ?? ""); }}>
              复制链接
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => { void openSafeExternalUrl(contextEl.closest("a")?.href).catch(() => undefined); }}>
              打开链接
            </ContextMenuItem>
          </>
        ) : null}
        {!mine ? (
          <>
            <ContextMenuItem
              onSelect={() => {
                openMemberProfile(message.userName);
              }}
            >
              访问主页
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                sendExclusiveRedpacket(message.userName);
              }}
            >
              发个专属红包
            </ContextMenuItem>
          </>
        ) : null}
        {canRevoke && !avatarContext ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={revoking}
              onSelect={() => {
                void handleRevoke();
              }}
            >
              {revoking ? "撤回中" : "撤回"}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
