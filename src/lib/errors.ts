/**
 * 解析 Tauri invoke 抛错，转成可给 UI 用的中文文案。
 *
 * Bridge 已经脱敏；这里再挡一层：URL、凭据关键词、堆栈和过长调试串不得进入界面。
 */

import type { AppError, AppErrorCode } from "./types";

const APP_ERROR_CODES: readonly AppErrorCode[] = [
  "unauthorized",
  "verification_required",
  "rate_limited",
  "network",
  "business",
  "outcome_unknown",
  "credential_storage",
];

const CODE_ALIASES: Record<string, AppErrorCode> = {
  unauthorized: "unauthorized",
  verification_required: "verification_required",
  verificationRequired: "verification_required",
  rate_limited: "rate_limited",
  rateLimited: "rate_limited",
  network: "network",
  business: "business",
  outcome_unknown: "outcome_unknown",
  outcomeUnknown: "outcome_unknown",
  credential_storage: "credential_storage",
  credentialStorage: "credential_storage",
};

const USER_COPY: Record<AppErrorCode, string> = {
  unauthorized: "登录已失效，请重新登录。",
  verification_required: "需要在浏览器完成访客验证后，再点重试。",
  rate_limited: "操作过于频繁，请稍后再试。",
  network: "网络异常，请检查连接后重试。",
  business: "操作未能完成。",
  outcome_unknown: "结果待确认。请稍后查看是否已经成功，请勿重复提交。",
  credential_storage: "无法保存登录凭据。本次登录仅在关闭应用前有效。",
};

const SECRET_PATTERN = /api[_-]?key|access[_-]?token|\btoken\b|password|mfa/i;
const URL_PATTERN = /https?:\/\/|fishpi\.cn\/[^\s]*apiKey/i;
const STACK_PATTERN =
  /(?:\bat\s+\S+\s+\()|(?:[/\\][\w.-]+\.rs(?::\d+))|(?:stack traceback)/i;

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return (
    typeof value === "string" &&
    (APP_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AppError>;
  return isAppErrorCode(candidate.code) && typeof candidate.message === "string";
}

/**
 * 把 invoke reject / 任意抛出值收成 AppError。
 * 无法识别时归为 business，不把原始 SDK / IPC 字符串交给 UI。
 */
export function parseInvokeError(error: unknown): AppError {
  const payload = unwrapErrorPayload(error);
  const code = normalizeErrorCode(readString(payload, "code"));
  const rawMessage = readString(payload, "message") ?? "";
  const retryAfterMs = readFiniteNumber(payload, "retryAfterMs");
  const credentialSaved = readOptionalBoolean(payload, "credentialSaved");

  if (code) {
    return {
      code,
      message: sanitizeMessage(rawMessage, code),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(credentialSaved !== undefined ? { credentialSaved } : {}),
    };
  }

  return {
    code: "business",
    message: USER_COPY.business,
  };
}

/** 给界面用的中文文案。不要直接渲染 AppError.message 或 Error.stack。 */
export function formatAppErrorMessage(error: AppError): string {
  if (error.code === "rate_limited" && error.retryAfterMs !== undefined) {
    const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return `操作过于频繁，请约 ${seconds} 秒后再试。`;
  }

  if (error.code === "business" && isSafeUserMessage(error.message)) {
    return error.message;
  }

  if (
    error.code === "credential_storage" &&
    isSafeUserMessage(error.message)
  ) {
    return error.message;
  }

  return USER_COPY[error.code];
}

export class AppInvokeError extends Error implements AppError {
  readonly code: AppErrorCode;
  readonly retryAfterMs?: number;
  readonly credentialSaved?: boolean;

  constructor(error: AppError) {
    super(formatAppErrorMessage(error));
    this.name = "AppInvokeError";
    this.code = error.code;
    this.retryAfterMs = error.retryAfterMs;
    this.credentialSaved = error.credentialSaved;
  }
}

function unwrapErrorPayload(error: unknown): unknown {
  if (error instanceof AppInvokeError) {
    return error;
  }

  if (typeof error === "string") {
    return parseJsonIfObject(error) ?? { message: error };
  }

  if (typeof error !== "object" || error === null) {
    return {};
  }

  const record = error as Record<string, unknown>;
  if (typeof record.error === "object" && record.error !== null) {
    return record.error;
  }

  if (typeof record.error === "string") {
    return parseJsonIfObject(record.error) ?? { message: record.error };
  }

  if (typeof record.message === "string") {
    const nested = parseJsonIfObject(record.message);
    if (nested && typeof nested === "object") {
      return nested;
    }
  }

  return record;
}

function normalizeErrorCode(code: string | undefined): AppErrorCode | undefined {
  if (!code) {
    return undefined;
  }
  return CODE_ALIASES[code];
}

function sanitizeMessage(message: string, code: AppErrorCode): string {
  const trimmed = message.trim();
  if (!trimmed || !isSafeUserMessage(trimmed)) {
    return USER_COPY[code];
  }
  return trimmed;
}

function isSafeUserMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  if (SECRET_PATTERN.test(trimmed) || URL_PATTERN.test(trimmed)) {
    return false;
  }
  if (STACK_PATTERN.test(trimmed)) {
    return false;
  }
  return true;
}

function parseJsonIfObject(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function readString(
  payload: unknown,
  key: string,
): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readFiniteNumber(
  payload: unknown,
  key: string,
): number | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(
  payload: unknown,
  key: string,
): boolean | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}
