// Requires an existing Vite server and Playwright; does not call any real write API.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.CONTENT_TEST_URL || "http://127.0.0.1:1420";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CONTENT_BROWSER ? { executablePath: process.env.CONTENT_BROWSER } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.route("**/content-selfcheck", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><body><div id="test-root" style="height:100vh"></div></body></html>',
  }));
  await page.goto(`${origin}/content-selfcheck`);
  await page.evaluate(async () => {
    const runtime = (await import("/@react-refresh")).default;
    runtime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (value) => value;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css");
    const callbacks = new Map();
    const events = new Map();
    window.testCalls = [];
    window.testMoonPosted = false;
    window.testEmit = (event, payload) => events.get(event)?.forEach((id) =>
      callbacks.get(id)?.({ payload, event }));
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    let generation = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (callback) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; },
      invoke: async (command, args) => {
        window.testCalls.push(command);
        if (command === "plugin:event|listen") {
          events.set(args.event, [...(events.get(args.event) ?? []), args.handler]);
          return args.handler;
        }
        if (command === "plugin:event|unlisten") {
          events.set(args.event, (events.get(args.event) ?? []).filter((id) => id !== args.eventId));
          return;
        }
        if (command === "auth_me") return { sessionGeneration: 4, user: { userName: "me" } };
        if (command === "article_list") return {
          sessionGeneration: 4, page: args.request.page, hasMore: false,
          articles: Array.from({ length: 32 }, (_, id) => ({
            id: `a${id}`, title: `Post ${id}`, authorUserName: "me", viewCount: id,
          })),
        };
        if (command === "article_detail") return { sessionGeneration: 4, article: {
          id: args.request.id, title: "Detail", authorUserName: "me",
          html: "<p>body</p>", commentable: true, rewarded: false, rewardPoint: 10,
          rewardContent: "SECRET", commentCount: 2, pageCount: 1, commentPage: 1,
          comments: [
            { id: "c1", userName: "me", markdown: "old" },
            { id: "c2", userName: "bob", markdown: "new", replyId: "c1" },
          ],
        }};
        if (command === "article_heat") return { sessionGeneration: 4, count: 2 };
        if (command === "article_heat_watch") return { sessionGeneration: 4, watchGeneration: ++generation };
        if (command === "article_heat_close") return;
        if (command === "comment_post") return { sessionGeneration: 4, accepted: false, outcomeUnknown: true };
        if (command === "breezemoon_list") return {
          sessionGeneration: 4, exhausted: false,
          items: Array.from({ length: 20 }, (_, index) => ({
            id: `m${(args.query.page - 1) * 20 + index}`,
            authorName: "bob", content: `Moon ${(args.query.page - 1) * 20 + index}`,
            timeAgo: "now", city: "Shanghai",
          })).concat(window.testMoonPosted && args.query.page === 1
            ? [{ id: "posted", authorName: "me", content: "Real posted moon" }] : []),
        };
        if (command === "breezemoon_send") {
          window.testMoonPosted = true;
          return { sessionGeneration: 4, accepted: true };
        }
        throw new Error(`Unexpected command ${command}`);
      },
    };
    const { sanitizeContentHtml } = await import("/src/features/article/ContentHtml.tsx");
    const clean = sanitizeContentHtml(
      '<p style="position:fixed" onclick="evil()">ok</p><script>evil()</script>' +
      '<img src="data:image/svg+xml,evil" onerror="evil()">' +
      '<a href="javascript:evil()">bad</a><iframe src="https://evil.test"></iframe>' +
      '<iframe src="//music.163.com/outchain/player?type=2&amp;id=123"></iframe>',
    );
    if (/onclick|onerror|<script|javascript:|data:image|position:fixed|evil.test/.test(clean))
      throw new Error("Unsafe HTML survived");
    if (!clean.includes('sandbox="allow-scripts allow-same-origin"')) throw new Error("Music sandbox missing");
    const { pastedImageSources, imageMarkdown, emojiCompletion } = await import("/src/features/article/commentInput.ts");
    if (pastedImageSources("<video src='https://a.test/v'></video><img src='https://a.test/x'>").length !== 1)
      throw new Error("Only images may be pasted");
    if (imageMarkdown(["javascript:evil()", "file:///x", "https://a.test/x"]).includes("evil"))
      throw new Error("Unsafe paste URL");
    if (!emojiCompletion(":sm", 3)) throw new Error("Emoji completion missing");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    window.testRoot = createRoot(document.getElementById("test-root"));
    window.testReact = React;
    const { ArticleHost } = await import("/src/features/article/ArticleHost.tsx");
    window.testRoot.render(React.createElement(ArticleHost));
  });
  await page.locator(".article-row").first().waitFor();
  await page.locator(".article-scroll [data-slot='scroll-area-viewport']").evaluate((node) => { node.scrollTop = 180; });
  await page.locator(".article-row-open").first().click();
  await page.locator(".article-title").waitFor();
  await page.waitForFunction(() => window.testCalls.includes("article_heat_watch"));
  assert.deepEqual(await page.locator(".article-comments > li").evaluateAll((nodes) => nodes.map((n) => n.id)), ["comment-item-c2", "comment-item-c1"]);
  assert.equal(await page.getByRole("button", { name: /感谢 0/ }).first().isDisabled(), true);
  assert.equal(await page.locator("body").innerText().then((text) => text.includes("SECRET")), false);
  const count = await page.evaluate(() => window.testCalls.filter((c) => c === "article_heat_watch").length);
  await page.evaluate(() => window.testEmit("desktop://reconnect", { sessionGeneration: 99 }));
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.testCalls.filter((c) => c === "article_heat_watch").length), count);
  await page.evaluate(() => window.testEmit("desktop://reconnect", { sessionGeneration: 4 }));
  await page.waitForFunction((count) => window.testCalls.filter((c) => c === "article_heat_watch").length > count, count);
  await page.locator("#article-comment-input").fill("keep draft");
  await page.locator("#article-comment-input").press("Control+Enter");
  await page.waitForFunction(() => document.querySelector("#article-comment-input").disabled);
  assert.equal(await page.locator("#article-comment-input").inputValue(), "keep draft");
  assert.equal(await page.evaluate(() => window.testCalls.filter((c) => c === "comment_post").length), 1);
  if (process.env.CONTENT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.CONTENT_SCREENSHOT_DIR}/article-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CONTENT_SCREENSHOT_DIR}/article-mobile.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.setViewportSize({ width: 1100, height: 760 });
  }
  await page.getByRole("button", { name: "返回列表" }).click();
  await page.waitForFunction(() => window.testCalls.includes("article_heat_close"));
  await page.evaluate(async () => {
    window.testRoot.unmount();
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { BreezemoonHost } = await import("/src/features/breezemoon/BreezemoonHost.tsx");
    window.testRoot = createRoot(document.getElementById("test-root"));
    window.testRoot.render(window.testReact.createElement(BreezemoonHost));
  });
  await page.locator(".bm-item").first().waitFor();
  await page.getByRole("button", { name: "加载更多" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".bm-item").length === 40);
  await page.locator("#breezemoon-input").fill("new moon");
  await page.locator("#breezemoon-input").press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".bm-item").length === 41);
  assert.equal(await page.locator("#breezemoon-input").inputValue(), "");
  assert.equal(await page.evaluate(() => window.testCalls.filter((c) => c === "breezemoon_send").length), 1);
  assert.equal(await page.getByRole("button", { name: "编辑", exact: true }).count(), 0);
  if (process.env.CONTENT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.CONTENT_SCREENSHOT_DIR}/content-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CONTENT_SCREENSHOT_DIR}/content-mobile.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  console.log("content browser selfcheck: HTML/paste security, comment order, own thank, reconnect generations, unknown write draft, cleanup, real moon merge passed");
} finally {
  await browser.close();
}
