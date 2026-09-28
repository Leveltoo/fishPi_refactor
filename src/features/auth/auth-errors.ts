/**
 * 登录 / 恢复错误文案。
 * 依赖 src/lib/errors.ts：isAppError、formatAppErrorMessage、parseInvokeError、AppInvokeError。
 */
import {
  AppInvokeError,
  formatAppErrorMessage,
  isAppError,
  parseInvokeError,
} from "../../lib/errors";
import type { AppError } from "../../lib/types";

export function asAuthError(err: unknown): AppError | null {
  if (isAppError(err)) {
    return err;
  }
  return null;
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof AppInvokeError) {
    return err.message;
  }
  if (isAppError(err)) {
    return formatAppErrorMessage(err);
  }
  return formatAppErrorMessage(parseInvokeError(err));
}
