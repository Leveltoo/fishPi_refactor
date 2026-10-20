import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, plain } from "../shell/testLoader.mjs";

function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}

async function panel() {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  const calls = [];
  const writes = [];
  const themes = [];
  let cursor = 0;
  let first = true;
  let cleanups;
  let prefs = { extensionRoot: "C:\\extensions", theme: "publisher.theme" };
  const picker = deferred();
  const save = { result: null };
  const load = createLoader({
    react: {
      useState: (initial) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], (next) => { slots[i] = next; }];
      },
      useRef: (initial) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = { current: initial };
        return slots[i];
      },
      useEffect: (effect) => { if (first) effects.push(effect); },
    },
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "@tauri-apps/api/event": { listen: async (name, handler) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    } },
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args: plain(args) });
      if (command === "extension_choose_directory") return picker.promise;
      if (command === "extension_scan") {
        return { root: args.root, plugins: [], themes: [], diagnostics: [] };
      }
      if (command === "extension_load_theme") {
        return { applied: true, css: `${args.root}:${args.theme}` };
      }
      throw new Error(command);
    } },
    "@tauri-apps/plugin-opener": {},
    "lucide-react": { FolderOpen: "FolderOpen", RefreshCw: "RefreshCw" },
    "react-markdown": {},
    "remark-gfm": {},
    "../desktop/api": {
      commandError: (error) => error.message,
      desktopPrefsGet: async () => prefs,
      desktopPrefsSet: async (patch) => {
        writes.push(plain(patch));
        if (save.result) await save.result;
        prefs = { ...prefs, ...patch };
      },
    },
    "./theme": { applyLegacyTheme: (css) => {
      themes.push(css);
      return { mapped: css ? 1 : 0, ignored: 0 };
    } },
  });
  const { ExtensionMount } = load(new URL("./ExtensionMount.tsx", import.meta.url));
  const render = () => {
    cursor = 0;
    const tree = ExtensionMount();
    first = false;
    return tree;
  };
  const control = (predicate) => find(render(), predicate)[0];
  render();
  cleanups = effects.map((effect) => effect());
  await flush();
  return {
    calls, writes, themes, picker, save, listeners, render,
    input: () => control((node) => node.type === "input"),
    theme: () => control((node) => node.type === "select"),
    choose: () => control((node) => node.type === "button" && node.props.children.type === "FolderOpen"),
    alert: () => control((node) => node.props?.role === "alert"),
    importPrefs: (next) => {
      prefs = next;
      listeners.get("desktop://prefs-changed")();
    },
    stop: async () => {
      cleanups.reverse().forEach((cleanup) => cleanup?.());
      await flush();
      assert.equal(listeners.size, 0);
    },
  };
}

test("directory wrapper uses the explicit command and nullable initial directory", async () => {
  const calls = [];
  const load = createLoader({
    "@tauri-apps/api/core": { invoke: async (...args) => { calls.push(plain(args)); return null; } },
  });
  const api = load(new URL("./api.ts", import.meta.url));
  assert.equal(await api.extensionChooseDirectory(), null);
  await api.extensionChooseDirectory("C:\\extensions");
  assert.deepEqual(calls, [
    ["extension_choose_directory", { root: null }],
    ["extension_choose_directory", { root: "C:\\extensions" }],
  ]);
});

test("cancel keeps the draft, saved root, scan and applied theme; chooser is accessible", async () => {
  const p = await panel();
  p.input().props.onChange({ target: { value: "C:\\draft" } });
  const button = p.choose();
  assert.ok(button.props["aria-label"]);
  assert.equal(button.props.title, button.props["aria-label"]);
  assert.equal(String(button.props.children.props["aria-hidden"]), "true");
  let prevented = false;
  button.props.onMouseDown({ button: 0, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  const before = [...p.themes];
  button.props.onClick();
  button.props.onClick();
  p.input().props.onBlur();
  assert.equal(p.choose().props.disabled, true);
  assert.equal(p.input().props.disabled, true);
  assert.equal(p.theme().props.disabled, true);
  assert.equal(String(p.render().props["aria-busy"]), "true");
  assert.deepEqual(p.calls.filter((call) => call.command === "extension_choose_directory"),
    [{ command: "extension_choose_directory", args: { root: "C:\\draft" } }]);
  p.picker.resolve(null);
  await flush();
  assert.equal(p.input().props.value, "C:\\draft");
  assert.equal(p.theme().props.value, "publisher.theme");
  assert.deepEqual(p.writes, []);
  assert.deepEqual(p.themes, before);
  assert.equal(p.calls.filter((call) => call.command === "extension_scan").length, 1);
  assert.equal(p.choose().props.disabled, false);
  await p.stop();
});

test("chosen directory saves only the root and rescans with the existing theme", async () => {
  const p = await panel();
  p.choose().props.onClick();
  p.picker.resolve("D:\\chosen");
  await flush();
  assert.deepEqual(p.writes, [{ extensionRoot: "D:\\chosen" }]);
  assert.equal(p.input().props.value, "D:\\chosen");
  assert.equal(p.theme().props.value, "publisher.theme");
  assert.deepEqual(p.calls.slice(-2), [
    { command: "extension_scan", args: { root: "D:\\chosen" } },
    { command: "extension_load_theme", args: { root: "D:\\chosen", theme: "publisher.theme" } },
  ]);
  assert.equal(p.themes.at(-1), "D:\\chosen:publisher.theme");
  assert.equal(p.render().props["aria-busy"], false);
  await p.stop();
});

test("selecting the saved directory avoids a redundant save and scan", async () => {
  const p = await panel();
  p.choose().props.onClick();
  p.picker.resolve("C:\\extensions");
  await flush();
  assert.deepEqual(p.writes, []);
  assert.equal(p.calls.filter((call) => call.command === "extension_scan").length, 1);
  await p.stop();
});

test("native chooser errors preserve directory and theme and enable retry", async () => {
  const p = await panel();
  p.choose().props.onClick();
  p.picker.reject(new Error("Cannot open directory picker"));
  await flush();
  assert.equal(p.alert().props.children, "Cannot open directory picker");
  assert.equal(p.input().props.value, "C:\\extensions");
  assert.equal(p.themes.length, 1);
  assert.deepEqual(p.writes, []);
  assert.equal(p.choose().props.disabled, false);
  await p.stop();
});

test("save failures keep the chosen draft without scanning or changing the theme", async () => {
  const p = await panel();
  const failure = deferred();
  p.save.result = failure.promise;
  p.choose().props.onClick();
  p.picker.resolve("D:\\chosen");
  await flush();
  failure.reject(new Error("Cannot save preferences"));
  await flush();
  assert.equal(p.alert().props.children, "Cannot save preferences");
  assert.equal(p.input().props.value, "D:\\chosen");
  assert.equal(p.theme().props.value, "publisher.theme");
  assert.equal(p.themes.length, 1);
  assert.equal(p.calls.filter((call) => call.command === "extension_scan").length, 1);
  assert.equal(p.choose().props.disabled, false);
  await p.stop();
});

for (const rejects of [false, true]) {
  test(`preference refresh discards an older picker ${rejects ? "error" : "selection"}`, async () => {
    const p = await panel();
    p.choose().props.onClick();
    p.importPrefs({ extensionRoot: "D:\\imported", theme: "Default" });
    await flush();
    if (rejects) p.picker.reject(new Error("Old native failure"));
    else p.picker.resolve("D:\\stale");
    await flush();
    assert.equal(p.input().props.value, "D:\\imported");
    assert.equal(p.theme().props.value, "Default");
    assert.deepEqual(p.writes, []);
    assert.equal(p.alert(), undefined);
    assert.equal(p.choose().props.disabled, false);
    await p.stop();
  });
}

test("unmounted panels discard a late selection without writing or restoring theme", async () => {
  const p = await panel();
  p.choose().props.onClick();
  await p.stop();
  const before = [...p.themes];
  p.picker.resolve("D:\\stale");
  await flush();
  assert.deepEqual(p.writes, []);
  assert.deepEqual(p.themes, before);
  assert.equal(p.themes.at(-1), "");
});

test("a superseded save failure cannot overwrite imported state or surface an old error", async () => {
  const p = await panel();
  const saving = deferred();
  p.save.result = saving.promise;
  p.choose().props.onClick();
  p.picker.resolve("D:\\chosen");
  await flush();
  p.importPrefs({ extensionRoot: "D:\\imported", theme: "Default" });
  await flush();
  saving.reject(new Error("Old save failure"));
  await flush();
  assert.equal(p.input().props.value, "D:\\imported");
  assert.equal(p.theme().props.value, "Default");
  assert.equal(p.alert(), undefined);
  assert.equal(p.render().props["aria-busy"], false);
  await p.stop();
});

test("manual directory input retains its trim, save and scan behavior", async () => {
  const p = await panel();
  p.input().props.onChange({ target: { value: "  D:\\manual  " } });
  p.input().props.onBlur();
  await flush();
  assert.deepEqual(p.writes, [{ extensionRoot: "D:\\manual" }]);
  assert.equal(p.input().props.value, "D:\\manual");
  assert.equal(p.themes.at(-1), "D:\\manual:publisher.theme");
  await p.stop();
});
