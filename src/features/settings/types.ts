export const THEME_IDS = ["desk", "cx", "ding", "feishu"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type DesktopSettings = {
  themeId: ThemeId;
  alwaysOnTop: boolean;
  opacity: number;
  closeToTray: boolean;
  bossKey: string;
  notifyEnabled: boolean;
  notifyChatroom: boolean;
  notifyChat: boolean;
  notifyAt: boolean;
  notifyReply: boolean;
  notifySys: boolean;
  notifyTalk: boolean;
  notifyTalkPattern: string;
  notifySound: boolean;
  notifySystem: boolean;
  autoReward: boolean;
};

export type NotifyShowRequest = {
  title: string;
  body: string;
};

export type AlwaysOnTopRequest = {
  on: boolean;
};

export type OpacityRequest = {
  opacity: number;
};

export type BridgeOutcome<T = void> =
  | { status: "ok"; data: T }
  | { status: "gap" }
  | { status: "error"; message: string };
