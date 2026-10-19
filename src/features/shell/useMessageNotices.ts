import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invokeNoticeList, listenNoticeEvents } from "@/features/activity/api";
import type { NoticeItemDto, NoticeListResult, NoticeType } from "@/features/activity/types";
import { loadChatroomFilters } from "@/features/chatroom/chatroomApi";
import { listenChatEvents } from "@/features/im/api";
import { NOTICE_COMMAND } from "@/features/im/types";
import { listenChatroom } from "@/lib/tauri";
import type { ChatMessageEvent, OnlineUser } from "@/lib/types";
import { CHATROOM_EVENT } from "@/lib/types";

import { DEFAULT_SETTINGS } from "@/features/settings/constants";
import { invokeNotifyShow, invokeTrayFlash } from "@/features/settings/api";
import { playNoticeSound } from "@/features/settings/noticeSound";
import {
  currentDesktopSettings,
  subscribeDesktopSettings,
} from "@/features/settings/settingsStore";
import { compileTalkPattern, talkPatternHits } from "@/features/settings/talkPattern";
import type { DesktopSettings } from "@/features/settings/types";

import type { WarnBroadcast } from "./WarnBroadcast";
import { noticeTarget } from "../activity/noticeTarget";
import { openNoticeTarget, type NoticeTarget } from "./navigation";

const WATCHED: readonly NoticeType[] = ["at", "reply", "commented", "sys-announce"];

type Cue = {
  title: string;
  body: string;
  /** 弹系统通知。聊天室普通发言为 false，对齐旧版「聊天室除外」。 */
  popup: boolean;
  target?: NoticeTarget;
};

/**
 * 新消息按类别开关走声音和系统通知。
 * 系统通知与应用内通知共用目标，账号代次隔离迟到点击。
 * 紧急公告只交给可关闭的文本模态。
 */
export function useMessageNotices(selfUserName: string, sessionGeneration: number): {
  broadcast: WarnBroadcast | null;
  dismissBroadcast: () => void;
} {
  const [broadcast, setBroadcast] = useState<WarnBroadcast | null>(null);
  const settingsRef = useRef(readSettings());
  const selfRef = useRef(selfUserName);
  const seenRef = useRef(new Set<string>());
  const primedTypesRef = useRef(new Set<NoticeType>());
  const refreshSeq = useRef(0);
  const warnedPatterns = useRef(new Set<string>());
  const lastOnlineRef = useRef<string[] | null>(null);
  const careUsersRef = useRef<string[]>([]);

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
      void loadFreshNotices(seq).then((fresh) => {
        if (!alive || seq !== refreshSeq.current || fresh == null) {
          return;
        }
        deliver(fresh, settingsRef.current, sessionGeneration);
      });
    }

    async function loadFreshNotices(seq: number): Promise<Cue[] | null> {
      const results = await Promise.allSettled(
        WATCHED.map((type) => invokeNoticeList({ type })),
      );
      const lists: NoticeListResult[] = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []);
      if (!alive || seq !== refreshSeq.current) {
        return null;
      }
      const settings = settingsRef.current;
      const fresh: Cue[] = [];
      for (const list of lists) {
        const primed = primedTypesRef.current.has(list.type);
        for (const item of list.items) {
          const key = `${list.type}:${item.id}:${item.dataType ?? ""}`;
          if (!primed) {
            seenRef.current.add(key);
            continue;
          }
          if (item.hasRead || item.deleted || seenRef.current.has(key) ||
              (list.type === "at" && item.author === selfRef.current)) {
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
        primedTypesRef.current.add(list.type);
      }
      return fresh;
    }

    void listenChatroom((event) => {
      if (!alive) {
        return;
      }
      if (event.event === CHATROOM_EVENT.online) {
        void loadChatroomFilters()
          .then((filters) => {
            if (!alive) {
              return;
            }
            careUsersRef.current = filters.careUsers;
            const cues = careOnlineCues(
              event.payload.users,
              lastOnlineRef.current,
              careUsersRef.current,
              selfRef.current,
            );
            lastOnlineRef.current = event.payload.users.map(
              (user) => user.userName,
            );
            if (cues.length > 0) {
              deliver(cues, settingsRef.current, sessionGeneration);
            }
          })
          .catch(() => {
            lastOnlineRef.current = event.payload.users.map(
              (user) => user.userName,
            );
          });
        return;
      }
      if (event.event !== CHATROOM_EVENT.msg) {
        return;
      }
      const cue = chatroomCue(
        event.payload,
        selfRef.current,
        settingsRef.current,
        warnedPatterns.current,
      );
      if (cue) {
        deliver([cue], settingsRef.current, sessionGeneration);
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
        deliver([cue], settingsRef.current, sessionGeneration);
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
    stops.push(subscribeDesktopSettings((snapshot) => {
      if (snapshot.ready) {
        pullNotices();
      }
    }));
    void loadChatroomFilters()
      .then((filters) => {
        if (alive) {
          careUsersRef.current = filters.careUsers;
        }
      })
      .catch(() => undefined);

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

export function chatroomCue(
  message: ChatMessageEvent,
  selfUserName: string,
  settings: DesktopSettings,
  warned: Set<string>,
): Cue | null {
  if (message.revoked) {
    return null;
  }
  if (selfUserName && message.userName === selfUserName) {
    return null;
  }
  const name = message.userNickname || message.userName || "有人";
  if (message.kind === "redpacket") {
    if (!settings.redpackNotice) {
      return null;
    }
    return cue("红包提醒", `${name} 发红包啦~`, true,
      { page: "chatroom", messageId: message.id });
  }
  if (message.kind !== "msg") {
    return null;
  }
  const text = (message.md || message.text || "").trim();
  if (settings.notifyTalk) {
    const pattern = compileTalkPattern(settings.notifyTalkPattern);
    if (pattern === "invalid") {
      warnInvalidPattern(settings.notifyTalkPattern, warned);
    } else if (talkPatternHits(pattern, text)) {
      return cue("关心的消息", `${name} 说：“${clip(text, 80)}”`, true,
        { page: "chatroom", messageId: message.id });
    }
  }
  if (!settings.notifyChatroom) {
    return null;
  }
  const body = text ? `${name}：${clip(text, 80)}` : `${name} 发来一条消息`;
  return cue("聊天室", body, false);
}

export function idleCue(
  sender: string | undefined,
  preview: string | undefined,
  selfUserName: string,
  settings: DesktopSettings,
): Cue | null {
  if (!settings.notifyChat || !sender || sender === selfUserName) {
    return null;
  }
  return cue("新消息", `${sender} 说：“${clip(preview ?? "", 10)}”`, true,
    { page: "im", userName: sender });
}

function careOnlineCues(
  users: OnlineUser[],
  lastOnline: string[] | null,
  careUsers: string[],
  selfUserName: string,
): Cue[] {
  if (lastOnline == null || careUsers.length === 0) {
    return [];
  }
  const names = users.map((user) => user.userName);
  const arrived = names.filter(
    (name) =>
      name.length > 0 &&
      name !== selfUserName &&
      !lastOnline.includes(name) &&
      careUsers.includes(name),
  );
  return arrived
    .map((name) => cue("特别关心", `你的特别关心 ${name} 上线啦~`, true))
    .filter((item): item is Cue => item != null);
}

export function noticeCue(type: NoticeType, item: NoticeItemDto): Cue | null {
  if (item.deleted) {
    return null;
  }
  const target = noticeTarget(item);
  if (type === "at") {
    const title = item.author ? `${item.author} 提及了你` : "提及了我";
    return cue(title, item.content || item.title, true, target);
  }
  if (type === "reply" || type === "commented") {
    const verb = type === "reply" ? "回复你" : "评论你";
    const who = item.author ? `${item.author}${verb}` : verb;
    const body = item.content ? `${who} ${item.content}` : who;
    return cue(item.title || "收到回复", body, true, target);
  }
  if (type === "sys-announce") {
    return cue("摸鱼派系统通知", item.title || item.content, true, target);
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

function deliver(cues: Cue[], settings: DesktopSettings, sessionGeneration: number): void {
  if (cues.length === 0) {
    return;
  }
  if (settings.notifySound) {
    playNoticeSound();
  }
  void invokeTrayFlash();
  if (!settings.notifySystem || !settings.notifyEnabled) {
    return;
  }
  for (const item of cues) {
    if (!item.popup) {
      continue;
    }
    toast.info(item.title, {
      description: item.body,
      action: item.target ? {
        label: "查看",
        onClick: () => {
          void openNoticeTarget(item.target!).catch(() => toast.error("打开通知失败"));
        },
      } : undefined,
    });
    void invokeNotifyShow({
      title: item.title, body: item.body, target: item.target, sessionGeneration,
    }).then((result) => {
      if (result.status === "error") {
        toast.error(result.message);
      }
    });
  }
}

function cue(title: string, body: string, popup: boolean, target?: NoticeTarget): Cue | null {
  const nextTitle = clip(title, 80);
  const nextBody = clip(body, 120);
  if (!nextTitle || !nextBody) {
    return null;
  }
  return { title: nextTitle, body: nextBody, popup, target };
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
