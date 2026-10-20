import assert from "node:assert/strict";
import test from "node:test";
import { createLoader } from "./testLoader.mjs";

test("the extension rail button opens its single persistent host outside settings", () => {
  const states = [];
  let cursor = 0;
  const empty = () => null;
  const component = new Proxy({}, { get: (_target, name) => name });
  const load = createLoader({
    react: {
      useState: (initial) => {
        const slot = cursor++;
        if (!(slot in states)) states[slot] = initial;
        return [states[slot], (value) => { states[slot] = value; }];
      },
      useEffect: () => {},
      useCallback: (fn) => fn,
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "lucide-react": component,
    "@/components/ui/alert": component,
    "@/components/ui/avatar": component,
    "@/components/ui/button": component,
    "@/components/ui/context-menu": component,
    "@/components/ui/dropdown-menu": component,
    "@/components/ui/separator": component,
    "@/components/ui/tooltip": component,
    "@/features/activity": { ActivityHost: "ActivityHost" },
    "@/features/activity/useWindowLiveness": { useWindowLiveness: empty },
    "@/features/article": { ArticleHost: "ArticleHost" },
    "@/features/breezemoon": { BreezemoonHost: "BreezemoonHost" },
    "@/features/im": { PrivateChatHost: "PrivateChatHost" },
    "@/features/im/unreadBus": { useImUnreadTotal: () => 0 },
    "@/features/overlay": { OverlayHost: "OverlayHost" },
    "@/features/redpacket": { RedPacketHost: "RedPacketHost" },
    "@/features/desktop/mounts": {
      DesktopMount: "DesktopMount", PlaylistMount: "PlaylistMount", ExtensionMount: "ExtensionMount",
    },
    "@/features/settings": { SettingsHost: "SettingsHost" },
    "./FishMark": { FishMark: "FishMark" },
    "@tauri-apps/api/event": {},
    "./navigation": { OPEN_CHATROOM_EVENT: "room" },
    "../usercard/window": {},
    "../redpacket/events": {},
    "./HeaderMusic": { HeaderMusic: "HeaderMusic" },
    "../../lib/nav": {},
    "../../lib/headerTitle": {},
    "./LivenessEdge": { LivenessEdge: "LivenessEdge" },
    "./session-snapshot": { displayName: () => "self", avatarInitial: () => "S" },
    "./useAutoReward": { useAutoReward: empty },
    "./useMessageNotices": { useMessageNotices: () => ({ broadcast: null, dismissBroadcast: empty }) },
    "./useStartupUpdateCheck": { useStartupUpdateCheck: empty },
    "./useNativeNotificationClicks": { useNativeNotificationClicks: empty },
    "./WarnBroadcast": { WarnBroadcastDialog: "WarnBroadcastDialog" },
    "./windowActions": {},
  });
  const { AppShell } = load(new URL("./AppShell.tsx", import.meta.url));
  const render = () => {
    cursor = 0;
    return AppShell({ user: { userName: "self" }, onLogout: empty, children: null });
  };
  function find(node, predicate, matches = []) {
    if (Array.isArray(node)) node.forEach((item) => find(item, predicate, matches));
    else if (node && typeof node === "object") {
      if (predicate(node)) matches.push(node);
      find(node.props?.children, predicate, matches);
    }
    return matches;
  }
  const initial = render();
  const rail = find(initial, (node) => node.props?.label === "扩展")[0];
  assert.ok(rail);
  const button = rail.props.children;
  assert.equal(button.props.children[0].type, "i");
  assert.match(button.props.children[0].props.className, /md-cube/);
  const extensionPage = find(initial, (node) => node.props?.children?.type === "ExtensionMount");
  assert.equal(extensionPage.length, 1);
  assert.equal(extensionPage[0].props.hidden, true);
  button.props.onClick();
  const next = render();
  assert.equal(find(next, (node) => node.props?.children?.type === "ExtensionMount")[0].props.hidden, false);
  const settings = find(next, (node) => node.props?.children?.type === "SettingsHost")[0];
  assert.equal(settings.props.hidden, true);
  assert.equal(find(settings, (node) => node.type === "ExtensionMount").length, 0);
});
