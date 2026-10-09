import assert from "node:assert/strict";
import test from "node:test";
import { createLoader } from "./testLoader.mjs";

test("native context guard lets business menus open before cancelling other regions", () => {
  let listener;
  class Element {
    constructor(menu = false) { this.menu = menu; }
    closest(selector) {
      assert.ok(selector.includes('data-slot="context-menu-trigger"'));
      return this.menu ? this : null;
    }
  }
  const load = createLoader({}, {
    Element,
    window: {
      addEventListener(name, handler, capture) {
        assert.equal(name, "contextmenu");
        assert.equal(capture, true);
        listener = handler;
      },
    },
  });
  const guard = load(new URL("./blockNativeContextMenu.ts", import.meta.url));
  guard.installNativeContextMenuGuard();
  for (const target of [new Element(true), new Element(false), null]) {
    const event = {
      target, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    listener(event);
    const business = target?.menu === true;
    assert.equal(event.defaultPrevented, !business);
    assert.equal(event.stopped, !business);
  }
});
