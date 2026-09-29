import { getCurrentWindow } from "@tauri-apps/api/window";
import {
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
  try {
    await invokeWindowOpacity(next ? opacity : 1);
  } catch {
    // 命令缺失时仍翻转视觉
  }
  const base = currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
  const settings = normalizeSettings({ ...base, opacityEnabled: next });
  publishDesktopSettings({ ready: true, settings });
  void invokeSettingsSet(settings);
  return next;
}
