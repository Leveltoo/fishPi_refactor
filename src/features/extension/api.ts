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

export type ExtensionScan = {
  root: string;
  themes: ExtensionItem[];
  plugins: ExtensionItem[];
  unsupported: string[];
  diagnostics: string[];
  message: string;
};

export type ThemeCss = {
  /** Source was read successfully, not applied to the document. */
  applied: boolean;
  css: string;
  message: string;
};

export type ExtensionDetail = {
  key: string;
  readme: string;
  message: string;
};

export function extensionChooseDirectory(root?: string): Promise<string | null> {
  return invoke<string | null>("extension_choose_directory", { root: root ?? null });
}

export function extensionScan(root?: string): Promise<ExtensionScan> {
  return invoke<ExtensionScan>("extension_scan", { root: root ?? null });
}

export function extensionLoadTheme(theme: string, root?: string): Promise<ThemeCss> {
  return invoke<ThemeCss>("extension_load_theme", {
    root: root ?? null,
    theme,
  });
}

export function extensionCall(api: string, key?: string, root?: string): Promise<ExtensionDetail> {
  return invoke<ExtensionDetail>("extension_call", {
    api,
    key: key ?? null,
    root: root ?? null,
  });
}
