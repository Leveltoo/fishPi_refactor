import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { addEmojiUrl } from "../../chatroom/chatroomApi";
import { toUserErrorMessage } from "../../chatroom/toUserError";
import {
  copyImageFromSrc,
  copyText,
  emojiCodeFromSrc,
  openMemberProfile,
  sendExclusiveRedpacket,
} from "../../chatroom/userMenuActions";
import { userCardProps } from "../../usercard/hover";

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
  const source = message.md?.trim() || message.text?.trim() || "";
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
  const [contextEl, setContextEl] = useState<Element | null>(null);
  const mine =
    selfUserName != null &&
    selfUserName.length > 0 &&
    message.userName === selfUserName;
  const name = message.userNickname?.trim() || message.userName;
  const className = ["im-msg", mine ? "is-mine" : ""].filter(Boolean).join(" ");
  const canRevoke = mine && !message.revoked && onRevoke != null;
  const avatarHref = sanitizeHttpUrl(message.userAvatarUrl);
  const letter = name.trim().slice(0, 1) || "?";
  const copyBody = message.md?.trim() || message.text?.trim() || "";

  function captureContext(event: { target: EventTarget | null }): void {
    setContextEl(event.target instanceof Element ? event.target : null);
  }

  const targetImg =
    contextEl != null && contextEl.nodeName.toLowerCase() === "img"
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

  function addFace(url: string): void {
    void addEmojiUrl(url)
      .then(() => {
        toast.success("已同步到服务器表情");
      })
      .catch((err: unknown) => {
        toast.error(toUserErrorMessage(err));
      });
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
                <button
                  type="button"
                  className="im-msg-revoke"
                  disabled={revoking}
                  onClick={() => {
                    void handleRevoke();
                  }}
                >
                  {revoking ? "撤回中" : "撤回"}
                </button>
              ) : null}
            </header>
            <div className="im-msg-content">{messageBody(message, onJump)}</div>
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onQuote ? (
          <ContextMenuItem
            onSelect={() => {
              onQuote(message);
            }}
          >
            回复
          </ContextMenuItem>
        ) : null}
        {!mine && onMention ? (
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
              onSelect={() => {
                addFace(targetImg.src);
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
          disabled={copyBody.length === 0}
          onSelect={() => {
            void copyText(copyBody);
          }}
        >
          复制消息
        </ContextMenuItem>
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
        {canRevoke ? (
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
