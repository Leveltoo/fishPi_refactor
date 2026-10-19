import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, plain } from "../shell/testLoader.mjs";

const load = createLoader({
  "@tauri-apps/plugin-opener": { openUrl: async () => {} },
});

const { noticeTarget, articleDeepLink } = load(
  new URL("./noticeTarget.ts", import.meta.url),
);

const item = (over) => ({
  id: "1",
  type: "reply",
  title: "t",
  content: "c",
  author: "a",
  time: "2026-10-19",
  hasRead: false,
  ...over,
});

test("A1 at + dataType 38 wins over url dispatch", () => {
  const target = noticeTarget(item({
    type: "at",
    dataType: 38,
    dataId: "9000000000000000001",
    url: "https://fishpi.cn/article/abc#comment123",
  }));
  assert.deepEqual(plain(target), { page: "chatroom", messageId: "9000000000000000001" });
});

test("A2/A3 in-site article url becomes an in-app deep link", () => {
  assert.deepEqual(
    plain(noticeTarget(item({ url: "https://fishpi.cn/article/abc123" }))),
    { page: "article", oId: "abc123" },
  );
  assert.deepEqual(
    plain(noticeTarget(item({ url: "https://fishpi.cn/article/abc123#comment456" }))),
    { page: "article", oId: "abc123", commentId: "456" },
  );
});

test("A4 query-style article url is not internalised", () => {
  assert.deepEqual(
    plain(noticeTarget(item({ url: "https://fishpi.cn/article?id=123" }))),
    { page: "external", url: "https://fishpi.cn/article?id=123" },
  );
});

test("B1 other community paths stay external", () => {
  assert.deepEqual(
    plain(noticeTarget(item({ url: "https://fishpi.cn/breezemoon" }))),
    { page: "external", url: "https://fishpi.cn/breezemoon" },
  );
});

test("C1 off-site links are not routed at all (community-only contract)", () => {
  assert.equal(noticeTarget(item({ url: "https://www.bilibili.com/video/x" })), undefined);
});

test("C2 credential-bearing urls are rejected", () => {
  assert.equal(noticeTarget(item({ url: "https://u:p@fishpi.cn/article/abc" })), undefined);
});

test("D1 no url means focus only", () => {
  assert.equal(noticeTarget(item({ type: "sys-announce" })), undefined);
});

test("D2 deleted short-circuits everything", () => {
  assert.equal(
    noticeTarget(item({ deleted: true, url: "https://fishpi.cn/article/abc#comment456" })),
    undefined,
  );
});

test("E1/E2 reply and commented dispatch on url, never on dataId", () => {
  for (const type of ["reply", "commented"]) {
    assert.deepEqual(
      plain(noticeTarget(item({ type, dataId: undefined, dataType: undefined, url: "https://fishpi.cn/article/x9#comment7" }))),
      { page: "article", oId: "x9", commentId: "7" },
    );
  }
});

test("article link states: bounds, non-comment hash, malformed comment hash", () => {
  assert.deepEqual(plain(articleDeepLink("https://fishpi.cn/article/" + "a".repeat(65))), { state: "out" });
  // 非评论锚没有「锚被吃掉」这回事，正常站内打开（PM seq=496 指出的高可达入口）
  assert.deepEqual(plain(articleDeepLink("https://fishpi.cn/article/abc#top")), { state: "in", oId: "abc" });
  assert.deepEqual(plain(articleDeepLink("https://fishpi.cn/article/abc#commentABC")),
    { state: "invalid", oId: "abc" });
  assert.deepEqual(plain(articleDeepLink("https://fishpi.cn/article/abc#comment" + "1".repeat(33))),
    { state: "invalid", oId: "abc" });
  // invalid 必须整体拒绝：既不退化成无锚跳转，也不退化成 external 开浏览器
  assert.equal(noticeTarget(item({ url: "https://fishpi.cn/article/abc#commentABC" })), undefined);
  assert.equal(noticeTarget(item({ url: "https://fishpi.cn/article/abc#top" })).oId, "abc");
});
