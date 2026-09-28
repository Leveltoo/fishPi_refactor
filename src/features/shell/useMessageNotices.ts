import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invokeNoticeList, listenNoticeEvents } from "@/features/activity/api";
import type { NoticeItemDto, NoticeListResult, NoticeType } from "@/features/activity/types";
import { listenChatEvents } from "@/features/im/api";
import { NOTICE_COMMAND } from "@/features/im/types";
import { listenChatroom } from "@/lib/tauri";
import type { ChatMessageEvent } from "@/lib/types";
import { CHATROOM_EVENT } from "@/lib/types";

import { DEFAULT_SETTINGS } from "@/features/settings/constants";
import { invokeNotifyShow } from "@/features/settings/api";
import { playNoticeSound } from "@/features/settings/noticeSound";
import {
  currentDesktopSettings,
  subscribeDesktopSettings,
} from "@/features/settings/settingsStore";
import { compileTalkPattern, talkPatternHits } from "@/features/settings/talkPattern";
import type { DesktopSettings } from "@/features/settings/types";

import type { WarnBroadcast } from "./WarnBroadcast";

const WATCHED: readonly NoticeType[] = ["at", "reply", "commented", "sys-announce"];

type Cue = {
  title: string;
  body: string;
};

/**
 * 新消息按类别开关走声音和系统通知。
 * 系统通知没有点击载荷，这里不假装打开窗口或切页。
 * 紧急公告只交给可关闭的文本模态。
 */
export function useMessageNotices(selfUserName: string): {
  broadcast: WarnBroadcast | null;
  dismissBroadcast: () => void;
} {
  const [broadcast, setBroadcast] = useState<WarnBroadcast | null>(null);
  const settingsRef = useRef(readSettings());
  const selfRef = useRef(selfUserName);
  const seenRef = useRef(new Set<string>());
  const primedRef = useRef(false);
  const refreshSeq = useRef(0);
  const warnedPatterns = useRef(new Set<string>());

  selfRef.current = selfUserName;

  const dismissBroadcast = useCallback(() => {
    setBroadcast(null);
  }, []);

  useEffect(() => {
    return subscribeDesktopSettings((snapshot) => {
      settingsRef.current = snapshot.settings;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const stops: Array<() => void> = [];

    function pullNotices(): void {
      const seq = ++refreshSeq.current;
      void loadFreshNotices().then((fresh) => {
        if (!alive || seq !== refreshSeq.current || fresh == null) {
          return;
        }
        if (!primedRef.current) {
          primedRef.current = true;
          return;
        }
        deliver(fresh, settingsRef.current);
      });
    }

    async function loadFreshNotices(): Promise<Cue[] | null> {
      let lists: NoticeListResult[];
      try {
        lists = await Promise.all(
          WATCHED.map((type) => invokeNoticeList({ type })),
        );
      } catch {
        return null;
      }
      const settings = settingsRef.current;
      const fresh: Cue[] = [];
      for (const list of lists) {
        for (const item of list.items) {
          const key = `${list.type}:${item.id}`;
          if (!primedRef.current) {
            if (!item.hasRead) {
              seenRef.current.add(key);
            }
            continue;
          }
          if (item.hasRead || seenRef.current.has(key)) {
            continue;
          }
          if (!categoryEnabled(list.type, settings)) {
            continue;
          }
          seenRef.current.add(key);
          const next = noticeCue(list.type, item);
          if (next) {
            fresh.push(next);
          }
        }
      }
      return fresh;
    }

    void listenChatroom((event) => {
      if (!alive || event.event !== CHATROOM_EVENT.msg) {
        return;
      }
      const cue = chatroomCue(
        event.payload,
        selfRef.current,
        settingsRef.current,
        warnedPatterns.current,
      );
      if (cue) {
        deliver([cue], settingsRef.current);
      }
    }).then((stop) => {
      if (!alive) {
        stop();
        return;
      }
      stops.push(stop);
    }).catch(() => undefined);

    void listenChatEvents((event) => {
      if (!alive || event.event !== "chat://notice") {
        return;
      }
      if (event.payload.command === NOTICE_COMMAND.refreshNotification) {
        pullNotices();
        return;
      }
      if (event.payload.command !== NOTICE_COMMAND.idleMessage) {
        return;
      }
      const cue = idleCue(
        event.payload.senderUserName,
        event.payload.preview,
        selfRef.current,
        settingsRef.current,
      );
      if (cue) {
        deliver([cue], settingsRef.current);
      }
    }).then((stop) => {
      if (!alive) {
        stop();
        return;
      }
      stops.push(stop);
    }).catch(() => undefined);

    void listenNoticeEvents((event) => {
      if (!alive) {
        return;
      }
      if (event.event === "notice://refresh") {
        pullNotices();
        return;
      }
      const text = event.payload.content?.trim() ?? "";
      if (!text) {
        return;
      }
      setBroadcast({
        text,
        publisher: event.payload.who?.trim() ?? "",
      });
    }).then((stop) => {
      if (!alive) {
        stop();
        return;
      }
      stops.push(stop);
    }).catch(() => undefined);

    pullNotices();

    return () => {
      alive = false;
      refreshSeq.current += 1;
      stops.forEach((stop) => stop());
    };
  }, []);

  return { broadcast, dismissBroadcast };
}

function readSettings(): DesktopSettings {
  return currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
}

function chatroomCue(
  message: ChatMessageEvent,
  selfUserName: string,
  settings: DesktopSettings,
  warned: Set<string>,
): Cue | null {
  if (message.kind !== "msg" || message.revoked) {
    return null;
  }
  if (selfUserName && message.userName === selfUserName) {
    return null;
  }
  const text = (message.md || message.text || "").trim();
  const name = message.userNickname || message.userName || "有人";
  if (settings.notifyTalk) {
    const pattern = compileTalkPattern(settings.notifyTalkPattern);
    if (pattern === "invalid") {
      warnInvalidPattern(settings.notifyTalkPattern, warned);
    } else if (talkPatternHits(pattern, text)) {
      return cue("关心的消息", `${name} 说：“${clip(text, 80)}”`);
    }
  }
  if (!settings.notifyChatroom) {
    return null;
  }
  const body = text ? `${name}：${clip(text, 80)}` : `${name} 发来一条消息`;
  return cue("聊天室", body);
}

function idleCue(
  sender: string | undefined,
  preview: string | undefined,
  selfUserName: string,
  settings: DesktopSettings,
): Cue | null {
  if (!settings.notifyChat || !sender || sender === selfUserName) {
    return null;
  }
  return cue("新消息", `${sender} 说：“${clip(preview ?? "", 10)}”`);
}

function noticeCue(type: NoticeType, item: NoticeItemDto): Cue | null {
  if (type === "at") {
    const title = item.author ? `${item.author} 提及了你` : "提及了我";
    return cue(title, item.content || item.title);
  }
  if (type === "reply" || type === "commented") {
    const verb = type === "reply" ? "回复你" : "评论你";
    const who = item.author ? `${item.author}${verb}` : verb;
    const body = item.content ? `${who} ${item.content}` : who;
    return cue(item.title || "收到回复", body);
  }
  if (type === "sys-announce") {
    return cue("摸鱼派系统通知", item.title || item.content);
  }
  return null;
}

function categoryEnabled(type: NoticeType, settings: DesktopSettings): boolean {
  if (type === "at") {
    return settings.notifyAt;
  }
  if (type === "reply" || type === "commented") {
    return settings.notifyReply;
  }
  if (type === "sys-announce") {
    return settings.notifySys;
  }
  return false;
}

function deliver(cues: Cue[], settings: DesktopSettings): void {
  if (cues.length === 0) {
    return;
  }
  if (settings.notifySound) {
    playNoticeSound();
  }
  if (!settings.notifySystem || !settings.notifyEnabled) {
    return;
  }
  for (const item of cues) {
    void invokeNotifyShow(item);
  }
}

function cue(title: string, body: string): Cue | null {
  const nextTitle = clip(title, 80);
  const nextBody = clip(body, 120);
  if (!nextTitle || !nextBody) {
    return null;
  }
  return { title: nextTitle, body: nextBody };
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}...`;
}

function warnInvalidPattern(pattern: string, warned: Set<string>): void {
  if (warned.has(pattern)) {
    return;
  }
  warned.add(pattern);
  toast.warning("聊天室关键词不是合法正则，这条规则已忽略。");
}
