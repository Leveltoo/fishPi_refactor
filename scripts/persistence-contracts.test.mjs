import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../src-tauri/src/commands/${path}`, import.meta.url), "utf8");

test("settings and imports share a serialized backend write with a complete visible snapshot", () => {
  const source = read("settings_set.rs");
  const command = source.slice(source.indexOf("pub async fn settings_set"), source.indexOf("fn load_current"));
  assert.ok(command.indexOf("SETTINGS_IO.lock().await") < command.indexOf(".store(STORE_FILE)"));
  assert.match(read("config_import.rs"), /settings_set\(app\.clone\(\), patch\)\.await/);
  const persist = source.slice(source.indexOf("fn persist"), source.indexOf("fn parse_settings"));
  assert.ok(persist.indexOf("store.set(SETTINGS_KEY, value)") < persist.indexOf("store.delete(key)"));
  assert.ok(persist.indexOf("store.set(SETTINGS_KEY, value)") < persist.indexOf("store.save()"));
  assert.match(persist, /if store\.save\(\)\.is_err\(\)/);
  assert.match(persist, /for \(key, value\) in previous/);
});

test("filter imports and regular edits serialize and restore memory on a failed disk write", () => {
  const source = read("chatroom_filters.rs");
  const command = source.slice(source.indexOf("pub fn chatroom_filters_set"), source.indexOf("pub fn chatroom_emoji_recent_get"));
  assert.ok(command.indexOf("FILTERS_IO.lock()") < command.indexOf("open_store"));
  assert.match(command, /let previous = store\.get\(FILTERS_KEY\)/);
  assert.match(command, /if store\.save\(\)\.is_err\(\)/);
  assert.match(command, /Some\(value\) => store\.set\(FILTERS_KEY, value\)/);
  assert.match(command, /store\.delete\(FILTERS_KEY\)/);
});

test("chatroom unmount leaves shared connections to auth and manual disconnect carries ownership", () => {
  const hook = readFileSync(new URL("../src/features/chatroom/useChatroomSession.ts", import.meta.url), "utf8");
  const cleanup = hook.match(/return \(\) => \{\s*cancelled = true;[\s\S]*?unlisten\?\.\(\);[\s\S]*?\}, \[\]\);/)?.[0];
  assert.ok(cleanup);
  assert.ok(cleanup.includes("unlisten?.()"));
  assert.doesNotMatch(cleanup, /invokeChatroomDisconnect/);
  assert.match(hook, /invokeChatroomDisconnect\(gensRef\.current \?\? undefined\)/);
  assert.match(hook, /await invokeChatroomDisconnect[^;]+;\s*if \(!activeRef\.current\) return;/);
});
