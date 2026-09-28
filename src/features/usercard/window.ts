/**
 * 用户资料子窗口：无边框 always-on-top，贴鼠标显示（对齐旧 Electron card 窗）。
 *
 * 单例 label `user-card`；重复打开只定位 + `user-update` + show。
 * 坐标：主窗 outer（物理） + client×scale → 物理；create/setPosition 统一用 Logical。
 */

import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const USER_CARD_LABEL = "user-card";
export const USER_CARD_UPDATE_EVENT = "user-update";

export const CARD_WIDTH = 400;
/** 含顶部 52px 头像 padding + 正文；过小会再次裁头像。 */
export const CARD_HEIGHT_MIN = 240;
export const CARD_HEIGHT_MAX = 420;

type Point = { x: number; y: number };

let lastMouse: Point = { x: 24, y: 48 };
let createLock: Promise<void> | null = null;

export function trackUserCardMouse(event: { clientX: number; clientY: number }): void {
  lastMouse = { x: event.clientX, y: event.clientY };
}

export function lastUserCardMouse(): Point {
  return { ...lastMouse };
}

function clampLogical(x: number, y: number, height: number): Point {
  const maxX = Math.max(0, window.screen.width - CARD_WIDTH - 8);
  const maxY = Math.max(0, window.screen.height - height - 8);
  return {
    x: Math.min(Math.max(0, Math.round(x)), maxX),
    y: Math.min(Math.max(0, Math.round(y)), maxY),
  };
}

/** 主窗 client 坐标 → 屏幕逻辑坐标（不含装饰时 outer≈client 原点）。 */
async function clientToLogical(clientX: number, clientY: number): Promise<Point> {
  try {
    const win = getCurrentWindow();
    const outer = await win.outerPosition();
    const scale = (await win.scaleFactor()) || 1;
    const logicalOuterX = outer.x / scale;
    const logicalOuterY = outer.y / scale;
    return clampLogical(logicalOuterX + clientX, logicalOuterY + clientY, CARD_HEIGHT_MIN);
  } catch {
    return clampLogical(
      window.screenX + clientX,
      window.screenY + clientY,
      CARD_HEIGHT_MIN,
    );
  }
}

export function isUserCardWindow(): boolean {
  try {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__;
    const label = internals?.metadata?.currentWindow?.label;
    if (label === USER_CARD_LABEL) {
      return true;
    }
  } catch {
    // 非 Tauri / 开发浏览器
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("window") === "user-card";
}

/** 内容就绪后按 scrollHeight 调高（上限 420）。由名片页调用。 */
export async function resizeUserCardWindow(contentHeight: number): Promise<void> {
  try {
    const height = Math.min(
      CARD_HEIGHT_MAX,
      Math.max(CARD_HEIGHT_MIN, Math.ceil(contentHeight) + 4),
    );
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const existing = await WebviewWindow.getByLabel(USER_CARD_LABEL);
    if (existing) {
      await existing.setSize(new LogicalSize(CARD_WIDTH, height));
      await existing.setResizable(false);
    }
  } catch {
    // 窗不存在 / 无权限
  }
}

/**
 * 打开 / 更新名片窗。
 * @param x 相对主 WebView 的 clientX；省略则用最近一次鼠标位置。
 */
export async function showUserCardWindow(
  userName: string,
  x?: number,
  y?: number,
): Promise<void> {
  const name = userName.trim();
  if (!name) {
    return;
  }

  const clientX = x ?? lastMouse.x;
  const clientY = y ?? lastMouse.y;
  const logical = await clientToLogical(clientX, clientY);

  try {
    const existing = await WebviewWindow.getByLabel(USER_CARD_LABEL);
    if (existing) {
      await existing.emit(USER_CARD_UPDATE_EVENT, { userName: name });
      await existing.setPosition(new LogicalPosition(logical.x, logical.y));
      await existing.show();
      await existing.setAlwaysOnTop(true);
      return;
    }
  } catch {
    // fall through to create
  }

  // 并发 double-create 保护
  if (createLock) {
    await createLock;
    return showUserCardWindow(name, clientX, clientY);
  }

  createLock = (async () => {
    const search = new URLSearchParams({
      window: "user-card",
      user: name,
    });
    const win = new WebviewWindow(USER_CARD_LABEL, {
      url: `index.html?${search.toString()}`,
      title: "",
      width: CARD_WIDTH,
      height: CARD_HEIGHT_MIN,
      x: logical.x,
      y: logical.y,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      focus: false,
      transparent: true,
    });
    await win.once("tauri://created", () => undefined);
  })().finally(() => {
    createLock = null;
  });

  await createLock;
}

export async function hideUserCardWindow(): Promise<void> {
  try {
    const existing = await WebviewWindow.getByLabel(USER_CARD_LABEL);
    if (existing) {
      await existing.hide();
    }
  } catch {
    // 窗不存在
  }
}
