import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function loader(mocks = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    function localRequire(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith(".")) {
        const base = path.resolve(path.dirname(filename), name);
        return load(path.extname(base) ? base : `${base}.ts`);
      }
      return require(name);
    }
    vm.runInThisContext(`(function(require, module, exports) {\n${source}\n})`, { filename })(
      localRequire, module, module.exports,
    );
    return module.exports;
  }
  return (name) => load(path.join(directory, name));
}

const load = loader({
  "@tauri-apps/plugin-opener": { openUrl: async () => {} },
  dompurify: { sanitize: () => { throw new Error("HTML sanitizer requires browser checks"); } },
});
const { compareMessageId, mergeThreadMessages, messagePeer, confirmsWrite, privateJumpId } = load("threadState.ts");
const { mapMessageEvent, mapPrivateMessage, mapNoticeEvent, mapRevokeEvent } = load("mappers.ts");
const { applyUnreadCounts, conversationsFrom, toConversation, upsertConversation, bumpUnread } = load("conversation.ts");
const { formatPrivateReply } = load("replyQuote.ts");
const { neteasePlayerUrl } = load("musicEmbed.ts");
const { insertText } = load("composerText.ts");
const message = (id, md = "hi", userName = "alice") => ({
  id, md, userName, receiverUserName: "bob", userAvatarUrl: "", time: "", revoked: false,
});
const row = (id, sender = "alice", receiver = "bob") => ({
  id, senderUserName: sender, receiverUserName: receiver,
  senderAvatarUrl: "a.png", receiverAvatarUrl: "b.png", unread: 1,
});

test("unread counts every message, not only each peer", () => {
  const rows = [row("1"), row("2"), row("3")].map((item) => toConversation(item, "bob"));
  assert.equal(applyUnreadCounts([], rows)[0].unread, 3);
  assert.equal(conversationsFrom([row("1", "bob", "alice")], "bob")[0].peerAvatarUrl, "b.png");
});
test("existing conversation order does not jump on select or receipt", () => {
  const list = conversationsFrom([row("1"), row("2", "carol")], "bob");
  assert.deepEqual(upsertConversation(list, { ...list[1], unread: 0 }).map((item) => item.peerUserName), ["alice", "carol"]);
  assert.equal(bumpUnread(list, "carol", 1)[1].unread, 2);
});
test("overlapping history and live merge by numeric string ID", () => {
  assert.equal(compareMessageId("9", "10"), -1);
  assert.equal(compareMessageId("99999999999999999999", "100000000000000000000"), -1);
  const merged = mergeThreadMessages([message("10"), message("10")], [message("9"), message("10", "new")]);
  assert.deepEqual(merged.map((item) => item.id), ["9", "10"]);
  assert.equal(merged[1].md, "new");
  assert.equal(mergeThreadMessages(merged, [message("10", "offline")], { incomingWins: false })[1].md, "new");
});
test("revoke before history removes body and cannot be revived", () => {
  const ids = new Set(["10"]);
  const first = mergeThreadMessages([], [message("10", "secret")], { revokedIds: ids });
  assert.equal(first[0].revoked, true);
  assert.equal(first[0].md, undefined);
  assert.equal(mergeThreadMessages(first, [message("10", "secret")])[0].md, undefined);
});
test("global outgoing echo uses receiver, not the active conversation", () => {
  const event = mapMessageEvent({ sessionGeneration: 3, message: message("1", "hi", "bob") });
  assert.equal(event.userName, undefined);
  assert.equal(messagePeer(event.userName, event.message, "bob"), "bob");
  assert.equal(messagePeer(undefined, { ...event.message, receiverUserName: "carol" }, "bob"), "carol");
  assert.equal(messagePeer(undefined, { ...event.message, receiverUserName: undefined }, "bob"), null);
});
test("uncertain send only confirms a new matching self echo", () => {
  const pending = { content: "hi", knownIds: new Set(["1"]) };
  assert.equal(confirmsWrite(message("1", "hi", "bob"), pending, "bob"), false);
  assert.equal(confirmsWrite(message("2", "hi", "alice"), pending, "bob"), false);
  assert.equal(confirmsWrite(message("2", "other", "bob"), pending, "bob"), false);
  assert.equal(confirmsWrite(message("2", "hi", "bob"), pending, "bob"), true);
});
test("mappers retain HTML, raw markdown, receiver and connection generations", () => {
  const mapped = mapPrivateMessage({ oId: "1", markdown: "**hi**", content: "<p>hi</p>", senderUserName: "a", receiverUserName: "b" });
  assert.equal(mapped.text, "<p>hi</p>");
  assert.equal(mapped.md, "**hi**");
  assert.equal(mapped.receiverUserName, "b");
  assert.equal(mapNoticeEvent({ command: "chatUnreadCountRefresh", connectionGeneration: 4 }).connectionGeneration, 4);
  assert.equal(mapRevokeEvent({ messageId: "1", connectionGeneration: 4 }).connectionGeneration, 4);
});
test("private quote preserves every line and old jump template", () => {
  const result = formatPrivateReply({ id: "12", displayName: "a", body: "one\ntwo" }, "answer");
  assert.ok(result.includes("https://fishpi.cn/chat#chat12"));
  assert.ok(result.includes(">one\n>two"));
  assert.ok(result.endsWith("\n\nanswer"));
  assert.equal(result.includes("@a"), false);
});
test("private reply jumps accept only exact chat links and local anchors", () => {
  assert.equal(privateJumpId("#chat12"), "12");
  assert.equal(privateJumpId("https://fishpi.cn/chat#chat12"), "12");
  for (const href of [
    "javascript:alert(1)#chat12", "https://evil.test/chat#chat12",
    "https://fishpi.cn/chat-room#chat12", "https://fishpi.cn/chat#chat12extra",
    "https://user:pass@fishpi.cn/chat#chat12", "https://fishpi.cn:8080/chat#chat12",
  ]) assert.equal(privateJumpId(href), null);
});
test("music embeds are canonical exact-host song or album players only", () => {
  assert.ok(neteasePlayerUrl("//music.163.com/outchain/player?type=1&amp;id=123").includes("type=1&id=123"));
  assert.ok(neteasePlayerUrl("http://music.163.com/outchain/player?type=2&id=456").startsWith("https:"));
  for (const url of [
    "https://evil.test/music.163.com/outchain/player?type=2&id=1",
    "https://music.163.com.evil.test/outchain/player?type=2&id=1",
    "javascript:alert(1)", "https://music.163.com/outchain/player?type=0&id=1",
    "https://music.163.com/outchain/player?type=2&id=1x",
  ]) assert.equal(neteasePlayerUrl(url), null);
});
test("token inserts at selection and keeps surrounding text", () => {
  assert.deepEqual(insertText("abcd", 1, 3, ":smile:"), { text: "a:smile:d", caret: 8 });
});

function hookRuntime() {
  const slots = [];
  let index = 0;
  let hook;
  let result;
  let queued = false;
  let alive = true;
  const effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  function schedule() {
    if (!alive || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (alive) render(); });
  }
  function render() {
    index = 0;
    result = hook();
    for (const effect of effects.splice(0)) effect();
  }
  const react = {
    useState(initial) {
      const slot = index++;
      if (!slots[slot]) slots[slot] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[slot].value, (value) => {
        slots[slot].value = typeof value === "function" ? value(slots[slot].value) : value;
        schedule();
      }];
    },
    useRef(value) {
      const slot = index++;
      return slots[slot] ??= { current: value };
    },
    useCallback(fn, deps) {
      const slot = index++;
      if (!equal(slots[slot]?.deps, deps)) slots[slot] = { deps, fn };
      return slots[slot].fn;
    },
    useEffect(fn, deps) {
      const slot = index++;
      if (equal(slots[slot]?.deps, deps)) return;
      const old = slots[slot];
      slots[slot] = { deps };
      effects.push(() => {
        old?.cleanup?.();
        slots[slot].cleanup = fn();
      });
    },
  };
  return {
    react,
    mount(fn) { hook = fn; render(); },
    get value() { return result; },
    unmount() { alive = false; slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 25; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function hookTests() {
  const runtime = hookRuntime();
  let handler;
  let reconnect;
  let delayedHistory;
  let delayedSeed;
  let delayedSend;
  let unreadRows = [row("1", "alice", "self"), row("2", "alice", "self")];
  let historyCalls = 0;
  let connectCalls = 0;
  let sends = 0;
  let marks = 0;
  const profile = (name) => ({ status: "ok", profile: { userName: name, userNickname: "", userAvatarUrl: "" } });
  const api = {
    invokeChatConnect: async ({ userName }) => { connectCalls += 1; return { sessionGeneration: 7, connectionGeneration: userName ? 11 : 10 }; },
    invokeChatDisconnect: async () => {},
    invokeChatList: async () => ({ sessionGeneration: 7, conversations: [row("1", "alice", "self")] }),
    invokeChatUnread: async () => ({ sessionGeneration: 7, messages: unreadRows }),
    invokeChatMarkRead: async () => { marks += 1; unreadRows = []; },
    invokeChatHistory: async (query) => {
      historyCalls += 1;
      if (query.userName === "alice" && delayedHistory) return delayedHistory.promise;
      return { sessionGeneration: 7, messages: [message(query.userName === "alice" ? "10" : "20", query.userName)], exhausted: true };
    },
    invokeChatSend: async () => { sends += 1; return delayedSend ? delayedSend.promise : { sessionGeneration: 7, accepted: true }; },
    invokeChatRevoke: async () => {},
    invokeUserSearch: async () => ({ sessionGeneration: 7, users: [] }),
    listenChatEvents: async (fn) => { handler = fn; return () => {}; },
  };
  const mockLoad = loader({
    react: runtime.react,
    sonner: { toast: { error() {}, warning() {}, message() {} } },
    "@tauri-apps/api/event": { listen: async (_event, fn) => { reconnect = fn; return () => {}; } },
    "../../lib/tauri": { invokeAuthMe: async () => ({ sessionGeneration: 7, user: { userName: "self" } }) },
    "../overlay/api": { fetchUserProfile: async (name) => profile(name) },
    "./api": api,
    "./offlineSeed": { loadOfflineThread: async (name) => name === "alice" && delayedSeed ? delayedSeed.promise : [] },
  });
  runtime.mount(mockLoad("usePrivateChat.ts").usePrivateChat);
  await flush();
  assert.equal(runtime.value.conversations[0].unread, 2);
  delayedHistory = deferred();
  delayedSeed = deferred();
  const opening = runtime.value.openConversation("alice");
  await flush();
  await runtime.value.openConversation("carol");
  delayedHistory.resolve({ sessionGeneration: 6, messages: [message("999", "old-session")], exhausted: true });
  delayedSeed.resolve([message("998", "old-seed")]);
  await opening;
  await flush();
  assert.equal(runtime.value.activeUser, "carol");
  assert.equal(runtime.value.messages.some((item) => ["999", "998"].includes(item.id)), false);
  passed += 1;
  console.log(`ok ${passed} - late old-thread history and offline seed are rejected`);

  const beforeReconnect = historyCalls;
  const beforeConnect = connectCalls;
  reconnect({ payload: { sessionGeneration: 6, chat: "已重新连接" } });
  await flush();
  assert.equal(historyCalls, beforeReconnect);
  reconnect({ payload: { sessionGeneration: 7, chat: "部分私聊通道已重新连接" } });
  await flush();
  assert.equal(historyCalls, beforeReconnect + 1);
  assert.equal(connectCalls, beforeConnect);
  passed += 1;
  console.log(`ok ${passed} - reconnect is generation-scoped and only pulls queries`);

  handler({ event: "chat://revoke", payload: { sessionGeneration: 7, userName: "carol", connectionGeneration: 11, messageId: "30" } });
  handler({ event: "chat://msg", payload: { sessionGeneration: 7, userName: "carol", connectionGeneration: 11, message: message("30", "late-secret") } });
  await flush();
  assert.equal(runtime.value.messages.find((item) => item.id === "30").revoked, true);
  assert.equal(runtime.value.messages.find((item) => item.id === "30").md, undefined);
  assert.equal(marks, 0);
  passed += 1;
  console.log(`ok ${passed} - revoke survives live echo and hidden pages do not mark read`);

  delayedSend = deferred();
  const sending = runtime.value.send("uncertain");
  await flush();
  assert.equal(await runtime.value.send("uncertain"), false);
  assert.equal(sends, 1);
  delayedSend.resolve({ sessionGeneration: 7, accepted: false, outcomeUnknown: true });
  assert.equal(await sending, false);
  await flush();
  assert.equal(runtime.value.pendingConfirm, true);
  assert.equal(await runtime.value.send("uncertain"), false);
  handler({ event: "chat://msg", payload: { sessionGeneration: 7, userName: "carol", connectionGeneration: 11, message: message("40", "uncertain", "carol") } });
  await flush();
  assert.equal(runtime.value.pendingConfirm, true);
  handler({ event: "chat://msg", payload: { sessionGeneration: 7, userName: "carol", connectionGeneration: 11, message: message("41", "uncertain", "self") } });
  await flush();
  assert.equal(runtime.value.pendingConfirm, false);
  assert.equal(runtime.value.confirmedContent, "uncertain");
  assert.equal(sends, 1);
  passed += 1;
  console.log(`ok ${passed} - concurrent and uncertain writes cannot be resent, only matching self echo confirms`);
  runtime.value.setVisible(true);
  await flush();
  assert.ok(marks > 0);
  runtime.unmount();
}

await hookTests();

async function cloudFavoriteTests() {
  const previousGlobals = new Map(["window", "Element"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class ImageTarget {
    nodeName = "IMG";
    src = "https://images.test/face.png";
    closest() { return null; }
    getAttribute() { return ""; }
  }
  globalThis.Element = ImageTarget;
  globalThis.window = { getSelection: () => null };
  const components = new Proxy({}, { get: (_target, key) => key });
  const jsx = (type, props) => ({ type, props });
  const find = (node, predicate) => {
    if (Array.isArray(node)) {
      for (const item of node) { const match = find(item, predicate); if (match) return match; }
    } else if (node && typeof node === "object") {
      if (predicate(node)) return node;
      return find(node.props?.children, predicate);
    }
  };
  function fixture({ load: loadSnapshot, append, auth } = {}) {
    const runtime = hookRuntime();
    const calls = { load: 0, append: [], server: 0, notices: [] };
    const mockLoad = loader({
      react: runtime.react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      sonner: { toast: Object.fromEntries(["success", "info", "warning", "error"].map((kind) =>
        [kind, (text) => calls.notices.push({ kind, text })])) },
      "@/components/ui/avatar": components,
      "@/components/ui/context-menu": components,
      "../../../lib/markdown": { sanitizeHttpUrl: () => null, openSafeExternalUrl: async () => {} },
      "../../../lib/tauri": { invokeAuthMe: auth ?? (async () => ({ sessionGeneration: 7, user: { userName: "self" } })) },
      "../../chatroom/chatroomApi": {
        loadCloudEmoji: async () => { calls.load += 1; return loadSnapshot ? loadSnapshot() : { sessionGeneration: 7, urls: [] }; },
        appendCloudEmoji: async (snapshot, urls) => {
          calls.append.push({ snapshot, urls });
          return append ? append(snapshot, urls) : { sessionGeneration: 7, urls };
        },
        addEmojiUrl: async () => { calls.server += 1; throw new Error("Must not write server groups"); },
      },
      "../../chatroom/userMenuActions": {},
      "../../usercard/hover": { userCardProps: () => ({}) },
      "../../chatroom/components/ChatHtmlView": { looksLikeHtml: () => false },
      "./MarkdownBody": { MarkdownBody: "MarkdownBody" },
    });
    const Bubble = mockLoad("components/MessageBubble.tsx").MessageBubble;
    runtime.mount(() => Bubble({ message: message("1"), selfUserName: "self" }));
    find(runtime.value, (node) => node.type === "article").props.onContextMenuCapture({ target: new ImageTarget() });
    return {
      runtime, calls,
      select() { find(runtime.value, (node) => node.type === "ContextMenuItem" && node.props.children === "添加表情").props.onSelect(); },
    };
  }
  try {
    const delayed = deferred();
    const same = { sessionGeneration: 7, urls: [] };
    const success = fixture({ load: () => delayed.promise });
    await flush();
    success.select();
    success.select();
    assert.equal(success.calls.load, 1);
    delayed.resolve(same);
    await flush();
    assert.deepEqual(success.calls.append, [{ snapshot: same, urls: ["https://images.test/face.png"] }]);
    assert.equal(success.calls.server, 0);
    assert.deepEqual(success.calls.notices.map((item) => item.kind), ["success"]);
    success.runtime.unmount();
    passed += 1;
    console.log(`ok ${passed} - image favorites use same-session Cloud snapshot and synchronously block double select`);

    const exists = fixture({ load: async () => ({ sessionGeneration: 7, urls: ["https://images.test/face.png"] }) });
    await flush();
    exists.select();
    await flush();
    assert.equal(exists.calls.append.length, 0);
    assert.deepEqual(exists.calls.notices.map((item) => item.kind), ["info"]);
    exists.runtime.unmount();
    const stale = fixture({ load: async () => ({ sessionGeneration: 8, urls: [] }) });
    await flush();
    stale.select();
    await flush();
    assert.equal(stale.calls.append.length, 0);
    assert.deepEqual(stale.calls.notices, []);
    stale.runtime.unmount();
    passed += 1;
    console.log(`ok ${passed} - existing favorite skips append and foreign-session snapshot cannot write or claim success`);

    const unknown = fixture({ append: async () => { throw { code: "outcome_unknown", message: "" }; } });
    await flush();
    unknown.select();
    await flush();
    await flush();
    assert.equal(unknown.calls.append.length, 1);
    assert.equal(unknown.calls.load, 1);
    assert.deepEqual(unknown.calls.notices.map((item) => item.kind), ["warning"]);
    unknown.runtime.unmount();
    const late = deferred();
    const unmounted = fixture({ append: () => late.promise });
    await flush();
    unmounted.select();
    await flush();
    unmounted.runtime.unmount();
    late.resolve({ sessionGeneration: 7, urls: ["https://images.test/face.png"] });
    await flush();
    assert.deepEqual(unmounted.calls.notices, []);
    let authCalls = 0;
    const changed = fixture({ auth: async () => ({
      sessionGeneration: ++authCalls < 3 ? 7 : 8, user: { userName: "self" },
    }) });
    await flush();
    changed.select();
    await flush();
    assert.equal(changed.calls.append.length, 1);
    assert.deepEqual(changed.calls.notices, []);
    changed.runtime.unmount();
    passed += 1;
    console.log(`ok ${passed} - unknown favorite writes never auto-retry and late/unmounted or changed-session success is suppressed`);
  } finally {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
await cloudFavoriteTests();
console.log(`${passed} IM migration checks passed`);
