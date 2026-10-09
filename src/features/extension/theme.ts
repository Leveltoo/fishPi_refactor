// Only variables actually present in the legacy theme.css have mappings.
export const LEGACY_COLORS: Readonly<Record<string, readonly string[]>> = {
  "--global-text-color": ["--color-text"],
  "--global-active-color": ["--color-accent", "--color-accent-hover", "--color-accent-pressed"],
  "--global-background-color": ["--color-bg"],
  "--global-popup-background-color": ["--color-bg-raised"],
  "--global-control-background-color": ["--color-bg-input"],
  "--global-control-placeholder-color": ["--color-text-faint"],
  "--global-control-text-color": ["--color-text-muted"],
  "--global-control-border-color": ["--color-border", "--color-border-strong"],
  "--global-control-focus-color": ["--color-focus"],
  "--main-chatroom-sidebar-background-color": ["--color-bg-sidebar", "--color-bg-hover"],
  "--main-chatroom-message-background-color": ["--color-bubble"],
  "--main-chatroom-message-color": ["--color-bubble-ink"],
  "--main-chatroom-user-message-background-color": ["--color-bubble-self"],
  "--main-chatroom-user-message-color": ["--color-bubble-self-ink"],
  "--header-btn-checked-color": ["--header-btn-checked-color"],
};

export type ThemeMapping = {
  css: string;
  mapped: number;
  ignored: number;
};

const STYLE_ID = "fishpi-local-theme";

function literalColor(value: string, probe: CSSStyleDeclaration): string | null {
  // No escapes, functions other than numeric colors, resource URLs or CSS-wide keywords.
  const color = value.trim().toLowerCase();
  if (
    color.length > 120 ||
    !/^(?:#[a-f0-9]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.%+,\s/-]+\))$/.test(color) ||
    /^(?:inherit|initial|unset|revert|revert-layer|currentcolor)$/.test(color)
  ) {
    return null;
  }
  probe.color = "";
  probe.color = color;
  return probe.color || null;
}

export function mapLegacyTheme(source: string): ThemeMapping {
  const sheet = new CSSStyleSheet();
  // A constructed, unattached sheet parses CSS without loading imports or resources.
  try {
    sheet.replaceSync(source);
  } catch {
    return { css: "", mapped: 0, ignored: 1 };
  }
  const values = new Map<string, string>();
  let ignored = 0;
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") {
      ignored += 1;
      continue;
    }
    for (const name of Array.from(rule.style)) {
      if (Object.prototype.hasOwnProperty.call(LEGACY_COLORS, name)) {
        if (rule.style.getPropertyPriority(name) === "") {
          values.set(name, rule.style.getPropertyValue(name).trim());
        } else {
          ignored += 1;
        }
      } else {
        ignored += 1;
      }
    }
  }
  const probe = document.createElement("span").style;
  function resolve(name: string, seen = new Set<string>()): string | null {
    if (seen.has(name) || seen.size >= 16) {
      return null;
    }
    seen.add(name);
    const raw = values.get(name);
    if (!raw) {
      return null;
    }
    const reference = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(raw);
    return reference ? resolve(reference[1], seen) : literalColor(raw, probe);
  }
  const declarations: string[] = [];
  let mapped = 0;
  for (const [name, targets] of Object.entries(LEGACY_COLORS)) {
    if (!values.has(name)) {
      continue;
    }
    const color = resolve(name);
    if (!color) {
      ignored += 1;
      continue;
    }
    mapped += 1;
    for (const target of targets) {
      declarations.push(`${target}:${color}`);
    }
  }
  return {
    css: declarations.length ? `:root:root:root{${declarations.join(";")}}` : "",
    mapped,
    ignored,
  };
}

export function applyLegacyTheme(source: string): ThemeMapping {
  const mapped = source ? mapLegacyTheme(source) : { css: "", mapped: 0, ignored: 0 };
  const current = document.getElementById(STYLE_ID);
  if (!mapped.css) {
    current?.remove();
    return mapped;
  }
  const style = current instanceof HTMLStyleElement ? current : document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = mapped.css;
  if (!style.parentNode) {
    document.head.appendChild(style);
  }
  return mapped;
}
