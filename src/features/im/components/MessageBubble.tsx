import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import {
  copyText,
  emojiCodeFromSrc,
  openMemberProfile,
  sendExclusiveRedpacket,
} from "../../chatroom/userMenuActions";

import type { PrivateMessageDto } from "../types";
import { userCardProps } from "../../usercard/hover";
import { MarkdownBody } from "./MarkdownBody";

type MessageBubbleProps = {
  message: PrivateMessageDto;
  selfUserName: string | null;
  onRevoke?: (messageId: string) => Promise<void> | void;
  onQuote?: (message: PrivateMessageDto) => void;
  onMention?: (userName: string) => void;
  onInsertToken?: (token: string) => void;
};

/** text 里常见图片/链接/表情短码：仍走 Markdown，不当纯文本原样输出。 */
function textLooksLikeMarkdown(text: string): boolean {
  return (
    /!\[[^\]]*\]\([^)]+\)/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /:[a-zA-Z0-9_+-]+:/.test(text)
  );
}

function messageBody(message: PrivateMessageDto) {
  if (message.revoked) {
    return <p className="im-msg-revoked">此消息已撤回</p>;
  }
  const md = message.md?.trim() ?? "";
  if (md.length > 0) {
    return <MarkdownBody source={md} />;
  }
  const text = message.text?.trim() ?? "";
  if (text.length > 0 && textLooksLikeMarkdown(text)) {
    return <MarkdownBody source={text} />;
  }
  return <p className="im-msg-plain">{text || "（空消息）"}</p>;
}

export function MessageBubble({
  message,
  selfUserName,
  onRevoke,
  onQuote,
  onMention,
  onInsertToken,
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
            <div className="im-msg-content">{messageBody(message)}</div>
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
          <ContextMenuItem
            onSelect={() => {
              void copyText(targetImg.src);
            }}
          >
            复制图片
          </ContextMenuItem>
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
