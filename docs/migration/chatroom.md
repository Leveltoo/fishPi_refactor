# 聊天室迁移核对

核对日期：2026-10-09。依据旧 Electron 的实际源码，不以 README 代替交互验证。旧 cloud 收藏与右键强制入队已补迁，保留协议、安全和真实网络验收边界，不宣称所有旧行为均像素级完成。

## 依据与边界

旧版已逐项读取：

- `fishpi-desktop/src/renderer/view/chatroom.vue`：历史、复读合并、撤回、滚动、话题、在线栏。
- `fishpi-desktop/src/renderer/components/chatroom-item.vue`：展示、菜单权限、引用、复读、红包快捷入口、来源与音乐封面。
- `fishpi-desktop/src/renderer/components/messagebox.vue`：发送、快捷键、光标、图片粘贴、输入高度、弹幕。
- `fishpi-desktop/src/renderer/components/emoji.vue`：默认表情、旧云收藏、上传、删除、导入导出。
- `fishpi-desktop/src/renderer/components/custom-msg.vue`、`via.vue`、`weather-card.vue`、`music-card.vue`、`music.vue`。
- `fishpi-desktop/src/renderer/App.vue`：仅 router-view；真实根行为在 `src/renderer/main.js`，包括 setVia、全局跳转、扩展 hooks；另核对 `view/home.vue` 与主进程 faceImport/faceExport。

接口以 crates.io 发布源码 `C:/Users/Admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fishpi-sdk-1.1.1/src/client/{chatroom,emoji}.rs` 为准。本次不改 Cargo/lock、state/realtime、生命周期或中心注册；不改旧版，不提交，不创建 worktree。红包 agent 拥有的 `RedpacketCard.tsx`、`redpacketEvents.ts` 未编辑。

## 旧功能与本次差异

- **历史与合并**：旧首屏依次读第 1、2 页；锚点 before 25 条，避免重复锚点。新版恢复两页首读与 ID 去重，取消人为 16 次翻页上限；已有 800 条内存安全窗口仍保留并提示重载。连续相同服务端 HTML 合并到最早一条，保留每个复读 ID 和用户；不以不同 Markdown 原文误拆同一显示内容。
- **撤回与 +1**：旧撤回主消息后提升第一条未撤回复读，链全部撤回则移除。新版显示层删除撤回行，窗口内部保留 tombstone，迟到历史不会复活；+1 放回气泡旁，仅最新非红包行存在复读时显示。
- **滚动与未读**：沿用旧 500px 跟随阈值，自己的新消息强制到底。新增历史/尺寸变化时保持可见锚点；未读以新增显示行计数，不把追加复读头像当成新行。复读 ID 的引用跳转定位到所属消息行。
- **消息菜单**：保留 @、私聊、主页、专属红包入口。自己的用户身份菜单不显示；消息菜单仍允许给自己发专属红包。自己的消息或 `纪律委员`/`OP`/`管理员`可撤回；管理员链撤回保留确认，按 ID 顺序执行，失败或未知结果立即停止，没有自动重试。
- **复制与复读**：优先精确 `md`，缺少时只读 `chatroom_raw`；读取失败显示错误，不用显示 HTML 冒充原文。Rust 普通消息 DTO 保留 Markdown 首尾空白。来源有旧 URL 和版本 tooltip；来源图标仍用现有文字表现，未声称像素级复刻。
- **引用**：恢复 `并说：` 前缀的添加/取消；发送时逐行 `>` 引用，使用原消息锚点、回复他人带 @，回复自己不 @。只在服务端 accepted 后清空草稿、引用与所选话题，失败和结果未知保留。
- **话题**：单击直接选择，双击发送旧 `*` 与反引号格式；修改使用 `[setdiscuss]...[/setdiscuss]`，16 字校验并显示旧 16 积分费用。不新增清空话题语义。
- **在线栏**：保留显示/折叠持久化、搜索、头像、用户菜单、双击私聊；小屏收起阈值恢复旧 500px。官方人数只认在线帧字段，不以用户列表长度伪造。
- **输入与图片**：Enter 发送、Ctrl+Enter 在选区插入换行；保留 @、短码补全、默认表情和 `message-height`。仅图片文件上传；粘贴图片 File 优先于同一剪贴板 HTML，避免双插入；HTML 只取 img/src，远程 HTTP(S) 转安全 Markdown，本地 file 读取失败明确提示选择文件。准备发送和上传有在途保护；上传不自动发送。
- **天气/自定义/音乐**：天气保留旧字段和已有图标；custom 居中，HTML 经净化。纯图不加气泡，长内容 >200px 折至 150px。音乐卡片回到共享播放列表，不再创建独立单曲 audio；歌手/封面复用已有 `music_resolve`。普通消息内可信歌曲 iframe 有封面覆盖点击，专辑保持 iframe，不把 album ID 当 song ID。右键“加入播放列表”已接 Kuhn 的 `enqueueNeteaseSong(id)`，强制追加；封面普通点击仍用 `playNeteaseSong(id)`，没有改变播放模式。
- **表情**：默认短码、服务器分组和本机最近记录分别保留；“收藏”独立使用旧 cloud 窄桥，读取、消息图片右键添加、选图上传、右键删除、换行 URL `.txt` 导入导出已恢复。已有“服务器”分组接口、上传、URL 添加、删除、JSON 导入导出仍单独命名，不称为旧 cloud 收藏。读-改-写保留未知旧字符串，不静默过滤后覆盖服务端；只有安全 HTTP(S) 项渲染成图片。写失败不改变 UI 列表；未知结果按会话锁住所有 cloud 写入口，消息菜单的隐式 GET 不能解锁，必须打开收藏或点击“刷新收藏”完成明确的只读刷新，才允许下一次用户写入。刷新若早于新的 unknown 结果开始，不会误清闸门。
- **弹幕**：保留颜色、32 UTF-16 字符限制、真实费用读取、入场动画及复读。SDK 1.1.1 的 `barrager` 用 format 拼 JSON，无法安全转义引号/换行；command 用 serde_json 构造相同 `[barrager]...[/barrager]` 协议，经 SDK `send` 提交一次，不重试、不本地伪造成功行。
- **重连与配置导入**：同会话成功重连只刷新历史，忙时合并等待一次；不再次 reconnect/connect/rebuild。配置导入事件重读 filters，立即卸载旧编辑器；FilterPanel 新 props 同步 shield/careUsers，取消 debounce 并隔离迟到保存、用户名查询结果。

## 安全与真实阻塞

1. **cloud 窄桥真实边界**：SDK 1.1.1 没有 cloud 领域接口，通用 core 请求是 `pub(crate)`，公开 utils 请求又有自动重试。用户已授权使用现有 reqwest + 公开 `FishPi::api_key()`，因此新增 Rust 固定端点窄桥而非停在缺领域 API。只访问两个确证 POST 地址，密钥仅 Rust 请求体使用，不传前端/不日志 URL/无 arbitrary-request IPC。沿用 SDK 当前 proxy 配置、8 秒连接/15 秒请求超时、禁止重定向，响应分块限制 1 MiB，cloud 字符串 512 KiB、4096 项/单项 8192 字节。应用内串行读-改-写，旧服务端没有 CAS，不能消除其他客户端同时保存的覆盖风险。真实账号网络端到端未跑。
2. **在线快照边界已接线**：父级已保存真实 Online/Discuss 帧，并在同代重连/幂等 connect 重播；聊天室不改基础层。重播是真实帧缓存，不是主动网络在线探测。SDK 本身仍无公开用户列表快照 getter，不能把列表长度或空缓存当官方人数。
3. **音乐右键已接线**：旧 `playMusic(id,true)` 与共享 `enqueueNeteaseSong(id)` 对齐；聊天室持久测试验证强制入队参数、封面普通点击保持原模式。未就绪只显示提示，不伪报入队完成。
4. **@ 补全与 Ctrl+Enter**：共享 MentionList 已排除 Ctrl/Meta/Alt/Shift 并保留 IME guard；聊天室普通选区换行已验证。本子任务未改共享组件。
5. **WebView 文件/剪贴板约束**：本地 file HTML 图片能否读取依赖现有 asset 权限，不扩大任意文件访问。图片复制仍沿用共享 helper，权限失败可能退为复制 URL，未承诺所有宿主都能复制位图。
6. **安全差异保留**：不照搬旧 v-html 的执行能力；剥离脚本、事件、srcdoc、任意 style 和应用布局 class，只允许可信网易云 exact `/outchain/player`、type 1/2、数字 ID，无账号/端口，规范为 HTTPS。装饰和操作节点由本地产生。无 SDK 公开 on_open/on_close，运行时连接健康不能靠“暂时没消息”推断。
7. **验证边界**：本子任务未自行运行 Cargo 或全量应用构建，未进行带账号的真实网络端到端测试。父级先前报告全库 pnpm test 55 项通过、Rust 76 项通过/1 项忽略、Native keyring 独立测试通过；这批数字不包含后来新增 cloud 桥。新增 cloud 的 Rust 单测等待父级统一运行，TS/组件 mock 和浏览器测试见下方。

## Cloud 协议证据

- 旧 lockfile 锁定 npm `fishpi@0.0.59`；只读下载 tarball 并按 lockfile integrity 验证，读取 `package/lib/emoji.js`/`utils.js`，未安装依赖或修改旧版。
- `Emoji.get()`：POST `https://fishpi.cn/api/cloud/get`，JSON body `{gameId:"emojis",apiKey}`；读取 `JSON.parse(rsp.data)`，返回 URL 字符串数组。不是 HTTP GET。
- `Emoji.set(urls)`：POST `https://fishpi.cn/api/cloud/sync`，body `{gameId:"emojis",data:JSON.stringify(urls),apiKey}`；旧 JS 直接 return rsp，没有为 `true`/`code` 转换。
- 公开服务端 `FishPiOffical/rhythm` commit `cc0103029e452abfeddacd7dd97c82f41db6bb8b`：`processor/CloudProcessor.java` 的 sync 使用 `renderJSON(StatusCodes.SUCC).renderMsg(...)`，get 使用 `renderJSON(StatusCodes.SUCC).renderData(data)`；`util/StatusCodes.java` 的 SUCC 为 0。`88250/latke` commit `c30b98000a8aafe2d1bc725f46869874bf825122` 的 `http/RequestContext.java` 确认 renderJSON(int) 为 `{code:int}`，renderData 添加 data。
- 因此正确保存形状为 `{code:0,msg:...}`，并不要求 data；`{code:0,data:true}` 也不会误判。明确 `false` 或 `data:false` 拒绝，缺成功码/坏 JSON 为 outcome_unknown，不自动再写。服务端消息不原样透传。
- `service/CloudService.java::getFromCloud` 在无记录或读取异常时返回 `""`；旧 JS 的 JSON.parse("") 会抛错。本迁移根据已确证服务端语义，只接受 `{code:0,data:""}` 为空初始收藏，缺 data/null/坏数组不能变空列表写回。这是修复旧首次收藏失败，不猜缺字段语义；旧协议无法区分“无记录”与服务端读取异常。

## 中心接线契约

- `desktop://reconnect`：

```ts
{
  sessionGeneration: number;
  attempted: boolean;
  relinked: boolean;
  chatroom: string;
  chat: string;
  notice: string;
  message: string;
}
```

hook 仅在 `sessionGeneration` 等于自身当前会话，且 attempted/relinked 为 true、chatroom 为“已重新连接”时刷新。父级保持原连接 generation，发 `chatroom://connection` 的 reconnecting/connected/unknown。已有句柄或重连中时 `chatroom_connect` 幂等返回，重连中是 Connecting，不返回假 Connected。

- 在线快照已由父级保存重播 `chatroom://online {sessionGeneration, connectionGeneration, users, discussing?, onlineCount?}` 和 `chatroom://discuss {sessionGeneration, connectionGeneration, discussing}`。保留服务端人数及合法空话题，缓存重发不等于主动网络探测，真实后续帧覆盖缓存。不再次建 socket 取快照。
- `desktop://config-imported`：import 写入成功后 emit，聊天室不依赖 payload，重读 `chatroom_filters_get`。前端取消未提交 debounce 与迟到 UI 回写；父级负责 backend 串行保存及 import await settings_set，本轮未编辑 `chatroom_filters.rs` 或 config_import。
- 正式共享字段已由父级声明，`messageView` 使用别名，不再做额外扩展 cast：

```ts
type WeatherDayDto = { date: string; maxTemp: string; minTemp: string; code: string };
type WeatherCardDto = { area: string; summary: string; days: WeatherDayDto[] };
type MusicCardDto = {
  title: string; source: string; coverUrl: string; from: string; audioUrl?: string;
};
// ChatMessageDto 的可选字段：
// viaClient?: string; viaVersion?: string; color?: string;
// weather?: WeatherCardDto; music?: MusicCardDto;
```

- 父级认证客户端保留旧平台/版本来源 tag：SDK `with_client_tag("Windows/<version>")`，其它平台同旧 macOS/Linux/PC。
- 音乐模块已导出 `enqueueNeteaseSong(id: string): boolean`，内部 forceAdd=true，聊天室右键已接。普通点击保持原入口；未就绪返回 false。
- 共享 MentionList 已按无修饰 Enter 选择并保留 IME guard。
- 父级已接 `commands/mod.rs` 的 `pub mod emoji_cloud; pub use emoji_cloud::*;` 及 `lib.rs` handler：`emoji_cloud_get`、`emoji_cloud_append`、`emoji_cloud_remove`。新增 DTO 在桥内，不需要改 `src/lib/types.ts`：`CloudEmojiSnapshot {sessionGeneration:number,urls:string[]}`；append request `{sessionGeneration,urls}`；remove request `{sessionGeneration,url}`。前端 sessionGeneration 来自读取快照，Rust 写前/请求后均核对同代。现有其它 command 不变，本 agent 不改中心注册。

## 持久自检

不增加依赖。`src/features/chatroom/migration-chatroom.test.mjs` 用已安装 TypeScript 的 transpileModule、node:test、node:assert 执行生产纯逻辑；最后对聊天室拥有的 TS/TSX 文件做不 emit 的定向类型检查。

```text
node --test src/features/chatroom/migration-chatroom.test.mjs src/features/chatroom/cloud-emoji.test.mjs
```

2026-10-09：33 项通过，0 失败（原迁移/定向 TS 29 项 + cloud IPC/真实组件 mock 4 项）。覆盖 composer 选区/引用/话题/音乐拼装，复读/撤回提升/tombstone/缓存，generation/reconnect 刷新队列，批量撤回止损，权限/颜色/话题边界，可信音乐 iframe、强制入队，cloud 安全 URL/旧 txt、服务器与收藏入口、unknown 写锁及显式刷新解锁、旧刷新不能解锁新 unknown、超大导入不提交、卸载隔离、配置导入 debounce 取消、TS 共享字段。

Rust 持久单测已加入 `commands/chatroom.rs`（历史参数、数字 ID、弹幕 JSON 转义及 UTF-16 长度）、`dto/message.rs`（md 空白、天气与来源映射）、`commands/emoji_cloud.rs`（4 项：固定协议/双重 JSON 字符串、成功码与 false 控制、确证空初始数据与坏响应、URL 边界/去重/未知旧串保留）。本 agent 遵照要求未争用 Cargo 构建锁；只对新增桥运行 rustfmt，单测由父级整合。

持久 `src/features/chatroom/browser-selfcheck.mjs` 使用已有/bundled Playwright + Vite，所有 Tauri IPC 与图片请求 mock，不用真实账户、不写真实 cloud。800x600/390x844 通过：收藏/服务器独立 tab、旧 txt 导入导出、保留未知旧串、服务端拒绝不删 UI、unknown 后显式刷新才解锁、菜单隐式 GET 不补写、无横向溢出/页面异常。

运行时提供 `PLAYWRIGHT_MODULE`（已安装 Playwright 路径）、可选 `CHATROOM_BROWSER`、`CHATROOM_TEST_URL`。已有 Vite 时直接 node 执行；`CHATROOM_SELF_CHECK_START_SERVER=1` 会在默认 1431 strictPort 创建仅本测试拥有的 Vite，finally 关闭自己的无头浏览器和 server，不触碰其它进程。本次测试启动后均已清理，无调试 exe 进程。

父级此前集成结果（2026-10-09）：全库 pnpm test 55 pass；Rust 76 pass、1 ignored；Native keyring 独立 pass；浏览器 typed safe assertions pass。本轮新 cloud TS/浏览器结果独立如上，不能将此前全库数字当成本轮 Rust 已通过。最终全库 pnpm/Cargo/build 由父级运行。

## 本次修改路径

以下均相对新版目录，不包括其他 agent 的并行改动：

```text
src/features/chatroom/ChatRoomPage.tsx
src/features/chatroom/PARITY.md
src/features/chatroom/chatroom.css
src/features/chatroom/chatroomApi.ts
src/features/chatroom/cloudEmojiLogic.ts
src/features/chatroom/cloud-emoji.test.mjs
src/features/chatroom/browser-selfcheck.mjs
src/features/chatroom/composerLogic.ts
src/features/chatroom/emojiImportExport.ts
src/features/chatroom/filterSync.ts
src/features/chatroom/messageView.ts
src/features/chatroom/migration-chatroom.test.mjs
src/features/chatroom/musicEmbed.ts
src/features/chatroom/pasteImages.ts
src/features/chatroom/reconnectReport.ts
src/features/chatroom/refreshQueue.ts
src/features/chatroom/replyQuote.ts
src/features/chatroom/revokeChain.ts
src/features/chatroom/useChatroomSession.ts
src/features/chatroom/via.ts
src/features/chatroom/components/ChatHtmlView.tsx
src/features/chatroom/components/CloudEmojiFavorites.tsx
src/features/chatroom/components/Composer.tsx
src/features/chatroom/components/EmojiPanel.tsx
src/features/chatroom/components/FilterPanel.tsx
src/features/chatroom/components/MessageItem.tsx
src/features/chatroom/components/MessageList.tsx
src/features/chatroom/components/MusicCard.tsx
src/features/chatroom/components/OnlineBar.tsx
src/features/chatroom/components/UserContextMenu.tsx
src-tauri/src/commands/chatroom.rs
src-tauri/src/commands/emoji_api.rs
src-tauri/src/commands/emoji_cloud.rs
src-tauri/src/dto/chatroom.rs
src-tauri/src/dto/message.rs
docs/migration/chatroom.md
```
