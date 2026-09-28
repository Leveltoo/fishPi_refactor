import { useState } from "react";

import { Button } from "@/components/ui/button";

import { Composer } from "./Composer";
import { MessageThread } from "./MessageThread";
import { PeerAvatar } from "./PeerAvatar";
import type { PrivateMessageDto, ReplyTarget } from "../types";

type MessagePaneProps = {
  peerUserName: string | null;
  peerAvatarUrl: string;
  peerNickname?: string | null;
  selfUserName: string | null;
  messages: PrivateMessageDto[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  sendAvailable: boolean;
  quote?: ReplyTarget | null;
  onQuote?: (message: PrivateMessageDto) => void;
  onMention?: (userName: string) => void;
  pendingMention?: string | null;
  onClearPendingMention?: () => void;
  onClearQuote?: () => void;
  onClear?: () => void;
  onLoadMore: () => void;
  onSend: (content: string) => Promise<boolean>;
  onRevoke: (messageId: string) => Promise<void> | void;
};

export function MessagePane({
  peerUserName,
  peerAvatarUrl,
  peerNickname,
  selfUserName,
  messages,
  loading,
  loadingMore,
  hasMore,
  sending,
  pendingConfirm,
  sendAvailable,
  quote,
  onQuote,
  onMention,
  pendingMention,
  onClearPendingMention,
  onClearQuote,
  onClear,
  onLoadMore,
  onSend,
  onRevoke,
}: MessagePaneProps) {
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  if (!peerUserName) {
    return (
      <section className="im-pane im-pane-idle" aria-label="私聊内容">
        <p className="im-pane-idle-copy">选择左侧会话，或开始新的私聊</p>
      </section>
    );
  }

  const title = peerNickname?.trim() || peerUserName;
  const nickname = peerNickname?.trim();

  return (
    <section className="im-pane" aria-label={`与 ${title} 的私聊`}>
      <header className="im-pane-head">
        <PeerAvatar name={peerUserName} src={peerAvatarUrl} />
        <div className="im-pane-who">
          <h2 className="im-pane-name">{title}</h2>
          <p className="im-pane-sub">
            {nickname && nickname !== peerUserName ? `@${peerUserName} · 私聊` : "私聊"}
          </p>
        </div>
        {onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="im-clear-thread"
            title="清屏并重新加载消息"
            onClick={onClear}
          >
            清屏
          </Button>
        ) : null}
      </header>
      <MessageThread
        peerUserName={peerUserName}
        messages={messages}
        selfUserName={selfUserName}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        onRevoke={onRevoke}
        onQuote={onQuote}
        onMention={onMention}
        onInsertToken={setPendingToken}
      />
      <Composer
        disabled={sending || loading}
        sending={sending}
        pendingConfirm={pendingConfirm}
        sendAvailable={sendAvailable}
        quote={quote ?? null}
        onClearQuote={onClearQuote ?? (() => undefined)}
        pendingMention={pendingMention ?? null}
        onClearPendingMention={onClearPendingMention}
        pendingToken={pendingToken}
        onClearPendingToken={() => setPendingToken(null)}
        onClear={onClear}
        onSend={onSend}
      />
    </section>
  );
}