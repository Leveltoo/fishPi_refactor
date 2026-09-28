import type { ChatMessageDto } from "../../lib/types";

/** 与旧客户端右键撤回一致：本人，或纪律委员 / OP / 管理员。 */
const MODERATOR_ROLES = new Set(["纪律委员", "OP", "管理员"]);

export function isModeratorRole(role: string | null | undefined): boolean {
  if (role == null) {
    return false;
  }
  const trimmed = role.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (MODERATOR_ROLES.has(trimmed)) {
    return true;
  }
  return MODERATOR_ROLES.has(trimmed.toUpperCase());
}

/** 弹幕 / 系统消息使用本地合成 ID，不能拿去 `chatroom_revoke`。 */
export function isRevokableMessageId(id: string): boolean {
  return /^\d+$/.test(id);
}

export function canRevokeMessage(
  message: ChatMessageDto,
  selfUserName: string | null,
  selfRole: string | null,
): boolean {
  if (message.revoked) {
    return false;
  }
  if (message.kind === "barrager" || message.kind === "custom") {
    return false;
  }
  if (!isRevokableMessageId(message.id)) {
    return false;
  }
  if (
    selfUserName != null &&
    selfUserName.length > 0 &&
    message.userName === selfUserName
  ) {
    return true;
  }
  return isModeratorRole(selfRole);
}

export function canReplyMessage(message: ChatMessageDto): boolean {
  if (message.revoked) {
    return false;
  }
  return message.kind !== "barrager" && message.kind !== "custom";
}
