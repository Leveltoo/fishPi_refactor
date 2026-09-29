/**
 * 桌面设置 typed invoke。命令未注册时返回 gap，不得假装已写入系统。
 *
 * 约定与 P0 一致：单 DTO 入参叫 `request`。
 */

import { invoke } from "@tauri-apps/api/core";

import {
  DEFAULT_BOSS_KEY,
  DEFAULT_SETTINGS,
  NOTIFY_COMMAND,
  OPACITY_MAX,
  OPACITY_MIN,
  SETTINGS_COMMAND,
  TALK_PATTERN_MAX,
  TRAY_COMMAND,
  WINDOW_COMMAND,
} from "./constants";
import { isMissingCommandError, toUserFacingMessage } from "./errors";
import {
  currentDesktopSettings,
  publishDesktopSettings,
} from "./settingsStore";
import { resolveThemeId } from "./theme";
import type {
  AlwaysOnTopRequest,
  BridgeOutcome,
  DesktopSettings,
  NotifyShowRequest,
  OpacityRequest,
} from "./types";

const missingCommands = new Set<string>();

export async function invokeSettingsGet(): Promise<
  BridgeOutcome<DesktopSettings>
> {
  const result = await invokeMapped(SETTINGS_COMMAND.get, undefined, parseSettings);
  if (result.status === "ok") {
    return { status: "ok", data: normalizeSettings(result.data) };
  }
  if (result.status === "gap") {
    return { status: "gap" };
  }
  return result;
}

export function invokeSettingsSet(
  settings: DesktopSettings,
): Promise<BridgeOutcome> {
  return invokeVoid(SETTINGS_COMMAND.set, {
    request: normalizeSettings(settings),
  });
}

export function invokeAlwaysOnTop(on: boolean): Promise<BridgeOutcome> {
  const request: AlwaysOnTopRequest = { on };
  return invokeVoid(WINDOW_COMMAND.alwaysOnTop, { request });
}

export function invokeWindowOpacity(opacity: number): Promise<BridgeOutcome> {
  const request: OpacityRequest = { opacity: clampOpacity(opacity) };
  return invokeVoid(WINDOW_COMMAND.opacity, { request });
}

export function invokeNotifyShow(
  request: NotifyShowRequest,
): Promise<BridgeOutcome> {
  return invokeVoid(NOTIFY_COMMAND.show, { request });
}

export function invokeTrayFlash(): Promise<BridgeOutcome> {
  return invokeVoid(TRAY_COMMAND.flash);
}

export function windowOpacityValue(settings: DesktopSettings): number {
  return settings.opacityEnabled ? settings.opacity : 1;
}

/** 合并当前设置、发布到订阅方并写入 Bridge。 */
export function persistSettingsPatch(
  partial: Partial<DesktopSettings>,
): Promise<BridgeOutcome> {
  const base = currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
  const settings = normalizeSettings({ ...base, ...partial });
  publishDesktopSettings({ ready: true, settings });
  return invokeSettingsSet(settings);
}

export function normalizeSettings(
  input: Partial<DesktopSettings> | null | undefined,
): DesktopSettings {
  const source = input ?? {};
  return {
    themeId: resolveThemeId(source.themeId),
    alwaysOnTop: Boolean(source.alwaysOnTop),
    opacity: clampOpacity(source.opacity ?? DEFAULT_SETTINGS.opacity),
    opacityEnabled: readBoolean(
      source.opacityEnabled,
      DEFAULT_SETTINGS.opacityEnabled,
    ),
    closeToTray:
      typeof source.closeToTray === "boolean"
        ? source.closeToTray
        : DEFAULT_SETTINGS.closeToTray,
    bossKey: normalizeBossKey(source.bossKey),
    notifyEnabled: Boolean(source.notifyEnabled),
    notifyChatroom: readBoolean(source.notifyChatroom),
    notifyChat: readBoolean(source.notifyChat),
    notifyAt: readBoolean(source.notifyAt),
    notifyReply: readBoolean(source.notifyReply),
    notifySys: readBoolean(source.notifySys),
    notifyTalk: readBoolean(source.notifyTalk),
    notifyTalkPattern: normalizeTalkPattern(source.notifyTalkPattern),
    notifySound: readBoolean(source.notifySound),
    notifySystem: readBoolean(source.notifySystem),
    autoReward: readBoolean(source.autoReward),
    redpackNotice: readBoolean(source.redpackNotice),
  };
}

export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.opacity;
  }
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, value));
}

function normalizeBossKey(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_BOSS_KEY;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_BOSS_KEY;
}

function parseSettings(payload: unknown): DesktopSettings {
  const record = asRecord(payload);
  const nested = asRecord(record?.settings) ?? asRecord(record?.value) ?? record;
  if (!nested) {
    return DEFAULT_SETTINGS;
  }
  return {
    themeId: resolveThemeId(nested.themeId ?? nested.theme),
    alwaysOnTop: readBoolean(
      nested.alwaysOnTop ?? nested.topWindow ?? nested.always_on_top,
    ),
    opacity: readOpacity(nested.opacity),
    opacityEnabled: readBoolean(
      nested.opacityEnabled ?? nested.opacity_enabled,
      DEFAULT_SETTINGS.opacityEnabled,
    ),
    closeToTray: readBoolean(
      nested.closeToTray ?? nested.close_to_tray,
      DEFAULT_SETTINGS.closeToTray,
    ),
    bossKey: normalizeBossKey(nested.bossKey ?? nested.boss_key),
    notifyEnabled: readBoolean(
      nested.notifyEnabled ?? nested.notify_enabled,
    ),
    notifyChatroom: readBoolean(nested.notifyChatroom ?? nested.notify_chatroom),
    notifyChat: readBoolean(nested.notifyChat ?? nested.notify_chat),
    notifyAt: readBoolean(nested.notifyAt ?? nested.notify_at),
    notifyReply: readBoolean(nested.notifyReply ?? nested.notify_reply),
    notifySys: readBoolean(nested.notifySys ?? nested.notify_sys),
    notifyTalk: readBoolean(nested.notifyTalk ?? nested.notify_talk),
    notifyTalkPattern: normalizeTalkPattern(
      nested.notifyTalkPattern ?? nested.notify_talk_pattern,
    ),
    notifySound: readBoolean(nested.notifySound ?? nested.notify_sound),
    notifySystem: readBoolean(nested.notifySystem ?? nested.notify_system),
    autoReward: readBoolean(nested.autoReward ?? nested.auto_reward),
    redpackNotice: readBoolean(nested.redpackNotice ?? nested.redpack_notice),
  };
}

function normalizeTalkPattern(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length <= TALK_PATTERN_MAX) {
    return trimmed;
  }
  return trimmed.slice(0, TALK_PATTERN_MAX);
}

function readOpacity(value: unknown): number {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.enable === false) {
      return DEFAULT_SETTINGS.opacity;
    }
    return readOpacity(record.value);
  }
  const numeric = readNumber(value);
  if (numeric === undefined) {
    return DEFAULT_SETTINGS.opacity;
  }
  const ratio = numeric > OPACITY_MAX && numeric <= 100 ? numeric / 100 : numeric;
  return clampOpacity(ratio);
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

async function invokeMapped<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  map: (payload: unknown) => T,
): Promise<BridgeOutcome<T>> {
  const payload = await invokeCommand(command, args);
  if (payload.status !== "ok") {
    return payload;
  }
  return { status: "ok", data: map(payload.data) };
}

async function invokeVoid(
  command: string,
  args?: Record<string, unknown>,
): Promise<BridgeOutcome> {
  const result = await invokeCommand(command, args);
  if (result.status === "ok") {
    return { status: "ok", data: undefined };
  }
  return result;
}

async function invokeCommand(
  command: string,
  args?: Record<string, unknown>,
): Promise<BridgeOutcome<unknown>> {
  if (missingCommands.has(command)) {
    return { status: "gap" };
  }
  try {
    const data = await invoke<unknown>(command, args);
    return { status: "ok", data };
  } catch (error) {
    if (isMissingCommandError(error)) {
      missingCommands.add(command);
      return { status: "gap" };
    }
    return {
      status: "error",
      message: toUserFacingMessage(error),
    };
  }
}
