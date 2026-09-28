/**
 * 根视图只做状态分流：
 * user-card 子窗 → 名片页（不经登录门）
 * restoring → 独立恢复页（不和登录失败混用）
 * login → 登录页（含 unauthorized 重新登录提示）
 * limited → 网络 / 访客验证，保留凭据，提供重试
 * ready → 主壳（默认主区聊天室；其它页由 AppShell state 切换）
 */
import { type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoginPage } from "./features/auth/LoginPage";
import { ChatRoomPage } from "./features/chatroom/ChatRoomPage";
import { AppShell } from "./features/shell/AppShell";
import { LimitedView } from "./features/shell/LimitedView";
import { RestoringView } from "./features/shell/RestoringView";
import { UserCardPage } from "./features/usercard/UserCardPage";
import { isUserCardWindow } from "./features/usercard/window";
import { persistNotice } from "./features/shell/session-snapshot";
import { useAuthGate } from "./features/shell/useAuthGate";
import "./App.css";

export default function App() {
  if (isUserCardWindow()) {
    return (
      <TooltipProvider delayDuration={400}>
        <div className="app-root app-root--card">
          <UserCardPage />
        </div>
      </TooltipProvider>
    );
  }

  const auth = useAuthGate();

  let view: ReactNode;
  switch (auth.phase.kind) {
    case "restoring":
      view = <RestoringView />;
      break;
    case "login":
      view = (
        <LoginPage
          notice={auth.phase.notice}
          submittingFromGate={auth.busy}
          onLoggedIn={auth.enterSession}
        />
      );
      break;
    case "limited":
      view = (
        <LimitedView
          reason={auth.phase.reason}
          message={auth.phase.message}
          retrying={auth.busy}
          onRetry={auth.retryRestore}
        />
      );
      break;
    case "ready":
      view = (
        <AppShell
          user={auth.phase.session.user}
          persistWarning={persistNotice(auth.phase.session)}
          loggingOut={auth.busy}
          onLogout={auth.logout}
        >
          <ChatRoomPage />
        </AppShell>
      );
      break;
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="app-root">{view}</div>
      <Toaster theme="dark" />
    </TooltipProvider>
  );
}