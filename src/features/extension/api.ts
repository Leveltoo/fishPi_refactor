import { invoke } from "@tauri-apps/api/core";

export type ExtensionItem = {
  key: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  kind: string;
  author: string;
  homepage: string;
  repository: string;
  icon: string;
};

/** 扩展目录里的 hook 脚本原文；Rust 只读取，执行由本模块负责。 */
export type HookScript = {
  key: string;
  source: string;
};

export type ExtensionScan = {
  root: string;
  themes: ExtensionItem[];
  plugins: ExtensionItem[];
  hooks: HookScript[];
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
