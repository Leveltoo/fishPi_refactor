import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { hideUserCardWindow } from "../usercard/window";
import {
  invokeAlwaysOnTop,
  invokeSettingsSet,
  invokeWindowOpacity,
  normalizeSettings,
} from "@/features/settings/api";
import { DEFAULT_SETTINGS } from "@/features/settings/constants";
import {
  currentDesktopSettings,
  publishDesktopSettings,
} from "@/features/settings/settingsStore";

/** 对齐旧版 min：藏到托盘，不缩到任务栏。 */
export async function hideMainToTray(): Promise<void> {
  await hideUserCardWindow();
  try {
    await getCurrentWindow().hide();
  } catch {
    try {
      await getCurrentWindow().minimize();
    } catch {
      // 非 Tauri
    }
  }
}

export async function closeMainWindow(): Promise<void> {
  try {
    await getCurrentWindow().close();
  } catch {
    // 非 Tauri
  }
}

/**
 * 顶栏透明按钮：翻转开关，使用设置里的透明度值，不写死 10% / 30%。
 * 返回翻转后的开关状态。
 */
export async function toggleWindowOpacity(
  currentlyEnabled: boolean,
  opacity: number,
): Promise<boolean> {
  const next = !currentlyEnabled;
  const result = await invokeWindowOpacity(next ? opacity : 1);
  if (result.status !== "ok") {
    toast.error(result.status === "gap" ? "窗口透明度命令未接入" : result.message);
    return currentlyEnabled;
  }
  const base = currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
  const settings = normalizeSettings({ ...base, opacityEnabled: next });
  publishDesktopSettings({ ready: true, settings });
  const saved = await invokeSettingsSet(settings);
  if (saved.status !== "ok") {
    toast.error(saved.status === "gap" ? "设置尚未保存" : saved.message);
  }
  return next;
}

export async function toggleWindowPin(currentlyOn: boolean): Promise<boolean> {
  const next = !currentlyOn;
  const result = await invokeAlwaysOnTop(next);
  if (result.status !== "ok") {
    toast.error(result.status === "gap" ? "窗口置顶命令未接入" : result.message);
    return currentlyOn;
  }
  const base = currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
  const settings = normalizeSettings({ ...base, alwaysOnTop: next });
  publishDesktopSettings({ ready: true, settings });
  const saved = await invokeSettingsSet(settings);
  if (saved.status !== "ok") {
    toast.error(saved.status === "gap" ? "设置尚未保存" : saved.message);
  }
  return next;
}

export function startWindowDrag(event: {
  button: number;
  target: EventTarget | null;
}): void {
  if (event.button !== 0 || !(event.target instanceof Element) ||
      event.target.closest("button, input, select, a, [data-menu='true']")) {
    return;
  }
  try {
    void getCurrentWindow().startDragging().catch(() => undefined);
  } catch {
    // Browser preview has no native window.
  }
}
