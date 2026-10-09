# 私聊模块迁移核对

核对日期：2026-10-09。旧项目 `D:/project-workspace/fishp-refactor/fishpi-desktop`；新项目 `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri`。
直接共享编辑，无 worktree、无提交、无新增依赖。以下勾选表示源码实现及对应自检，不代表真实账号、原生窗口或全部旧版行为已经验收。

## 写入范围

- `src/features/im/**`：宿主、列表、线程、输入、正文、API/DTO 映射、代次与合并逻辑、持久小测试。
- `src-tauri/src/commands/chat.rs`：私聊命令行为、分页边界、写入结果与代次校验。
- `src-tauri/src/dto/chat.rs`：保留原始 Markdown 与服务端 HTML、收件人及可选请求代次。
- `docs/migration/im.md`：本核对与交接记录。
- 未编辑旧项目、Cargo/lock、state/realtime/auth/offline_store、shared lib、中心注册或 AppShell。

## 旧版依据

- `fishpi-desktop/src/renderer/view/chats.vue`、`chat.vue`。
- `fishpi-desktop/src/renderer/components/chat-item.vue`、`messagebox.vue`。
- `fishpi-desktop/src/renderer/App.vue`、`notice.js`、`main.js` 及 `view/home.vue` 中相关入口。
- SDK 1.1.1 本地源码：`C:/Users/Admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fishpi-sdk-1.1.1`。

## 迁移 Checklist

- [x] 头像侧栏、开始新私聊、用户名搜索/资料验证、昵称标题、已存在会话原位更新。
- [x] 未读按每条消息累加后再归并对端；双通道消息按 ID 去重，不重复累加。
- [x] 仅当前且可见会话提交已读；成功后清除对应未读，隐藏页面不自动已读。
- [x] 历史每页 25 条，按数字字符串 ID 排序、重叠页去重、向前合并、保留滚动位置。
- [x] SDK 特定“没有更多消息了”响应映射为耗尽，其他错误仍失败；分页请求同步防重入。
- [x] 切换会话串行建连/清理，history/离线 seed 校验生命周期、session 和打开序号。
- [x] 全局出站消息按 `receiverUserName` 找到对端，不以当前会话猜测；无可靠对端不合并。
- [x] 按对端保存草稿；输入组件切换后，旧发送/上传结果不能改动新会话输入。
- [x] Enter 发送、Ctrl/Shift+Enter 换行、IME 不提交；光标处插入 @、表情及图片。
- [x] 复用表情组、短码/@ 补全和真实图片上传；文件/剪贴板图片、HTML 图片粘贴、裸图片 URL。
- [x] HTML 粘贴只解析 `img[src]`，过滤不安全 URL 并去重，不从脚本或任意属性提取资源。
- [x] 输入区拖动/键盘调整高度，沿用 `message-height` 存储。
- [x] 不伪造已发送消息；accepted 只表示接受，不确定结果保留草稿、禁止自动补发/重复提交。
- [x] 不确定发送仅由新的、相同正文的自己消息确认；旧历史、他人消息及不同正文不能确认。
- [x] 自己消息撤回，拒绝重复不确定撤回；先撤回后历史/实时/离线到达不恢复正文。
- [x] 引用原始 Markdown，保留全部行与旧 `https://fishpi.cn/chat#chat{id}` 模板；撤回后清引用。
- [x] 回复跳转逐页寻找原消息；只把精确站内 `/chat#chat{id}` 或本地锚点作为私聊跳转。
- [x] 服务端 HTML 与原始 Markdown 同时保留；HTML 净化展示，Markdown 完整渲染。
- [x] 网易云歌曲/专辑 iframe 保留为真实播放器；精确域名/路径白名单、sandbox、固定响应式尺寸。
- [x] 图片点击复用看图；头像/链接复用用户名片，侧栏保留 3 秒悬停延迟。
- [x] 右键回复、@、自己撤回、短码、添加表情、复制图片/选区/消息/链接、访问主页、专属红包。
- [x] 私聊右键“添加表情”复用旧 Cloud 收藏 `loadCloudEmoji/appendCloudEmoji`，不再写服务器分组；成功/已有/unknown 分别提示，不冒充服务器同步。
- [x] 输入右键复制/粘贴复用剪贴板与上传；删除开发说明文案，不另做产品入口。
- [x] 同代 `desktop://reconnect` 的全部/部分私聊成功均查询列表、未读和当前第一页；不再次触发 reconnect。
- [x] `chat_send` 使用既有 SDK 用户连接；无连接不改走 HTTP。SDK 的已读/撤回 `false` 不算成功。
- [x] 修正线程与输入组件重复 sibling key；持久浏览器测试验证 A→B→A 及反复切换后只有当前线程和输入组件，卸载后无残留。
- [x] `chat.rs` 使用父级 checked send/take 与 live-generation 快照；pending 不报告建连成功，换号返回 superseded。
- [ ] 真账号发送/上传/撤回、长历史跳转、账号切换、断网/休眠恢复、原生名片/剪贴板/通知验收。
- [x] 主线程 Rust 全量编译与新增单测通过，最终结果见迁移总清单。

## 安全与会话策略

- hook 的 `sessionRef` 只在身份初始化时设置，history/seed 的迟到结果绝不重设代次。
- 全部查询结果与事件校验挂载 session；连接请求/清理带可选 `sessionGeneration`、`connectionGeneration`。
- 发送同步防重入，按 peer 保存未确认写入；历史与实时都使用同一确认条件，无自动重试。
- 撤回 ID 在会话内粘滞，合并时清空 `md/text`；被撤回消息不再显示，迟到记录不能复活。
- 本 feature 只读 `loadOffline`；中心 DesktopMount 统一落盘，避免多消费者重复写。
- HTML 使用已安装 DOMPurify，限制标签/属性/URL/CSS。iframe 只允许网易云固定播放器，禁止脚本、事件属性、srcdoc 和任意嵌入。
- 原生通知、声音、托盘设置仍由共享宿主负责，IM 不重复投递通知。
- 收藏动作在 await 前用 ref 防重入，每次点击读取新 Cloud snapshot 并核对当前身份/session；追加请求原样携带 snapshot 代次。写入完成后核对返回 snapshot、当前身份和组件生命周期，同代且包含目标 URL 才报成功。已有 URL 不追加；unknown 只提示打开收藏刷新，不自动重试。面板继续共用 Russell 的默认/收藏/服务器入口，未修改 chatroomApi 或共享组件。

## 持久小测试

文件：`src/features/im/tests/migration-im.test.mjs`。使用已安装 TypeScript `transpileModule`、Node `vm/assert` 与小型 hook/IPC mock，不新增依赖，不改中心 test script。

在新项目根目录执行：

```powershell
node src/features/im/tests/migration-im.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

18 项检查覆盖：逐消息未读、列表原位更新、超长数字 ID/重叠合并、撤回正文清除、全局收件人、严格写入确认、DTO 双正文/代次、旧引用模板、安全回复链接、安全歌曲/专辑 URL、选区插入、迟到 history/seed、同代部分 reconnect 的纯查询、不复活/隐藏不已读、并发及不确定发送，以及真实 MessageBubble 的 Cloud 收藏接线/同步防重入、已收藏不写/旧 snapshot 拒绝、unknown 不重试/卸载或换号迟到成功不提示。

Rust 持久单测位于两个归属文件内：DTO camelCase/可选代次/双正文及收件人、SDK 已读/撤回 false 失败映射、pending 连接不生成成功快照/换号拒绝。尚未执行 Cargo。

持久浏览器回归文件：`src/features/im/tests/browser-selfcheck.mjs`。使用已有 Vite、已安装 Playwright 和 Edge，无新依赖，也不启动 native exe。可设置 `IM_TEST_URL`（默认 `http://localhost:1420`）、`PLAYWRIGHT_MODULE`（已有 Playwright 模块路径）、`IM_BROWSER_CHANNEL=msedge` 或 `IM_BROWSER`（浏览器可执行文件路径），再执行：

```powershell
node src/features/im/tests/browser-selfcheck.mjs
```

脚本直接加载真实 PrivateChatHost/React StrictMode，使用官方 Tauri mockIPC。1000x760/390x844 分别做 A→B→A→B→A，断言线程/输入各只有一份、作者仅属当前会话、各自草稿恢复、25 条历史去重、分页、对端实时消息不混入、当前实时消息只追加一次、iframe sandbox/布局、整窗卸载清理及无 React console error。HMR websocket 在测试中 mock，不对用户应用或真实写 API 发请求。

Cloud 接线 fixture 另提供 `emoji_cloud_get/emoji_cloud_append` 和 `chatroom_emoji_recent_get/remember`，mock 默认图片与共用面板样式。真实右键动作验证请求携带同代 snapshot、不调用 `emoji_add_url`、重复收藏不写、收藏页可插入及 unknown 只提示；不把 mock 当成真实 Cloud 服务验收。

可选 `--duplicate-key-control` 只在 Playwright 的模块响应中恢复旧重复 key，不修改源码；该负对照应失败。可选 `IM_SCREENSHOT_DIR` 输出截图，默认不留临时文件。

## 验证记录

- 2026-10-09：本模块 15 项持久自检通过；主线程反馈同一自检已集成通过。
- 2026-10-09：`tsc --noEmit` 通过；主线程已反馈 whole `pnpm build` 通过。
- 2026-10-09：清理临时文件后再次执行 15 项自检与 `tsc --noEmit` 均通过；归属范围 `git diff --check` 通过，仅有 Git 的 LF/CRLF 提示。
- 2026-10-09：本模块只对两个归属 Rust 文件执行 `rustfmt --edition 2021`，未执行 Cargo/update。
- 2026-10-09：唯一 key 与 checked/live callers 接入后最终复跑，15 项逻辑自检、TypeScript、范围内 diff 检查及两个视口的持久浏览器回归均通过；负对照按预期失败。
- 2026-10-09：Cloud 收藏接线后 18 项持久自检、TypeScript 及 1000x760/390x844 浏览器回归通过，复用已有 1422 Vite；未启动 native exe、未执行整库 build/Cargo，未编辑 Russell 的 API/面板。
- 浏览器基础检查使用实际 PrivateChatHost、StrictMode、官方 Tauri mockIPC、Edge 与确定性图片/播放器 fixture，1000x760 和 375x650 的 HTML/iframe 净化、Markdown、右键 @、草稿切换、发送、图片粘贴上传、不确定回显及溢出检查通过。
- **切换 DOM 残留已修复并回归**：根因为 MessageThread/Composer 同级都使用 `key={peerUserName}`，违反 sibling key 唯一性。最小修复为 `thread:${peerUserName}` / `composer:${peerUserName}`，保留按对端重建与草稿隔离。负对照恢复旧 key 后，第二次切换即失败（两个线程而非一个）并捕获 React 重复 key 警告；修复版两个视口全部断言通过。未用清空 DOM 或隐藏旧节点掩盖问题。
- 主线程另已反馈 800x600/390x844 的 mock smoke 打开会话显示历史通过；这不替代上述切换场景。
- 临时 `.qa.html/.tsx/.mjs/.py`、浏览器启动 Python 脚本与截图已删除；保留持久 `migration-im.test.mjs` 和 `browser-selfcheck.mjs`。
- 实际音乐服务播放、上传服务、原生系统剪贴板和真实通知未验证；fixture 只证明嵌入及事件处理。

## 中心契约与剩余风险

- 无新增中心 command/DTO 导出请求；使用现有私聊入口。请求新增代次字段可选，兼容现有调用。
- reconnect report 必须保留 `sessionGeneration:number`，chat 文案保留“已重新连接”/“部分私聊通道已重新连接”；本 hook 对两者只补拉查询。实际 SDK reconnect/句柄和监听保留由主线程实现。
- offline API 签名无需改变。主线程已加入按账号路径、旧 session 过滤、`offline_revoke` 持久 tombstone 与中心两路撤回监听；本模块没有重复写或修改中心存储。请全量验证跨账号隔离与先撤回后缓存写入。
- **父级原子契约已接入**：`send_user_chat_checked(user, content, expected_session, expected_connection)`、`take_user_chat_checked(user, expected_session, expected_connection)`、`take_global_chat_checked(expected_session, expected_connection)` 替代 check-then-send/take。幂等快照只由 `live_user_chat_generation(user, expected_session)` / `live_global_chat_generation(expected_session)` 构造；含 pending 的 `has_*` 不再用于报告 ready，等待 pending 期间继续检查同代，换号报 superseded。未编辑 state；同锁实现及 Rust 全量验证由父级负责。
- 账号切换需中心重新挂载整组业务宿主并清账号缓存；本 hook 不接管 auth。
- 应用内通知“查看”已有中心导航；原生 Windows 通知点击/投递仍需平台契约，不由 IM 伪造。
- 桌面调试 exe、全量 Cargo 与真实 Windows 验收由主线程负责。IM QA 未启动 native exe，也未终止任何未知来源或用户应用；只关闭本测试创建的浏览器。不以 mock 通过替代原生验收。
