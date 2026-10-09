# 扩展、旧主题与旧配置迁移

更新：2026-10-09。此模块仅负责指定独占文件，不改 Cargo/lock、中心注册、
AppShell、shared lib、auth 或 offline。共用目录直接编辑，无 worktree、无提交、
无新增依赖。本页不是“旧 JS / 任意 CSS 完全兼容”的声明。

## 实际源码核对

- [x] 旧 `src/main/extension/index.js`：根目录一级扫描、`fishpi.type` 分流、
  `publisher.name` 键、插件 Context 创建、command 回调、收发消息与活跃度 hooks。
- [x] 旧 `src/main/extension/context.js`：动态 require、`activate(events, electron)`、
  独立 Fishpi SDK、`login(token)`、logout/quit、`send`、`setSidebar`、
  `setHookJs`、`getSettingUrl()`、`hooks()`。
- [x] 旧 `src/renderer/extension.js`：整份主题 CSS link 注入与撤销、
  `lastTheme` 缓存、`:root` 变量收集。
- [x] 旧 `src/renderer/view/extension.vue`：列表、图标、作者、版本、主页、
  README marked 渲染及相对资源替换、插件设置入口。
- [x] 旧 `src/renderer/view/context.vue`、`static/webview.js`：带
  Node、关闭 contextIsolation/禁用 webSecurity 的 webview、preload `$ipc`、
  command/reply、宿主 send、CSS 变量透传。
- [x] 旧 `src/renderer/setting.js` 和 `view/setting.vue`：全部默认设置、
  字段形状、老板键字符串/`{text}`、屏蔽三种类型、特别关心、目录选择。
- [x] 旧 `src/renderer/theme/theme.css`：真实旧变量。源码没有单独 `themes/`
  示例包；本机默认 `.fishpi` 目录也不存在，未虚构第三方主题样本。
- [x] 旧 `App.vue` 只有 router-view；插件根对象实际在
  `src/renderer/main.js` 的 `$VueApp`，包括 require hook 的 `activate($VueApp)`、
  sidebar 注册、自定义菜单、sendMsg、用户资料与音乐方法。
- [x] 旧 `view/chatroom.vue`、`components/messagebox.vue`、`view/index.vue`、
  `notice.js`：incoming 全事件处理、发送前串行 hooks/取消、60 秒活跃度、
  登录广播、特别关心上线通知及通知选项真实语义。

## 已实现模块

- [x] 本地扩展目录扫描：只认一级子目录内有效 `package.json.fishpi`；
  主题/插件分流、`publisher.name`（缺 publisher 为 unknown），按目录排序，
  重复键明确诊断，不进行名称模糊匹配。
- [x] 目录检查：本地绝对路径，拒绝 UNC/网络根、控制字符、相对路径；
  文件路径跨平台拒绝 `..`、绝对路径、盘符/ADS。canonicalize 后必须留在
  当前包内；目录链接逃逸拒绝。只读常规文件，读取前/中双重上限。
- [x] 扩展表现：名称、版本、描述、作者、用户点击打开 http(s) 主页/仓库；
  仓库支持字符串或 `{url}`、`git+https`。URL 不接受凭据段。
- [x] 本地 PNG/JPEG/GIF/WebP/ICO 图标转 data URL；SVG 不做字符串黑名单
  “净化”，直接不接收，以免遗漏外部资源、CSS 或活动内容。
- [x] README 详情：只读 `README.md/.markdown/.txt/README`，Markdown 使用
  已安装 ReactMarkdown/GFM，跳过 HTML；图片只显示 alt，链接仅在明确
  点击后经 opener 打开 http(s)。不执行 HTML、不自动加载远程或本地资源。
- [x] 目录编辑、主题发现/持久化/切换/重扫、返回内置主题、失败撤销主题；
  异步代次检查防止旧扫描/README 响应覆盖新选择，卸载清理样式与监听。
- [x] 偏好变化事件让已挂载 ExtensionMount 在导入后重读根目录和主题；
  默认 `Default` 不注入样式、不改 `html[data-theme]`，保留现有四套内置视觉。
- [x] 原 `hooks` JS 原文扫描字段已删除；不 require、eval、Function、
  shell、下载或激活插件。共享聊天室 hooks 调用仍为原值透传，
  `hasSendMsgHooks/hasChatroomHooks` 为 false，不注册全局可调用宿主对象。

### 读取上限

- 每个根最多查看 2,000 项、列出 200 个包；触达上限返回诊断。
- package.json 64,000 字节；主题源 200,000 字节；README 128,000 字节；
  单图标 32,000 字节。UTF-8 文本支持 BOM，其他编码拒绝。
- 无效包或无法读取的文件不会触发插件执行，也不会伪造兼容成功。

## 受控主题映射

Rust 只读取主题 `main` 指向的包内 `.css` 为惰性文本。
`ThemeCss.applied` 仅表示源读取成功，**不表示原 CSS 已应用**。
前端用未挂载的 constructed CSSStyleSheet/CSSOM 解析，唯一允许 selector 为
顶层精确 `:root`，仅提取以下真实旧变量：

- `--global-text-color` → `--color-text`
- `--global-active-color` → accent/hover/pressed
- `--global-background-color` → bg；popup-background → bg-raised
- control-background → bg-input；control-placeholder → text-faint
- control-text → text-muted；control-border → border/border-strong
- control-focus → focus
- chatroom-sidebar-background → bg-sidebar/bg-hover
- chatroom-message-background/color → bubble/bubble-ink
- chatroom-user-message-background/color → bubble-self/bubble-self-ink
- `--header-btn-checked-color` → 同名变量

只接收经浏览器校验的字面颜色：hex、颜色名、数值 rgb(a)/hsl(a)；
允许引用另一个白名单旧变量，循环引用拒绝。`!important`、CSS-wide 值、
currentColor、未知 var、URL、转义值与其他函数拒绝。
最终生成只含上述新变量和规范化颜色的本地 style。
主主题 `data-theme`、dark class、字体、几何尺寸、布局不变。
非白名单声明/规则计入忽略项；不支持 @import、媒体规则、字体/图像资源、
Vue/iView selector、任意全局 CSS。红红包/Markdown/音乐等旧专用变量没有
可靠新语义映射，不伪造完全兼容。CSSOM 丢弃的非法声明/import 无法逐项计数。

## 旧设置完整映射

导入按旧字段是否存在且类型正确处理，缺失字段不重置现有普通偏好：

- `global.opacity.value` 百分比 → `SettingsPatch.opacity`（0.1..1）；
  enable → opacityEnabled，关闭立即设窗口 1.0。
- `global.topWindow` → alwaysOnTop，保存后尝试立即作用于窗口。
- `global.autoReward` → autoReward；music 的 0/1/2 原值 → DesktopPrefs.musicMode。
- `global.updateMirror` → DesktopPrefs.updateMirror，复用 updater 域名规范化。
- `chatroom.redpackNotice` → redpackNotice。
- `chatroom.shield` → 独立 `chatroom-filters.json` 的 shield。
  保留 username/content/redpacket，内容正则只是字符串，不当代码执行。
- `chatroom.careUsers` → 同文件的 careUsers；通过现有 filter command 清洗/去重。
- `message.notice.chatroom/chat/at/reply/sys/talk` → 同名 notify* 开关。
- `message.notice.talkmsg` → notifyTalkPattern，使用现有 200 字节上限；
  现有 DTO 会 trim，超限在报告中明确提示。
- `message.way.audio` → notifySound；msg → notifySystem + notifyEnabled。
- `hotkey.boss` 字符串或 `{text}` → hotkey + bossKey；复用现有老板键注册验证。
- `extensions.root/theme` → DesktopPrefs.extensionRoot/theme，Default 保留；
  不覆盖独立内置 `AppSettings.themeId`。
- 独立 Local Storage username → loginUsername；password/passwd 绝不导入。
- 旧默认并没有 closeToTray、内置 themeId 或 windowWidth/windowHeight；
  不从未知插件字段猜测这些值，保留新端现有值。

屏蔽/关心不写 settings.json（settings_set 会清空整个文件）。
只出现其中一项时保留另一项；明确空数组才清空。
格式错误的非空数组不会将有效现有数据清空；非法项逐项跳过并报告。
现有契约上限为 40 规则、100 用户、规则 200 字、用户名 64 字，
规范化/截断/去重发生时明确报告，不声称超限数据完整保留。
字段齐全的有效导入替换对应现有字段，不与旧端不明用户的数据自动并集。
插件自定义字段不写普通偏好，其数量/区域出现在报告中。

### 读取与账号安全

- 只看 `%APPDATA%\fishpi-app`、`%APPDATA%\fishpi`，防路径链接逃逸。
- LevelDB 复制到唯一临时目录再 open；不修改原目录、不复用/删除未知临时目录。
  总复制 128 MB、单条值 1 MB；复制期间大小变化或读取失败拒绝导入。
  正常/异常退栈都清理复制目录；进程被强杀时不能保证清理。
- 按 Chromium 原始 `LocalStorageCachedArea::Uint8VectorToString16` 解码：
  `0=UTF-16LE`、`1=Latin-1`，未知 tag 拒绝，不猜编码；
  键在 origin 后第一个 NUL 分割，不能用最后一个 NUL，否则 UTF-16 键失真。
- 只接受旧源码实际 origin `file://`、localhost/127.0.0.1:9080；
  token/username/setting 必须来自同一 origin。多来源有效配置或多数据目录拒绝猜选。
- command 注入 `State<AppState>`；**读取 legacy await 前**抓 expected_generation，
  唯一写凭据路径为 `auth::save_imported_credential(&state, expected_generation, value)`。
  父级 helper 持 AUTH_COMMIT，检查同代次且未登录；已登录/代次变化/写库失败
  返回 credentialSaved=false，明确仅继续普通设置导入，不覆盖当前账号 keyring。
- 返回值与事件只含状态/报告，不返回 token、原 settings、密码或插件脚本。
  prefs 文件只序列化白名单 DesktopPrefs，并递归清除 secret 字段。
  保存先写同目录临时文件并 sync，再 rename，失败保留原 prefs。
- 普通设置、filters、prefs、credential 各自报告成功；不是跨文件事务。
  某一项失败不假装全部成功，也不撤销已经成功的其他项。

## JS API 兼容边界

- `activate(context, electron)`：无法原样执行。原 API 给完整 Electron 主进程、
  Node require 和进程/文件能力；Tauri 原生 command 不是 Node ABI，
  当前没有不可信 JS 隔离运行时和权限契约。不能靠前端 eval 模拟。
- `context.fishpi`、`login(token)`：无法原样兼容。旧 Fishpi JS SDK 直接拿 token；
  现在 SDK1.1.1 和凭据只能在 Rust，不能暴露给插件。账号由父级整合。
- `hooks().sendMsgEvent(msg)`：旧回调可变换/取消消息；当前聊天室调用者已有
  透传入口，但无安全 JS 运行时。维持发送草稿/真实发送契约，不伪造插件生效。
- `hooks().messageEvent(msg)`：旧回调处理全部 WS 类型且可返回 true/消息/空值；
  新共享入口只是归一后的消息 DTO，不等同旧原始全事件，不能称为兼容。
- `hooks().liveness`：旧每分钟发数值回调；没有运行时，当前不执行回调。
- `setHookJs(file)` → `hook.activate($VueApp)`：旧 Vue 根、DOM、自定义菜单、
  sendMsg/音乐/用户资料、renderer require 都是特权对象；React AppShell 不提供
  同一对象，不将任意 JS 注入已登录 WebView。
- `setSidebar(icon,url)` / `getSettingUrl()`：旧 URL 是 JS 激活后的返回值，
  无法不运行插件而发现；旧页面依赖 Node、preload、关掉 webSecurity。
  元数据/README 已迁移，**插件设置页面和 sidebar 页面没有迁移运行**。
- `context.on('command',...)` / context.send / webview `$ipc.send/invoke/on/off`：
  Electron 双向 command 与动态 callback channel 不等同 Tauri 注册 command。
  仅提供宿主只读 readme 操作，不开放任意插件 command 总线。
- `logout` / `quit` lifecycle：没有插件运行时，不投递假事件或默默执行旧监听。
- `electron.shell/Notification/ipcMain/ipcRenderer/BrowserWindow`、fs、
  child_process、fetch 与 require 缓存重载：无直接等价权限，不开放任意 shell、
  文件系统、外网、主进程或真实凭据。宿主用户点击主页不等于插件得到 shell。

不将未运行代码的静态字符串扫描当成可靠 API 用量证明；仓库/本机没有真实
第三方包可逐插件认证，因此只报告接口级兼容边界，没有宣称认证某个用户插件。
若后续要迁移动态插件，需要先明确隔离运行时、授权 API、资源协议和错误/超时
语义；即便如此登录 token 和任意本地权限也不能恢复。

## 中心注册与设置契约

- 原 `lib.rs` 已注册 extension_scan、extension_load_theme、extension_call、
  config_import、desktop_prefs_get/set；**没有新增 command 名称**，无需本模块改 lib/mod。
- config_import 增 State 注入，无前端参数新增；父级负责 AppState manage 与 auth helper。
- extension_call 现仅支持 `{api:"readme",key,root:null|string}`，返回
  `{key,readme,message}`；任意旧执行 API 明确错误。其 TS wrapper 与唯一调用者已同步。
- ExtensionScan 删除 hooks，新增 diagnostics；plugins/themes 不含 JS source、
  包完整 manifest、凭据或内存 SDK。所有本模块调用者已同步。
- ImportResult 新增 `filtersSaved:boolean`；现有 DesktopMount 按 message 显示不受影响。
  父级可补 `src/features/desktop/api.ts` 类型并在导入 UI 分项展示。
- `desktop://prefs-changed` 无负载，只要求相关模块重读 prefs；ExtensionMount 已监听。
- `desktop://config-imported` 负载为脱敏 ImportResult。父级应在成功写设置后重读
  settings_get 并 publishDesktopSettings，在 filtersSaved 时重读 filters；
  **当前 settings/chatroom 已挂载缓存尚未在本模块内改动**，仅持久化正确不代表
  这些内存状态立即同步。不得让旧设置页缓存随后覆写新导入设置。
- 父级已负责 LoginPage 明确的旧配置导入入口；这里不修改登录 UI。
- 旧设置的系统目录选择 dialog 尚无新端 picker：目前本地绝对路径输入 +
  重扫可用，不加 dialog 依赖/中心注册。精确旧 folder-picker 操作不声称完成。
- AppShell 的 ExtensionMount 必须常驻或至少需要主题时保持挂载；
  本模块卸载会撤销主题。不在禁止修改的 AppShell 中补生命周期。

## 测试与剩余验证

- [x] `pnpm exec tsc --noEmit` 通过（共享整合改动已消除先前无关 TS 错误）。
- [x] rustfmt 解析/格式化两个 Rust 文件成功；不等同 Cargo 编译/测试。
- [x] 本机 Edge browser mock 的 selfcheck 通过：白名单/URL/布局过滤、
  var 循环拒绝、默认主题撤销且现有视觉令牌恢复、不执行未知 hook、
  收发消息原值透传。父级也确认 selfcheck 通过。
- [x] 本机 Edge React 集成夹具通过：主题选择/撤销、README HTML/图片不加载、
  网络请求无外部资源、1280px/350px 截图、异步新请求覆盖旧请求、卸载清理。
  仅模拟 Tauri IPC，不能替代真实 Rust/WebView 联调。
- [x] Rust 已添加断言：目录分流/重复键、不读取 hooks、跨平台 traversal/ADS、
  精确主题键/缺失回退、文本限制、README 惰性、主页/作者/Base64/SVG拒绝；
  Unix-only 链接逃逸测试（Windows 不执行此条）。
- [x] 导入 Rust 已添加断言：Latin-1/UTF-16 键值、全部内置设置映射、
  缺字段/显式false、屏蔽三类型/关心/明确空数组/非法字段保留、
  secret 清除、来源不能混合/多来源拒绝、非法偏好和结果不含凭据。
- [ ] 上述 Rust 测试由父级最终 Cargo 运行；本模块按要求不跑 Cargo。
- [ ] 真机 keyring、登录/退出与导入并发、真实旧 LevelDB 压缩样本、窗口 API、
  Windows junction 动态替换、备份中途旧进程写入需主集成验证。
  canonicalize 检查不是跨平台文件句柄级沙箱，无法承诺抵御本机攻击者同时换链。
- [ ] 未使用真实用户插件/第三方主题测试；未执行用户代码、未下载程序。
- [ ] 超出既有限额的旧规则/用户名/关键词无法逐位无损迁入当前设置模型；
  报告明确说明规范化，原旧数据未修改。过滤器无效正则的运行语义仍归聊天室模块。

## 改动文件

- `src-tauri/src/commands/extension_host.rs`
- `src-tauri/src/commands/config_import.rs`
- `src/features/extension/api.ts`
- `src/features/extension/hooks.ts`
- `src/features/extension/ExtensionMount.tsx`
- `src/features/extension/theme.ts`
- `src/features/extension/extension.css`
- `src/features/extension/selfcheck.ts`
- `docs/migration/extensions.md`

临时 Python 验证脚本执行后删除，不作为交付代码；截图只保存在可视化输出目录。
