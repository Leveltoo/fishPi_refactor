---
feature: user-card-window
status: delivered
updated: 2026-09-24
branch: (no git repo)
commits:
---

# User Card Window

## Report

**What was built** — 用户资料从主窗居中 Dialog 迁到独立 Tauri 子窗 `user-card`（无边框、置顶、不抢焦点、贴鼠标）。悬停热区约 1.5s 或点击用户名/@ 立即打开；mouseleave / 点空白 / Esc 关闭。卡片结构对齐旧 `card.vue`：方头像、昵称、勋章、签名、角色图、积分、城市、`#编号`、在线标签、非本人「私聊」；颜色用当前主题 token。Bridge `user_profile` 导出 `cardBg`、`metals`。头像负 margin 上探需顶部 `padding-top: 52px`，否则 `overflow:hidden` 裁切；窗高按内容调至 240–420。

**Verification** — `node node_modules/typescript/bin/tsc --noEmit` → 仅既有 `tsconfig.json` TS5101（PRE-EXISTING）。`cargo check --manifest-path src-tauri/Cargo.toml` → PASS（既有 dead_code 警告）。独立 review：首轮 5 个 critical 修复后复审全部 FIXED。用户确认头像完整显示。

**Journey log**
1. 首轮用居中 Dialog + 简化 chips，与旧版不符 → 用户要求完整迁移，改为子窗。
2. Compose Next 决策：独立子窗、结构照搬旧卡、点击与悬停同一路径。
3. 复审 critical：固定高、Esc、本人私聊、坐标/DPI、双开 → 均已修。
4. 验收后头像被窗顶裁切：`margin-top:-48` + 顶距不足 → `padding-top:52px`、`CARD_HEIGHT_MIN=240`。
5. 残留（非阻塞）：窗变高后未再 clamp；`auth_me` 失败时本人可能仍见私聊；本目录无 git。

## [S1] Problem

旧 Electron 客户端在头像/用户名上悬停约 1.5s，会在鼠标旁弹出**无边框、不抢焦点**的资料小窗（方头像、勋章、签名、角色、积分、城市、编号、MBTI、在线状态、私聊等），移出即隐藏。

新版此前只做了居中 modal Dialog + 简化 chips，交互与样式均不对；用户要求**按旧版完整迁移**，不是「差不多」的近似实现。

## [S2] Design

### Decisions

- Workspace：当前 `fishpi-desktop-refactor-tauri`（既有 override：不 worktree；本目录亦**无 git**，不做 worktree/分支）。不主动 commit。
- 呈现：**独立 Tauri 子窗口**（用户选定），非主窗内浮层、非居中 Dialog。
- 点击路径：悬停与点击用户名/@ 链接**都**打开/更新同一子窗口（用户选定）；删除主窗居中名片 Dialog。
- 视觉：**结构照搬旧 `card.vue`**（用户选定）；颜色/边框用当前 `tokens.css` / `themes.css`，不写死旧夜港变量。
- 悬停延迟：默认 **1500ms**（对齐旧 `data-time || 1.5`）；`data-user-card-delay`（ms）可覆盖，范围 200–5000。
- 触发标记：`.user-card` + `data-user`（旧约定），同时兼容已写的 `data-user-card`。值为 `userName`。

### 子窗口契约

| 项 | 约定 |
|----|------|
| label | `user-card`（单例） |
| 尺寸 | 初值 400×240（含 52px 头像顶距）；内容就绪后按滚动高度调高（上限约 420），宽 400 |
| 样式 | `decorations: false`、`transparent` 可选、`alwaysOnTop: true`、`skipTaskbar: true`、`resizable: false`、`focus: false`（showInactive 等价） |
| 定位 | 主窗原点 + `clientX/clientY`（旧 `winPos + mouse`）；夹紧在工作区内，避免右/下裁切 |
| 打开 | 复用单例：已有则 `setPosition` + 发送 `user-update` + show；否则创建 |
| 关闭 | 卡片 `mouseleave`、主窗点空白/非 `.user-card`、Esc、切换用户前 hide |
| 路由 | 主 SPA 增加窗口判定：`label === "user-card"` 或 `?window=user-card` 只渲染名片页，不挂 AppShell |

### 数据契约

扩展 `UserProfileDto` / `user_profile` 映射（Bridge 已有 `UserInfo` 源字段，现未导出）：

- 已有且需透出：`cardBg`、`metals[]`（`icon`/`description`/`enabled`）、`role`、`city`、`online`、`points`、`userNo`、`intro`、昵称/用户名/头像
- `mbti`：`WireUserInfo` / domain **当前无此字段**；有则显示，无则整块隐藏（不伪造）
- 角色图 URL：沿用旧客户端 `roleImg` 外链（管理员/OP/纪律委员/超级会员/成员/新手）；未知角色不显示图，显示文字 title

前端 `UserProfile` + `mapProfile` 同步扩展；子窗口经 `user_profile` 自取，或主窗展示后 emit（优先**子窗自取**，避免跨窗传大对象）。

### 卡片布局（对齐旧 card.vue 结构）

1. **Header**（半透明底）：左 100×100 **方**头像（上溢 ~64px）→ 右：昵称 1.2em + `@用户名` 0.8em；下方勋章图标 20px 行  
2. **Body**（半透明底）：签名全文  
3. **Info row**：角色图 · 积分图标(可点进积分页) · 城市 · `#userNo` 描边徽章 · MBTI 色块（若有）  
4. **State row**：在线/离线 Tag · **私聊**（非本人）  
5. 背景：`cardBg` cover；无则主窗 raised 底  
6. `mouseleave` 关窗；头像点击 → 系统浏览器打开 member 页

### 触发与关闭（主窗）

- `mouseover` 委托 `.user-card[data-user]` 或 `[data-user-card]` → 计时 → `showUserCard(user, clientX, clientY)`
- `mouseout` 离开热区 → `clearTimeout`
- 文档 `click`：命中 `.user-card` / `[data-user-card]` → 立刻 show；否则 `hideUserCard`
- 现有 `fishpi:user-card` 事件改为驱动**同一**子窗口（点击 @ 链接等）

### 覆盖挂载点（主窗）

与旧版一致或等价处打标：

- 聊天室消息头像 / 昵称区  
- 「也这么说」头像  
- 在线列表行  
- 私聊气泡头像、会话头像  
- （既有）Markdown / HTML / Mention 点击用户名 → 同一 show  

### Bridge / capability

- 扩展 `user_profile` DTO（见上）  
- 子窗口 label 进入 capability（`windows: ["main", "user-card"]` 或独立 capability）：允许 show/hide/set-position/close、以及名片页所需最小 core 权限  
- 主窗增加打开/定位/隐藏子窗的 command 或纯前端 `WebviewWindow` API（选定其一在实现时定：**优先前端 `WebviewWindow`**，Rust 仅在需要 always-on-top 原生保证时补）

### 错误行为

- `user_profile` 失败：子窗显示错误文案，不空壳假装成功  
- 无 `userName`：不打开  
- 登出/会话切换：强制 hide 子窗  

## [S3] Out of Scope

- 主窗内 modal 名片 Dialog（删除该路径）  
- 伪造 SDK 未返回的 `mbti`  
- 改聊天室/私聊其它交互  
- 像素级复刻旧 CSS 变量与 HarmonyOS 字体（只保结构；字体跟全局）  
- 独立「退出登录」按钮（旧卡有；新版登出仍在壳层账号菜单，避免双入口）——若验收要求可再开任务  

## Tasks

- [x] T1: 扩展 `UserProfileDto` + `user_profile` 映射（cardBg/metals/既有字段）并补 TS `UserProfile`/`mapProfile` — acceptance: invoke `user_profile` 返回含 `cardBg` 与 `metals`，前端类型可读 (covers: S2 数据契约)
- [x] T2: 实现 `user-card` 子窗口单例：创建/定位/show/hide + capability/windows 接入 — acceptance: 主窗 API 可在指定 client 坐标弹出无边框 always-on-top 窗，二次打开不新建 (covers: S2 子窗口契约)
- [x] T3: 子窗名片页：旧结构布局 + 当前 token 样式 + 私聊/头像外链 — acceptance: 打开后视觉结构对齐旧 card.vue 字段分区，mouseleave/Esc/点空白关闭 (covers: S2 卡片布局; depends: T1, T2)
- [x] T4: 主窗 hover 1.5s + 点击立即 show + 统一 `fishpi:user-card` 到子窗；覆盖聊天室/在线/私聊挂载点；移除居中 Dialog — acceptance: 悬停 1.5s 与点用户名均弹同一子窗，主窗不再出现居中名片 Dialog (covers: S2 触发与覆盖; depends: T2, T3)
- [x] T5: 验证 `npx tsc --noEmit` 仅既有 TS5101；`cargo check` 无新错误 — acceptance: 命令输出记录为 PASS / PRE-EXISTING (covers: S2 错误行为; depends: T1–T4)
