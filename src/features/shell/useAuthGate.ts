/**
 * 主壳状态分流。
 *
 * 依赖 src/lib/tauri.ts（前端类型化 API agent）：
 * - invokeAuthRestore()
 * - invokeAuthLogout()
 *
 * 启动只走 auth_restore；恢复中与登录失败分开。
 * 网络受限 / verification_required 保留会话，重试仍调 restore，不调 logout。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invokeAuthLogout, invokeAuthRestore } from "../../lib/tauri";
import type { AuthSession } from "../../lib/types";
import { asAuthError, authErrorMessage } from "../auth/auth-errors";
import {
  interpretLogoutNotice,
  interpretRestoreOutcome,
  type LimitedReason,
} from "./restore-outcome";
import { readSessionSnapshot, type SessionSnapshot } from "./session-snapshot";

export type AuthPhase =
  | { kind: "restoring" }
  | { kind: "login"; notice?: string }
  | { kind: "limited"; reason: LimitedReason; message: string }
  | { kind: "ready"; session: SessionSnapshot };

export type AuthGate = {
  phase: AuthPhase;
  busy: boolean;
  enterSession: (value: AuthSession | unknown) => void;
  retryRestore: () => void;
  logout: () => void;
};

function phaseFromRestore(
  value: unknown,
  fallbackUnauthorized: string,
): AuthPhase {
  const view = interpretRestoreOutcome(value);
  switch (view.kind) {
    case "no_session":
      return { kind: "login" };
    case "authenticated":
      return { kind: "ready", session: view.session };
    case "unauthorized":
      return { kind: "login", notice: view.message || fallbackUnauthorized };
    case "limited":
      return {
        kind: "limited",
        reason: view.reason,
        message: view.message,
      };
  }
}

function phaseFromThrown(err: unknown): AuthPhase {
  const appErr = asAuthError(err);
  const code = appErr?.code;
  if (code === "unauthorized") {
    return { kind: "login", notice: authErrorMessage(err) };
  }
  if (code === "verification_required") {
    return {
      kind: "limited",
      reason: "verification",
      message: authErrorMessage(err),
    };
  }
  if (code === "network" || code === "rate_limited" || code === "outcome_unknown") {
    return {
      kind: "limited",
      reason: "network",
      message: authErrorMessage(err),
    };
  }
  return { kind: "login", notice: authErrorMessage(err) };
}

export function useAuthGate(): AuthGate {
  const [phase, setPhase] = useState<AuthPhase>({ kind: "restoring" });
  const [busy, setBusy] = useState(false);
  const epochRef = useRef(0);

  const runRestore = useCallback(async (showRestoring: boolean) => {
    const epoch = ++epochRef.current;
    if (showRestoring) {
      setPhase({ kind: "restoring" });
    }
    setBusy(true);
    try {
      const outcome = await invokeAuthRestore();
      if (epoch !== epochRef.current) {
        return;
      }
      setPhase(phaseFromRestore(outcome, "登录已失效，请重新登录"));
    } catch (err) {
      if (epoch !== epochRef.current) {
        return;
      }
      setPhase(phaseFromThrown(err));
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void runRestore(true);
    return () => {
      epochRef.current += 1;
    };
  }, [runRestore]);

  const enterSession = useCallback((value: unknown) => {
    const session = readSessionSnapshot(value);
    if (!session) {
      setPhase({
        kind: "login",
        notice: "登录成功但未能读取用户信息，请重试",
      });
      return;
    }
    epochRef.current += 1;
    setBusy(false);
    setPhase({ kind: "ready", session });
  }, []);

  const retryRestore = useCallback(() => {
    void runRestore(false);
  }, [runRestore]);

  const logout = useCallback(async () => {
    const epoch = ++epochRef.current;
    setBusy(true);
    try {
      const result = await invokeAuthLogout();
      if (epoch !== epochRef.current) {
        return;
      }
      setPhase({
        kind: "login",
        notice: interpretLogoutNotice(result),
      });
    } catch (err) {
      if (epoch !== epochRef.current) {
        return;
      }
      const appErr = asAuthError(err);
      const notice =
        appErr?.code === "credential_storage"
          ? authErrorMessage(err)
          : interpretLogoutNotice(err) ?? authErrorMessage(err);
      setPhase({ kind: "login", notice });
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false);
      }
    }
  }, []);

  return {
    phase,
    busy,
    enterSession,
    retryRestore,
    logout,
  };
}
