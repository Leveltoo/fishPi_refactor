import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import type { OnlineEvent } from "../../../lib/types";
import { userCardProps } from "../../usercard/hover";
import { UserContextMenu } from "./UserContextMenu";

type OnlineUser = OnlineEvent["users"][number];

const SIDEBAR_KEY = "showSidebar";

type OnlineSidebarProps = {
  onlineCount: number | null;
  users: OnlineUser[];
  selfUserName?: string | null;
  onMention: (userName: string) => void;
  onOpenIm: (userName: string) => void;
};

function avatarLetter(name: string): string {
  return name.trim().slice(0, 1) || "?";
}

function readShowSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeShowSidebar(show: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(show));
  } catch {
    // Legacy behavior: an unavailable storage backend only affects this session.
  }
}

export function OnlineSidebar({
  onlineCount,
  users,
  selfUserName = null,
  onMention,
  onOpenIm,
}: OnlineSidebarProps) {
  const [showSidebar, setShowSidebar] = useState(readShowSidebar);
  const [search, setSearch] = useState("");
  const visibleUsers = useMemo(() => {
    const needle = search.trim();
    return needle.length === 0
      ? users
      : users.filter((user) => user.userName.includes(needle));
  }, [search, users]);

  function toggleSidebar(): void {
    setShowSidebar((previous) => {
      const next = !previous;
      writeShowSidebar(next);
      return next;
    });
  }

  return (
    <section
      className={showSidebar ? "chat-side-box" : "chat-side-box is-collapsed"}
      aria-label="在线列表"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="chat-side-toggle"
        onClick={toggleSidebar}
        title="折叠在线列表"
        aria-expanded={showSidebar}
      >
        <i
          className={showSidebar ? "fa fa-angle-right" : "fa fa-angle-left"}
          aria-hidden="true"
        />
      </Button>
      <aside className="chat-side">
        <p className="chat-side-count">当前在线({onlineCount ?? users.length})</p>
        <p className="chat-side-search-wrap">
          <Input
            className="chat-side-search"
            value={search}
            placeholder="搜索"
            aria-label="搜索在线用户"
            onChange={(event) => setSearch(event.target.value)}
          />
        </p>
        <ScrollArea className="chat-side-scroll">
          {visibleUsers.length === 0 ? null : (
            <ul className="chat-online-users">
              {visibleUsers.map((user) => {
                const src = sanitizeHttpUrl(user.userAvatarUrl);
                return (
                  <li key={user.userName} className="chat-online-user">
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          className="chat-online-user-row"
                          title={user.userName}
                          onDoubleClick={() => onOpenIm(user.userName)}
                          {...userCardProps(user.userName)}
                        >
                          <Avatar className="chat-online-avatar">
                            {src ? <AvatarImage src={src} alt="" /> : null}
                            <AvatarFallback>{avatarLetter(user.userName)}</AvatarFallback>
                          </Avatar>
                          <span>{user.userName}</span>
                        </div>
                      </ContextMenuTrigger>
                      <UserContextMenu
                        userName={user.userName}
                        selfUserName={selfUserName}
                        onMention={onMention}
                      />
                    </ContextMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </aside>
    </section>
  );
}

export const OnlineBar = OnlineSidebar;
