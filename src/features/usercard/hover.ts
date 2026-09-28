/**
 * 悬停 / 点击触发用户资料子窗。
 * - `.user-card[data-user]` 或 `[data-user-card]` / `[data-user]`
 * - 默认 1.5s（旧版 data-time || 1.5）；`data-user-card-delay` 可覆盖（ms）
 * - 点击立即 show；点空白 / 非热区 hide；主窗 Esc hide（子窗 focus:false 收不到）
 */

import { useEffect } from "react";
import { hideUserCardWindow, showUserCardWindow, trackUserCardMouse } from "./window";

const DEFAULT_DELAY_MS = 1500;

const SELECTOR =
  ".user-card[data-user], [data-user-card], [data-user]:is(.user-card, .msg-avatar, .chat-msg-identity, .chat-msg-name, .chat-online-user-row, .im-conv-avatar, .im-avatar, .chat-also-user)";

function userNameOf(el: Element): string | null {
  const direct =
    el.getAttribute("data-user-card") ??
    el.getAttribute("data-user") ??
    null;
  const name = direct?.trim();
  if (name) {
    return name;
  }
  const host = el.closest("[data-user-card], [data-user], .user-card");
  return host?.getAttribute("data-user-card") ?? host?.getAttribute("data-user") ?? null;
}

/** 挂在头像/昵称上：写入 `data-user` + `data-user-card`（不改 className）。 */
export function userCardProps(userName: string | null | undefined) {
  const name = userName?.trim();
  if (!name) {
    return {};
  }
  return {
    "data-user": name,
    "data-user-card": name,
  } as Record<string, string>;
}

function findHotTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest(SELECTOR) ?? target.closest("[data-user-card], [data-user]");
}

export function useUserCardHover(): void {
  useEffect(() => {
    let timer: number | null = null;
    let activeEl: Element | null = null;

    function clearTimer(): void {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function schedule(el: Element, clientX: number, clientY: number): void {
      const userName = userNameOf(el);
      if (!userName) {
        return;
      }
      trackUserCardMouse({ clientX, clientY });
      if (activeEl === el && timer != null) {
        return;
      }
      clearTimer();
      activeEl = el;
      const rawDelay = Number(
        el.getAttribute("data-user-card-delay") ?? el.getAttribute("data-time"),
      );
      const isSeconds =
        el.hasAttribute("data-time") && !el.hasAttribute("data-user-card-delay");
      const delay =
        Number.isFinite(rawDelay) && rawDelay > 0
          ? isSeconds
            ? Math.min(5000, Math.max(200, Math.round(rawDelay * 1000)))
            : Math.min(5000, Math.max(200, Math.round(rawDelay)))
          : DEFAULT_DELAY_MS;
      timer = window.setTimeout(() => {
        timer = null;
        void showUserCardWindow(userName, clientX, clientY);
      }, delay);
    }

    function onOver(event: MouseEvent): void {
      trackUserCardMouse(event);
      const el = findHotTarget(event.target);
      if (el) {
        schedule(el, event.clientX, event.clientY);
        return;
      }
      clearTimer();
      activeEl = null;
    }

    function onOut(event: MouseEvent): void {
      const related = event.relatedTarget;
      if (
        activeEl != null &&
        related instanceof Node &&
        activeEl.contains(related)
      ) {
        return;
      }
      clearTimer();
      activeEl = null;
    }

    function onMove(event: MouseEvent): void {
      trackUserCardMouse(event);
    }

    async function onClick(event: MouseEvent): Promise<void> {
      trackUserCardMouse(event);
      const el = findHotTarget(event.target);
      const name = el ? userNameOf(el) : null;
      if (name) {
        clearTimer();
        await showUserCardWindow(name, event.clientX, event.clientY);
        return;
      }
      await hideUserCardWindow();
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        clearTimer();
        void hideUserCardWindow();
      }
    }

    document.addEventListener("mouseover", onOver, { passive: true });
    document.addEventListener("mouseout", onOut, { passive: true });
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimer();
      activeEl = null;
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
      void hideUserCardWindow();
    };
  }, []);
}
