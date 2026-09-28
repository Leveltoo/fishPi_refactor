/**
 * 把 auth_restore / auth_me 的多种可能形状归一成主壳视图。
 * 后端 RestoreOutcome 与 AuthMe.status 由其他 agent 定稿，这里按契约做容错解析。
 */
import {
  readSessionSnapshot,
  type SessionSnapshot,
} from "./session-snapshot";

export type LimitedReason = "network" | "verification";

export type RestoreView =
  | { kind: "no_session" }
  | { kind: "authenticated"; session: SessionSnapshot }
  | { kind: "unauthorized"; message: string }
  | { kind: "limited"; reason: LimitedReason; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function normalizeTag(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[_-]/g, "").toLowerCase();
}

function limitedNetwork(): RestoreView {
  return {
    kind: "limited",
    reason: "network",
    message: "网络暂时不可用。已保留本机登录凭据，可稍后重试，不会清除 token。",
  };
}

function limitedVerification(): RestoreView {
  return {
    kind: "limited",
    reason: "verification",
    message:
      "需要完成访问验证。已保留本机登录凭据，请在浏览器验证后点重试，不会清除 token。",
  };
}

function unauthorizedView(message?: string): RestoreView {
  return {
    kind: "unauthorized",
    message: message || "登录已失效，请重新登录",
  };
}

function fromTag(tag: string, payload?: unknown): RestoreView | null {
  switch (tag) {
    case "nosession":
    case "loggedout":
      return { kind: "no_session" };
    case "authenticated":
    case "loggedin": {
      const session = readSessionSnapshot(payload);
      return session
        ? { kind: "authenticated", session }
        : { kind: "no_session" };
    }
    case "unauthorized":
      return unauthorizedView();
    case "temporarilyunavailable":
    case "limitednetwork":
    case "network":
    case "restoring":
      return limitedNetwork();
    case "verificationrequired":
    case "verification":
      return limitedVerification();
    default:
      return null;
  }
}

/**
 * 解析 auth_restore 返回值。
 * 兼容：字符串枚举、外部标签 `{ Authenticated: session }`、内部标签 kind/type/status。
 */
export function interpretRestoreOutcome(value: unknown): RestoreView {
  if (value == null) {
    return { kind: "no_session" };
  }

  if (typeof value === "string") {
    return fromTag(normalizeTag(value)) ?? { kind: "no_session" };
  }

  const rec = asRecord(value);
  if (!rec) {
    return { kind: "no_session" };
  }

  const taggedKeys = [
    "Authenticated",
    "NoSession",
    "Unauthorized",
    "TemporarilyUnavailable",
    "VerificationRequired",
    "authenticated",
    "noSession",
    "unauthorized",
    "temporarilyUnavailable",
    "verificationRequired",
  ] as const;
  for (const key of taggedKeys) {
    if (key in rec) {
      const mapped = fromTag(normalizeTag(key), rec[key] === true ? rec : rec[key]);
      if (mapped) {
        return mapped;
      }
    }
  }

  const tag = fromTag(
    normalizeTag(rec.kind ?? rec.type ?? rec.status ?? rec.outcome),
    rec.session ?? rec,
  );
  if (tag) {
    return tag;
  }

  const session = readSessionSnapshot(rec);
  if (session) {
    return { kind: "authenticated", session };
  }

  return { kind: "no_session" };
}

export function interpretLogoutNotice(value: unknown): string | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const deleted =
    rec.credentialCleared ??
    rec.credentialDeleted ??
    rec.credentialsDeleted ??
    rec.persistDeleted;
  const warning = [
    rec.persistWarning,
    rec.deleteWarning,
    rec.warning,
  ].find(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (deleted === false) {
    return (
      warning ||
      "已退出当前会话，但未能删除本机登录凭据。下次启动仍可能自动恢复。"
    );
  }
  return warning;
}
