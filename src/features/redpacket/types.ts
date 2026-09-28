/** 旧版与 SDK 已有的红包类型，不额外发明。 */
export type RedPacketType =
  | "random"
  | "average"
  | "specify"
  | "heartbeat"
  | "rockPaperScissors";

/** 0 石头 / 1 剪刀 / 2 布，与 SDK `GestureType` 一致。 */
export type GestureIndex = 0 | 1 | 2;

export type OnlineUserPreview = {
  userName: string;
  userAvatarUrl: string;
};

export type RedPacketGot = {
  userId: string;
  userName: string;
  avatar: string;
  userMoney: number;
  time: string;
};

export type RedPacketInfo = {
  info: {
    count: number;
    got: number;
    message: string;
    userName: string;
    userAvatarUrl: string;
    gesture?: GestureIndex;
  };
  receivers: string[];
  who: RedPacketGot[];
};

export type OpenRedPacketRequest = {
  oId: string;
  gesture?: GestureIndex;
};

export type SendRedPacketRequest = {
  type: RedPacketType;
  money: number;
  count: number;
  msg: string;
  recivers: string[];
  gesture?: GestureIndex;
};

export type SendAccepted = {
  accepted: true;
  outcomeUnknown: false;
};

export type OpenSession = {
  oId: string;
  gesture?: GestureIndex;
  packetType?: RedPacketType;
  preview: OpenPreview;
};

export type OpenPreview = {
  userName: string;
  userAvatarUrl: string;
  message: string;
  count?: number;
  got?: number;
};

export type SendSession = {
  lockedUser?: string;
  lockedType?: RedPacketType;
  /** 聊天室发包事件里的当前用户；不是专属锁定对象。 */
  selfUserName?: string;
  onlineUsers: OnlineUserPreview[];
  initialReceivers: string[];
};

export type OpenOutcome =
  | { status: "ok"; data: RedPacketInfo }
  | { status: "unavailable"; message: string }
  | { status: "outcome_unknown"; message: string }
  | { status: "error"; message: string };

export type SendOutcome =
  | { status: "accepted"; message: string }
  | { status: "outcome_unknown"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };
