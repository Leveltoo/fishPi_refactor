import { useEffect } from "react";
import { toast } from "sonner";
import { updateCheck } from "@/features/desktop/api";
import { invokeNotifyShow } from "@/features/settings/api";
import { currentDesktopSettings } from "@/features/settings/settingsStore";
import { OPEN_SETTINGS_EVENT } from "@/lib/nav";

/**
 * 启动后自动检查更新。失败安静。有更新时应用内提示，系统通知仍受设置开关约束。
 * 系统通知点击无法跳页（插件 2.4 无回调），提示里的按钮才切到设置。
 */
export function useStartupUpdateCheck(): void {
  useEffect(() => {
    let alive = true;
    void updateCheck()
      .then((info) => {
        if (!alive || info.upToDate) {
          return;
        }
        const title = info.name.trim() || "发现新版本";
        const body = clip(info.body, 120) || `最新 ${info.tag}`;
        toast.info(title, {
          description: body,
          action: {
            label: "去设置",
            onClick: () => {
              window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
            },
          },
        });
        const settings = currentDesktopSettings()?.settings;
        if (settings?.notifySystem && settings.notifyEnabled) {
          void invokeNotifyShow({ title, body });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}...`;
}
