// Run from the project root: node src/features/article/selfcheck.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
let payload;
let invocations = 0;
const mocks = {
  "@tauri-apps/api/core": {
    invoke: async () => { invocations++; return payload; },
  },
  "../../lib/safeHtml": { looksLikeHtml: (value) => /<\/?[a-z][^>]*>/i.test(value) },
};
const cache = new Map();
function load(file) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved);
  const output = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  cache.set(resolved, module.exports);
  vm.runInNewContext(output, {
    module, exports: module.exports, Error,
    require: (name) => {
      if (mocks[name]) return mocks[name];
      assert.ok(name.startsWith("."), `unexpected dependency: ${name}`);
      return load(path.resolve(path.dirname(resolved), `${name}.ts`));
    },
  }, { filename: resolved });
  return module.exports;
}
const { applyVote, mergeById, acceptsChannel } = load(path.join(here, "contentState.ts"));
const neutral = { id: "c1", vote: "none", goodCount: 2, badCount: 3 };
for (const direction of ["up", "down"]) {
  const selected = applyVote(neutral, direction);
  assert.equal(selected.vote, direction);
  const cancelled = applyVote(selected, direction);
  assert.equal(cancelled.vote, "none");
  assert.equal(cancelled.goodCount, 2);
  assert.equal(cancelled.badCount, 3);
}
const switched = applyVote({ ...neutral, vote: "up" }, "down", true);
assert.equal(switched.goodCount, 1);
assert.equal(switched.badCount, 4);
assert.equal(applyVote({ ...neutral, vote: "down", badCount: 0 }, "down").badCount, 0);
assert.equal(neutral.vote, "none");
const rows = [{ id: "old" }, { id: "older" }];
assert.deepEqual(Array.from(mergeById([{ id: "new" }], rows), (item) => item.id), ["new", "old", "older"]);
assert.deepEqual(Array.from(mergeById(rows, [{ id: "x" }, { id: "x" }, rows[0]]), (item) => item.id), ["old", "older", "x"]);
assert.equal(mergeById(rows, [rows[0]]), rows);
const event = { articleId: "a1", sessionGeneration: 4, watchGeneration: 7 };
assert.ok(acceptsChannel(event, "a1", 4, 7));
assert.ok(!acceptsChannel(event, "other", 4, 7));
assert.ok(!acceptsChannel(event, "a1", 5, 7));
assert.ok(!acceptsChannel(event, "a1", 4, 8));
assert.ok(!acceptsChannel(event, "a1", 4, 0));
const api = load(path.join(here, "api.ts"));
payload = {
  sessionGeneration: 4,
  article: {
    id: "a1", title: "post", html: "<p>body</p>", rewarded: false,
    rewardContent: "SECRET", comments: [{ id: "c1", html: "<p>reply</p>", replyId: "c0" }],
    pageCount: 3, commentPage: 3, commentHasEarlier: true,
  },
};
const detail = await api.invokeArticleDetail({ id: "a1" });
assert.equal(detail.rewardContent, "");
assert.equal(detail.sessionGeneration, 4);
assert.equal(detail.commentPage, 3);
assert.equal(detail.commentHasEarlier, true);
assert.equal(detail.comments[0].replyId, "c0");
assert.equal(detail.comments[0].html, "<p>reply</p>");
payload.article.rewarded = true;
assert.equal((await api.invokeArticleDetail({ id: "a1" })).rewardContent, "SECRET");
payload = { data: { article: { oId: "a1", articleComments: [{ oId: "c2", commentContent: "hello" }] },
  pagination: { paginationPageCount: 2 } } };
assert.equal((await api.invokeArticleDetail({ id: "a1" })).comments[0].id, "c2");
for (const invalid of [null, {}, "ok"]) {
  payload = invalid;
  const ack = await api.invokeCommentPost({ articleId: "a1", commentContent: "x" });
  assert.equal(ack.accepted, false);
  assert.equal(ack.outcomeUnknown, true);
}
payload = { accepted: true, sessionGeneration: 4, rewarded: false, rewardContent: "SECRET" };
assert.equal((await api.invokeArticleReward({ id: "a1" })).rewardContent, "");
payload = { accepted: true, sessionGeneration: 4, outcomeUnknown: true, rewarded: true, rewardContent: "SECRET" };
assert.equal((await api.invokeArticleReward({ id: "a1" })).rewardContent, "");
const before = invocations;
payload = { accepted: true, sessionGeneration: 4 };
assert.equal((await api.invokeCommentPost({ articleId: "a1", commentContent: "x" })).accepted, true);
assert.equal(invocations - before, 1);
const moon = load(path.join(here, "../breezemoon/api.ts"));
payload = null;
assert.equal((await moon.invokeBreezemoonSend({ content: "hello" })).outcomeUnknown, true);
payload = { sessionGeneration: 4, items: [{ id: "m1", content: "<p>moon</p>", created: 123 }], exhausted: false };
const list = await moon.invokeBreezemoonList({ page: 1, size: 20 });
assert.equal(list.items[0].created, "123");
assert.equal(list.items[0].content, "<p>moon</p>");
assert.equal(list.exhausted, false);
console.log("content selfcheck: vote, dedupe, channel generations, DTOs, reward boundary, write acknowledgements passed");
