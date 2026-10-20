import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, flush, plain } from "../shell/testLoader.mjs";

function find(node, predicate, matches = []) {
  if (Array.isArray(node)) node.forEach((item) => find(item, predicate, matches));
  else if (node && typeof node === "object") {
    if (typeof node.type === "function" && node.props) {
      find(node.type(node.props), predicate, matches);
    } else {
      if (predicate(node)) matches.push(node);
      find(node.props?.children, predicate, matches);
    }
  }
  return matches;
}

function mountPanel() {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  const calls = [];
  const themes = [];
  const opened = [];
  let cursor = 0;
  let first = true;
  let cleanups = [];
  let prefs = { extensionRoot: "C:\\extensions", theme: "publisher.theme" };
  let scanVersion = 1;

  const Button = ({ children, ...props }) => ({ type: "button", props: { ...props, children } });
  const ScrollArea = ({ children, ...props }) => ({ type: "div", props: { ...props, children } });
  const Markdown = ({ children }) => ({ type: "div", props: { children } });

  const load = createLoader({
    react: {
      useState: (initial) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (next) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        }];
      },
      useRef: (value) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: value };
        return slots[index];
      },
      useEffect: (effect) => {
        if (first) effects.push(effect);
      },
    },
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "@tauri-apps/api/event": {
      listen: async (name, handler) => {
        listeners.set(name, handler);
        return () => listeners.delete(name);
      },
    },
    "@tauri-apps/api/core": {
      invoke: async (command, args) => {
        calls.push({ command, args: plain(args) });
        if (command === "extension_choose_directory") return "D:\\chosen";
        if (command === "extension_scan") {
          return {
            root: args.root,
            plugins: [{
              key: "publisher.plugin",
              name: "plugin",
              displayName: "Plugin",
              description: `Version ${scanVersion}`,
              version: "1.0.0",
              kind: "plugin",
              author: "Publisher",
              homepage: "https://example.com/plugin",
              repository: "",
              icon: "",
            }],
            themes: [{
              key: "publisher.theme",
              name: "theme",
              displayName: "Theme",
              description: "Theme",
              version: "1.0.0",
              kind: "theme",
              author: "Publisher",
              homepage: "",
              repository: "",
              icon: "",
            }],
            unsupported: [],
            diagnostics: [],
            message: "",
          };
        }
        if (command === "extension_load_theme") {
          return args.theme === "Default"
            ? { applied: false, css: "", message: "" }
            : { applied: true, css: `${args.root}:${args.theme}`, message: "" };
        }
        if (command === "extension_call") {
          return { key: args.key, readme: "# Readme\n\n[site](https://example.com/readme)", message: "" };
        }
        throw new Error(command);
      },
    },
    "@tauri-apps/plugin-opener": {
      openUrl: async (url) => opened.push(url),
    },
    "@/components/ui/button": { Button },
    "@/components/ui/scroll-area": { ScrollArea },
    "react-markdown": { default: Markdown },
    "remark-gfm": { default: {} },
    "../desktop/api": {
      commandError: (error) => error.message,
      desktopPrefsGet: async () => prefs,
    },
    "./theme": {
      applyLegacyTheme: (css) => {
        themes.push(css);
        return { mapped: css ? 1 : 0, ignored: 0 };
      },
    },
  });

  const { ExtensionMount } = load(new URL("./ExtensionMount.tsx", import.meta.url));
  const render = () => {
    cursor = 0;
    const tree = ExtensionMount();
    first = false;
    return tree;
  };
  const start = async () => {
    render();
    cleanups = effects.map((effect) => effect());
    await flush();
  };
  return {
    calls,
    opened,
    render,
    start,
    changePrefs(next) {
      prefs = next;
      scanVersion += 1;
      listeners.get("desktop://prefs-changed")();
    },
    stop: async () => {
      cleanups.reverse().forEach((cleanup) => cleanup?.());
      await flush();
      assert.equal(listeners.size, 0);
    },
    themes,
  };
}

test("directory wrapper uses the explicit native command", async () => {
  const calls = [];
  const load = createLoader({
    "@tauri-apps/api/core": {
      invoke: async (...args) => {
        calls.push(plain(args));
        return null;
      },
    },
  });
  const api = load(new URL("./api.ts", import.meta.url));
  assert.equal(await api.extensionChooseDirectory(), null);
  await api.extensionChooseDirectory("C:\\extensions");
  assert.deepEqual(calls, [
    ["extension_choose_directory", { root: null }],
    ["extension_choose_directory", { root: "C:\\extensions" }],
  ]);
});

test("legacy extension page loads list and applies selected theme", async () => {
  const p = mountPanel();
  await p.start();
  assert.deepEqual(p.calls.slice(0, 2), [
    { command: "extension_scan", args: { root: "C:\\extensions" } },
    {
      command: "extension_load_theme",
      args: { root: "C:\\extensions", theme: "publisher.theme" },
    },
  ]);
  assert.equal(p.themes.at(-1), "C:\\extensions:publisher.theme");
  const rows = find(p.render(), (node) => node.props?.["aria-pressed"] !== undefined);
  assert.equal(rows.length, 2);
  assert.equal(rows.some((row) => JSON.stringify(row.props.children).includes("Plugin")), true);
  await p.stop();
});

test("clicking an extension opens README and external links", async () => {
  const p = mountPanel();
  await p.start();
  const row = find(p.render(), (node) =>
    node.type === "button" && node.props?.["aria-pressed"] === false)[0];
  row.props.onClick();
  await flush();
  assert.equal(p.calls.some((call) =>
    call.command === "extension_call" &&
    call.args.key === "publisher.plugin"), true);

  const links = find(p.render(), (node) =>
    node.type === "button" && String(node.props?.children).includes("主页"));
  links[0].props.onClick();
  await flush();
  assert.deepEqual(p.opened, ["https://example.com/plugin"]);
  await p.stop();
});

test("prefs change refreshes metadata and clears old detail", async () => {
  const p = mountPanel();
  await p.start();
  const row = find(p.render(), (node) =>
    node.type === "button" && node.props?.["aria-pressed"] === false)[0];
  row.props.onClick();
  await flush();
  const reads = p.calls.filter((call) => call.command === "extension_call").length;
  p.changePrefs({ extensionRoot: "D:\\new", theme: "Default" });
  await flush();
  assert.equal(p.calls.filter((call) => call.command === "extension_scan").length, 2);
  assert.equal(p.calls.filter((call) => call.command === "extension_call").length, reads);
  assert.equal(p.themes.at(-1), "");
  await p.stop();
});
