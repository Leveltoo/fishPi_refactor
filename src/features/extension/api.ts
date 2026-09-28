import { invoke } from "@tauri-apps/api/core";

export type ExtensionItem = {
  key: string;
  name: string;
  description: string;
  version: string;
  kind: string;
};

export type ExtensionScan = {
  root: string;
  themes: ExtensionItem[];
  plugins: ExtensionItem[];
  unsupported: string[];
  message: string;
};

export type ThemeCss = {
  applied: boolean;
  css: string;
  message: string;
};

export function extensionScan(root?: string): Promise<ExtensionScan> {
  return invoke<ExtensionScan>("extension_scan", { root: root ?? null });
}

export function extensionLoadTheme(theme: string, root?: string): Promise<ThemeCss> {
  return invoke<ThemeCss>("extension_load_theme", {
    root: root ?? null,
    theme,
  });
}

export function extensionCall(api: string): Promise<void> {
  return invoke<void>("extension_call", { api });
}
