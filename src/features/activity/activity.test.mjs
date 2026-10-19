import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, deferred, flush, hookMocks, plain } from "../shell/testLoader.mjs";

test("activity maps real values and never invents reward or check-in success", async () => {
  let payload;
  let calls = 0;
  const load = createLoader({
    "@tauri-apps/api/core": { invoke: async () => { calls++; return payload; } },
    "@tauri-apps/api/event": {},
  });
  const api = load(new URL("./api.ts", import.meta.url));
  assert.equal(api.mapLiveness(135), 100);
  assert.equal(api.mapLiveness({ liveness: 25 }), 25);
  assert.throws(() => api.mapLiveness({}));
  assert.throws(() => api.mapLiveness(NaN));
  const notice = api.mapNoticeItem({
    id: "999999999999999999", title: "reply", content: "<b>body</b>", dataType: 38,
    dataId: "888888888888888888", deleted: true, commentSharpURL: "/article/a#b",
  }, "at", 0);
  assert.equal(notice.id, "999999999999999999");
  assert.equal(notice.content, "body");
  assert.equal(notice.dataType, 38);
  assert.equal(notice.deleted, true);
  for (const sum of [-1, 0, 15]) {
    payload = { sum };
    const before = calls;
    const result = await api.invokeUserRewardLiveness();
    assert.equal(result.status, "ok");
    assert.equal(result.sum, sum);
    assert.equal(calls - before, 1);
  }
  payload = null;
  assert.equal((await api.invokeUserRewardLiveness()).status, "outcome_unknown");
  assert.equal((await api.invokeUserCheckin()).status, "outcome_unknown");
});

test("notification categories target standard message IDs, suppress self/deleted and validate links", () => {
  const load = createLoader({
    react: {},
    sonner: { toast: { warning: () => {} } },
    "@/features/activity/api": {},
    "@/features/chatroom/chatroomApi": {},
    "@/features/im/api": {},
    "@/lib/tauri": {},
    "@tauri-apps/plugin-opener": {},
    "../chatroom/jumpEvents": {},
    "../../lib/nav": {},
    "@/features/settings/api": {},
    "@/features/settings/noticeSound": {},
  });
  const { DEFAULT_SETTINGS } = load(new URL("../settings/constants.ts", import.meta.url));
  const { chatroomCue, idleCue, noticeCue } = load(new URL("../shell/useMessageNotices.ts", import.meta.url));
  const { noticeTarget } = load(new URL("./noticeTarget.ts", import.meta.url));
  const settings = { ...DEFAULT_SETTINGS, redpackNotice: true, notifyTalk: true,
    notifyTalkPattern: "hello", notifyChatroom: true, notifyChat: true };
  const message = { id: "999999999999999999", kind: "redpacket", userName: "other" };
  assert.deepEqual(plain(chatroomCue(message, "self", settings, new Set()).target),
    { page: "chatroom", messageId: message.id });
  assert.equal(chatroomCue({ ...message, userName: "self" }, "self", settings, new Set()), null);
  assert.equal(chatroomCue({ ...message, revoked: true }, "self", settings, new Set()), null);
  const talk = { ...message, kind: "msg", md: "hello" };
  assert.equal(chatroomCue(talk, "self", settings, new Set()).target.messageId, talk.id);
  assert.equal(chatroomCue({ ...talk, md: "ordinary" }, "self", settings, new Set()).popup, false);
  assert.equal(idleCue("self", "hello", "self", settings), null);
  assert.deepEqual(plain(idleCue("peer", "hello", "self", settings).target),
    { page: "im", userName: "peer" });
  const at = { id: "n", type: "at", dataType: 38, dataId: message.id, title: "mention", content: "hello" };
  assert.equal(noticeTarget(at).messageId, message.id);
  assert.equal(noticeCue("at", { ...at, deleted: true }), null);
  assert.equal(noticeTarget({ ...at, deleted: true }), undefined);
  assert.equal(noticeTarget({ ...at, type: "reply", url: "https://evil.test" }), undefined);
  // FE-02 契约变更：站内文章链接由 external 改为应用内深链
  // （依据 shared/fe-02-notice-target-behavior-points.md v1.4 行 A2/A3，PM 放行）
  assert.deepEqual(plain(noticeTarget({ ...at, type: "reply", url: "/article/a" })),
    { page: "article", oId: "a" });
  assert.deepEqual(plain(noticeTarget({ ...at, type: "commented", url: "/article/a#comment77" })),
    { page: "article", oId: "a", commentId: "77" });
  // 非文章站内路径与查询式文章链接仍走 external（A4/B1 未变）
  assert.deepEqual(plain(noticeTarget({ ...at, type: "reply", url: "/breezemoon" })),
    { page: "external", url: "https://fishpi.cn/breezemoon" });
});

test("switching notice categories discards late lists and marks only the requested category", async () => {
  const hooks = hookMocks();
  const requests = [];
  const marked = deferred();
  const load = createLoader({
    react: hooks.react,
    sonner: { toast: { success: () => {}, error: () => {}, warning: () => {} } },
    "./api": {
      invokeNoticeCount: async () => ({ sessionGeneration: 3 }),
      invokeNoticeList: ({ type }) => {
        const pending = deferred();
        requests.push({ type, pending });
        return pending.promise;
      },
      invokeNoticeMakeRead: async () => marked.promise,
    },
  });
  const activity = load(new URL("./useActivity.ts", import.meta.url)).useActivity();
  activity.selectType("reply");
  activity.selectType("at");
  requests[1].pending.resolve({ sessionGeneration: 3, items: [{ id: "at", hasRead: false }] });
  await flush();
  requests[0].pending.resolve({ sessionGeneration: 3, items: [{ id: "old-reply", hasRead: false }] });
  await flush();
  assert.equal(hooks.states[2][0].id, "at");
  const marking = activity.markTypeRead();
  activity.selectType("reply");
  requests[2].pending.resolve({ sessionGeneration: 3, items: [{ id: "new-reply", hasRead: false }] });
  await flush();
  marked.resolve({ status: "ok", message: "read" });
  await marking;
  await flush();
  assert.equal(hooks.states[2][0].id, "new-reply");
  assert.equal(hooks.states[2][0].hasRead, false);
});
