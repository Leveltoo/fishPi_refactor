import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, hookMocks, plain } from "../shell/testLoader.mjs";

test("user profile prefetch and fetch share one request and cache the result", async () => {
  let calls = 0;
  const load = createLoader({
    "@tauri-apps/api/core": {
      invoke: async () => {
        calls += 1;
        return { userName: "alice", userNickname: "Alice", userAvatarURL: "https://fishpi.cn/a.png" };
      },
    },
  });
  const api = load(new URL("./api.ts", import.meta.url));
  assert.equal(api.cachedUserProfile("alice"), null);
  const [prefetched, fetched] = await Promise.all([
    api.prefetchUserProfile("alice"),
    api.fetchUserProfile("ALICE"),
  ]);
  assert.equal(calls, 1);
  assert.equal(prefetched.status, "ok");
  assert.equal(fetched.status, "ok");
  assert.equal(api.cachedUserProfile("alice")?.status, "ok");
  await api.fetchUserProfile("alice");
  assert.equal(calls, 1);
  api.invalidateUserProfile("alice");
  await api.fetchUserProfile("alice");
  assert.equal(calls, 2);
});

test("image fit handles stage ratio, invalid sizes and pointer-centered zoom", () => {
  const { fitImageLayout, zoomImageLayout } = createLoader()(new URL("./imageLayout.ts", import.meta.url));
  for (const sizes of [[1200, 1000, 800, 400], [800, 2000, 600, 800], [400, 300, 300, 800]]) {
    const fitted = fitImageLayout(...sizes);
    assert.ok(fitted.width <= sizes[2] && fitted.height <= sizes[3]);
    assert.ok(fitted.x >= 0 && fitted.y >= 0);
    assert.ok(Math.abs(fitted.width / fitted.height - sizes[0] / sizes[1]) < 1e-10);
  }
  assert.deepEqual(plain(fitImageLayout(0, 1, 2, 3)), { width: 0, height: 0, x: 0, y: 0 });
  assert.equal(fitImageLayout(Infinity, 1, 2, 3).width, 0);
  const current = { width: 400, height: 200, x: 100, y: 50 };
  const next = zoomImageLayout(current, -80, 240, 120);
  assert.ok(Math.abs((240 - next.x) / next.width - (240 - current.x) / current.width) < 1e-10);
  assert.ok(Math.abs((120 - next.y) / next.height - (120 - current.y) / current.height) < 1e-10);
  assert.equal(zoomImageLayout(current, 10000, 0, 0).width, 20);
  assert.equal(zoomImageLayout(current, -Infinity, 0, 0), current);
});

test("mention Enter selection leaves all modifier combinations and IME events to the parent", () => {
  const hooks = hookMocks();
  const picked = [];
  const parent = [];
  const components = new Proxy({}, { get: (_target, name) => name });
  let stateSlot = 0;
  let onKey;
  let closed = 0;
  const load = createLoader({
    react: {
      ...hooks.react,
      useState: (initial) => hooks.react.useState(
        stateSlot++ === 0 ? [{ userName: "alice" }, { userName: "bob" }] : initial,
      ),
    },
    "react/jsx-runtime": hooks.jsx,
    "@/components/ui/avatar": components,
    "@/components/ui/button": components,
    "@/components/ui/command": components,
    "../../lib/markdown": { sanitizeHttpUrl: () => null },
    "./api": { searchUsers: async () => ({ status: "ok", users: [] }) },
    "./events": {},
  }, {
    window: {
      setTimeout: () => 1,
      clearTimeout: () => {},
      addEventListener: (name, handler, capture) => {
        assert.equal(name, "keydown");
        assert.equal(capture, true);
        onKey = handler;
      },
      removeEventListener: (name, handler, capture) => {
        assert.equal(name, "keydown");
        assert.equal(capture, true);
        assert.equal(handler, onKey);
        onKey = null;
      },
    },
  });
  load(new URL("./MentionList.tsx", import.meta.url)).MentionList({
    query: "alice",
    onPick: (name) => picked.push(name),
    onClose: () => { closed++; },
  });
  hooks.start();
  function press(overrides = {}) {
    const event = {
      key: "Enter", keyCode: 13, isComposing: false,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...overrides,
    };
    onKey(event);
    if (!event.stopped) parent.push(event);
    return event;
  }
  const plainEnter = press();
  assert.deepEqual(picked, ["alice"]);
  assert.equal(plainEnter.prevented, true);
  assert.equal(plainEnter.stopped, true);
  const modifiers = ["ctrlKey", "metaKey", "altKey", "shiftKey"];
  for (let mask = 1; mask < 16; mask++) {
    const event = press(Object.fromEntries(
      modifiers.map((key, i) => [key, Boolean(mask & (1 << i))]),
    ));
    assert.equal(event.prevented, false, `modifier mask ${mask}`);
    assert.equal(event.stopped, false, `modifier mask ${mask}`);
  }
  assert.equal(parent.length, 15);
  for (const overrides of [
    { isComposing: true }, { keyCode: 229 },
    { isComposing: true, ctrlKey: true }, { isComposing: true, key: "Escape" },
  ]) {
    const event = press(overrides);
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
  }
  assert.deepEqual(picked, ["alice"]);
  assert.equal(closed, 0);
  const escape = press({ key: "Escape" });
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(closed, 1);
  hooks.stop();
  assert.equal(onKey, null);
});
