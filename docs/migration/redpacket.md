# 红包模块迁移记录

## 功能清单

- [x] 拼手气红包、普通红包、专属红包、心跳红包、猜拳红包。
- [x] 发红包面板：类型、积分、个数、留言、在线收件人头像多选和预选收件人参数。
- [x] 专属红包菜单参数 `user` 锁定收件人；`userName` 只表示当前登录用户。
- [x] 猜拳手势选择、发送时手势校验、领取时手势校验和胜负文案。
- [x] 领取结果详情：红包信息、领取人、头像、金额、最大红包和 0 积分提示。
- [x] 卡片状态：已领完、已领取、实时领取人合并。
- [x] 右键复制红包地址和「再发一个」；猜拳重发保留旧版 `ceil(money / 0.95)` 和随机出手行为。
- [x] 关闭按钮、Esc、关闭行为不伪造领取状态；普通红包恢复旧版打开即请求，不加确认步骤。
- [x] 发包/开包写操作单飞；不确定结果只提示核对，不自动重试。
- [x] 消息 ID 只接受数字字符串，避免 JavaScript number 丢失雪花精度。
- [x] 恢复旧版猜拳图片资源和红包卡视觉结构。

## 根因修复

- 卡片点击只派发打开事件，不再提前 `setClaimed(true)`。只有服务端返回的领取人记录，或聊天室实时 status 合并出的领取人，才会显示当前用户已领取。
- `fishpi:redpacket-resend` 由 `RedPacketHost` 实际监听，直接进入 `redpacket_send`，不再停在无人监听的事件上。
- 开包/发包在 IPC 前后校验登录会话代次；网络超时、响应无法解码、会话切换或结果无法确认均归类为 `outcome_unknown`。
- 发送面板和宿主均有单飞保护；同一笔不确定请求在当前宿主生命周期内禁止再次提交。

## Bridge 契约

### `redpacket_open`

```text
invoke("redpacket_open", {
  request: {
    oId: string,
    gesture?: 0 | 1 | 2,
    expectedSessionGeneration?: number
  }
})
```

返回 `RedPacketInfoDto`：

```text
{
  sessionGeneration: number,
  info: {
    count: number,
    got: number,
    message: string,
    userName: string,
    userAvatarUrl: string,
    gesture?: 0 | 1 | 2
  },
  receivers: string[],
  who: { userId: string, userName: string, avatar: string, userMoney: number, time: string }[]
}
```

### `redpacket_send`

```text
invoke("redpacket_send", {
  request: {
    type: "random" | "average" | "specify" | "heartbeat" | "rockPaperScissors",
    money: number,
    count: number,
    msg: string,
    recivers: string[],
    gesture?: 0 | 1 | 2,
    expectedSessionGeneration?: number
  }
})
```

返回现有 `SendResult`：`accepted` 只表示 SDK 请求被接受，不代表聊天室已经回显；`outcomeUnknown` 不得自动重发。

## 中心接线需求

- `src-tauri/src/lib.rs` 的 `generate_handler!` 必须包含 `redpacket_open` 和 `redpacket_send`。
- `AppShell` 继续挂载 `RedPacketHost`，不需要额外窗口或路由。
- 聊天室卡片派发 `fishpi:redpacket`，detail 至少包含数字字符串 `messageId`；猜拳额外带 `type` 和 `gesture`。
- 聊天室发红包派发 `fishpi:redpacket-send`；专属红包带 `user`，在线列表使用 `users` / `onlineUsers` / `onlineList`。
- 聊天室「再发一个」派发 `fishpi:redpacket-resend`，detail 使用服务端历史拼写 `recivers`。
- 现有 `chatroom://redpacket-status` 继续负责合并领取人和进度；本模块不改 `state/realtime`。
- `ChatMessageDto.redpacket` 需要保留 `type/msg/money/count/got/recivers/who`；不需要改 `dto/message.rs` 或 `shared lib/types.ts`。
- 父级已注册 `redpacket_send`，已有宿主挂载和 menu/online/status 接线，本模块无追加中心接线阻塞。
- `fishpi:redpacket-result` 是经 IPC 核对的开包结果 `{ messageId, sessionGeneration, info, receivers, who }`，由当前卡片/头像行消费；不得用发送者事件中的 `gesture` 冒充领取者选择。

## 验证

- `node --test scripts/migration-redpacket.test.mjs`：10 passed。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm test`：最近一次全量 29 passed，含 10 项红包持久测试和 bridge 注册测试。
- Browser smoke：父级反馈 desktop/mobile 发红包面板已通过，本模块未另跑真钱款浏览器流程。
- Rust 全库由父级统一验证：父级反馈 69 passed + 1 ignored；本模块没有运行 Cargo。此后本模块仅追加写操作后会话变化的 `outcome_unknown` 映射，需要父级最终构建纳入。
- `scripts/bridge-contracts.test.mjs` 已覆盖 command 注册检查；父级已注册 `redpacket_send`。

## 变更路径

- `src/features/redpacket/RedPacketHost.tsx`
- `src/features/redpacket/OpenRedPacketDialog.tsx`
- `src/features/redpacket/SendRedPacketDialog.tsx`
- `src/features/redpacket/api.ts`
- `src/features/redpacket/constants.ts`
- `src/features/redpacket/events.ts`
- `src/features/redpacket/index.ts`
- `src/features/redpacket/parts.tsx`
- `src/features/redpacket/redpacket.css`
- `src/features/redpacket/resultCopy.ts`
- `src/features/redpacket/sendForm.ts`
- `src/features/redpacket/types.ts`
- `src/features/redpacket/README.md`
- `src/features/redpacket/TODO.md`
- `src/features/redpacket/assets/Rock.png`
- `src/features/redpacket/assets/Scissors.png`
- `src/features/redpacket/assets/Paper.png`
- `src/features/chatroom/components/RedpacketCard.tsx`
- `src/features/chatroom/redpacketEvents.ts`
- `src-tauri/src/commands/redpacket.rs`
- `src-tauri/src/dto/redpacket.rs`
- `scripts/migration-redpacket.test.mjs`
- `docs/migration/redpacket.md`

## 验证边界

- 未向生产账户真实发包/领取，服务端余额、类型特有金额规则和访客验证由真实 SDK 返回，不在前端虚构。
- 已按本机 crates.io 发布源码 `fishpi-sdk-1.1.1/src/client/{mod,redpacket,core}.rs` 和 `domain/redpacket.rs` 核对；`RedPacketSend` 使用公共导出 `fishpi_sdk::client::RedPacketSend`，没有改 Cargo 或使用 SDK path。
- 不确定请求保护仅保存在当前宿主内存生命周期中，不写磁盘，也不通过读取红包接口自动重试。收到待确认提示后应先核对聊天室记录，不能靠重启绕过核对。
- 开包详情与卡片即时状态来自真实返回；跨卡片重新挂载后的累计状态仍由现有聊天室历史和 `chatroom://redpacket-status` 保存，未改共享状态层。
- 未新建 worktree、未提交、未安装依赖；复杂资源复制用临时 Python 脚本执行，脚本已自删。
