import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { invokeAuthMe } from "../../lib/tauri";
import { communityNoticeUrl, openNoticeTarget, type NoticeTarget } from "./navigation";

export function parseNotificationTarget(value: unknown): NoticeTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const bounded = (text: unknown, max: number): text is string =>
    typeof text === "string" && text.trim().length > 0 && text.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(text);
  if (item.page === "settings") return { page: "settings" };
  if (item.page === "im" && bounded(item.userName, 64)) {
    return { page: "im", userName: item.userName };
  }
  if (item.page === "chatroom" &&
      (item.messageId === undefined || item.messageId === null || bounded(item.messageId, 128))) {
    return { page: "chatroom", messageId: typeof item.messageId === "string" ? item.messageId : undefined };
  }
  if (item.page === "external" && bounded(item.url, 4096)) {
    const url = communityNoticeUrl(item.url);
    if (url) return { page: "external", url };
  }
  return undefined;
}

export function useNativeNotificationClicks(sessionGeneration: number): void {
  useEffect(() => {
    let alive = true;
    const stop = listen<{ sessionGeneration: number; target: unknown }>(
      "desktop://notification-click",
      (event) => {
        const payload = event.payload;
        if (!alive || !Number.isSafeInteger(sessionGeneration) || sessionGeneration <= 0 ||
            payload?.sessionGeneration !== sessionGeneration) return;
        const target = parseNotificationTarget(payload.target);
        if (!target) return;
        void invokeAuthMe().then((session) => {
          if (alive && session.status === "loggedIn" &&
              session.sessionGeneration === sessionGeneration) {
            return openNoticeTarget(target);
          }
        }).catch(() => {
          if (alive) toast.error("打开通知失败");
        });
      },
    );
    return () => {
      alive = false;
      void stop.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [sessionGeneration]);
}
