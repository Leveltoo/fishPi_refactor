import test from "node:test";

test("content migration: votes, paging merge, generations, paid content and write acknowledgements", async () => {
  await import("../src/features/article/selfcheck.mjs");
});
