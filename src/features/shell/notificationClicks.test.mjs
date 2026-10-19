import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, hookMocks, plain } from "./testLoader.mjs";

test("native clicks validate destinations and navigate only in their owning session", async () => {
  const hooks = hookMocks();
  const calls = [];
  const listeners = new Map();
  const pending = deferred();
  let session = { status: "loggedIn", sessionGeneration: 7 };
  let wait = false;
  let reads = 0;
  const load = createLoader({
    react: hooks.react,
    sonner: { toast: { error: () => {} } },
    "@tauri-apps/api/event": {
      listen: async (name, callback) => {
        listeners.set(name, callback);
        return () => listeners.delete(name);
      },
    },
    "../../lib/tauri": {
      invokeAuthMe: () => { reads++; return wait ? pending.promise : Promise.resolve(session); },
    },
    "./navigation": {
      openNoticeTarget: async (target) => calls.push(plain(target)),
      communityNoticeUrl: (value) => {
        const url = new URL(value, "https://fishpi.cn");
        return url.origin === "https://fishpi.cn" && !url.username && !url.password ? url.href : undefined;
      },
    },
  });
  const { parseNotificationTarget, useNativeNotificationClicks } =
    load(new URL("./useNativeNotificationClicks.ts", import.meta.url));
  for (const value of [
    null, {}, { page: "im", userName: "" }, { page: "im", userName: "peer\n" },
    { page: "external", url: "https://evil.example" },
    { page: "external", url: "https://u:p@fishpi.cn" },
    { page: "external", url: "https://fishpi.cn:444/a" },
    { page: "chatroom", messageId: "x".repeat(129) },
    { page: "article" },
    { page: "article", oId: "" },
    { page: "article", oId: "x".repeat(65) },
    { page: "article", oId: "a", commentId: "x".repeat(33) },
    { page: "article", oId: "a", commentId: "" },
  ]) assert.equal(parseNotificationTarget(value), undefined);
  const targets = [
    { page: "settings" }, { page: "im", userName: "peer" },
    { page: "chatroom", messageId: "9000000000000000001" },
    { page: "external", url: "https://fishpi.cn/article/123#456" },
    { page: "article", oId: "abc123" },
    { page: "article", oId: "abc123", commentId: "456" },
  ];
  useNativeNotificationClicks(7);
  hooks.start();
  await flush();
  const click = listeners.get("desktop://notification-click");
  click({ payload: { sessionGeneration: 6, target: targets[0] } });
  assert.equal(reads, 0);
  for (const target of targets) {
    click({ payload: { sessionGeneration: 7, target } });
    await flush();
  }
  assert.deepEqual(calls, targets);
  session = { status: "loggedOut", sessionGeneration: 7 };
  click({ payload: { sessionGeneration: 7, target: targets[0] } });
  await flush();
  assert.equal(calls.length, targets.length);
  wait = true;
  click({ payload: { sessionGeneration: 7, target: targets[0] } });
  pending.resolve({ status: "loggedIn", sessionGeneration: 8 });
  await flush();
  assert.equal(calls.length, targets.length);
  hooks.stop();
  await flush();
  assert.equal(listeners.size, 0);
  click({ payload: { sessionGeneration: 7, target: targets[0] } });
  await flush();
  assert.equal(calls.length, targets.length);
});

test("unmount prevents a native click's late authentication lookup from navigating", async () => {
  const hooks = hookMocks();
  const pending = deferred();
  let click;
  let opened = false;
  const load = createLoader({
    react: hooks.react,
    sonner: { toast: { error: () => {} } },
    "@tauri-apps/api/event": {
      listen: async (_name, callback) => { click = callback; return () => {}; },
    },
    "../../lib/tauri": { invokeAuthMe: () => pending.promise },
    "./navigation": {
      openNoticeTarget: async () => { opened = true; },
      communityNoticeUrl: () => undefined,
    },
  });
  load(new URL("./useNativeNotificationClicks.ts", import.meta.url)).useNativeNotificationClicks(7);
  hooks.start();
  await flush();
  click({ payload: { sessionGeneration: 7, target: { page: "settings" } } });
  hooks.stop();
  pending.resolve({ status: "loggedIn", sessionGeneration: 7 });
  await flush();
  assert.equal(opened, false);
});
