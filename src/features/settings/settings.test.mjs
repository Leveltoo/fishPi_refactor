import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, plain } from "../shell/testLoader.mjs";

test("settings defaults, sanitization, shared synchronization and serialized writes", async () => {
  const calls = [];
  const first = deferred();
  let saved;
  let fail = false;
  const load = createLoader({
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push([command, plain(args ?? {})]);
      if (command === "settings_get") return saved;
      if (calls.filter(([name]) => name === "settings_set").length === 1) await first.promise;
      if (fail) throw { code: "business", message: "rejected" };
    } },
  });
  const api = load(new URL("./api.ts", import.meta.url));
  const store = load(new URL("./settingsStore.ts", import.meta.url));
  const defaults = api.normalizeSettings();
  assert.equal(defaults.opacity, 0.6);
  assert.equal(defaults.opacityEnabled, false);
  assert.equal(defaults.closeToTray, false);
  assert.equal(defaults.bossKey, "Win+F2");
  assert.equal(api.normalizeSettings({ notifyEnabled: "false" }).notifyEnabled, false);
  assert.equal(api.normalizeSettings({ opacity: Infinity }).opacity, 0.6);
  assert.equal(api.clampOpacity(0), 0.1);
  assert.equal(api.clampOpacity(3), 1);
  assert.equal(api.windowOpacityValue(defaults), 1);
  const observed = [];
  const stop = store.subscribeDesktopSettings((value) => observed.push(value.settings));
  store.publishDesktopSettings({ ready: true, settings: defaults });
  assert.equal(observed[0], defaults);
  const one = api.invokeSettingsSet({ ...defaults, bossKey: "Ctrl+F2" });
  const two = api.invokeSettingsSet({ ...defaults, bossKey: "Ctrl+F3" });
  await flush();
  assert.equal(calls.length, 1);
  first.resolve();
  assert.equal((await one).status, "ok");
  assert.equal((await two).status, "ok");
  assert.deepEqual(calls.map(([, args]) => args.request.bossKey), ["Ctrl+F2", "Ctrl+F3"]);
  saved = defaults;
  fail = true;
  const rejected = { ...defaults, bossKey: "invalid" };
  store.publishDesktopSettings({ ready: true, settings: rejected });
  assert.equal((await api.invokeSettingsSet(rejected)).status, "error");
  assert.equal(store.currentDesktopSettings().settings.bossKey, "Win+F2");
  stop();
  const pattern = load(new URL("./talkPattern.ts", import.meta.url));
  assert.equal(pattern.compileTalkPattern("["), "invalid");
  assert.equal(pattern.talkPatternHits(pattern.compileTalkPattern(""), "anything"), true);
  assert.equal(pattern.talkPatternHits(pattern.compileTalkPattern("hello"), "world"), false);
});

test("failed settings readback cannot overwrite a newer edit", async () => {
  const read = deferred();
  const load = createLoader({
    "@tauri-apps/api/core": { invoke: async (command) => {
      if (command === "settings_get") return read.promise;
      throw { code: "business", message: "rejected" };
    } },
  });
  const api = load(new URL("./api.ts", import.meta.url));
  const store = load(new URL("./settingsStore.ts", import.meta.url));
  const first = api.normalizeSettings({ bossKey: "bad" });
  store.publishDesktopSettings({ ready: true, settings: first });
  const write = api.invokeSettingsSet(first);
  await flush();
  const newer = api.normalizeSettings({ bossKey: "Ctrl+F4" });
  store.publishDesktopSettings({ ready: true, settings: newer });
  read.resolve(api.normalizeSettings());
  await write;
  assert.equal(store.currentDesktopSettings().settings, newer);
});
