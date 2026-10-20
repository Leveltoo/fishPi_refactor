// Uses an existing Vite server and an installed Playwright, never real write APIs.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.IM_TEST_URL || "http://localhost:1420";
const duplicateKeyControl = process.argv.includes("--duplicate-key-control");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.IM_BROWSER_CHANNEL ? { channel: process.env.IM_BROWSER_CHANNEL } : {}),
  ...(process.env.IM_BROWSER ? { executablePath: process.env.IM_BROWSER } : {}),
});
try {
  for (const viewport of [{ width: 1000, height: 760 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    // Hot reload is not under test; do not open a real websocket from the mock page.
    await page.routeWebSocket((url) => url.hostname === new URL(origin).hostname &&
      url.port === new URL(origin).port, (socket) => socket.send('{"type":"connected"}'));
    if (duplicateKeyControl) await page.route("**/src/features/im/components/MessagePane.tsx*", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      assert.ok(source.includes("`thread:${peerUserName}`") && source.includes("`composer:${peerUserName}`"));
      await route.fulfill({ response, body: source.replaceAll("`thread:${peerUserName}`", "peerUserName")
        .replaceAll("`composer:${peerUserName}`", "peerUserName") });
    });
    await page.route("**/im-selfcheck", (route) => route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"><div id="test-root" style="height:100vh"></div></body></html>',
    }));
    await page.route("https://music.163.com/**", (route) => route.fulfill({
      contentType: "text/html", body: "<html><body>player fixture</body></html>",
    }));
    await page.route(/https:\/\/(?:images\.test|file\.fishpi\.cn|cdn\.jsdelivr\.net)\//, (route) => route.fulfill({
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64"),
    }));
    await page.goto(`${origin}/im-selfcheck`);
    await page.evaluate(async () => {
      const runtime = (await import("/@react-refresh")).default;
      runtime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (value) => value;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import("/src/index.css");
      await import("/src/features/chatroom/chatroom.css");
      const { mockIPC, mockWindows } = await import("/node_modules/@tauri-apps/api/mocks.js");
      const { emit } = await import("/node_modules/@tauri-apps/api/event.js");
      const React = (await import("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { TooltipProvider } = await import("/src/components/ui/tooltip.tsx");
      const { Toaster } = await import("/src/components/ui/sonner.tsx");
      const { PrivateChatHost } = await import("/src/features/im/PrivateChatHost.tsx");
      const calls = [];
      let favorites = [];
      let recent = [];
      let cloudUnknown = false;
      let nextConnection = 10;
      const message = (peer, id) => ({
        id: String(id), userName: peer, receiverUserName: "self", md: `${peer} history ${id}`,
        userAvatarUrl: "", time: "12:34", revoked: false,
        ...(id === 33 ? { text: '<p><img src="https://images.test/face.png" alt="fixture"></p>' } : {}),
        ...(id === 34 ? { text: '<iframe src="//music.163.com/outchain/player?type=1&amp;id=123"></iframe>' } : {}),
      });
      mockWindows("main");
      mockIPC(async (command, args) => {
        calls.push({ command, args });
        switch (command) {
          case "auth_me": return { sessionGeneration: 7, user: { userName: "self" } };
          case "chat_connect": return { sessionGeneration: 7, connectionGeneration: ++nextConnection };
          case "chat_disconnect": return null;
          case "chat_list": return { sessionGeneration: 7, conversations: ["alice", "carol"].map((peer) => ({
            senderUserName: peer, receiverUserName: "self",
            senderAvatarUrl: "", receiverAvatarUrl: "", unread: 0,
          })) };
          case "chat_unread": return { sessionGeneration: 7, messages: [] };
          case "chat_mark_read": return null;
          case "chat_history": return {
            sessionGeneration: 7, exhausted: args.query.page > 1,
            messages: args.query.page > 1 ? [message(args.query.userName, 1)] :
              Array.from({ length: 25 }, (_, index) => message(args.query.userName, index + 10)).reverse(),
          };
          case "offline_load": return { chats: {}, chatroom: [], failed: [] };
          case "user_profile": return {
            userName: args.request.userName, userNickname: "", userAvatarUrl: "",
          };
          case "emoji_groups": return [];
          case "emoji_cloud_get": return { sessionGeneration: 7, urls: favorites };
          case "emoji_cloud_append":
            if (args.request.sessionGeneration !== 7) throw { code: "session_superseded", message: "" };
            if (cloudUnknown) throw { code: "outcome_unknown", message: "" };
            favorites = [...new Set([...favorites, ...args.request.urls])];
            return { sessionGeneration: 7, urls: favorites };
          case "chatroom_emoji_recent_get": return recent;
          case "chatroom_emoji_recent_remember":
            recent = [args.request, ...recent];
            return recent;
          default: throw new Error(`Unexpected mock command: ${command}`);
        }
      }, { shouldMockEvents: true });
      window.imTest = { calls, emit, React, createRoot, setCloudUnknown: (value) => { cloudUnknown = value; } };
      window.imTest.root = createRoot(document.getElementById("test-root"));
      window.imTest.root.render(React.createElement(React.StrictMode, null,
        React.createElement(TooltipProvider, null,
          React.createElement("div", { className: "shell__page", style: { height: "100vh" } },
            React.createElement(PrivateChatHost)),
          React.createElement(Toaster))));
    });
    await page.getByRole("button", { name: "alice", exact: true }).waitFor();
    await page.getByRole("button", { name: "想和谁聊聊？", exact: true }).click();
    await page.locator(".im-user-form input").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".im-user-form").count(), 0);
    for (const [index, peer] of ["alice", "carol", "alice", "carol", "alice"].entries()) {
      await page.getByRole("button", { name: peer, exact: true }).click();
      await page.waitForFunction((peer) =>
        !document.querySelector("#im-input")?.disabled &&
        document.querySelector(".im-msg") != null, peer);
      assert.equal(await page.locator(".im-thread-stream").count(), 1,
        `${viewport.width}px switch ${index + 1}: only the current thread may remain; ${errors.join("\n")}`);
      assert.equal(await page.locator(".im-composer").count(), 1);
      assert.equal(await page.locator(".im-msg-meta").evaluateAll((nodes) =>
        nodes.every((node) => getComputedStyle(node).display === "none")), true);
      assert.deepEqual([...new Set((await page.locator(".im-msg-content").allTextContents())
        .map((text) => text.split(" history ")[0]).filter(Boolean))], [peer]);
      assert.equal(await page.locator(".im-msg").count(), 25);
      assert.equal(await page.locator("#im-input").inputValue(),
        index > 1 ? `${peer} draft` : "");
      await page.locator("#im-input").fill(`${peer} draft`);
    }
    await page.getByRole("button", { name: "加载更早消息", exact: true })
      .evaluate((button) => button.click());
    await page.waitForFunction(() => document.querySelectorAll(".im-msg").length === 26);
    assert.deepEqual([...new Set((await page.locator(".im-msg-content").allTextContents())
      .map((text) => text.split(" history ")[0]).filter(Boolean))], ["alice"]);
    await page.evaluate(() => window.imTest.emit("chat://msg", {
      sessionGeneration: 7, userName: "carol", connectionGeneration: 999,
      message: { id: "100", userName: "carol", receiverUserName: "self", md: "other peer live", userAvatarUrl: "", time: "", revoked: false },
    }));
    await page.evaluate(() => window.imTest.emit("chat://msg", {
      sessionGeneration: 7, userName: "alice",
      message: { id: "101", userName: "alice", receiverUserName: "self", md: "current peer live", userAvatarUrl: "", time: "", revoked: false },
    }));
    await page.waitForFunction(() => document.querySelectorAll(".im-msg").length === 27);
    assert.equal(await page.locator(".im-msg-meta").evaluateAll((nodes) =>
      nodes.every((node) => getComputedStyle(node).display === "none")), true);
    assert.equal(await page.locator('[data-msg-id="100"]').count(), 0);
    assert.equal(await page.locator('[data-msg-id="101"]').count(), 1);
    assert.equal(await page.locator(".im-thread-stream").count(), 1);
    assert.equal(await page.locator(".im-msg-content iframe").evaluateAll((frames) => frames.every((frame) => {
      const rect = frame.getBoundingClientRect();
      const article = frame.closest("article").getBoundingClientRect();
      return rect.top >= article.top && rect.bottom <= article.bottom + 1 &&
        frame.getAttribute("sandbox") === "allow-scripts allow-same-origin";
    })), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator(".im-composer").evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight + 1), true);
    const image = page.locator('[data-msg-id="33"] .im-msg-content img');
    await image.click({ button: "right" });
    await page.getByRole("menuitem", { name: "添加表情", exact: true }).click();
    await page.getByText("已加入收藏", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.imTest.calls.filter((call) =>
      call.command === "emoji_cloud_append").map((call) => call.args.request)),
    [{ sessionGeneration: 7, urls: ["https://images.test/face.png"] }]);
    assert.equal(await page.evaluate(() => window.imTest.calls.some((call) => call.command === "emoji_add_url")), false);
    await image.click({ button: "right" });
    await page.getByRole("menuitem", { name: "添加表情", exact: true }).click();
    await page.getByText("表情已在收藏中", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.imTest.calls.filter((call) => call.command === "emoji_cloud_append").length), 1);
    await page.getByRole("button", { name: "发表情", exact: true }).click();
    await page.getByRole("tab", { name: "收藏", exact: true }).click();
    await page.getByRole("tabpanel", { name: "收藏表情", exact: true }).getByRole("button", { name: "收藏表情", exact: true }).click();
    assert.ok((await page.locator("#im-input").inputValue()).includes("https://images.test/face.png"));
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.imTest.setCloudUnknown(true));
    await page.evaluate(() => window.imTest.emit("chat://msg", {
      sessionGeneration: 7, userName: "alice",
      message: { id: "102", userName: "alice", receiverUserName: "self", text: '<p><img src="https://images.test/unknown.png"></p>', userAvatarUrl: "", time: "", revoked: false },
    }));
    await page.locator('[data-msg-id="102"] .im-msg-content img').click({ button: "right" });
    await page.getByRole("menuitem", { name: "添加表情", exact: true }).click();
    await page.getByText("结果待确认，请打开收藏刷新查看，勿重复提交。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.imTest.calls.filter((call) => call.command === "emoji_cloud_append").length), 2);
    assert.equal(await page.evaluate(() => window.imTest.calls.some((call) => call.command === "emoji_add_url")), false);
    if (process.env.IM_SCREENSHOT_DIR) await page.screenshot({
      path: path.join(process.env.IM_SCREENSHOT_DIR, `im-switch-${viewport.width}.png`),
    });
    await page.evaluate(() => window.imTest.root.unmount());
    assert.equal(await page.locator(".im-thread-stream, .im-composer").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`ok - ${viewport.width}x${viewport.height} StrictMode switching, drafts, pagination/live, Cloud favorite/panel/unknown and unmount`);
  }
} finally {
  await browser.close();
}
