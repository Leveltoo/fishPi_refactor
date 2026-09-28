import {
  AppInvokeError,
  formatAppErrorMessage,
  isAppError,
  parseInvokeError,
} from "../../lib/errors";
import { COMMAND_LABEL } from "./constants";

export class BridgeGapError extends Error {
  readonly command: string;

  constructor(command: string) {
    const label = COMMAND_LABEL[command] ?? command;
    super(`${label}尚未接入 Bridge，请求未发出。`);
    this.name = "BridgeGapError";
    this.command = command;
  }
}

export function isBridgeGapError(error: unknown): error is BridgeGapError {
  return error instanceof BridgeGapError;
}

export function isOutcomeUnknown(error: unknown): boolean {
  return parseInvokeError(error).code === "outcome_unknown";
}

export function isMissingCommandError(error: unknown): boolean {
  const text = stringifyUnknown(error);
  if (text.length === 0) {
    return false;
  }
  return (
    /command [`']?[\w:-]+[`']? not found/i.test(text) ||
    /not found in the allowlist/i.test(text) ||
    /not allowed to (?:call|use) command/i.test(text) ||
    /unknown command/i.test(text) ||
    /command not found/i.test(text)
  );
}

export function toUserErrorMessage(error: unknown): string {
  if (error instanceof BridgeGapError) {
    return error.message;
  }
  if (error instanceof AppInvokeError) {
    return error.message;
  }
  if (isAppError(error)) {
    return formatAppErrorMessage(error);
  }
  return "请求失败";
}

function stringifyUnknown(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return `${error.message} ${error.name}`;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.error, record.code]
      .filter((part) => typeof part === "string")
      .join(" ");
    if (parts.length > 0) {
      return parts;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }
  return "";
}
