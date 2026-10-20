import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, hookMocks, plain } from "../shell/testLoader.mjs";

function clock() {
  const pending = new Map();
  let id = 0;
  return {
    pending,
    window: {
      setTimeout: (fn) => { pending.set(++id, fn); return id; },
      clearTimeout: (key) => pending.delete(key),
    },
    run: () => {
      const tasks = [...pending.values()];
      pending.clear();
      tasks.forEach((fn) => fn());
    },
  };
}

test("config-imported refreshes desktop prefs and discards earlier read results", async () => {
  const hooks = hookMocks();
  const listeners = new Map();
  const initial = deferred();
  const modes = [];
  let reads = 0;
  const load = createLoader({
    react: hooks.react,
    "react/jsx-runtime": hooks.jsx,
    "@tauri-apps/api/event": { listen: async (name, handler) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    } },
    "@tauri-apps/api/core": { invoke: async (command) => {
      if (command === "desktop_prefs_get") {
        reads++;
        return reads === 1 ? initial.promise : { updateMirror: "imported.example", musicMode: 2 };
      }
      if (command === "reconnect_watch") return { watching: false };
      throw new Error(command);
    } },
    "./offline": {
      loadOffline: async () => ({ chatroom: [], chats: {}, failed: [] }),
      messagePreview: () => "",
    },
    "../music/playerStore": { setPlayerMode: (mode) => modes.push(mode) },
    "../../lib/tauri": { invokeAuthMe: async () => ({ sessionGeneration: 1, status: "loggedIn" }) },
  });
  load(new URL("../desktop/DesktopMount.tsx", import.meta.url)).DesktopMount();
  hooks.start();
  await flush();
  const result = { found: true, settingsSaved: true, filtersSaved: true, prefsSaved: true,
    credentialSaved: false, message: "imported" };
  listeners.get("desktop://config-imported")({ payload: result });
  await flush();
  assert.equal(hooks.states[0], "imported.example");
  assert.equal(hooks.states[3].filtersSaved, true);
  assert.deepEqual(modes, [2]);
  initial.resolve({ updateMirror: "old.example", musicMode: 0 });
  await flush();
  assert.equal(hooks.states[0], "imported.example");
  assert.deepEqual(modes, [2]);
  listeners.get("desktop://config-imported")({ payload: { ...result, prefsSaved: false } });
  await flush();
  assert.equal(reads, 2);
  hooks.stop();
  await flush();
  assert.equal(listeners.size, 0);
});

test("config-imported reloads shared settings, cancels debounce and rejects stale reads/saves", async () => {
  const hooks = hookMocks();
  const timer = clock();
  const listeners = new Map();
  const initial = deferred();
  const importing = deferred();
  const oldSave = deferred();
  const writes = [];
  const opacity = [];
  let settings;
  let reads = 0;
  const load = createLoader({
    react: hooks.react,
    "@tauri-apps/api/event": { listen: async (name, handler) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    } },
    "./theme": { bootDefaultTheme: () => {}, applyTheme: () => {} },
    "./api": {
      invokeSettingsGet: async () => {
        reads++;
        if (reads === 1) return initial.promise;
        if (reads === 3) return importing.promise;
        return { status: "ok", data: settings };
      },
      invokeSettingsSet: async (next) => { writes.push(plain(next)); return oldSave.promise; },
      invokeWindowOpacity: async (value) => { opacity.push(value); return { status: "ok" }; },
      normalizeSettings: (next) => next,
      clampOpacity: (value) => value,
    },
  }, { window: timer.window });
  const { DEFAULT_SETTINGS } = load(new URL("./constants.ts", import.meta.url));
  const store = load(new URL("./settingsStore.ts", import.meta.url));
  settings = { ...DEFAULT_SETTINGS, bossKey: "Ctrl+F3", opacity: 0.8 };
  const desktop = load(new URL("./useDesktopSettings.ts", import.meta.url)).useDesktopSettings();
  hooks.start();
  await flush();
  const onImport = listeners.get("desktop://config-imported");
  onImport({ payload: { settingsSaved: true } });
  await flush();
  assert.equal(store.currentDesktopSettings().settings.bossKey, "Ctrl+F3");
  initial.resolve({ status: "ok", data: { ...DEFAULT_SETTINGS, bossKey: "old" } });
  await flush();
  assert.equal(store.currentDesktopSettings().settings.bossKey, "Ctrl+F3");
  desktop.setNotifyEnabled(true);
  await flush();
  assert.equal(writes.length, 1);
  desktop.setOpacity(0.25);
  assert.equal(timer.pending.size, 2);
  const staleTimers = [...timer.pending.values()];
  onImport({ payload: { settingsSaved: true } });
  assert.equal(timer.pending.size, 0);
  desktop.setBossKey("blocked-during-reload");
  oldSave.resolve({ status: "error", message: "old failure" });
  importing.resolve({ status: "ok", data: settings });
  await flush();
  staleTimers.forEach((fn) => fn());
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(opacity.length, 0);
  assert.equal(hooks.states[3], null);
  assert.equal(store.currentDesktopSettings().settings.opacity, 0.8);
  onImport({ payload: { settingsSaved: false, filtersSaved: true } });
  await flush();
  assert.equal(reads, 3);
  hooks.stop();
  await flush();
  assert.equal(listeners.size, 0);
});

function find(node, predicate, matches = []) {
  if (Array.isArray(node)) node.forEach((item) => find(item, predicate, matches));
  else if (node && typeof node === "object") {
    if (predicate(node)) matches.push(node);
    find(node.props?.children, predicate, matches);
  }
  return matches;
}

function renderHooks() {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let first = true;
  let cleanups = [];
  return {
    reset: () => {
      slots.length = 0;
      effects.length = 0;
      cursor = 0;
      first = true;
      cleanups = [];
    },
    react: {
      useState: (initial) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
      },
      useRef: (initial) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = { current: initial };
        return slots[i];
      },
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useEffect: (effect) => { if (first) effects.push(effect); },
    },
    render: (component) => { cursor = 0; const node = component(); first = false; return node; },
    start: () => { cleanups = effects.map((effect) => effect()); },
    stop: () => cleanups.reverse().forEach((cleanup) => cleanup?.()),
  };
}

test("settings filters reload on import without pending edits, late reads/saves or user lookups restoring old cache", async () => {
  const hooks = renderHooks();
  const timer = clock();
  const listeners = new Map();
  const initial = deferred();
  const oldSave = deferred();
  const lookup = deferred();
  const writes = [];
  let defaults;
  let reads = 0;
  let filters = { shield: [{ type: "content", value: "imported" }], careUsers: ["imported-user"] };
  const components = new Proxy({}, { get: (_target, name) => name });
  const load = createLoader({
    react: hooks.react,
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "@tauri-apps/api/event": { listen: async (name, handler) => {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    } },
    "@phosphor-icons/react": {},
    sonner: { toast: { error: () => {} } },
    "@/components/ui/alert": components,
    "@/components/ui/button": components,
    "@/components/ui/input": components,
    "@/components/ui/spinner": components,
    "@/features/desktop/api": {},
    "@/features/music/playerStore": {
      getPlayerSnapshot: () => ({ mode: 0 }),
      subscribePlayer: () => () => {},
      setPlayerMode: () => {},
    },
    "@/features/extension/api": {
      extensionChooseDirectory: async () => null,
      extensionScan: async () => ({ themes: [] }),
    },
    "@tauri-apps/api/core": { invoke: async () => null },
    "./useDesktopSettings": { useDesktopSettings: () => ({ settings: defaults, loading: false }) },
    "@/features/chatroom/chatroomApi": {
      loadChatroomFilters: async () => {
        reads++;
        return reads === 1 ? initial.promise : filters;
      },
      saveChatroomFilters: async (next) => { writes.push(plain(next)); return oldSave.promise; },
      lookupUserName: async () => lookup.promise,
    },
  }, { window: timer.window });
  defaults = load(new URL("./constants.ts", import.meta.url)).DEFAULT_SETTINGS;
  const host = load(new URL("./SettingsHost.tsx", import.meta.url)).SettingsHost();
  const section = find(host, (node) => node.type?.name === "ChatroomFiltersSection")[0].type;
  hooks.reset();
  const render = () => hooks.render(() =>
    section({ redpackNotice: false, onRedpackNotice: () => {} }));
  render();
  hooks.start();
  await flush();
  const onImport = listeners.get("desktop://config-imported");
  onImport({ payload: { filtersSaved: true } });
  await flush();
  initial.resolve({ shield: [{ type: "username", value: "old" }], careUsers: ["old-user"] });
  await flush();
  const input = () => find(render(), (node) => node.type === "input" && node.props.placeholder === "正则")[0];
  assert.equal(input().props.value, "imported");
  input().props.onChange({ target: { value: "unsaved" } });
  assert.equal(timer.pending.size, 1);
  const stale = [...timer.pending.values()][0];
  filters = { shield: [{ type: "content", value: "second-import" }], careUsers: ["second-user"] };
  onImport({ payload: { filtersSaved: true } });
  await flush();
  assert.equal(timer.pending.size, 0);
  stale();
  await flush();
  assert.equal(writes.length, 0);
  input().props.onChange({ target: { value: "in-flight" } });
  timer.run();
  await flush();
  assert.equal(writes.length, 1);
  filters = { shield: [{ type: "content", value: "third-import" }], careUsers: ["third-user"] };
  onImport({ payload: { filtersSaved: true } });
  await flush();
  oldSave.resolve({ shield: [{ type: "content", value: "late-save" }], careUsers: ["old-user"] });
  await flush();
  assert.equal(input().props.value, "third-import");
  find(render(), (node) => node.type === "input" && node.props.placeholder === "用户名")[0]
    .props.onChange({ target: { value: "pending-user" } });
  find(render(), (node) => node.type === "input" && node.props.placeholder === "用户名")[0]
    .props.onKeyDown({ key: "Enter", preventDefault: () => {} });
  await flush();
  onImport({ payload: { filtersSaved: true } });
  await flush();
  lookup.resolve("pending-user");
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(input().props.value, "third-import");
  const before = reads;
  onImport({ payload: { filtersSaved: false, settingsSaved: true } });
  await flush();
  assert.equal(reads, before);
  hooks.stop();
  await flush();
  assert.equal(listeners.size, 0);
});
