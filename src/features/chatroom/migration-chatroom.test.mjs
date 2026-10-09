import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(directory, "../../..");
const cache = new Map();

// Execute the production pure modules after stripping types, without React or IPC mocks.
function load(relative, parent = directory) {
  const filename = path.resolve(parent, relative.endsWith(".ts") ? relative : `${relative}.ts`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.length ?? 0, 0, filename);
  const module = { exports: {} };
  cache.set(filename, module);
  const require = (specifier) => {
    assert.ok(specifier.startsWith("."), `Unexpected non-pure import: ${specifier}`);
    return load(specifier, path.dirname(filename));
  };
  new Function("exports", "require", "module", result.outputText)(module.exports, require, module);
  return module.exports;
}

const composer = load("./composerLogic");
const reply = load("./replyQuote");
const view = load("./messageView");
const windowState = load("./messageWindow");
const permissions = load("./permissions");
const reconnect = load("./reconnectReport");
const { createRefreshQueue } = load("./refreshQueue");
const { createFilterSaveGuard } = load("./filterSync");
const { revokeRepeatChain } = load("./revokeChain");
const { neteasePlayer } = load("./musicEmbed");
const emoji = load("./emojiShortcode");
const { viaDetails } = load("./via");
const events = load("./events");
const cloud = load("./cloudEmojiLogic");
const message = (id, fields = {}) => ({
  id, kind: "msg", text: "<p>same</p>", md: "same",
  userName: "alice", userNickname: "Alice", userAvatarUrl: "",
  time: "", revoked: false, ...fields,
});
const target = reply.toReplyTarget(message("123", { md: "  first\nsecond  " }));
const report = {
  sessionGeneration: 7, attempted: true, relinked: true,
  chatroom: "\u5df2\u91cd\u65b0\u8fde\u63a5", chat: "", notice: "", message: "",
};

test("selection replacement and Ctrl+Enter keep surrounding draft and caret", () => {
  assert.deepEqual(composer.insertTextAtSelection("abcdef", 2, 4, "\n"), { text: "ab\nef", caret: 3 });
  assert.deepEqual(composer.insertTextAtSelection("abc", -3, 90, "x"), { text: "x", caret: 1 });
  assert.deepEqual(composer.insertTextAtSelection("abc", 90, 90, "@bob "), { text: "abc@bob ", caret: 8 });
  assert.deepEqual(composer.insertTextAtSelection("abc", 2, 1, ":"), { text: "ab:c", caret: 3 });
});

test("reply draft prefix is idempotent and cancellation removes only the leading prefix", () => {
  const prefix = "\u5e76\u8bf4\uff1a";
  assert.equal(composer.withReplyPrefix("draft", true), `${prefix}draft`);
  assert.equal(composer.withReplyPrefix(`${prefix}draft`, true), `${prefix}draft`);
  assert.equal(composer.withReplyPrefix(`${prefix}draft`, false), "draft");
  assert.equal(composer.withReplyPrefix(`draft${prefix}`, false), `draft${prefix}`);
});

test("reply target retains exact Markdown rather than display HTML", () => {
  assert.equal(target.raw, "  first\nsecond  ");
  assert.equal(target.body, "first\nsecond");
  assert.equal(target.displayName, "Alice");
  assert.equal(reply.toReplyTarget(message("124", { md: undefined })).raw, undefined);
});

test("reply template matches old username, message link and multiline quote", () => {
  const prefix = "\u56de\u590d@alice [\u21a9](https://fishpi.cn/cr#chatroom123 \"\u8df3\u8f6c\u81f3\u539f\u6d88\u606f\")\uff1a\n\n";
  assert.equal(reply.formatReplyTemplate(target, "bob", target.raw), `${prefix}>  first\n>second\n\n`);
  assert.ok(reply.formatReplyTemplate(target, "alice", "original").startsWith(
    "\u56de\u590d[\u21a9](https://fishpi.cn/cr#chatroom123",
  ));
  assert.ok(reply.formatReplyTemplate(target, null, "a\n\nb").includes(">a\n>\n>b"));
});

test("compose reply and topic without modifying draft or HTML display fallback", () => {
  const draft = composer.withReplyPrefix("draft", true);
  const result = composer.composeChatroomMessage(draft, {
    replyTo: target, raw: target.raw, selfUserName: "bob", discussed: "topic",
  });
  assert.equal(result, reply.formatReplyTemplate(target, "bob", target.raw) + draft + "\r\n*`# topic #`*");
  assert.equal(draft, "\u5e76\u8bf4\uff1adraft");
  assert.equal(composer.composeChatroomMessage('ok<span class="quote-message"/>', {
    replyTo: null, selfUserName: null,
  }), "ok");
});

test("compose converts songs and albums with original player sizes", () => {
  const options = { replyTo: null, selfUserName: null };
  assert.match(composer.composeChatroomMessage("https://music.163.com/#/song?id=123&userid=1", options), /height=86.*type=2&id=123/);
  assert.match(composer.composeChatroomMessage("https://music.163.com/album?id=456", options), /height=210.*type=1&id=456/);
  assert.equal(composer.composeChatroomMessage("plain", options), "plain");
});

test("repeat merge follows rendered HTML equality and does not mutate input", () => {
  const input = [message("1"), message("2", { md: "different raw", userName: "bob" })];
  const before = structuredClone(input);
  const rows = view.mergeDoubleMessages(input);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "1");
  assert.deepEqual(view.displayMessageIds(rows[0]), ["1", "2"]);
  assert.deepEqual(input, before);
  assert.equal(view.mergeDoubleMessages(input), rows);
  assert.equal(view.mergeDoubleMessages(input.slice()), rows);
  assert.equal(view.mergeDoubleMessages([
    message("3"), message("4", { text: "<p>different</p>" }),
  ]).length, 2);
});

test("repeat merge excludes special rows and +1 follows the latest non-redpacket row", () => {
  const rows = view.mergeDoubleMessages([
    message("10"), message("11"), message("12", { kind: "redpacket" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(view.plusOneMessageId(rows), "10");
  assert.equal(view.plusOneMessageId(view.mergeDoubleMessages([
    message("20"), message("21"), message("22", { kind: "music" }),
  ])), null);
  assert.equal(view.mergeDoubleMessages([
    message("30", { kind: "weather" }), message("31", { kind: "weather" }),
  ]).length, 2);
});

test("display cache invalidates rich fields and repeated user identity", () => {
  const first = view.mergeDoubleMessages([message("40", { viaVersion: "1" }), message("41")]);
  const second = view.mergeDoubleMessages([
    message("40", { viaVersion: "2" }), message("41", { userNickname: "Changed" }),
  ]);
  assert.notEqual(first[0], second[0]);
  assert.equal(first[0].alsoSaid[0].userNickname, "Alice");
  assert.equal(second[0].alsoSaid[0].userNickname, "Changed");
  const third = view.mergeDoubleMessages([message("40", { weather: { area: "new", summary: "", days: [] } })]);
  assert.equal(third[0].weather.area, "new");
});

test("primary revoke promotes surviving repeats, full chain revoke removes the visible row", () => {
  const state = windowState.createChatWindow();
  windowState.applyHistory(state, [message("53"), message("52"), message("51")]);
  windowState.applyRevoke(state, "51");
  let rows = view.mergeDoubleMessages(windowState.snapshotMessages(state));
  assert.equal(rows[0].id, "52");
  assert.deepEqual(view.displayMessageIds(rows[0]), ["52", "53"]);
  windowState.applyRevoke(state, "53");
  rows = view.mergeDoubleMessages(windowState.snapshotMessages(state));
  assert.equal(rows[0].alsoSaid.length, 0);
  windowState.applyRevoke(state, "52");
  assert.equal(view.mergeDoubleMessages(windowState.snapshotMessages(state)).length, 0);
});

test("revoke-before-history and refresh retain tombstones and deduplicate IDs", () => {
  const state = windowState.createChatWindow();
  windowState.applyRevoke(state, "62");
  windowState.applyHistory(state, [message("63"), message("62"), message("61")]);
  assert.deepEqual(state.order, ["61", "62", "63"]);
  assert.equal(state.byId.get("62").revoked, true);
  assert.equal(windowState.applyHistory(state, [message("61")]).added, 0);
  windowState.clearMessagesKeepRevokes(state);
  windowState.applyHistory(state, [message("62")]);
  assert.equal(state.byId.get("62").revoked, true);
  assert.equal(view.mergeDoubleMessages(windowState.snapshotMessages(state)).length, 0);
});

test("snowflake IDs use exact integer ordering and synthetic events append", () => {
  assert.equal(windowState.compareMessageId("9007199254740993", "9007199254740992"), 1);
  const state = windowState.createChatWindow();
  windowState.applyHistory(state, [message("73"), message("72")]);
  windowState.applyMessage(state, message("custom:1", { kind: "custom" }));
  assert.deepEqual(state.order, ["72", "73", "custom:1"]);
});

test("same-session reconnect success refreshes, stale/failed/other-channel reports do not", () => {
  assert.equal(reconnect.shouldRefreshAfterReconnect(report, 7), true);
  assert.equal(reconnect.shouldRefreshAfterReconnect(report, undefined), false);
  assert.equal(reconnect.shouldRefreshAfterReconnect(report, 8), false);
  for (const change of [
    { attempted: false }, { relinked: false }, { chatroom: "" },
    { sessionGeneration: 6 }, { chatroom: "failed", chat: report.chatroom },
  ]) assert.equal(reconnect.shouldRefreshAfterReconnect({ ...report, ...change }, 7), false);
});

test("busy reconnect refresh requests coalesce and cannot cross sessions", () => {
  const queue = createRefreshQueue();
  queue.request(7);
  queue.request(7);
  assert.equal(queue.take(7, false), false);
  assert.equal(queue.take(7, true), true);
  assert.equal(queue.take(7, true), false);
  queue.request(7);
  assert.equal(queue.take(8, true), false);
  assert.equal(queue.take(7, true), false);
});

test("configuration import cancels a pending filter save and rejects stale results", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const guard = createFilterSaveGuard();
  const submitted = [];
  guard.schedule((token) => submitted.push(token));
  const beforeImport = guard.token();
  context.mock.timers.tick(399);
  guard.invalidate();
  context.mock.timers.tick(1000);
  assert.deepEqual(submitted, []);
  assert.equal(guard.isCurrent(beforeImport), false);
  guard.schedule((token) => submitted.push(token));
  const next = guard.token();
  context.mock.timers.tick(400);
  assert.deepEqual(submitted, [next]);
  guard.invalidate();
  assert.equal(guard.isCurrent(next), false);
});

test("new filter edits replace pending debounce rather than saving stale drafts", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const guard = createFilterSaveGuard();
  const drafts = [];
  guard.schedule(() => drafts.push("old"));
  context.mock.timers.tick(200);
  guard.schedule(() => drafts.push("new"));
  context.mock.timers.tick(399);
  assert.deepEqual(drafts, []);
  context.mock.timers.tick(1);
  assert.deepEqual(drafts, ["new"]);
});

test("config import listener reloads filters and panel props synchronize both local lists", () => {
  const page = readFileSync(path.join(directory, "ChatRoomPage.tsx"), "utf8");
  const panel = readFileSync(path.join(directory, "components/FilterPanel.tsx"), "utf8");
  assert.match(page, /listen\("desktop:\/\/config-imported"[\s\S]*?reloadFilters\(\)/);
  assert.match(panel, /saveGuard\.current\.invalidate\(\);[\s\S]*?setShield\(filters\.shield\)/);
  assert.match(panel, /setCareUsers\(filters\.careUsers\)/);
  assert.match(panel, /\}, \[filters\]\)/);
});

test("message and history generation filters keep same-generation reconnect events", () => {
  const current = { sessionGeneration: 7, connectionGeneration: 3 };
  assert.equal(events.matchesGeneration({ payload: current }, current), true);
  assert.equal(events.matchesGeneration({ sessionGeneration: 7 }, current), true);
  assert.equal(events.matchesGeneration({ payload: { ...current, sessionGeneration: 6 } }, current), false);
  assert.equal(events.matchesGeneration({ payload: { ...current, connectionGeneration: 2 } }, current), false);
});

test("batch revoke stops after failure without retrying and ignores synthetic IDs", async () => {
  const calls = [];
  assert.equal(await revokeRepeatChain("80", ["81", "82", "81", "custom:1"], async (id) => {
    calls.push(id);
    return id !== "82";
  }), false);
  assert.deepEqual(calls, ["81", "82"]);
  calls.length = 0;
  assert.equal(await revokeRepeatChain("80", ["81", "81"], async (id) => {
    calls.push(id);
    return true;
  }), true);
  assert.deepEqual(calls, ["81", "80"]);
});

test("revoke permission matches owner and three moderator roles", () => {
  assert.equal(permissions.canRevokeMessage(message("90"), "alice", null), true);
  for (const role of ["OP", "\u7eaa\u5f8b\u59d4\u5458", "\u7ba1\u7406\u5458"]) {
    assert.equal(permissions.canRevokeMessage(message("90"), "bob", role), true);
  }
  assert.equal(permissions.canRevokeMessage(message("90"), "bob", "member"), false);
  assert.equal(permissions.canRevokeMessage(message("custom:1"), "alice", "OP"), false);
  assert.equal(permissions.canRevokeMessage(message("90", { revoked: true }), "alice", "OP"), false);
  assert.equal(permissions.canReplyMessage(message("barrager:1", { kind: "barrager" })), false);
});

test("topic validation, shield regex and CSS color boundaries remain safe", () => {
  assert.equal(view.topicCommand(" "), null);
  assert.equal(view.topicCommand("x".repeat(17)), null);
  assert.equal(view.topicCommand(" topic "), "[setdiscuss]topic[/setdiscuss]");
  assert.equal(view.topicCommand("x".repeat(16)), `[setdiscuss]${"x".repeat(16)}[/setdiscuss]`);
  assert.equal(view.isShielded(message("91"), [{ type: "content", value: "[" }]), false);
  assert.equal(view.isShielded(message("91"), [{ type: "username", value: "alice" }]), true);
  for (const color of ["url(x)", "expression(x)", "#fff; color:red", "var(--x)", "\\red", "/*x*/red"]) {
    assert.equal(view.safeCssColor(color), null);
  }
  assert.equal(view.safeCssColor(" #FFF "), "#fff");
  assert.equal(view.safeCssColor("rgba(1,2,3,0.5)"), "rgba(1,2,3,0.5)");
});

test("music iframe parser accepts only exact trusted paths, songs and albums", () => {
  assert.deepEqual(neteasePlayer("//music.163.com/outchain/player?type=2&amp;id=123&auto=1"), {
    src: "https://music.163.com/outchain/player?type=2&id=123&auto=0&height=66", songId: "123", height: 86,
  });
  assert.equal(neteasePlayer("https://music.163.com/outchain/player?type=1&id=456").songId, null);
  for (const url of [
    "javascript:alert(1)", "https://music.163.com.evil/outchain/player?type=2&id=123",
    "https://u@music.163.com/outchain/player?type=2&id=123",
    "https://music.163.com:444/outchain/player?type=2&id=123",
    "https://music.163.com/x/outchain/player?type=2&id=123",
    "/outchain/player?type=2&id=123", "https://music.163.com/outchain/player?type=3&id=123",
    "https://music.163.com/outchain/player?type=2&id=x",
  ]) assert.equal(neteasePlayer(url), null, url);
});

test("default emoji and original via source links remain available", () => {
  assert.match(emoji.expandEmojiShortcodes(":smile:"), /^!\[smile\]\(https:\/\//);
  assert.equal(emoji.expandEmojiShortcodes(":not_a_known_emoji:"), ":not_a_known_emoji:");
  assert.equal(viaDetails("Windows", "1.2").url, "https://github.com/imlinhanchao/fishpi-desktop/releases");
  assert.equal(viaDetails("Web").url, undefined);
});

test("cloud favorites text preserves order and uses original newline export rather than group JSON", () => {
  const first = "https://example.com/a.png";
  const second = "http://example.com/b?a=1&b=2";
  assert.deepEqual(cloud.parseCloudEmojiText(`${first}\r\n${second}\n${first}`), [first, second]);
  assert.equal(cloud.serializeCloudEmojiText([first, second]), `${first}\n${second}`);
  assert.equal(cloud.serializeCloudEmojiText([]), "");
  assert.deepEqual(cloud.parseCloudEmojiText(""), []);
  assert.deepEqual(cloud.parseCloudEmojiText('[{"url":"https://example.com/a.png"}]'), []);
  assert.throws(() => cloud.parseCloudEmojiText("x".repeat(cloud.CLOUD_EMOJI_MAX_FILE_BYTES + 1)));
});

test("cloud image URLs reject relative, credentialed and executable sources without normalizing old strings", () => {
  for (const url of [
    "javascript:alert(1)", "data:image/png,x", "file:///a", "//example.com/a", "/a",
    "https://u:p@example.com/a", "https://example.com/a b", "https://example.com/a>",
  ]) assert.equal(cloud.cloudEmojiUrl(url), null, url);
  assert.equal(cloud.cloudEmojiUrl(" https://example.com/a%2Fb?x=1#y "), "https://example.com/a%2Fb?x=1#y");
});

test("server emoji tab remains distinct from legacy cloud favorites and their import formats", () => {
  const source = readFileSync(path.join(directory, "components/EmojiPanel.tsx"), "utf8");
  assert.match(source, /\["favorites",/);
  assert.match(source, /\["server",/);
  for (const api of ["loadEmojiGroups", "loadEmojiGroupItems", "addEmojiUrl", "removeEmoji"]) {
    assert.ok(source.includes(`${api}(`), api);
  }
  assert.ok(source.includes("<CloudEmojiFavorites"));
  assert.ok(!source.includes("CLOUD_EMOJI_BLOCKER"));
  const favorites = readFileSync(path.join(directory, "components/CloudEmojiFavorites.tsx"), "utf8");
  for (const api of ["refreshCloudEmoji", "appendCloudEmoji", "removeCloudEmoji", "downloadCloudEmojiText"]) {
    assert.ok(favorites.includes(`${api}(`), api);
  }
  assert.match(favorites, /accept="\.txt,text\/plain"/);
  assert.match(favorites, /isOutcomeUnknown\(err\)[\s\S]*?unknownRef\.current = true/);
  assert.match(favorites, /unknown \|\| snapshot == null/);
  assert.match(favorites, /ContextMenuItem[\s\S]*removeCloudEmoji\(current, raw\)/);
});

test("music menu force-enqueues while cover clicks preserve ordinary mode behavior", () => {
  const playlist = load("../music/playlist");
  const calls = [];
  assert.equal(playlist.enqueueNeteaseSong("123"), false);
  playlist.bindPlaylist((id, forceAdd) => calls.push({ id, forceAdd }));
  assert.equal(playlist.enqueueNeteaseSong("123"), true);
  assert.equal(playlist.playNeteaseSong("456"), true);
  assert.deepEqual(calls, [{ id: "123", forceAdd: true }, { id: "456", forceAdd: false }]);
  playlist.bindPlaylist(null);
  const menu = readFileSync(path.join(directory, "components/MessageItem.tsx"), "utf8");
  assert.match(menu, /enqueueNeteaseSong\(musicSongId\)/);
  assert.doesNotMatch(menu, /playNeteaseSong\(/);
  for (const name of ["MusicCard.tsx", "ChatHtmlView.tsx"]) {
    const source = readFileSync(path.join(directory, "components", name), "utf8");
    assert.match(source, /playNeteaseSong\(/);
    assert.doesNotMatch(source, /enqueueNeteaseSong\(/);
  }
});

test("cloud IPC never accepts tokens or arbitrary endpoints and pins writes to the loaded generation", () => {
  const api = readFileSync(path.join(directory, "chatroomApi.ts"), "utf8");
  const start = api.indexOf("export function loadCloudEmoji");
  const section = api.slice(start, api.indexOf("export function loadEmojiGroups", start));
  assert.doesNotMatch(section, /apiKey|token|endpoint|gameId/);
  assert.match(section, /request: \{ sessionGeneration: snapshot\.sessionGeneration, \.\.\.request \}/);
  assert.match(section, /cloudWrite\(snapshot, "emoji_cloud_append", \{ urls \}\)/);
  assert.match(section, /cloudWrite\(snapshot, "emoji_cloud_remove", \{ url \}\)/);
  const bridge = readFileSync(path.join(project, "src-tauri/src/commands/emoji_cloud.rs"), "utf8");
  assert.match(bridge, /https:\/\/fishpi\.cn\/api\/cloud\/get/);
  assert.match(bridge, /https:\/\/fishpi\.cn\/api\/cloud\/sync/);
  assert.match(bridge, /Policy::none\(\)/);
  assert.match(bridge, /MAX_RESPONSE_BYTES/);
  assert.match(bridge, /response\.chunk\(\)/);
  assert.doesNotMatch(bridge, /println!|dbg!|log::|tracing::|utils::post|utils::get/);
});

test("owned TypeScript modules type-check against shared DTOs without emitting files", () => {
  const config = ts.readConfigFile(path.join(project, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, project);
  const roots = readdirSync(directory, { recursive: true })
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith("RedpacketCard.tsx") && !name.endsWith("redpacketEvents.ts"))
    .map((name) => path.join(directory, name));
  const program = ts.createProgram({
    rootNames: [...roots, path.join(project, "src/vite-env.d.ts")],
    options: parsed.options,
  });
  const normalize = (filename) => path.resolve(filename).replaceAll("\\", "/").toLowerCase();
  const owned = new Set(roots.map(normalize));
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((entry) =>
    !entry.file || owned.has(normalize(entry.file.fileName)),
  );
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => project,
    getNewLine: () => "\n",
  }));
});
