# 桌面模块迁移核对

核对日期：2026-10-09。旧项目 `D:/project-workspace/fishp-refactor/fishpi-desktop`；新项目 `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri`。
直接共享编辑，无 worktree、无 Git commit、无新增依赖。本文的“已核对”表示源码与小测试核对，不等于真实 Windows 验收。

## 模块清单

- [x] 桌面壳：原导航事件、独立 Blocks 扩展入口、标题栏拖动、置顶/透明、主窗隐藏联动名片、默认关闭退出、老板键。
- [x] 设置：旧默认值、共享设置同步、串行写入、失败回读、配置导入事件同步（含 filters）、音乐模式同步、通知类别/方式开关。
- [x] 通知/活跃：真实分类和安全目标链接、已删除/自己消息过滤、列表与已读操作竞态、奖励结果与签到边界。
- [x] 音乐：点击顺序、旧 0/1/2 策略与文案、右键强制入队共享契约、去重、两种删除行为、清空废止迟到结果、静音和单曲循环。
- [x] 看图/@：复用现有 overlay 与补全入口，修正图片适配、鼠标锚点缩放、复位、失败提示；补全只拦截无修饰键 Enter，保留 IME 防护；不重做主题。
- [x] 名片：单例窗口创建等待/错误处理、重复打开刷新身份、主窗私聊/专属红包/退出请求、长内容滚动。
- [x] DesktopMount：reconnect 同会话过滤、私聊外层代次透传、全局 user-channel peer 推导、两路撤回落盘接线、导入后设置/音乐同步。
- [ ] 原生 Windows 验收：托盘、老板键、显隐/关闭、透明度、通知实际投递、音频与休眠/网络恢复。
- [ ] Rust 全量编译/测试：按分工由主 agent 统一执行，本模块未运行 Cargo。

## 旧版依据

- `D:/project-workspace/fishp-refactor/fishpi-desktop/src/main/windows/main.js`、`card.js`、`img.js`、`autocomplete.js`。
- `D:/project-workspace/fishp-refactor/fishpi-desktop/src/main/block/tray.js`、`update.js` 与 `src/main/lib/hotkeys.js`。
- `D:/project-workspace/fishp-refactor/fishpi-desktop/src/renderer/setting.js`、`notice.js`。
- `D:/project-workspace/fishp-refactor/fishpi-desktop/src/renderer/view/setting.vue`、`home.vue`、`card.vue`、`img.vue`。
- `D:/project-workspace/fishp-refactor/fishpi-desktop/src/renderer/components/liveness.vue`、`player.vue`、`music.vue`。
- 发布 SDK 源码：`C:/Users/Admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fishpi-sdk-1.1.1/src`。

## 行为与差异

### 桌面壳及窗口

- 复用已有聊天室/私聊/设置/红包事件，不增加中心注册。应用内通知“查看”可以切页并跳消息；启动更新提示可以跳设置。
- 扩展恢复为独立侧栏入口，使用既有 Lucide Blocks 与 `MainPage="extension"`，独立标题和页面；`ExtensionMount` 只常驻挂载一次，不在设置中重复挂载，不修改扩展模块或其安全策略。
- 主窗隐藏先隐藏名片；老板键隐藏主窗时也隐藏名片。主窗重新聚焦隐藏名片并重置托盘闪烁。
- 默认 `closeToTray=false`，关闭主窗退出整个应用，避免名片子窗维持后台进程。启用关闭到托盘则保留会话；退出仍走托盘。
- 原生置顶/透明操作失败保留开关并提示，不显示假成功；左键标题栏空白启动原生拖动，按钮/输入不参与。
- 托盘左键/菜单显示主窗、取消最小化、聚焦及退出复用已有 Rust 实现，本轮不改中心生命周期。

### 设置

- 恢复透明度默认 60%，透明开关默认关；老板键默认 `Win+F2`；关闭到托盘与所有通知/自动奖励类别默认关。
- 前后端都补齐部分配置默认值与非有限透明度防御；普通设置不含 token/apiKey/password/mfa。
- 设置宿主订阅共享快照，局部修改合并最新快照；`settings_set` 串行写入。失败回读已保存值，只在没有更新编辑时回滚。
- Rust 热键注册失败保留旧键；设置落盘失败恢复内存配置并尝试恢复旧热键。尚需主 agent 的真实平台与 Cargo 验证。
- `ImportResult.filtersSaved:boolean` 与父级 DTO 对齐。监听 `desktop://config-imported`，按 `settingsSaved/prefsSaved/filtersSaved` 重读共享设置、桌面偏好（含音乐模式）及设置页屏蔽/特别关心；未成功保存的部分不强行刷新。事件只传状态，不复制旧配置或凭据。
- 导入重读前清理透明度/设置/filter 待执行防抖，重读期间不提交旧快照；用读取代次拒绝迟到的初始读取、保存回包与用户名查询。卸载时清监听和 timer。已派发后端写入及已有写队列不能由前端撤回，不宣称事件同步能取消这些写入；本轮未修改 `config_import.rs` 或扩大凭据读取权限。
- 未新增主题，未覆盖当前皮肤或全局样式。旧 theme ID 仍走既有映射，不宣称已重建旧 CSS。

### 通知及活跃

- `ChatMessageEvent` 只用标准字符串 `id`，修复 `useMessageNotices.ts` 的两处 `oId` TS2339。
- 聊天室普通消息只走声音/托盘；关键词、红包、闲置私聊、@、回复/评论、系统公告按类别与方式开关处理。
- 通知列表按类别首次成功建立静默基线，随后只处理新的未读项；各类别独立失败不阻断其他类别；删除项和自己提及不弹。
- 通知 DTO 保留 `url/dataId/dataType/deleted`。聊天室 @ 的 `dataType=38` 跳 `dataId`；外部目标仅允许无凭据的 `https://fishpi.cn` 默认 HTTPS 端口。
- 活动列表丢弃旧请求结果；切换类别后已读操作不能把新类别标成已读。紧急公告仍用可关闭文本模态。
- 非数值活跃响应报错，不伪造 0%。昨日奖励 >0 才提示领取成功，0 表示无奖励，负数表示已领过；完成后回查每日状态。写入不自动重试。
- SDK 1.1.1 无签到写 API，`user_checkin` 返回明确业务错误；`is_checkin` 只是查询，不伪装签到成功。

### 音乐

- 请求按点击顺序串行解析，避免不同网络耗时逆序插入；清空/卸载推进 generation，迟到解析不会恢复已关闭列表。
- 旧模式 0 替换；1 去重追加且保持当前索引；2 去重追加后选择列表最后一项，即使重复点击也如此。沿用旧 1/2 文案与实际行为的错位，不擅自纠正。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/music/index.ts` 导出 `enqueueNeteaseSong(id)`，也支持 `playNeteaseSong(id, true)`。对应旧 `chatroom-item.vue` 右键调用 `playMusic(id, true)`：始终去重追加并保持当前曲/索引，即使普通点击模式为 0 或 2；不改全局播放偏好。空列表加入首曲，未挂载返回 false，沿用同一串行解析队列及清空代次。普通 `playNeteaseSong(id)` 策略不变。
- 已通知 Russell 接入 `MessageItem` 的右键“加入播放列表”；本模块只提供共享契约，不修改聊天室组件，最终菜单接线由聊天室 agent 完成。
- 旧“移出当前曲”先删除再推进索引；按 ID 删除保留数值索引，超界回 0。两种行为分别测试。
- 绑定新 audio 时恢复静音；单曲结束从 0 重播，多曲结束前进；播放失败显示错误。只播放，不下载音乐。

### 看图、名片和补全

- 图片使用容器宽高的最小比例完整适配；保留滚轮锚点缩放、拖动、Esc、右键复制和浏览器打开。增加适合窗口复位、加载/复制/打开错误提示。
- 看图仍是现有主窗 Dialog，未重建旧独立图片窗；这属于剩余窗口形态差异，不是 SDK 阻塞。
- @ 补全继续复用现有 `MentionList/mention` 与消息输入入口。共享 `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/overlay/MentionList.tsx` 仅在 Ctrl/Meta/Alt/Shift 全部未按下的 Enter 才选择用户；组合 Enter 不 preventDefault/stopPropagation，交父输入原有发送/换行逻辑。保留 `isComposing` 与 `keyCode=229` 防护及方向键/Esc。本轮未扩大任意本地文件/图片访问能力。
- 名片等待真实 `tauri://created`，不是等待监听注册完成；创建错误或超时释放并发锁。复用窗口重新读取用户资料和当前身份。
- 名片动作定向 `emitTo("main", ...)`，不在子窗直接清凭据。主壳把私聊/红包事件转为已有本地事件；logout 仍由现有登录门接收。
- SDK UserInfo 无 MBTI，但主线程已补固定资料读取并提取真实公开字段，详见 user-profile.md；没有伪造或推断值。名片多屏/高 DPI 定位仍需原生验收。

### 重连和缓存

- `ReconnectReport.sessionGeneration:number` 与父级 Rust report 对齐。缺失、非整数、非正值、旧代次/换号事件均不更新本组件。
- 手动结果与事件使用相同校验；原样展示各通道文案，“部分私聊通道已重新连接”不提升为全部连接成功。
- `chatroom://msg` 和 `chat://msg` 均把外层 `event.payload.sessionGeneration` 原样传入 `mergeOffline`，不使用嵌套消息代次。
- 全局私聊事件可能没有外层 `userName`：直接复用 `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/im/threadState.ts` 的 `messagePeer`，结合挂载会话 `user.userName` 与消息 `userName/receiverUserName` 推 peer。没有可靠 peer 不写；写入前后复核同代会话。
- `chatroom://revoke` 与 `chat://revoke` 统一调用父级 `revokeOffline({messageId, sessionGeneration})`；不要求 peer，支持后台全局撤回。写入及 `setOffline` 都复核同会话；旧/缺失代次、空 ID 不写，换号后的迟到回包不覆盖新账号。父级 Rust 按当前账号所有 bucket 删除正文并保存有界 tombstone，防止先撤回后消息到达复活；本模块未编辑存储实现。
- 真实 SDK reconnect、连接保留与 Windows schedule 为主 agent 修改；本模块不改 auth/state/realtime/reconnect/offline 存储实现。
- 下载成功但 `installed=false` 正常显示已下载；不自动安装、运行文件、执行旧更新脚本或打开下载文件。

## 持久小测试

所有测试使用 Node 内置 `node:test/assert` 和已安装 TypeScript，零新增依赖。native IPC 和 React hook 生命周期为显式小 mock；不代替真实 Tauri。

- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/shell/desktop.test.mjs`：事件代次校验、全局入站/出站 peer、外层 generation、两种无 peer 撤回接线/同代更新/换号迟到拒绝、卸载清理、安全导航、窗口失败。手动 reconnect 共用已测试的校验函数。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/shell/navigation.test.mjs`：实际 AppShell 渲染树中的 Blocks 入口可点击、扩展页面切换、单一常驻宿主、设置页不重复挂载。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/settings/settings.test.mjs`：默认/规范化、快照同步、串行写入、失败回读与不覆盖更新编辑、正则防御。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/settings/configImport.test.mjs`：实际导入事件监听、状态标志分流、偏好/共享设置/filter 重读、初始读取迟到拒绝、取消防抖、旧保存结果及用户名查询拒绝、卸载清理。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/activity/activity.test.mjs`：真实数值/奖励/未知签到、标准长字符串 ID、通知类别/删除/自发过滤、安全目标与列表/已读竞态。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/music/music.test.mjs`：旧策略/去重/删除、公开强制入队 API 在三种模式下保持当前曲/去重/不改偏好/空列表/卸载行为、解析顺序/强制入队清空代次、audio 静音/单曲循环。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/overlay/overlay.test.mjs`：宽高适配、无效尺寸、锚点缩放与下界；实际 MentionList 捕获监听、无修饰键 Enter、15 种修饰键 Enter 组合透传、IME 两种防护、Esc 与卸载清理。
- `D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/usercard/usercard.test.mjs`：真实创建事件等待、并发重复打开、创建错误清理。
- 公共测试加载器：`D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src/features/shell/testLoader.mjs`，不进入应用生产入口。
- Rust 新增/扩充持久测试：`D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src-tauri/src/dto/settings.rs`（默认/非有限值）、`D:/project-workspace/fishp-refactor/fishpi-desktop-refactor-tauri/src-tauri/src/dto/notice.rs`（链接安全）。原老板键与 updater 的已有单测保留。

在新项目根目录执行：

```powershell
node --test src/features/shell/desktop.test.mjs src/features/shell/navigation.test.mjs src/features/settings/settings.test.mjs src/features/settings/configImport.test.mjs src/features/activity/activity.test.mjs src/features/music/music.test.mjs src/features/overlay/overlay.test.mjs src/features/usercard/usercard.test.mjs
pnpm build
```

## 验证记录

- 2026-10-09：最终 19 个桌面测试组全部通过，含原 14 组、配置导入 3 组、强制入队 1 组及补全键盘 1 组。音乐/overlay 的 6 组定向回归也通过；加上父级桥接契约 3 组，本轮完整命令共 22/22 通过。
- 2026-10-09：`pnpm build` 最终通过（包含 tsc 与 Vite production build）；先前独占范围外 RedPacketHost 参数错误已由共享编辑修复，本模块未越界修改。
- 2026-10-09：父级已有 `scripts/bridge-contracts.test.mjs` 的 3 个注册/依赖契约测试通过；本模块未编辑该脚本。独占已跟踪文件 `git diff --check` 通过。
- 构建仍有现有 Vite `__dirname`、bundle 大小及 dpi 重复静态/动态导入警告；不是构建错误，未为此改中心配置或做无关拆包。
- 主 agent 报告浏览器 mock IPC smoke 800x600 / 390x844 通过，截图无明显重叠；这是主 agent 的验证，不是本模块运行真实 Windows。
- 本模块未运行 Cargo，未执行下载/安装，未新增依赖，未提交 Git。

## 中心接线与剩余阻塞

- 不新增 command 或 DTO 中心导出，现有 `settings/notice/user/window/update` 注册继续使用。本模块未改中心注册、Cargo/lock、权限配置或 keyring。
- 父级已新增并注册 `offline_revoke` 与 `offline.ts` helper，本模块两路 listener 已接好，无额外中心导出请求。请全量验收覆盖唯一数字 ID、跨 bucket 清正文、tombstone 持久化及同账号/同代拒绝；这些由父级实现，前端小测试不代替 Rust 存储测试。
- 配置导入继续使用父级 `desktop://config-imported` 与现有 settings/filter/prefs get 命令，无新增中心注册；聊天室自身 filter 同步由父级通知其 agent。本轮音乐/补全共享契约不涉及 `state.rs` 或账号凭据。
- 请中心保留 `ReconnectReport.sessionGeneration`、外层私聊 generation 与 `offline_merge` 同会话拒绝逻辑。IM 当前已过滤 reconnect 代次并接受部分私聊恢复；本模块复用了其 peer helper，没有改 IM。
- 请中心在账号切换时重新挂载整组业务宿主/清空账号缓存；名片子窗身份会在重复打开刷新，但不能自行替代中心凭据失效。
- 请统一 Cargo 验证覆盖 settings/notice DTO、新增 Rust 单测、settings 落盘失败回退和 window-close 生命周期；真实 Windows keyring feature 与 Cargo 由主 agent 维护。
- SDK 1.1.1 没有签到写或连接生命周期 `on_close`；原版也没有签到写。旧 cloud 已由固定 Rust 窄桥补迁，仍需真实验收；不伪造签到或精确断线观测。
- 本地 `C:/Users/Admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-notification-2.4.0/src/desktop.rs` 没有 Windows 通知点击回调；投递异步任务的实际 show 错误未回传、permission_state 返回 Granted。应用内“查看”有真实动作，但不能宣称系统通知投递/权限/点击已验证。恢复原生通知点击需要独立平台实现及中心权限评审。
- 更新器保留新仓库、允许主机/文件大小防御及只下载不执行。发布包签名校验/真实安装不在本轮完成范围；未宣称已安装。
