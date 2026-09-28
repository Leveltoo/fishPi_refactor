/** 主壳使用的会话快照。字段名对齐 DTO camelCase，缺省时做容错。 */

export type ShellUser = {
  userName: string;
  userNickname: string;
  userAvatarUrl: string;
  userNo: string;
  role: string;
};

export type SessionSnapshot = {
  sessionGeneration: number;
  user: ShellUser;
  credentialSaved: boolean;
  persistWarning?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function readString(...candidates: unknown[]): string {
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      return String(item);
    }
  }
  return "";
}

function readNumber(...candidates: unknown[]): number {
  for (const item of candidates) {
    if (typeof item === "number" && Number.isFinite(item)) {
      return item;
    }
    if (typeof item === "string" && item.trim()) {
      const parsed = Number(item);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

function readBool(...candidates: unknown[]): boolean {
  for (const item of candidates) {
    if (typeof item === "boolean") {
      return item;
    }
  }
  return false;
}

/** 头像只接受 http(s)，避免 javascript: 等危险协议进入 img。 */
export function safeAvatarUrl(url: unknown): string {
  if (typeof url !== "string") {
    return "";
  }
  const trimmed = url.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return "";
}

export function readShellUser(value: unknown): ShellUser {
  const rec = asRecord(value) ?? {};
  return {
    userName: readString(rec.userName, rec.user_name, rec.username),
    userNickname: readString(rec.userNickname, rec.user_nickname, rec.nickname),
    userAvatarUrl: safeAvatarUrl(
      rec.userAvatarUrl ?? rec.user_avatar_url ?? rec.userAvatarURL ?? rec.avatar,
    ),
    userNo: readString(rec.userNo, rec.user_no, rec.userNumber),
    role: readString(rec.role, rec.userRole, rec.user_role),
  };
}

export function readSessionSnapshot(value: unknown): SessionSnapshot | null {
  const rec = asRecord(value);
  if (!rec) {
    return null;
  }
  const nested = rec.session ?? rec.Authenticated;
  const source = asRecord(nested) ?? rec;
  const user = readShellUser(source.user ?? source);
  if (!user.userName && !user.userNickname) {
    return null;
  }
  const persistWarning = readString(
    source.persistWarning,
    source.persist_warning,
  );
  return {
    sessionGeneration: readNumber(
      source.sessionGeneration,
      source.session_generation,
    ),
    user,
    credentialSaved: readBool(
      source.credentialSaved,
      source.credential_saved,
    ),
    persistWarning: persistWarning || undefined,
  };
}

export function displayName(user: ShellUser): string {
  return user.userNickname || user.userName || "摸鱼派用户";
}

export function avatarInitial(user: ShellUser): string {
  const name = displayName(user);
  return name.slice(0, 1);
}

export function persistNotice(session: SessionSnapshot): string | undefined {
  if (session.persistWarning) {
    return session.persistWarning;
  }
  if (!session.credentialSaved) {
    return "无法保存登录凭据，关闭应用后需要重新登录。";
  }
  return undefined;
}
