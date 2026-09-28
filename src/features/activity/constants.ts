import type { NoticeType } from "./types";
import { NOTICE_COMMAND, USER_COMMAND } from "./types";

/** SDK 建议活跃度至少间隔 10 分钟查询。 */
export const LIVENESS_POLL_MS = 10 * 60 * 1000;

export const DEFAULT_NOTICE_TYPE: NoticeType = "at";

export const NOTICE_TYPES: readonly { value: NoticeType; label: string }[] = [
  { value: "at", label: "@我" },
  { value: "reply", label: "回复" },
  { value: "commented", label: "评论" },
  { value: "following", label: "关注" },
  { value: "point", label: "积分" },
  { value: "sys-announce", label: "系统" },
];

export const COMMAND_LABEL: Record<string, string> = {
  [NOTICE_COMMAND.count]: "通知未读",
  [NOTICE_COMMAND.list]: "通知列表",
  [NOTICE_COMMAND.makeRead]: "标记通知已读",
  [NOTICE_COMMAND.readAll]: "全部已读",
  [USER_COMMAND.liveness]: "活跃度",
  [USER_COMMAND.isCheckin]: "签到状态",
  [USER_COMMAND.checkin]: "签到",
  [USER_COMMAND.isCollectedLiveness]: "昨日奖励状态",
  [USER_COMMAND.rewardLiveness]: "领取昨日奖励",
};

/** SDK 1.1.0 无签到写 API 时后端返回的业务错误文案（与 Rust 常量一致）。 */
export const CHECKIN_UNSUPPORTED =
  "签到写操作暂不可用：fishpi-sdk 1.1.0 仅提供 is_checkin() 查询，没有签到写 API。本次没有真正签到。";
export const CHECKIN_UNAVAILABLE = "签到命令尚未接入，本次没有真正签到。";
export const CHECKIN_PENDING =
  "结果待确认。请稍后核对是否已经签到，请勿重复提交。";
export const CHECKIN_NOT_DONE = "当前尚未签到，本次没有记为已签。";
export const CHECKIN_OK = "签到成功。";

export const REWARD_UNAVAILABLE =
  "领取昨日奖励命令尚未接入，本次没有真正领取。";
export const REWARD_PENDING =
  "结果待确认。请稍后核对是否已经领取，请勿重复提交。";

export const READ_UNAVAILABLE = "标记已读命令尚未接入，本次没有真正标记。";
export const READ_PENDING =
  "结果待确认。请稍后核对通知是否已读，请勿重复提交。";
