/**
 * 聊天室右键「用户」菜单：@ / 单独聊聊 / 访问主页 / 发个专属红包。
 * 对齐旧 `userMenuShow`；本人不弹（由调用方判断）。
 */

import {
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import {
  insertMentionToken,
  openMemberProfile,
  openPrivateChat,
  sendExclusiveRedpacket,
} from "../userMenuActions";

type UserContextMenuContentProps = {
  userName: string;
  onMention: (userName: string) => void;
};

export function UserContextMenu({
  userName,
  onMention,
}: UserContextMenuContentProps) {
  if (!userName) {
    return null;
  }
  return (
    <ContextMenuContent className="chat-menu" sideOffset={4}>
      <ContextMenuItem
        onSelect={() => {
          onMention(userName);
        }}
      >
        {insertMentionToken(userName).trim()}
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          openPrivateChat(userName);
        }}
      >
        单独聊聊
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          openMemberProfile(userName);
        }}
      >
        访问主页
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          sendExclusiveRedpacket(userName);
        }}
      >
        发个专属红包
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
