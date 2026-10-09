import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);

function loadModules(invoke = async () => { throw new Error("Unexpected IPC"); }) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    }).outputText;
    const require = (id) => {
      if (id === "@tauri-apps/api/core") return { invoke };
      return id.startsWith(".") ? load(resolve(dirname(filename), `${id}.ts`)) : nodeRequire(id);
    };
    new Function("require", "module", "exports", compiled)(require, module, module.exports);
    return module.exports;
  }
  return (name) => load(resolve(root, `src/features/${name}.ts`));
}

const load = loadModules();
const { createSendFormValues, validateSendForm } = load("redpacket/sendForm");
const { parseGesture, parseOpenEvent, parseSendPayload, parseResendEvent } = load("redpacket/events");
const { parseOpenPayload, encodeRedPacketMessage } = load("redpacket/api");
const { openHeadline, resolveSenderGesture, isLuckyKing, maxGotMoney } = load("redpacket/resultCopy");
const { whoFromCardOrStatus, toRedpacketDetail, toRedpacketResendDetail } = load("chatroom/redpacketEvents");
const form = (type = "random", overrides = {}) => ({ ...createSendFormValues(type), ...overrides });
const packet = (overrides = {}) => ({
  sessionGeneration: 7,
  info: { count: 2, got: 1, userName: "alice", message: "test", userAvatarUrl: "" },
  receivers: [],
  who: [{ userId: "9007199254740993", userName: "bob", userMoney: 5, avatar: "", time: "" }],
  ...overrides,
});
const me = { status: "loggedIn", sessionGeneration: 7, user: { userName: "bob" } };
const event = (detail) => ({ detail });
const rpsRequest = validateSendForm(form("rockPaperScissors")).request;

test("redpacket: five types retain legacy defaults, counts and receiver rules", () => {
  for (const type of ["random", "average", "heartbeat"]) {
    const result = validateSendForm(form(type));
    assert.equal(result.ok, true);
    assert.equal(result.request.count, 2);
    assert.equal(result.request.money, 32);
    assert.notEqual(result.request.msg, "");
    assert.deepEqual(result.request.recivers, []);
  }
  assert.equal(validateSendForm(form("specify")).ok, false);
  const specified = validateSendForm(form("specify", { receivers: [" bob ", "bob", "carol"] }));
  assert.deepEqual(specified.request.recivers, ["bob", "carol"]);
  assert.equal(specified.request.count, 2);
  const rps = validateSendForm(form("rockPaperScissors", { money: "32", count: "", gesture: 0 }));
  assert.equal(rps.ok, true);
  assert.equal(rps.request.count, 1);
  assert.equal(rps.request.gesture, 0);
  const encoded = JSON.parse(encodeRedPacketMessage(rps.request)
    .slice("[redpacket]".length, -"[/redpacket]".length));
  assert.equal(encoded.gesture, 0);
  assert.ok(Object.hasOwn(encoded, "recivers"));
  assert.equal(Object.hasOwn(encoded, "receivers"), false);
});

test("redpacket: money and counts reject truncation, overflow and invalid gestures", () => {
  for (const money of ["1.5", "32junk", "NaN", "Infinity", "", "-1", "0", "4294967296"]) {
    assert.equal(validateSendForm(form("random", { money })).ok, false, money);
  }
  for (const count of ["1.5", "2junk", "0", "1001", ""]) {
    assert.equal(validateSendForm(form("heartbeat", { count })).ok, false, count);
  }
  assert.equal(validateSendForm(form("random", { money: "4294967295", count: "1000" })).ok, true);
  assert.equal(validateSendForm(form("specify", {
    receivers: Array.from({ length: 1001 }, (_, i) => `user${i}`),
  })).ok, false);
  assert.equal(validateSendForm(form("rockPaperScissors", { gesture: 1.5 })).ok, false);
  assert.equal(validateSendForm(form("invalid")).ok, false);
});

test("redpacket: event IDs stay strings and userName never locks a receiver", () => {
  assert.equal(parseGesture(0), 0);
  assert.equal(parseGesture("Rock"), 0);
  assert.equal(parseGesture(1.5), undefined);
  assert.equal(parseOpenEvent(event({ oId: 9007199254740992 })), null);
  assert.equal(parseOpenEvent(event({ id: "send" })), null);
  assert.equal(parseOpenEvent(event({ packet: { id: "9007199254740993" }, gesture: "0" })).gesture, 0);
  assert.equal(parseSendPayload({ userName: "bob", type: "specify" }).lockedUser, undefined);
  assert.equal(parseSendPayload({ userName: "bob" }).selfUserName, "bob");
  assert.deepEqual(parseSendPayload({ user: "carol", recivers: ["bob"] }).initialReceivers, ["carol"]);
  assert.deepEqual(parseSendPayload({ recivers: '["bob","carol"]' }).initialReceivers, ["bob", "carol"]);
  const online = parseSendPayload({ users: [
    { userNickname: "nickname-only" }, { userName: "bob" }, { userName: "bob" },
  ] });
  assert.equal(online.onlineUsers.length, 1);
});

test("redpacket: resend validates original parameters and randomly chooses a legal gesture", () => {
  const resend = parseResendEvent(event({ type: "rockPaperScissors", money: 32, count: 10, msg: "", recivers: [] }));
  assert.ok([0, 1, 2].includes(resend.gesture));
  assert.equal(resend.count, 1);
  assert.equal(parseResendEvent(event({ type: "unknown", money: 32, count: 2 })), null);
  assert.equal(parseResendEvent(event({ type: "random", money: "32junk", count: 2 })), null);
  const source = { revoked: false, redpacket: {
    type: "rockPaperScissors", money: 243, count: 1, msg: "again", recivers: [],
  } };
  const restored = toRedpacketResendDetail(source);
  assert.equal(restored.money, Math.ceil(243 / 0.95));
  assert.equal(restored.msg, "again");
  assert.equal(toRedpacketResendDetail({ ...source, revoked: true }), null);
  assert.equal(toRedpacketResendDetail({ redpacket: { ...source.redpacket, money: 0xffff_ffff } }), null);
});

test("redpacket: malformed results never become a successful claim or zero-money record", () => {
  assert.equal(parseOpenPayload({}), null);
  assert.equal(parseOpenPayload({ code: 1, msg: "failed" }), null);
  assert.equal(parseOpenPayload(packet({ who: [{ userName: "bob" }] })), null);
  assert.equal(parseOpenPayload(packet({ sessionGeneration: 0 })), null);
  assert.equal(parseOpenPayload(packet()).who[0].userId, "9007199254740993");
  assert.equal(openHeadline(packet(), "bob"), "5 \u79ef\u5206");
  assert.equal(openHeadline(packet({ receivers: ["carol"] }), "bob"), "\u4f1a\u9519\u610f\u4e86");
  assert.equal(openHeadline(packet({ who: [] }), "bob"), "\u9519\u8fc7\u4e00\u4e2a\u4ebf");
  assert.equal(openHeadline(packet({ who: [{ ...packet().who[0], userMoney: 0 }] }), "bob"), "\u62a2\u4e86\u4e2a\u5bc2\u5bde");
});

test("redpacket: rock-paper-scissors titles and sender gestures respect perspective and gesture zero", () => {
  for (const money of [5, 0, -5]) {
    const data = packet({ info: { ...packet().info, gesture: 0 }, who: [{ ...packet().who[0], userMoney: money }] });
    assert.equal(openHeadline(data, "alice"), money > 0 ? "\u731c\u62f3\u843d\u8d25\uff01" :
      money === 0 ? "\u6253\u6210\u5e73\u624b" : "\u731c\u62f3\u80dc\u5229\uff01");
    assert.equal(openHeadline(data, "bob"), money < 0 ? "\u731c\u62f3\u843d\u8d25\uff01" :
      money === 0 ? "\u6253\u6210\u5e73\u624b" : "\u731c\u62f3\u80dc\u5229\uff01");
    assert.equal(resolveSenderGesture(data, 2, "bob"), 0);
    delete data.info.gesture;
    assert.equal(resolveSenderGesture(data, 0, "bob"), money > 0 ? 1 : money < 0 ? 2 : 0);
    assert.equal(resolveSenderGesture(data, 0, "carol"), undefined);
  }
  assert.equal(openHeadline(packet({ who: [] }), "alice", "rockPaperScissors"), "\u8fd8\u6ca1\u4eba\u731c...");
});

test("redpacket: lucky winner appears only when complete and receiver rows merge without duplicates", () => {
  const lucky = packet({ info: { ...packet().info, got: 2 },
    who: [packet().who[0], { ...packet().who[0], userName: "carol" }] });
  assert.equal(isLuckyKing(lucky.who[0], lucky, maxGotMoney(lucky.who)), true);
  assert.equal(isLuckyKing(lucky.who[1], lucky, maxGotMoney(lucky.who)), false);
  assert.equal(isLuckyKing(packet().who[0], packet(), 5), false);
  assert.deepEqual(whoFromCardOrStatus({ who: [{ userName: "bob", avatar: "" }] },
    [{ userName: "bob", avatar: "b.png" }, { userName: "carol", avatar: "" }]),
    [{ userName: "bob", avatar: "b.png" }, { userName: "carol", avatar: "" }]);
  assert.deepEqual(whoFromCardOrStatus(undefined, [
    { userName: "bob", avatar: "" }, { userName: "bob", avatar: "b.png" },
  ]), [{ userName: "bob", avatar: "b.png" }]);
  assert.equal(toRedpacketDetail({ id: "1", userName: "alice", redpacket: {
    type: "random", count: 2, got: 0, money: 32,
  } }).messageId, "1");
});

test("redpacket: IPC validates before a write and sends the expected session generation", async () => {
  let writes = 0;
  const api = loadModules(async (name, args) => {
    if (name === "auth_me") return me;
    writes++;
    assert.equal(args.request.expectedSessionGeneration, 7);
    return name === "redpacket_open" ? packet() :
      { accepted: true, outcomeUnknown: false, sessionGeneration: 7 };
  })("redpacket/api");
  assert.equal((await api.openRedPacket({ oId: "1", gesture: 0 })).status, "ok");
  assert.equal((await api.sendRedPacket(rpsRequest)).status, "accepted");
  assert.equal(writes, 2);
  assert.equal((await api.openRedPacket({ oId: "invalid" })).status, "error");
  assert.equal((await api.sendRedPacket({ ...rpsRequest, money: 0 })).status, "error");
  assert.equal(writes, 2);
});

test("redpacket: unknown, unavailable and business outcomes never trigger automatic retry", async () => {
  for (const failure of [
    { code: "outcome_unknown", message: "pending" }, "command redpacket_open not found",
    { code: "business", message: "rejected" },
  ]) {
    let writes = 0;
    const api = loadModules(async (name) => {
      if (name === "auth_me") return me;
      writes++;
      throw failure;
    })("redpacket/api");
    const status = typeof failure === "string" ? "unavailable" :
      failure.code === "outcome_unknown" ? "outcome_unknown" : "error";
    assert.equal((await api.openRedPacket({ oId: "1" })).status, status);
    assert.equal((await api.sendRedPacket(rpsRequest)).status, status);
    assert.equal(writes, 2);
  }
});

test("redpacket: malformed responses and a changed account leave the write outcome unknown", async () => {
  const malformed = loadModules(async (name) => name === "auth_me" ? me : {})("redpacket/api");
  assert.equal((await malformed.openRedPacket({ oId: "1" })).status, "outcome_unknown");
  assert.equal((await malformed.sendRedPacket(rpsRequest)).status, "outcome_unknown");
  let reads = 0;
  const changed = loadModules(async (name) => name === "auth_me" ?
    { ...me, sessionGeneration: ++reads === 1 ? 7 : 8 } : packet())("redpacket/api");
  assert.equal((await changed.openRedPacket({ oId: "1" })).status, "outcome_unknown");
});
