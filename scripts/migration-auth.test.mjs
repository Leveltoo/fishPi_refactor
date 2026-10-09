import assert from "node:assert/strict";
import test from "node:test";
import { createLoader, flush, hookMocks } from "../src/features/shell/testLoader.mjs";

test("login imports restore only a saved credential and never pass an old password", async () => {
  for (const credentialSaved of [false, true]) {
    const hooks = hookMocks();
    let restored = 0;
    let imports = 0;
    const load = createLoader({
      react: { ...hooks.react, useId: () => "login" },
      "react/jsx-runtime": hooks.jsx,
      "lucide-react": Object.fromEntries(["Eye", "EyeOff", "Import", "Lock", "Shield", "User"].map((key) => [key, key])),
      "@tauri-apps/plugin-opener": { openUrl: async () => {} },
      "@/components/ui/alert": { Alert: "Alert", AlertDescription: "AlertDescription" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input-group": Object.fromEntries(
        ["InputGroup", "InputGroupAddon", "InputGroupButton", "InputGroupInput"].map((key) => [key, key]),
      ),
      "@/components/ui/spinner": { Spinner: "Spinner" },
      "../shell/TitleBar": { TitleBar: "TitleBar" },
      "../shell/FishMark": { FishMark: "FishMark" },
      "../../lib/tauri": { invokeAuthLogin: () => { throw new Error("Import must not log in with a password"); } },
      "@/features/desktop/api": {
        desktopPrefsGet: async () => ({ loginUsername: "alice" }),
        desktopPrefsSet: async () => ({}),
        commandError: () => "error",
        configImport: async (...args) => {
          assert.equal(args.length, 0);
          imports++;
          return { credentialSaved, found: true, message: "imported" };
        },
      },
    });
    const { LoginPage } = load(new URL("../src/features/auth/LoginPage.tsx", import.meta.url));
    const tree = LoginPage({ onLoggedIn: () => {}, onRestoreSession: () => restored++ });
    const nodes = [];
    function collect(value) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") {
        nodes.push(value);
        collect(value.props?.children);
      }
    }
    collect(tree);
    const button = nodes.find((node) => node.type === "Button" &&
      JSON.stringify(node.props.children).includes("\u5bfc\u5165\u65e7\u914d\u7f6e"));
    assert.ok(button);
    button.props.onClick();
    await flush();
    assert.equal(imports, 1);
    assert.equal(restored, Number(credentialSaved));
  }
});
