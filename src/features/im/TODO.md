# 私聊 feature 缺口

接线核对：`PrivateChatHost` 已挂到 AppShell 侧栏，真正列表 / 历史 / 发送仍必须补 Bridge `chat_*` 命令。

本目录只实现前端宿主 `PrivateChatHost`。`src-tauri` 当前 **没有** 私聊 / 通知 / 未读 / 搜人 / 签到命令，也没有对应事件转发。UI 已按约定封装 invoke / listen；命令未注册时抛 `BridgeGapError`，**不会伪装发送成功**。

## 已接（现有 Bridge）

| 能力 | 说明 |
|---|---|
| `auth_me` | 读取当前用户，用于会话列表区分对端 |

## 缺失：私聊 command（P1 必须）

建议命名与入参（camelCase，单 DTO 叫 `request` / `query`）已写在 `types.ts` / `api.ts`，便于 Rust 侧对齐：

| command | SDK | 说明 |
|---|---|---|
| `chat_list` | `chat().list()` | 会话列表（每会话最新一条） |
| `chat_unread` | `chat().unread()` | 未读私聊 |
| `chat_history` | `chat().history(user, page, size, autoread)` | 历史；建议 `autoread` 由前端另调 mark-read |
| `chat_send` | 指定用户连接上的 `ChatConnection::send`，或等价 HTTP | 返回 `accepted` / `outcomeUnknown`，**不带消息 ID**，不自动重试 |
| `chat_mark_read` | `chat().mark_as_read(user)` | 打开会话后同步已读 |
| `chat_connect` | `chat().connect(Some(user))` 或 `connect(None)` | **按用户一条连接**；`userName` 缺省 = 全局通知频道（user-channel） |
| `chat_disconnect` | 断开对应连接 | 换会话 / 退出时调用；退出须断开全部私聊连接 |
| `chat_revoke` | `chat().revoke(id)` | UI 未做撤回按钮，事件到达会标记已撤回 |

DTO 建议：消息 ID 用 string；带 `sessionGeneration`（连接类另带 `connectionGeneration`）；字段 camelCase。历史与实时同一 `PrivateMessageDto`。

## 缺失：搜人

| command | SDK | 现状 |
|---|---|---|
| `user_search` | `user().names(query)` | Command 面板可打开；无 API 时 **本地过滤已有会话**，并允许按用户名占位开始（不校验用户是否存在） |

开始新会话不会伪造发送成功。

## 缺失：实时事件

计划要求：全局通知频道与指定用户会话连接分开，不假设一条 WS 覆盖全部私聊。

| event | 用途 |
|---|---|
| `chat://msg` | 当前会话追加消息；非当前会话未读 + sonner |
| `chat://notice` | `chatUnreadCountRefresh` 刷新未读；`newIdleChatMessage` 未读 + sonner |
| `chat://revoke` | 按 ID 标记撤回 |
| `notice://refresh` | 再拉未读计数 |
| `notice://broadcast` | 应用内 sonner（不是 OS 通知） |

前端在 connect 前会 `listen`。Rust 返回 connect 前应注册完监听，并做会话代次隔离。

## 签到 / 昨日奖励 / 活跃度（P1，但不改 shell / App）

计划写在 P1。最小 toast 可以挂在本 feature，但 **没有 invoke**，也不能改 `App.tsx` / shell 做入口。

待 Bridge 提供后再接，建议：

- `user_liveness` ← `user().liveness()`，至少间隔 10 分钟
- `user_is_checkin` ← `user().is_checkin()`
- `user_is_collected_liveness` / `user_reward_liveness` ← 昨日奖励

写操作不自动重试；超时走 `outcome_unknown`。轮询须在退出时取消。

## 不要在本 feature 做

- **OS 托盘 / 系统通知**：属 P2，且必须改 `src-tauri` 与权限，前端做不了。
- **P2 设置页**。
- 改 `App.tsx`、shell、chatroom、redpacket、`components/ui`、`package.json`。

## 发送语义（已按计划实现）

- 不本地 echo 冒充已发送气泡。
- `accepted` 只表示请求已接受。
- `outcomeUnknown` 提示「结果待确认」，不清空输入，不自动补发。
- 命令缺失：toast 说明未接入，草稿保留。
