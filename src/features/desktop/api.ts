import { invoke } from "@tauri-apps/api/core";
import { parseInvokeError } from "../../lib/errors";

export type UpdateInfo = {
  current: string;
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  assetName: string;
  upToDate: boolean;
};

export type UpdateApplyResult = {
  downloaded: boolean;
  installed: boolean;
  message: string;
};

export type DesktopPrefs = {
  updateMirror: string;
  extensionRoot: string;
  theme: string;
  musicMode: number;
  loginUsername: string;
  windowWidth: number;
  windowHeight: number;
};

export type DesktopPrefsPatch = {
  updateMirror?: string;
  extensionRoot?: string;
  theme?: string;
  musicMode?: number;
  loginUsername?: string;
};

export type ImportResult = {
  found: boolean;
  credentialSaved: boolean;
  settingsSaved: boolean;
  prefsSaved: boolean;
  message: string;
};

export type WatchReport = {
  watching: boolean;
  message: string;
};

export type ReconnectReport = {
  attempted: boolean;
  relinked: boolean;
  message: string;
  chatroom: string;
  chat: string;
  notice: string;
};

export function commandError(error: unknown): string {
  return parseInvokeError(error).message;
}

export function updateCheck(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("update_check");
}

export function updateApply(): Promise<UpdateApplyResult> {
  return invoke<UpdateApplyResult>("update_apply");
}

export function updateOpenRelease(tag: string): Promise<void> {
  return invoke<void>("update_open_release", { tag });
}

export function configImport(): Promise<ImportResult> {
  return invoke<ImportResult>("config_import");
}

export function desktopPrefsGet(): Promise<DesktopPrefs> {
  return invoke<DesktopPrefs>("desktop_prefs_get");
}

export function desktopPrefsSet(patch: DesktopPrefsPatch): Promise<DesktopPrefs> {
  return invoke<DesktopPrefs>("desktop_prefs_set", { patch });
}

export function reconnectWatch(): Promise<WatchReport> {
  return invoke<WatchReport>("reconnect_watch");
}

export function reconnectNow(): Promise<ReconnectReport> {
  return invoke<ReconnectReport>("reconnect_now");
}
