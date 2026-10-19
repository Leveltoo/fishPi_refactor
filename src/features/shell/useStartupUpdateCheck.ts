import { useEffect } from "react";
import { toast } from "sonner";
import { updateCheck } from "@/features/desktop/api";
import { invokeNotifyShow } from "@/features/settings/api";
import { currentDesktopSettings } from "@/features/settings/settingsStore";
import { OPEN_SETTINGS_EVENT } from "@/lib/nav";

/**
 * 启动后自动检查更新。失败安静。有更新时应用内提示，系统通知仍受设置开关约束。
 * Windows 系统通知和提示里的按钮都切到设置。
 */
export function useStartupUpdateCheck(sessionGeneration: number): void {
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
          void invokeNotifyShow({ title, body, target: { page: "settings" }, sessionGeneration });
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
