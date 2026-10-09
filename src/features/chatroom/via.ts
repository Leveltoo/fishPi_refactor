import { viaLabel } from "./messageView";

const RELEASES = "https://github.com/imlinhanchao/fishpi-desktop/releases";
const VIEWS: Record<string, { title: string; url?: string }> = {
  Windows: { title: "来自桌面客户端@", url: RELEASES },
  macOS: { title: "来自桌面客户端@", url: RELEASES },
  MacOS: { title: "来自桌面客户端@", url: RELEASES },
  Linux: { title: "来自桌面客户端@", url: RELEASES },
  Chrome: { title: "来自浏览器扩展@", url: "https://chrome.google.com/webstore/detail/fkaomdjjdbglkbcmfhhlioejkpacbbpe" },
  Edge: { title: "来自浏览器扩展@", url: "https://microsoftedge.microsoft.com/addons/detail/oldbilakhdpiamjbkocdcdnlnakainfm" },
  VSCode: { title: "来自 VSCode 扩展@", url: "https://marketplace.visualstudio.com/items?itemName=hancel.pwl-chat" },
  IDEA: { title: "来自 IDEA 扩展@", url: "https://plugins.jetbrains.com/plugin/18091-pwl-chat" },
  Python: { title: "来自 Python 客户端@", url: "https://fishpi.cn/article/1641135630423" },
  Golang: { title: "来自 Golang 客户端@", url: "https://fishpi.cn/article/1641661864119" },
  IceNet: { title: "来自小冰机器人@", url: "https://github.com/HereIsYui/pwl-xiaoice" },
  ElvesOnline: { title: "来自凌机器人@", url: "https://github.com/imufwt/elves2" },
  Dart: { title: "来自 Dart 客户端@", url: "https://github.com/imlinhanchao/fishpi-dart" },
  Web: { title: "来自" },
  iOS: { title: "来自 iPhone 客户端" },
  Android: { title: "来自 Android 客户端" },
  Mobile: { title: "来自" },
  Other: { title: "来自其他客户端: " },
  Extension: { title: "来自扩展程序" },
  PC: { title: "来自桌面客户端" },
};

export function viaDetails(client: string, version?: string): { label: string; title: string; url?: string } {
  const view = VIEWS[client] ?? { title: `来自${client}@` };
  return { label: viaLabel(client), title: `${view.title}${version || "未知"}`, url: view.url };
}
