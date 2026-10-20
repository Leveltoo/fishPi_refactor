import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, hookMocks, plain } from "../shell/testLoader.mjs";

const track = (id) => ({ id, name: id, artist: "artist", url: `https://music.test/${id}` });

test("playlist preserves old numeric strategies, duplicate order and distinct delete behaviors", () => {
  const player = createLoader()(new URL("./playerStore.ts", import.meta.url));
  const ids = () => Array.from(player.getPlayerSnapshot().tracks, (item) => item.id);
  player.enqueuePlayerTrack(track("a"), 0);
  player.enqueuePlayerTrack(track("b"), 1);
  player.enqueuePlayerTrack(track("c"), 1);
  assert.deepEqual(ids(), ["a", "b", "c"]);
  assert.equal(player.getPlayerSnapshot().index, 0);
  player.enqueuePlayerTrack(track("a"), 2);
  assert.deepEqual(ids(), ["a", "b", "c"]);
  assert.equal(player.getPlayerSnapshot().index, 2);
  player.setPlayerIndex(0);
  player.playerRemoveCurrent();
  assert.deepEqual(ids(), ["b", "c"]);
  assert.equal(player.getPlayerSnapshot().index, 1);
  player.setPlayerTracks([track("a"), track("b"), track("c")], 1);
  player.playerRemoveSong("a");
  assert.equal(player.getPlayerSnapshot().index, 1);
  player.playerRemoveSong("c");
  assert.equal(player.getPlayerSnapshot().index, 0);
  player.enqueuePlayerTrack(track("d"), 0);
  assert.deepEqual(ids(), ["d"]);
  player.setPlayerMode(999);
  assert.equal(player.getPlayerSnapshot().mode, 0);
  const before = player.getPlayerGeneration();
  player.playerClear();
  assert.equal(player.getPlayerGeneration(), before + 1);
  assert.deepEqual(ids(), []);
});

test("public force-add appends without changing the current song or ordinary click strategies", async () => {
  const hooks = hookMocks();
  const components = new Proxy({}, { get: (_target, name) => name });
  const load = createLoader({
    react: hooks.react,
    "react/jsx-runtime": hooks.jsx,
    "@/components/ui/button": components,
    "@/components/ui/input": components,
    "@/components/ui/scroll-area": components,
    "@/components/ui/select": components,
    "../desktop/api": { desktopPrefsGet: async () => ({ musicMode: 0 }) },
    "./api": { musicResolve: async (id) => track(id) },
  });
  const playlist = load(new URL("./index.ts", import.meta.url));
  const player = load(new URL("./playerStore.ts", import.meta.url));
  const ids = () => plain(player.getPlayerSnapshot().tracks).map((item) => item.id);
  assert.equal(playlist.enqueueNeteaseSong("c"), false);
  playlist.PlaylistMount();
  hooks.start();
  await flush();
  for (const mode of [0, 1, 2]) {
    player.setPlayerTracks([track("a"), track("b")], 1);
    player.setPlayerMode(mode);
    assert.equal(playlist.enqueueNeteaseSong("c"), true);
    assert.equal(playlist.playNeteaseSong("d", true), true);
    await flush();
    assert.deepEqual(ids(), ["a", "b", "c", "d"]);
    assert.equal(player.getPlayerSnapshot().index, 1);
    assert.equal(player.getPlayerSnapshot().mode, mode);
    playlist.enqueueNeteaseSong("c");
    await flush();
    assert.deepEqual(ids(), ["a", "b", "c", "d"]);
    assert.equal(player.getPlayerSnapshot().index, 1);
    playlist.playNeteaseSong("e");
    await flush();
    assert.deepEqual(ids(), mode === 0 ? ["e"] : ["a", "b", "c", "d", "e"]);
    assert.equal(player.getPlayerSnapshot().index, mode === 0 ? 0 : mode === 1 ? 1 : 4);
  }
  player.playerClear();
  playlist.enqueueNeteaseSong("first");
  await flush();
  assert.deepEqual(ids(), ["first"]);
  assert.equal(player.getPlayerSnapshot().index, 0);
  hooks.stop();
  assert.equal(playlist.enqueueNeteaseSong("late"), false);
});

test("music resolve follows click order and clear rejects a late result", async () => {
  const hooks = hookMocks();
  const components = new Proxy({}, { get: (_target, name) => name });
  const requests = [];
  const first = deferred();
  const third = deferred();
  let enqueue;
  const load = createLoader({
    react: hooks.react,
    "react/jsx-runtime": hooks.jsx,
    "@/components/ui/button": components,
    "@/components/ui/input": components,
    "@/components/ui/scroll-area": components,
    "@/components/ui/select": components,
    "../desktop/api": {
      desktopPrefsGet: async () => ({ musicMode: 1 }),
      commandError: (error) => String(error),
    },
    "./api": { musicResolve: async (id) => {
      requests.push(id);
      if (id === "a") return first.promise;
      if (id === "c") return third.promise;
      return track(id);
    } },
    "./playlist": {
      bindPlaylist: (fn) => { enqueue = fn; },
      bindPlaylistHas: () => {},
      bindPlaylistRemove: () => {},
    },
  });
  const player = load(new URL("./playerStore.ts", import.meta.url));
  load(new URL("./PlaylistMount.tsx", import.meta.url)).PlaylistMount();
  hooks.start();
  await flush();
  enqueue("a");
  enqueue("b");
  await flush();
  assert.deepEqual(requests, ["a"]);
  first.resolve(track("a"));
  await flush();
  assert.deepEqual(requests, ["a", "b"]);
  assert.deepEqual(plain(player.getPlayerSnapshot().tracks).map((item) => item.id), ["a", "b"]);
  enqueue("c", true);
  await flush();
  player.playerClear();
  third.resolve(track("c"));
  await flush();
  assert.equal(player.getPlayerSnapshot().tracks.length, 0);
  hooks.stop();
});

test("mute survives audio rebinding and single-song ended really replays", async () => {
  const player = createLoader()(new URL("./playerStore.ts", import.meta.url));
  const calls = [];
  const audio = {
    muted: false, currentTime: 20,
    pause: () => calls.push("pause"),
    play: async () => { calls.push("play"); },
    removeAttribute: (name) => calls.push(name),
    load: () => calls.push("load"),
  };
  player.playerToggleMute();
  player.bindPlayerAudio(audio);
  assert.equal(audio.muted, true);
  player.enqueuePlayerTrack(track("a"), 0);
  player.playerOnEnded();
  await flush();
  assert.equal(audio.currentTime, 0);
  assert.deepEqual(calls, ["play"]);
  player.playerClear();
  assert.deepEqual(calls, ["play", "pause", "src", "load"]);
});
