import {
  AppInvokeError,
  formatAppErrorMessage,
  isAppError,
} from "../../lib/errors";

export function toUserErrorMessage(error: unknown): string {
  if (error instanceof AppInvokeError) {
    return error.message;
  }
  if (isAppError(error)) {
    if (error.code === "outcome_unknown") {
      return "结果待确认";
    }
    return formatAppErrorMessage(error);
  }
  return "请求失败";
}

export function isOutcomeUnknown(error: unknown): boolean {
  if (error instanceof AppInvokeError) {
    return error.code === "outcome_unknown";
  }
  return isAppError(error) && error.code === "outcome_unknown";
}
