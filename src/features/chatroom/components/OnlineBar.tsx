import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  onRedpacket: (userName: string) => void;
};

function avatarLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "?";
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
  onRedpacket,
}: OnlineSidebarProps) {
  const countLabel =
    onlineCount == null ? "在线人数待服务端确认" : `在线 ${onlineCount}`;
  const statusClass = isUnknownStatus(connectionStatus)
    ? "is-unknown"
    : connectionStatus.toLowerCase() === "connected"
      ? "is-connected"
      : "is-other";

  return (
    <aside className="chat-side" aria-label="在线列表">
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
      <ScrollArea className="chat-side-scroll">
        {users.length === 0 ? (
          <p className="chat-online-empty">暂无在线列表</p>
        ) : (
          <ul className="chat-online-users">
            {users.map((user) => {
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
    </aside>
  );
}

export type { OnlineSidebarProps };

/** 兼容旧 import 名。 */
export const OnlineBar = OnlineSidebar;
