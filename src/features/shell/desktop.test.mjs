import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, hookMocks, plain } from "./testLoader.mjs";

test("reconnect, messages and peerless revokes keep the outer session and reject stale results", async () => {
  const hooks = hookMocks();
  const listeners = new Map();
  const writes = [];
  const revokes = [];
  const lateRevoke = deferred();
  const roomId = "9000000000000000001";
  const globalId = "9000000000000000002";
  const lateId = "9000000000000000003";
  const revokedSnapshot = { chatroom: [{ id: roomId, revoked: true }], chats: {}, failed: [] };
  const snapshot = { chatroom: [], chats: {}, failed: [] };
  let current = { sessionGeneration: 9, status: "loggedIn", user: { userName: "self" } };
  const load = createLoader({
    react: hooks.react,
    "react/jsx-runtime": hooks.jsx,
    "@tauri-apps/api/event": { listen: async (event, fn) => {
      listeners.set(event, fn);
      return () => listeners.delete(event);
    } },
    "@tauri-apps/api/core": { invoke: async (command) => {
      if (command === "desktop_prefs_get") return { updateMirror: "" };
      if (command === "reconnect_watch") return { watching: true, message: "watching" };
      throw new Error(`Unexpected command: ${command}`);
    } },
    "./offline": {
      loadOffline: async () => snapshot,
      mergeOffline: async (input) => { writes.push(plain(input)); return snapshot; },
      revokeOffline: async (input) => {
        revokes.push(plain(input));
        return input.messageId === lateId ? lateRevoke.promise : revokedSnapshot;
      },
      messagePreview: () => "",
    },
    "../settings/api": { invokeSettingsGet: async () => ({ status: "error" }) },
    "../music/playerStore": { setPlayerMode: () => {} },
    "../../lib/tauri": { invokeAuthMe: async () => current },
  });
  const api = load(new URL("../desktop/api.ts", import.meta.url));
  for (const value of [undefined, null, 0, -1, 8, "9", 9.1, Infinity]) {
    assert.equal(api.matchesDesktopSession(value, current), false);
  }
  assert.equal(api.matchesDesktopSession(9, current), true);
  assert.equal(api.matchesDesktopSession(9, { ...current, status: "loggedOut" }), false);
  load(new URL("../desktop/DesktopMount.tsx", import.meta.url)).DesktopMount();
  hooks.start();
  await flush();
  const reconnect = listeners.get("desktop://reconnect");
  reconnect({ payload: { sessionGeneration: 8, chat: "old" } });
  reconnect({ payload: { chat: "missing" } });
  await flush();
  assert.equal(hooks.states[5], null);
  reconnect({ payload: { sessionGeneration: 9, chat: "partial", relinked: true } });
  await flush();
  assert.equal(hooks.states[5].chat, "partial");
  const onChat = listeners.get("chat://msg");
  onChat({ payload: {
    userName: "peer", sessionGeneration: 9,
    message: { id: "snowflake", sessionGeneration: 100, text: "hello" },
  } });
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].sessionGeneration, 9);
  assert.equal(writes[0].peer, "peer");
  assert.equal(writes[0].messages[0].id, "snowflake");
  onChat({ payload: {
    sessionGeneration: 9, message: { id: "inbound", userName: "background", receiverUserName: "self" },
  } });
  onChat({ payload: {
    sessionGeneration: 9, message: { id: "outbound", userName: "self", receiverUserName: "recipient" },
  } });
  onChat({ payload: {
    sessionGeneration: 9, message: { id: "unknown", userName: "self" },
  } });
  await flush();
  assert.deepEqual(writes.slice(1).map((item) => item.peer), ["background", "recipient"]);
  assert.ok(writes.every((item) => item.sessionGeneration === 9));
  listeners.get("chatroom://revoke")({ payload: { messageId: roomId, sessionGeneration: 9 } });
  listeners.get("chat://revoke")({ payload: { messageId: globalId, sessionGeneration: 9 } });
  for (const sessionGeneration of [undefined, 8]) {
    listeners.get("chat://revoke")({ payload: { messageId: "old", sessionGeneration } });
  }
  listeners.get("chat://revoke")({ payload: { messageId: "", sessionGeneration: 9 } });
  await flush();
  assert.deepEqual(revokes, [
    { messageId: roomId, sessionGeneration: 9 },
    { messageId: globalId, sessionGeneration: 9 },
  ]);
  assert.equal(hooks.states[6], revokedSnapshot);
  listeners.get("chat://revoke")({ payload: { messageId: lateId, sessionGeneration: 9 } });
  await flush();
  const beforeAccountChange = hooks.states[6];
  for (const sessionGeneration of [undefined, 8]) {
    onChat({ payload: { userName: "peer", sessionGeneration, message: { id: "stale" } } });
  }
  current = { sessionGeneration: 10, status: "loggedIn" };
  lateRevoke.resolve({ chatroom: [{ id: lateId, revoked: true }], chats: {}, failed: [] });
  onChat({ payload: { userName: "new-peer", sessionGeneration: 10, message: { id: "new" } } });
  reconnect({ payload: { sessionGeneration: 10, chat: "new-account" } });
  await flush();
  assert.equal(writes.length, 3);
  assert.equal(hooks.states[5].chat, "partial");
  assert.equal(hooks.states[6], beforeAccountChange);
  hooks.stop();
  await flush();
  assert.equal(listeners.size, 0);
});

test("notification navigation restricts external links and dispatches the existing app events", async () => {
  const events = new EventTarget();
  const jumps = [];
  const opened = [];
  const im = [];
  const load = createLoader({
    "@tauri-apps/plugin-opener": { openUrl: async (url) => opened.push(url) },
    "../chatroom/jumpEvents": { dispatchChatJump: (id) => jumps.push(id) },
    "../../lib/nav": { openImWithUser: (name) => im.push(name), OPEN_SETTINGS_EVENT: "settings" },
  }, { window: events, requestAnimationFrame: (fn) => fn() });
  const nav = load(new URL("./navigation.ts", import.meta.url));
  for (const url of ["http://fishpi.cn/a", "https://evil.test/a", "//evil.test/a",
    "https://fishpi.cn:444/a", "https://user:pass@fishpi.cn/a", "javascript:alert(1)"]) {
    assert.equal(nav.communityNoticeUrl(url), undefined);
  }
  assert.equal(nav.communityNoticeUrl("/article/a#b"), "https://fishpi.cn/article/a#b");
  let room = 0;
  events.addEventListener(nav.OPEN_CHATROOM_EVENT, () => room++);
  await nav.openNoticeTarget({ page: "chatroom", messageId: "999999999999999999" });
  assert.equal(room, 1);
  assert.deepEqual(jumps, ["999999999999999999"]);
  await nav.openNoticeTarget({ page: "im", userName: "peer" });
  assert.deepEqual(im, ["peer"]);
  await nav.openNoticeTarget({ page: "external", url: "/article/a" });
  assert.deepEqual(opened, ["https://fishpi.cn/article/a"]);
  await assert.rejects(nav.openNoticeTarget({ page: "external", url: "//evil.test" }));
});

test("native window failures leave switches unchanged, and hiding main first hides the card", async () => {
  const calls = [];
  const load = createLoader({
    "@tauri-apps/api/window": { getCurrentWindow: () => ({
      hide: async () => calls.push("main-hide"),
      close: async () => calls.push("main-close"),
    }) },
    sonner: { toast: { error: () => calls.push("error") } },
    "../usercard/window": { hideUserCardWindow: async () => calls.push("card-hide") },
    "@/features/settings/api": {
      invokeAlwaysOnTop: async () => ({ status: "error", message: "failed" }),
      invokeWindowOpacity: async () => ({ status: "gap" }),
    },
  });
  const actions = load(new URL("./windowActions.ts", import.meta.url));
  assert.equal(await actions.toggleWindowPin(false), false);
  assert.equal(await actions.toggleWindowOpacity(false, 0.6), false);
  await actions.hideMainToTray();
  assert.deepEqual(calls.slice(-2), ["card-hide", "main-hide"]);
});
