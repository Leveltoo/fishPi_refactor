import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, flush } from "../shell/testLoader.mjs";

test("user-card creation waits for the real event, serializes duplicate opens and handles errors", async () => {
  const handlers = new Map();
  let created = 0;
  let existing = null;
  const updates = [];
  class WebviewWindow {
    constructor() { created++; }
    once(event, fn) { handlers.set(event, fn); return Promise.resolve(() => handlers.delete(event)); }
    static async getByLabel() { return existing; }
  }
  const load = createLoader({
    "@tauri-apps/api/dpi": { LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({
      outerPosition: async () => ({ x: 100, y: 100 }),
      scaleFactor: async () => 2,
    }) },
    "@tauri-apps/api/webviewWindow": { WebviewWindow },
  }, { window: { screen: { width: 1920, height: 1080 }, setTimeout, clearTimeout } });
  const card = load(new URL("./window.ts", import.meta.url));
  let ready = false;
  const one = card.showUserCardWindow("first").then(() => { ready = true; });
  await flush();
  assert.equal(ready, false);
  const two = card.showUserCardWindow("second");
  await flush();
  assert.equal(created, 1);
  existing = {
    emit: async (_event, payload) => updates.push(payload.userName),
    setPosition: async () => {}, show: async () => {}, setAlwaysOnTop: async () => {},
  };
  handlers.get("tauri://created")({ payload: null });
  await Promise.all([one, two]);
  assert.equal(ready, true);
  assert.deepEqual(updates, ["second"]);
  existing = null;
  const failed = card.showUserCardWindow("third");
  await flush();
  handlers.get("tauri://error")({ payload: "failed" });
  await assert.rejects(failed);
  assert.equal(handlers.size, 0);
});

test("hover prewarm creates the singleton hidden before it is shown", async () => {
  const handlers = new Map();
  let options = null;
  class WebviewWindow {
    constructor(_label, nextOptions) { options = nextOptions; }
    once(event, fn) { handlers.set(event, fn); return Promise.resolve(() => handlers.delete(event)); }
    static async getByLabel() { return null; }
  }
  const load = createLoader({
    "@tauri-apps/api/dpi": { LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({
      outerPosition: async () => ({ x: 100, y: 100 }),
      scaleFactor: async () => 1,
    }) },
    "@tauri-apps/api/webviewWindow": { WebviewWindow },
  }, { window: { screen: { width: 1920, height: 1080 }, setTimeout, clearTimeout } });
  const card = load(new URL("./window.ts", import.meta.url));
  const warm = card.prewarmUserCardWindow("warm");
  await flush();
  assert.equal(options.visible, false);
  handlers.get("tauri://created")({ payload: null });
  await warm;
  assert.equal(handlers.size, 0);
});
