// Mock-only UI check. Uses installed/bundled Playwright, never a real account.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.CHATROOM_TEST_URL || "http://127.0.0.1:1431";
const project = fileURLToPath(new URL("../../../", import.meta.url));
let server;
let browser;
try {
  if (process.env.CHATROOM_SELF_CHECK_START_SERVER === "1") {
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
      "--port", new URL(origin).port, "--strictPort"], { cwd: project, stdio: "pipe", windowsHide: true });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (server.exitCode != null) throw new Error("Self-check Vite server exited");
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      if (attempt === 99) throw new Error("Self-check Vite server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHATROOM_BROWSER ? { executablePath: process.env.CHATROOM_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.route("https://example.com/**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==", "base64"),
  }));
  await page.route("**/chatroom-cloud-selfcheck", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><body><div id="test-root" style="max-width:340px"></div></body></html>',
  }));
  await page.goto(`${origin}/chatroom-cloud-selfcheck`);
  await page.evaluate(async () => {
    const runtime = (await import("/@react-refresh")).default;
    runtime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (value) => value;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css");
    await import("/src/features/chatroom/chatroom.css");
    window.cloudCalls = [];
    window.cloudMode = "accepted";
    window.cloudUrls = ["https://example.com/one.png", "legacy-unrenderable"];
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        window.cloudCalls.push({ command, args });
        if (command === "chatroom_emoji_recent_get") return [];
        if (command === "chatroom_emoji_recent_remember") return [args.request];
        if (command === "emoji_cloud_get") return { sessionGeneration: 7, urls: [...window.cloudUrls] };
        if (command === "emoji_cloud_append") {
          if (window.cloudMode === "unknown") throw { code: "outcome_unknown", message: "unconfirmed" };
          for (const url of args.request.urls) if (!window.cloudUrls.includes(url)) window.cloudUrls.push(url);
          return { sessionGeneration: 7, urls: [...window.cloudUrls] };
        }
        if (command === "emoji_cloud_remove") {
          if (window.cloudMode === "rejected") throw { code: "business", message: "server rejected save" };
          window.cloudUrls = window.cloudUrls.filter((url) => url !== args.request.url);
          return { sessionGeneration: 7, urls: [...window.cloudUrls] };
        }
        if (command === "emoji_groups") return [{ id: "server", name: "Server group", sort: 0, isDefault: true }];
        if (command === "emoji_group_items") return [{
          id: "server-one", emojiId: "server-one", groupId: "server",
          name: "Server emoji", url: "https://example.com/server.png", sort: 0,
        }];
        throw new Error(`Unexpected IPC ${command}`);
      },
    };
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { EmojiPanel } = await import("/src/features/chatroom/components/EmojiPanel.tsx");
    window.cloudRoot = createRoot(document.getElementById("test-root"));
    window.cloudRoot.render(React.createElement(EmojiPanel, { disabled: false, onInsert: () => {} }));
  });
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const favorites = page.getByRole("tabpanel", { name: "\u6536\u85cf\u8868\u60c5" });
  await tab("\u6536\u85cf").click();
  await favorites.locator("img").waitFor();
  assert.equal(await favorites.locator("img").count(), 1);
  assert.equal(await page.evaluate(() => window.cloudCalls.some((c) => c.command === "emoji_groups")), false);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "\u5bfc\u51fa\u6536\u85cf", exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.txt$/);
  assert.equal(await readFile(await download.path(), "utf8"), "https://example.com/one.png\nlegacy-unrenderable");
  await download.delete();
  await favorites.locator("input[accept='.txt,text/plain']").setInputFiles({
    name: "favorites.txt", mimeType: "text/plain",
    buffer: Buffer.from("https://example.com/two.png\r\nhttps://example.com/two.png\njavascript:evil()"),
  });
  await page.waitForFunction(() => window.cloudUrls.includes("https://example.com/two.png"));
  await page.waitForFunction(() => !document.querySelector('[aria-label="\u5bfc\u5165\u6536\u85cf"]').disabled);
  assert.deepEqual(await page.evaluate(() => window.cloudCalls.find((c) => c.command === "emoji_cloud_append").args.request), {
    sessionGeneration: 7, urls: ["https://example.com/two.png"],
  });
  await page.evaluate(() => { window.cloudMode = "rejected"; });
  await favorites.locator(".chat-emoji-item").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "\u5220\u9664", exact: true }).click();
  await page.waitForFunction(() => window.cloudCalls.some((c) => c.command === "emoji_cloud_remove"));
  assert.equal(await favorites.locator("img").count(), 2);
  await page.evaluate(() => { window.cloudMode = "unknown"; });
  await favorites.locator("input[accept='.txt,text/plain']").setInputFiles({
    name: "unknown.txt", mimeType: "text/plain", buffer: Buffer.from("https://example.com/three.png"),
  });
  await page.waitForFunction(() => document.querySelector('[aria-label="\u5bfc\u5165\u6536\u85cf"]').disabled);
  const writes = await page.evaluate(() => window.cloudCalls.filter((c) => c.command === "emoji_cloud_append").length);
  await page.evaluate(async () => {
    const api = await import("/src/features/chatroom/chatroomApi.ts");
    const snapshot = await api.loadCloudEmoji(); // Same implicit read as the message menu.
    try {
      await api.appendCloudEmoji(snapshot, ["https://example.com/three.png"]);
      throw new Error("Unknown write retried");
    } catch (err) {
      if (err.code !== "outcome_unknown") throw err;
    }
  });
  assert.equal(await page.evaluate(() => window.cloudCalls.filter((c) => c.command === "emoji_cloud_append").length), writes);
  await page.getByRole("button", { name: "\u5237\u65b0\u6536\u85cf", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="\u5bfc\u5165\u6536\u85cf"]').disabled);
  await tab("\u670d\u52a1\u5668").click();
  await page.getByRole("tabpanel", { name: "\u670d\u52a1\u5668\u8868\u60c5" }).getByTitle("Server emoji").waitFor();
  assert.equal(await favorites.count(), 0);
  for (const viewport of [{ width: 800, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await tab("\u6536\u85cf").click();
    await favorites.locator("img").first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot(); // Exercise actual painting without leaving QA output files.
    await tab("\u670d\u52a1\u5668").click();
  }
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.cloudRoot.unmount());
  console.log("chatroom cloud browser selfcheck: distinct tabs, legacy text import/export, rejected save, unknown refresh gate, desktop/mobile passed");
} finally {
  await browser?.close();
  if (server && server.exitCode == null) {
    const closed = once(server, "close");
    server.kill();
    await closed;
  }
}
