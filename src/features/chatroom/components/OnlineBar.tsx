import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OnlineEvent } from "../../../lib/types";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { connectionStatusLabel, isUnknownStatus } from "../labels";
import type { ChatroomFilters } from "../chatroomApi";
import { UserContextMenu } from "./UserContextMenu";
import { userCardProps } from "../../usercard/hover";
import { FilterPanel } from "./FilterPanel";

type OnlineUser = OnlineEvent["users"][number];

const SIDEBAR_KEY = "showSidebar";

/**
 * 旧版侧栏：当前在线 + 搜索 + 列表；重建/刷新/屏蔽挂在此栏顶，不进窗口标题栏。
 * 话题改到消息与输入之间的 `.chat-discusse`（对齐旧 `.discusse`）。
 * 列表行右键对齐旧 `userMenuShow`：@ / 单独聊聊 / 访问主页 / 发个专属红包。
 */
type OnlineSidebarProps = {
  onlineCount: number | null;
  users: OnlineUser[];
  connectionStatus: string;
  busy: boolean;
  onRebuild: () => void;
  onRefresh: () => void;
  filters: ChatroomFilters;
  filtersReady: boolean;
  onFilters: (filters: ChatroomFilters) => void;
  onEditTopic: () => void;
  onMention: (userName: string) => void;
  onOpenIm: (userName: string) => void;
};

function avatarLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "?";
}

function readShowSidebar(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    return raw == null || raw === "true";
  } catch {
    return true;
  }
}

function writeShowSidebar(show: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(show));
  } catch {
    // 隐私模式写不进去就只改本次会话。
  }
}

export function OnlineSidebar({
  onlineCount,
  users,
  connectionStatus,
  busy,
  onRebuild,
  onRefresh,
  filters,
  filtersReady,
  onFilters,
  onEditTopic,
  onMention,
  onOpenIm,
}: OnlineSidebarProps) {
  const [showSidebar, setShowSidebar] = useState(readShowSidebar);
  const [search, setSearch] = useState("");
  const countLabel =
    onlineCount == null ? "在线人数待服务端确认" : `在线 ${onlineCount}`;
  const statusClass = isUnknownStatus(connectionStatus)
    ? "is-unknown"
    : connectionStatus.toLowerCase() === "connected"
      ? "is-connected"
      : "is-other";
  const visibleUsers = useMemo(() => {
    const needle = search.trim();
    if (needle.length === 0) {
      return users;
    }
    return users.filter((user) => user.userName.includes(needle));
  }, [users, search]);

  function toggleSidebar(): void {
    setShowSidebar((prev) => {
      const next = !prev;
      writeShowSidebar(next);
      return next;
    });
  }

  return (
    <aside
      className={showSidebar ? "chat-side-box" : "chat-side-box is-collapsed"}
      aria-label="在线列表"
    >
      <button
        type="button"
        className="chat-side-toggle"
        title={showSidebar ? "折叠在线列表" : "展开在线列表"}
        aria-expanded={showSidebar}
        onClick={toggleSidebar}
      >
        {showSidebar ? "›" : "‹"}
      </button>
      <div className="chat-side">
        <div className="chat-side-head">
          <span className={`chat-conn ${statusClass}`} role="status">
            {connectionStatusLabel(connectionStatus)}
          </span>
          <span className="chat-side-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={onRebuild}
                  disabled={busy}
                >
                  断开重建
                </Button>
              </TooltipTrigger>
              <TooltipContent>断开并重新连接，再拉最近历史</TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onRefresh}
              disabled={busy}
            >
              刷新
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="xs">
                  屏蔽
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="chat-filter-popover"
                sideOffset={6}
              >
                <PopoverHeader>
                  <PopoverTitle>屏蔽与特别关心</PopoverTitle>
                </PopoverHeader>
                {filtersReady ? (
                  <FilterPanel filters={filters} onChange={onFilters} />
                ) : (
                  <p className="chat-emoji-note">
                    本机规则还没读出来。为避免写空覆盖，先不能改。
                  </p>
                )}
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onEditTopic}
              disabled={busy}
              title="修改话题，最长 16 字，需要 16 积分"
            >
              改话题
            </Button>
          </span>
        </div>
        <p className="chat-side-count" title={countLabel}>
          {countLabel}
          {users.length > 0 ? ` · 列表 ${users.length}` : ""}
        </p>
        <Input
          className="chat-side-search"
          value={search}
          placeholder="搜索"
          aria-label="搜索在线用户"
          onChange={(event) => setSearch(event.target.value)}
        />
        <ScrollArea className="chat-side-scroll">
          {users.length === 0 ? (
            <p className="chat-online-empty">暂无在线列表</p>
          ) : visibleUsers.length === 0 ? (
            <p className="chat-online-empty">没有匹配的在线用户</p>
          ) : (
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
                          <Avatar size="sm">
                            {src ? <AvatarImage src={src} alt="" /> : null}
                            <AvatarFallback>
                              {avatarLetter(user.userName)}
                            </AvatarFallback>
                          </Avatar>
                          <span>{user.userName}</span>
                        </div>
                      </ContextMenuTrigger>
                      <UserContextMenu
                        userName={user.userName}
                        onMention={onMention}
                      />
                    </ContextMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>
    </aside>
  );
}

export type { OnlineSidebarProps };

/** 兼容旧 import 名。 */
export const OnlineBar = OnlineSidebar;
