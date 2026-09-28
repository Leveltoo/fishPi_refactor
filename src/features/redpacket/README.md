# 红包 overlay

常驻宿主：`RedPacketHost`。无必填 props，自己听 `window` 事件并弹出 dialog。

聊天室不要直接 import 内部文件，从 `src/features/redpacket` 引入：

```ts
import { RedPacketHost } from "../redpacket"
```

## 事件

### 开红包 `fishpi:redpacket`

聊天室点击红包消息时：

```ts
window.dispatchEvent(new CustomEvent("fishpi:redpacket", {
  detail: { oId: message.id, type: "random" },
}))
```

`detail` 至少要有红包 / 消息标识。解析顺序：

1. `oId` / `oid` / `id` / `messageId` / `o_id`
2. 嵌套 `packet`（对象再取上面那些键，或 `packet` 本身是字符串 ID）

不要传数字 ID（雪花会丢精度），不要用 `id: "send"`。

可选字段（有则展示基本信息，没有也能点「领取」）：

| 字段 | 用途 |
|---|---|
| `type` | `random` / `average` / `specify` / `heartbeat` / `rockPaperScissors` |
| `gesture` | 猜拳：`0` 石头 / `1` 剪刀 / `2` 布，或中文/英文名 |
| `userName` / `userAvatarUrl` | 发送者 |
| `msg` / `message` | 留言 |
| `count` / `got` | 进度 |
| `info` | 与 SDK 开包结果同形的预览 |

猜拳且未带 `gesture` 时，先出手再领取。

### 发红包 `fishpi:redpacket-send`

```ts
window.dispatchEvent(new CustomEvent("fishpi:redpacket-send", {
  detail: {
    users: [{ userName, userAvatarUrl }],
  },
}))
```

专属给某人：

```ts
window.dispatchEvent(new CustomEvent("fishpi:redpacket-send", {
  detail: { user: "someone" },
}))
```

| 字段 | 用途 |
|---|---|
| `user` / `userName` | 锁定专属对象，类型不可改 |
| `users` / `onlineUsers` / `onlineList` | 专属红包头像多选；没有则改用手填用户名 |
| `type` | 预选类型 |
| `recivers` / `receivers` | 预选接收人（服务端字段是 `recivers` 这个历史拼写） |

## 不做

P2 名片、看图、独立窗口。状态合并留给聊天室听 `chatroom://redpacket-status`。
