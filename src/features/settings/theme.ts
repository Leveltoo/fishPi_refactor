import { DEFAULT_SETTINGS, isThemeId } from "./constants";
import type { ThemeId } from "./types";

/** 旧存储的皮肤 id，统一迁到 desk。 */
const LEGACY_THEME_MAP: Readonly<Record<string, ThemeId>> = {
  default: "desk",
  daybreak: "desk",
  contrast: "desk",
};

const DARK_THEME_IDS: readonly ThemeId[] = ["desk", "cx"];

export function applyTheme(themeId: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.classList.toggle("dark", DARK_THEME_IDS.includes(themeId));
}

export function resolveThemeId(value: unknown): ThemeId {
  if (typeof value === "string") {
    if (isThemeId(value)) {
      return value;
    }
    const legacy = LEGACY_THEME_MAP[value];
    if (legacy) {
      return legacy;
    }
  }
  return DEFAULT_SETTINGS.themeId;
}

export function bootDefaultTheme(): void {
  const current = document.documentElement.dataset.theme;
  if (current && isThemeId(current)) {
    return;
  }
  applyTheme(resolveThemeId(current ?? DEFAULT_SETTINGS.themeId));
}
