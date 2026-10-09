import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const src = fileURLToPath(new URL("../../", import.meta.url));

// Execute the real TS modules with explicit native/UI mocks, without a new runner.
export function createLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  const context = vm.createContext({
    console, URL, URLSearchParams, Event, CustomEvent, setTimeout, clearTimeout,
    ...globals,
  });
  function load(file) {
    const resolved = file instanceof URL ? fileURLToPath(file) : path.resolve(file);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const output = ts.transpileModule(readFileSync(resolved, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const module = { exports: {} };
    cache.set(resolved, module);
    const require = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith(".css")) return {};
      assert.ok(name.startsWith(".") || name.startsWith("@/"), `Unmocked dependency: ${name}`);
      const base = name.startsWith("@/")
        ? path.join(src, name.slice(2))
        : path.resolve(path.dirname(resolved), name);
      const target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
        .find((candidate) => existsSync(candidate));
      assert.ok(target, `Module not found: ${name}`);
      return load(target);
    };
    const execute = vm.runInContext(
      `(function(require, module, exports) { ${output}\n})`, context,
      { filename: resolved },
    );
    execute(require, module, module.exports);
    return module.exports;
  }
  return load;
}

export const plain = (value) => JSON.parse(JSON.stringify(value));
export const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
};

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function hookMocks() {
  const states = [];
  const effects = [];
  const cleanups = [];
  return {
    states,
    react: {
      useState: (initial) => {
        const slot = states.length;
        states.push(typeof initial === "function" ? initial() : initial);
        return [states[slot], (value) => {
          states[slot] = typeof value === "function" ? value(states[slot]) : value;
        }];
      },
      useRef: (current) => ({ current }),
      useCallback: (fn) => fn,
      useEffect: (effect) => { effects.push(effect); },
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
    jsx: {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    start: () => { effects.forEach((effect) => cleanups.push(effect())); },
    stop: () => { cleanups.reverse().forEach((cleanup) => cleanup?.()); },
  };
}
