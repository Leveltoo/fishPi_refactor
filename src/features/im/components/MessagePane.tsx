import { useCallback, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { userCardProps } from "../../usercard/hover";

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
  confirmedContent?: string | null;
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
  confirmedContent,
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
  const draftsRef = useRef(new Map<string, string>());
  const clearToken = useCallback(() => setPendingToken(null), []);

  if (!peerUserName) {
    return (
      <section className="im-pane im-pane-idle" aria-label="私聊内容">
        <p className="im-pane-idle-copy">私聊</p>
      </section>
    );
  }

  const title = peerNickname?.trim() || peerUserName;
  const nickname = peerNickname?.trim();

  return (
    <section className="im-pane" aria-label={`与 ${title} 的私聊`}>
      <header className="im-pane-head">
        <span {...userCardProps(peerUserName)}>
          <PeerAvatar name={peerUserName} src={peerAvatarUrl} />
        </span>
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
            size="icon-sm"
            className="im-clear-thread"
            title="清屏并重新加载消息"
            aria-label="消息清屏"
            onClick={onClear}
          >
            <ArrowClockwiseIcon />
          </Button>
        ) : null}
      </header>
      <MessageThread
        key={`thread:${peerUserName}`}
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
        key={`composer:${peerUserName}`}
        disabled={sending || loading}
        sending={sending}
        pendingConfirm={pendingConfirm}
        confirmedContent={confirmedContent}
        initialDraft={draftsRef.current.get(peerUserName) ?? ""}
        onDraftChange={(draft) => { draftsRef.current.set(peerUserName, draft); }}
        sendAvailable={sendAvailable}
        quote={quote ?? null}
        onClearQuote={onClearQuote ?? (() => undefined)}
        pendingMention={pendingMention ?? null}
        onClearPendingMention={onClearPendingMention}
        pendingToken={pendingToken}
        onClearPendingToken={clearToken}
        onClear={onClear}
        onSend={onSend}
      />
    </section>
  );
}
