import { applyLegacyTheme, mapLegacyTheme } from "./theme";
import {
  hasChatroomHooks, hasSendMsgHooks, installExtensionHooks,
  runChatroomHooks, runSendMsgHooks,
} from "./hooks";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Browser-only assertions. This module is not imported by the production app. */
export async function checkExtensionSafety(): Promise<void> {
  const defaults = getComputedStyle(document.documentElement).getPropertyValue("--color-text");
  const theme = mapLegacyTheme(`
    :root {
      --global-text-color: #abcdef;
      --global-active-color: rgb(210, 63, 49);
      --global-background-color: var(--global-text-color);
      --global-control-text-color: url(https://invalid.example/secret);
      --color-bg: red;
      font-size: 999px;
    }
    body { display:none; background:url(https://invalid.example/leak); }
  `);
  check(theme.mapped === 3, "only the three safe legacy colors should map");
  check(theme.ignored >= 4, "unmapped declarations must be counted");
  check(!theme.css.includes("url") && !theme.css.includes("display"), "no resource or layout CSS");
  check(theme.css.includes("--color-text:rgb(171, 205, 239)"), "colors should be normalized");
  check(theme.css.includes("--color-bg:rgb(171, 205, 239)"), "safe variable references should resolve");
  const cyclic = mapLegacyTheme(`
    :root { --global-text-color:var(--global-background-color);
      --global-background-color:var(--global-text-color); }
  `);
  check(cyclic.mapped === 0 && cyclic.css === "", "cyclic references must fail closed");
  for (const color of [
    "url(file:///secret)", "var(--unknown)", "inherit", "currentColor",
    "expression(alert(1))", "r\\65 d", "red!important", "color-mix(in srgb, red, blue)",
  ]) {
    const result = mapLegacyTheme(`:root { --global-text-color:${color}; }`);
    check(!result.css.includes("!important"), "priority must not escape the mapped output");
    check(result.mapped === 0, `reject unsafe or unsupported value: ${color}`);
  }
  check(mapLegacyTheme("@import 'https://invalid.example/theme.css';").css === "", "imports are inert");
  applyLegacyTheme(":root { --global-text-color: #abcdef; }");
  check(document.getElementById("fishpi-local-theme") != null, "mapped style attached");
  applyLegacyTheme("");
  check(document.getElementById("fishpi-local-theme") == null, "default removes overrides");
  check(getComputedStyle(document.documentElement).getPropertyValue("--color-text") === defaults,
    "default preserves the existing visual tokens");
  let executed = false;
  installExtensionHooks([{ source: { toString: () => { executed = true; return "bad"; } } }]);
  check(!executed && !hasChatroomHooks() && !hasSendMsgHooks(), "unknown hooks never execute");
  const message = { messageId: "1", content: "unchanged" };
  check(await runChatroomHooks(message) === message, "incoming identity is preserved");
  check(await runSendMsgHooks("unchanged") === "unchanged", "outgoing text is preserved");
}
