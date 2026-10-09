import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, plain } from "../shell/testLoader.mjs";

const unknown = { code: "outcome_unknown", message: "unconfirmed" };
const snapshot = { sessionGeneration: 7, urls: ["https://example.com/one.png"] };

test("an uncertain context-menu write stays blocked until an explicit successful read-only refresh", async () => {
  const calls = [];
  let failWrite = true;
  let failRead = false;
  const load = createLoader({
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args: plain(args ?? {}) });
      if (command === "emoji_cloud_get" && failRead) throw { code: "network", message: "unavailable" };
      if (command === "emoji_cloud_append" && failWrite) throw unknown;
      return snapshot;
    } },
  });
  const api = load(new URL("./chatroomApi.ts", import.meta.url));
  await assert.rejects(api.appendCloudEmoji(snapshot, ["https://example.com/two.png"]), (err) => err.code === "outcome_unknown");
  failWrite = false;
  await api.loadCloudEmoji(); // An implicit pre-add read must not unlock a retry.
  await assert.rejects(api.appendCloudEmoji(snapshot, ["https://example.com/two.png"]), (err) => err.code === "outcome_unknown");
  await assert.rejects(api.removeCloudEmoji(snapshot, snapshot.urls[0]), (err) => err.code === "outcome_unknown");
  assert.equal(calls.filter((call) => call.command === "emoji_cloud_append").length, 1);
  assert.equal(calls.filter((call) => call.command === "emoji_cloud_remove").length, 0);
  failRead = true;
  await assert.rejects(api.refreshCloudEmoji());
  await assert.rejects(api.appendCloudEmoji(snapshot, ["https://example.com/two.png"]));
  failRead = false;
  const confirmed = await api.refreshCloudEmoji();
  await api.appendCloudEmoji(confirmed, ["https://example.com/two.png"]);
  assert.equal(calls.filter((call) => call.command === "emoji_cloud_append").length, 2);
  assert.deepEqual(calls.at(-1).args.request, {
    sessionGeneration: 7, urls: ["https://example.com/two.png"],
  });
  assert.ok(calls.every((call) => !JSON.stringify(call.args).includes("apiKey")));
});

test("a refresh begun before a new uncertain write cannot clear its confirmation gate", async () => {
  const read = deferred();
  let writes = 0;
  const load = createLoader({
    "@tauri-apps/api/core": { invoke: async (command) => {
      if (command === "emoji_cloud_get") return read.promise;
      writes += 1;
      throw unknown;
    } },
  });
  const api = load(new URL("./chatroomApi.ts", import.meta.url));
  const pendingRefresh = api.refreshCloudEmoji();
  await assert.rejects(api.appendCloudEmoji(snapshot, ["https://example.com/two.png"]));
  read.resolve(snapshot);
  await pendingRefresh;
  await assert.rejects(api.appendCloudEmoji(snapshot, ["https://example.com/two.png"]));
  assert.equal(writes, 1);
});

function hooks() {
  const slots = [];
  const effects = [];
  const cleanups = [];
  let cursor = 0;
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect(effect) {
        const index = cursor++;
        if (!(index in slots)) {
          slots[index] = true;
          effects.push(effect);
        }
      },
    },
    jsx: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    render(component) { cursor = 0; return component(); },
    start() { effects.forEach((effect) => cleanups.push(effect())); },
    stop() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

function nodes(root) {
  if (root == null || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}

function favoritesFixture(api) {
  const runtime = hooks();
  const load = createLoader({
    react: runtime.react,
    "react/jsx-runtime": runtime.jsx,
    "lucide-react": { Download: "Download", Plus: "Plus", RefreshCw: "Refresh", Upload: "Upload" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/context-menu": {
      ContextMenu: "ContextMenu", ContextMenuContent: "ContextMenuContent",
      ContextMenuItem: "ContextMenuItem", ContextMenuTrigger: "ContextMenuTrigger",
    },
    "../chatroomApi": api,
    "../emojiImportExport": { downloadCloudEmojiText: () => {} },
    "../../../lib/upload": { isImageFile: () => true, uploadFiles: async () => [] },
  }, { TextEncoder });
  const { CloudEmojiFavorites } = load(new URL("./components/CloudEmojiFavorites.tsx", import.meta.url));
  const render = () => runtime.render(() => CloudEmojiFavorites({ disabled: false, onPick: () => {} }));
  return { runtime, render, button: (title) => nodes(render()).find((node) => node.props?.title === title) };
}

test("actual favorites UI imports newline text, keeps server APIs separate, and requires refresh after unknown", async () => {
  let reads = 0;
  let writes = 0;
  let submitted;
  const fixture = favoritesFixture({
    refreshCloudEmoji: async () => { reads += 1; return snapshot; },
    appendCloudEmoji: async (current, urls) => {
      writes += 1;
      submitted = { current: plain(current), urls: plain(urls) };
      throw unknown;
    },
    removeCloudEmoji: async () => { throw new Error("not expected"); },
  });
  fixture.render();
  fixture.runtime.start();
  await flush();
  const input = nodes(fixture.render()).find((node) => node.props?.accept === ".txt,text/plain");
  input.props.onChange({ target: { files: [{
    size: 80,
    text: async () => "https://example.com/two.png\r\nhttps://example.com/two.png\njavascript:alert(1)",
  }], value: "selected" } });
  await flush();
  assert.deepEqual(submitted, { current: snapshot, urls: ["https://example.com/two.png"] });
  assert.equal(writes, 1);
  assert.equal(fixture.button("\u6dfb\u52a0\u6536\u85cf\u56fe\u7247").props.disabled, true);
  input.props.onChange({ target: { files: [{ size: 40, text: async () => "https://example.com/three.png" }], value: "" } });
  await flush();
  assert.equal(writes, 1);
  fixture.button("\u5237\u65b0\u6536\u85cf").props.onClick();
  await flush();
  assert.equal(reads, 2);
  assert.equal(fixture.button("\u6dfb\u52a0\u6536\u85cf\u56fe\u7247").props.disabled, false);
  fixture.runtime.stop();
});

test("favorites cancellation discards late read results and oversized imports never invoke cloud writes", async () => {
  const read = deferred();
  let writes = 0;
  const fixture = favoritesFixture({
    refreshCloudEmoji: () => read.promise,
    appendCloudEmoji: async () => { writes += 1; return snapshot; },
    removeCloudEmoji: async () => snapshot,
  });
  fixture.render();
  fixture.runtime.start();
  fixture.runtime.stop();
  read.resolve(snapshot);
  await flush();
  assert.equal(fixture.button("\u6dfb\u52a0\u6536\u85cf\u56fe\u7247").props.disabled, true);
  const ready = favoritesFixture({
    refreshCloudEmoji: async () => snapshot,
    appendCloudEmoji: async () => { writes += 1; return snapshot; },
    removeCloudEmoji: async () => snapshot,
  });
  ready.render();
  ready.runtime.start();
  await flush();
  const input = nodes(ready.render()).find((node) => node.props?.accept === ".txt,text/plain");
  input.props.onChange({ target: { files: [{
    size: 512 * 1024 + 1, text: async () => { throw new Error("must not read"); },
  }], value: "" } });
  await flush();
  assert.equal(writes, 0);
  ready.runtime.stop();
});
