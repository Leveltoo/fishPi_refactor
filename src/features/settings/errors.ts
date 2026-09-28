import {
  AppInvokeError,
  formatAppErrorMessage,
  parseInvokeError,
} from "../../lib/errors";

const MISSING_COMMAND_PATTERN =
  /command [`']?[\w:-]+[`']? not found|unknown command|not allowed to (?:call|use) command|not found in the allowlist|__TAURI_INTERNALS__|IPC function/i;

export function isMissingCommandError(error: unknown): boolean {
  return MISSING_COMMAND_PATTERN.test(rawErrorText(error));
}

export function toUserFacingMessage(error: unknown): string {
  if (error instanceof AppInvokeError) {
    return error.message;
  }
  return formatAppErrorMessage(parseInvokeError(error));
}

function rawErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const pieces = [record.message, record.code, record.error]
      .filter((item) => typeof item === "string")
      .join(" ");
    if (pieces.length > 0) {
      return pieces;
    }
  }
  return "";
}
