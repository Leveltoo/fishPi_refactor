import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import type { Conversation } from "../types";
import { userCardProps } from "../../usercard/hover";
import { PeerAvatar } from "./PeerAvatar";

type ConversationListProps = {
  conversations: Conversation[];
  activeUser: string | null;
  loading: boolean;
  onSelect: (userName: string) => void;
  onStart: () => void;
};

export function ConversationList({
  conversations,
  activeUser,
  loading,
  onSelect,
  onStart,
}: ConversationListProps) {
  return (
    <aside className="im-sidebar" aria-label="私聊会话">
      <div className="im-sidebar-head">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="想和谁聊聊？"
          title="想和谁聊聊？"
          onClick={onStart}
        >
          <i className="fa fa-plus" aria-hidden="true" />
        </Button>
      </div>
      <ScrollArea className="im-sidebar-scroll">
        {loading ? (
          <div className="im-sidebar-skel" aria-busy="true" aria-label="正在加载会话">
            <Skeleton className="im-skel-row" />
            <Skeleton className="im-skel-row" />
            <Skeleton className="im-skel-row" />
          </div>
        ) : (
          <ul className="im-conv-list">
            {conversations.map((item) => {
              const active = item.peerUserName === activeUser;
              return (
                <li key={item.peerUserName}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={active ? "im-conv is-active" : "im-conv"}
                    aria-current={active ? "true" : undefined}
                    title={item.peerUserName}
                    aria-label={`${item.peerUserName}${item.unread ? `，${item.unread}条未读私信` : ""}`}
                    onClick={() => onSelect(item.peerUserName)}
                  >
                    <span
                      className="im-conv-avatar"
                      {...userCardProps(item.peerUserName)}
                    >
                      <PeerAvatar
                        name={item.peerUserName}
                        src={item.peerAvatarUrl}
                      />
                      {item.unread > 0 ? (
                        <Badge
                          className="im-unread"
                          title={`${item.unread}条未读私信`}
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}
