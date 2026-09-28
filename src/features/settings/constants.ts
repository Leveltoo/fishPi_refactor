import type { DesktopSettings, ThemeId } from "./types";
import { THEME_IDS } from "./types";

export const SETTINGS_COMMAND = {
  get: "settings_get",
  set: "settings_set",
} as const;

export const WINDOW_COMMAND = {
  alwaysOnTop: "window_set_always_on_top",
  opacity: "window_set_opacity",
} as const;

export const NOTIFY_COMMAND = {
  show: "notify_show",
} as const;

export const OPACITY_MIN = 0.3;
export const OPACITY_MAX = 1;
export const OPACITY_STEP = 0.05;

export const DEFAULT_BOSS_KEY = "Ctrl+Shift+H";

export const DEFAULT_SETTINGS: DesktopSettings = {
  themeId: "desk",
  alwaysOnTop: false,
  opacity: 1,
  closeToTray: true,
  bossKey: DEFAULT_BOSS_KEY,
  notifyEnabled: false,
  notifyChatroom: false,
  notifyChat: false,
  notifyAt: false,
  notifyReply: false,
  notifySys: false,
  notifyTalk: false,
  notifyTalkPattern: "",
  notifySound: false,
  notifySystem: false,
  autoReward: false,
};

export const THEME_OPTIONS: readonly {
  id: ThemeId;
  label: string;
  blurb: string;
}[] = [
  { id: "desk", label: "工位红", blurb: "炭黑底 · 朱红强调 · 白气泡" },
  { id: "cx", label: "Codex", blurb: "石墨壳 · 克制软绿" },
  { id: "ding", label: "钉钉", blurb: "冷灰蓝密列表 · 顶栏搜索" },
  { id: "feishu", label: "飞书", blurb: "白底大圆角 · 渐变标志" },
];

export const TALK_PATTERN_MAX = 200;

export const BRIDGE_GAP_COPY = "需重编译 Bridge 才持久化";

export const BRIDGE_GAP_DETAIL =
  "桌面 Bridge 命令尚未接入。界面可以改，但没有写入系统，需重编译 Bridge 才持久化。";

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}
