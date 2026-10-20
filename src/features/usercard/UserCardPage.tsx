/**
 * 用户资料子窗口页面（旧 card.vue 结构）。
 * 不走 AppShell / 登录门；`user_profile` / `auth_me` 走进程内已登录 Bridge。
 */

import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { sanitizeHttpUrl } from "../../lib/markdown";
import { OPEN_IM_EVENT } from "../../lib/nav";
import { invokeAuthMe } from "../../lib/tauri";
import {
  cachedUserProfile,
  fetchUserProfile,
  invalidateUserProfile,
  type ProfileOutcome,
} from "../overlay/api";
import {
  CARD_WIDTH,
  REQUEST_LOGOUT_EVENT,
  resizeUserCardWindow,
  USER_CARD_UPDATE_EVENT,
} from "./window";
import "./usercard.css";

const ROLE_IMG: Record<string, string> = {
  管理员: "https://pwl.stackoverflow.wiki/adminRole.png",
  OP: "https://pwl.stackoverflow.wiki/opRole.png",
  纪律委员: "https://pwl.stackoverflow.wiki/policeRole.png",
  超级会员: "https://pwl.stackoverflow.wiki/svipRole.png",
  成员: "https://pwl.stackoverflow.wiki/vipRole.png",
  新手: "https://pwl.stackoverflow.wiki/newRole.png",
};

function initialUser(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("user");
  return fromQuery?.trim() ?? "";
}

export function UserCardPage() {
  const [userName, setUserName] = useState(initialUser);
  const [outcome, setOutcome] = useState<ProfileOutcome | null>(() => {
    const name = initialUser();
    return name ? cachedUserProfile(name) : null;
  });
  const [selfName, setSelfName] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSelfName(null);
    void invokeAuthMe()
      .then((me) => {
        if (cancelled) {
          return;
        }
        const name =
          (me as { user?: { userName?: string } })?.user?.userName?.trim() ??
          (me as { userName?: string })?.userName?.trim() ??
          "";
        setSelfName(name || null);
      })
      .catch(() => {
        if (!cancelled) {
          setSelfName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userName) {
      setOutcome(null);
      return;
    }
    let cancelled = false;
    setOutcome(cachedUserProfile(userName));
    void fetchUserProfile(userName).then((next) => {
      if (!cancelled) {
        setOutcome(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userName, refresh]);

  useEffect(() => {
    const unlisten = listen<{ userName?: string }>(USER_CARD_UPDATE_EVENT, (event) => {
      const next = event.payload?.userName?.trim();
      if (next) {
        invalidateUserProfile(next);
        setUserName(next);
        setRefresh((value) => value + 1);
      }
    });
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        void getCurrentWindow().hide();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      void unlisten.then((fn) => fn()).catch(() => undefined);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || outcome == null) {
      return;
    }
    // 等一帧布局后再量
    const id = requestAnimationFrame(() => {
      void resizeUserCardWindow(node.scrollHeight || node.offsetHeight || 200);
    });
    return () => cancelAnimationFrame(id);
  }, [outcome, userName]);

  function handleClose(): void {
    void getCurrentWindow().hide();
  }

  async function requestLogout(): Promise<void> {
    handleClose();
    await emitTo("main", REQUEST_LOGOUT_EVENT);
  }

  const profile = outcome?.status === "ok" ? outcome.profile : null;
  const bg = sanitizeHttpUrl(profile?.cardBg);
  const nick = profile?.userNickname?.trim() || profile?.userName || userName;
  const account = profile?.userName || userName;
  const roleImg = profile?.role ? ROLE_IMG[profile.role] : undefined;
  const metals = (profile?.metals ?? []).filter((m) => m.enabled && m.icon);
  const isSelf = selfName != null && account.toLowerCase() === selfName.toLowerCase();
  const canChat = selfName != null && account.length > 0 && !isSelf;

  return (
    <main
      id="card"
      ref={rootRef}
      className={`ucard ${profile?.online ? "is-online" : ""}`}
      style={{
        width: CARD_WIDTH,
        ...(bg ? { backgroundImage: `url(${bg})` } : {}),
      }}
      onMouseLeave={handleClose}
    >
      {outcome == null ? (
        <div className="ucard-loading">
          <Spinner />
          <span>加载名片…</span>
        </div>
      ) : outcome.status !== "ok" ? (
        <p className="ucard-error">{outcome.message}</p>
      ) : profile == null ? (
        <p className="ucard-error">没有资料</p>
      ) : (
        <>
          <header className="ucard-header">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="ucard-avatar-btn"
              aria-label="打开个人主页"
              onClick={() => {
                void openUrl(`https://fishpi.cn/member/${encodeURIComponent(account)}`);
              }}
            >
              <Avatar className="ucard-avatar">
                <AvatarImage src={sanitizeHttpUrl(profile.userAvatarUrl) ?? ""} alt="" />
                <AvatarFallback>{nick.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Button>
            <div className="ucard-name">
              <div className="ucard-name-row">
                <span className="ucard-nick">{nick}</span>
                <span className="ucard-account">{account}</span>
              </div>
              {metals.length > 0 ? (
                <div className="ucard-metals">
                  {metals.map((metal, index) => (
                    <img
                      key={`${metal.icon}-${index}`}
                      src={metal.icon}
                      title={metal.description || undefined}
                      alt=""
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </header>

          <section className="ucard-body">
            {profile.intro ? <p className="ucard-intro">{profile.intro}</p> : null}
            <div className="ucard-row">
              <div className="ucard-basic">
                {roleImg ? (
                  <img className="ucard-role" src={roleImg} alt={profile.role} title={profile.role} />
                ) : profile.role ? (
                  <span className="ucard-role-text" title={profile.role}>
                    {profile.role}
                  </span>
                ) : null}
                {profile.points !== undefined ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="ucard-points"
                    title={`${profile.points} 积分`}
                    onClick={() => {
                      void openUrl(
                        `https://fishpi.cn/member/${encodeURIComponent(account)}/points`,
                      );
                    }}
                  >
                    <PointsIcon />
                    <span className="ucard-points-num">{profile.points}</span>
                  </Button>
                ) : null}
                {profile.city ? (
                  <span className="ucard-city" title={profile.city}>
                    <i className="fa fa-map-marker" aria-hidden="true" />
                  </span>
                ) : null}
                {profile.userNo ? (
                  <span className="ucard-no" title={profile.userNo}>
                    #{profile.userNo}
                  </span>
                ) : null}
                {profile.mbti ? (
                  <a
                    className="ucard-mbti"
                    href={`https://www.16personalities.com/ch/${profile.mbti.split("-")[0]}-%E4%BA%BA%E6%A0%BC`}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(event) => {
                      event.preventDefault();
                      void openUrl(event.currentTarget.href);
                    }}
                  >
                    <i className="fa fa-user-o" aria-hidden="true" />
                    {profile.mbti}
                  </a>
                ) : null}
              </div>
              <div className="ucard-state">
                <Badge
                  variant={profile.online ? "destructive" : "outline"}
                  className={profile.online ? "ucard-tag is-online" : "ucard-tag"}
                >
                  {profile.online ? "在线" : "离线"}
                </Badge>
                {canChat ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="ucard-chat"
                    onClick={() => {
                      void emitTo("main", OPEN_IM_EVENT, { userName: account })
                        .then(handleClose);
                    }}
                  >
                    私聊
                  </Button>
                ) : isSelf ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="default"
                    className="ucard-chat"
                    onClick={() => {
                      void requestLogout();
                    }}
                  >
                    退出登录
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function PointsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#FDA203" stroke="#EF7819" strokeWidth="2" />
      <path
        d="m12 5 1.9 4.1 4.5.5-3.3 3.1.9 4.4L12 14.9l-4 2.2.9-4.4-3.3-3.1 4.5-.5z"
        fill="#FFF42B"
      />
    </svg>
  );
}
