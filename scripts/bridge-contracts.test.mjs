import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("every business command is registered in the Tauri bridge", () => {
  const handler = read("src-tauri/src/lib.rs").match(/generate_handler!\[([\s\S]*?)\]/)?.[1];
  assert.ok(handler);
  const registered = new Set(handler.match(/\b[a-z][a-z_]+\b/g));
  const commandDir = new URL("src-tauri/src/commands/", root);
  for (const file of readdirSync(commandDir).filter((name) => name.endsWith(".rs"))) {
    const source = readFileSync(new URL(file, commandDir), "utf8");
    const command = /#\[tauri::command(?:\([^\]]*\))?\]\s*pub\s+(?:async\s+)?fn\s+(\w+)/g;
    for (const [, name] of source.matchAll(command)) {
      assert.ok(registered.has(name), `${file}: ${name} is not registered`);
    }
  }
});

test("published SDK and native credential backends remain pinned", () => {
  const cargo = read("src-tauri/Cargo.toml");
  assert.match(cargo, /fishpi-sdk\s*=\s*"=1\.1\.1"/);
  assert.match(cargo, /features\s*=\s*\["windows-native"\]/);
  assert.match(cargo, /features\s*=\s*\["apple-native"\]/);
  assert.match(cargo, /features\s*=\s*\["sync-secret-service",\s*"crypto-rust"\]/);
  assert.doesNotMatch(cargo, /fishpi-sdk\s*=\s*\{[^}]*\bpath\s*=/);
});

test("direct frontend invokes target registered commands", () => {
  const handler = read("src-tauri/src/lib.rs").match(/generate_handler!\[([\s\S]*?)\]/)?.[1];
  const registered = new Set(handler.match(/\b[a-z][a-z_]+\b/g));
  const src = new URL("src/", root);
  for (const file of readdirSync(src, { recursive: true }).filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(join(fileURLToPath(src), file), "utf8");
    for (const [, name] of source.matchAll(/\binvoke(?:<[^;\n]+?>)?\(\s*["']([a-z][a-z_]+)["']/g)) {
      assert.ok(registered.has(name), `${file}: ${name} is not registered`);
    }
  }
});
