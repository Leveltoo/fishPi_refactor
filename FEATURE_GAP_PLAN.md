# 新老功能对照与开发计划

> 对照：`fishpi-desktop`（旧 Electron） vs `fishpi-desktop-refactor-tauri`（新 Tauri）  
> 生成：2026-09-23 · 状态基于源码与各 feature 的 PARITY / TODO  
> 用途：后续按优先级补齐功能

---

## 总览

| 区域 | 旧版 | 新版 | 缺口 |
|------|------|------|------|
| 登录 / 会话 / 凭据 | ✅ | ✅ 密钥串 + 代次隔离 | 记住用户名等细节 |
| 聊天室核心 | ✅ | ✅ 收发/历史/撤回/合并+1/话题/上传图/右键 | 云端表情、红包体验细节 |
| 私聊 | ✅ | ✅ Bridge + UI + 撤回 + 图片上传 | 基本对齐 |
| 帖子 / 评论 | ✅ | ✅ 列表/详情/感谢/赞踩/打赏/在看 | 评论删/感谢/赞踩、热更新评论 |
| 清风明月 | ✅ | ✅ 列表 + 发送 | 编辑 / 删除 |
| 通知 / 活跃 / 签到 | ✅ | 大部分 ✅ | **签到写 API 在 SDK 中不存在**（见下）、通知点击跳转 |
| 设置 | ✅ | ✅ + 四主题 | 屏蔽/关心入口、网易云播放策略入口 |
| 扩展 / 插件 | ✅ JS 插件可跑 | 仅列表 + 本地 CSS 主题 | **JS 插件故意不兼容** |
| 桌面壳（托盘/老板键/置顶/透明/关闭到托盘） | ✅ | ✅ | 通知点击、托盘角标闪烁 |
| 音乐播放器 | ✅ | ✅ 播放列表 | 设置里的点击策略、卡片进列表 |
| 离线消息 | ✅ 部分 | 写库 ✅ | **聊天页不自动 hydrate** |
| 断网重连 | ✅ | 部分 | SDK 句柄限制，唤醒只补 connect |

---

## P0 · 体验必补（高优先级）

- [x] **真正签到**（已核实：当前无法实现，如实上报）  
  现状：`user_checkin` 命令已注册；前端「签到」调用写命令（不再只重查 `user_is_checkin`）。  
  根因（已核实）：fishpi-sdk 1.1.0 `UserApi` 仅有 `is_checkin()`（GET `user/checkedIn`），**没有签到写方法**；`post_raw` / `get_raw` / `with_key` / `send_raw` 均为 `pub(crate)`，外部无法借道 raw POST。  
  旁证：旧版 `fishpi-desktop` 与官方 `fishpi.js`（0.0.59 及最新 FishPiOffical/fishpi.js）同样只有 `isCheckIn()` 查询，**无任何签到写端点**。README 宣称的「签到」在源码中不存在。  
  行为：`user_checkin` 返回 `AppError { code: business }`，文案说明 SDK 缺写 API；前端 toast 如实展示，**不伪造成功**。  
  待：SDK 补齐签到写 API（或公开 raw post 且确认官方端点）后再改为真实写入。

- [x] **离线消息自动上屏**（2026-09-23）  
  聊天室：`offlineSeed` 在拉历史前 seed，按 ID 合并、撤回 sticky。  
  私聊：打开会话时 seed `chats[peer]`，历史优先、离线只补洞。

- [x] **私聊撤回按钮**（2026-09-23）  
  自己的未撤回消息 hover「撤回」→ `chat_revoke`；成功才标已撤回；`outcome_unknown` 不伪造。

- [x] **发弹幕 UI**（2026-09-23）  
  Composer「弹幕」Popover + 颜色预设 → `chatroom_barrager`。

- [x] **评论互动补齐**（2026-09-23）  
  `comment_delete` / `comment_thank` / `comment_vote` 已接 SDK CommentApi；页脚删除/感谢/赞踩。

- [x] **音乐卡片进播放列表**（2026-09-23）  
  MusicCard「加入播放列表」→ `playNeteaseSong`，跟随 musicMode。

- [x] **窗口控件接线**（2026-09-23）  
  最小化=hide、透明切换、置顶+持久化、关闭走 close_to_tray。

- [x] **设置页：屏蔽规则 / 特别关心入口**（2026-09-23）  
  设置「聊天室屏蔽 / 特别关心」与顶栏共用 `chatroom-filters.json`。

---

## P1 · 功能对齐（中优先级）

- [x] **设置页：屏蔽规则 / 特别关心入口**（2026-09-23，见上）
- [ ] **设置页：网易云点击策略**  
  播放 / 加列表 / 播放并加列表（`setting.global.music` 三档）。

- [x] **图片上传 / 粘贴**（聊天室 + 私聊）  
  fishpi-sdk 1.1.0 有 `FishPi::upload`（multipart `upload`）。  
  Bridge `file_upload` 收 base64 → 写临时文件 → SDK 上传 → 删临时文件。  
  聊天室 / 私聊支持粘贴图片与「图片」选文件；成功只插入 markdown，不自动发送。

- [ ] **云端自定义表情包**  
  旧版 `api/cloud` gameId=emojis；SDK 无此接口 → 标为受限或等 SDK。

- [ ] **清风明月编辑 / 删除**  
  需要 SDK 对应命令；无则 UI 禁用并说明。

- [x] **红包体验**（部分）  
  - 右键「复制红包地址」✅ ·「再发一个」打开发送面板并带对方 ✅（完整原单重发仍缺 payload）  
  - 猜拳红包手势选择完整度仍待 UI  
  - 领取状态合并 UI 仍缺  

- [x] **在线列表用户菜单**（2026-09-23）  
  @ / 单独聊聊 / 访问主页 / 发个专属红包；双击进私聊。

- [x] **右键菜单体系**（聊天室，2026-09-23）  
  顺序对齐旧 `msgMenuShow`：@ · 音乐加入/移出播放列表 · 回复 · 复读 · 复制地址 · 专属红包 · 红包地址/再发一个 · 表情短码/添加表情/复制消息 · 撤回/撤回复读 · 复制。  
  头像 / 昵称 / 也这么说 / 在线列表：@ / 单独聊聊 / 访问主页 / 发个专属红包。  
  菜单样式：去 zoom 动画，中性灰悬停，小圆角系统菜单。

- [ ] **断网 / 休眠恢复增强**  
  SDK `reconnect` 需 `&mut` 句柄；升级 SDK 或 Bridge 持可变连接后做真正 reconnect；否则文档写清限制。

- [ ] **导入旧配置验证**  
  本机无旧数据；在有 `%APPDATA%\fishpi-app` 的环境验证 token/设置导入。

- [ ] **托盘角标 / 闪烁**  
  旧版新消息托盘提示；现只有显示/隐藏/退出。

---

## P2 · 打磨与差异项（低优先级 / 可选）

- [ ] **用户名片**完善（积分、MBTI、城市、在线、专属红包入口）  
- [ ] **看图**：缩放/拖拽/外开/复制（overlay 可扩展）  
- [ ] **@ / 表情自动补全**贴光标（旧版独立 always-on-top 窗）  
- [ ] **特别关心上线提醒**  
- [ ] **红包提醒开关**（设置）  
- [ ] **管理员批量撤回**  
- [ ] **自定义滚动条**  
- [ ] **插件侧栏 / context webview**（计划首发不做 JS 插件，维持排除）  
- [ ] **网易云完整播放列表设置 UI**  
- [ ] **CSP `media-src` 外链音频**（音乐卡可能播不起来，需评估）

---

## 明确不做 / 受限（与 REFACTOR_PLAN 一致）

| 项 | 原因 |
|----|------|
| 旧 Electron JS 插件兼容 | 安全模型不同；只列表不执行 |
| 职业成长 / 金手指 | 首发非目标 |
| 自动持久化发送队列 | 非目标 |
| 离线完整历史库 | 只保留当前窗口 + 有界离线记录 |
| 网易云做成完整播放器产品 | 仅播放列表 + 单曲解析 |

---

## 建议迭代顺序

```
Sprint A（体验缺口）— 2026-09-23 完成
  1. 离线消息 hydrate ✅
  2. 私聊撤回按钮 ✅
  3. 窗口控件接线 ✅
  4. 真正签到（阻塞：SDK 1.1.0 无写 API；user_checkin 如实返回 business 错误）

Sprint B（社交补齐）
  5. 发弹幕 UI ✅
  6. 评论删除/感谢/赞踩 ✅
  7. 红包状态合并 + 再发一个（部分：右键专属红包 ✅，再发一个仍缺）
  8. 音乐卡进播放列表 ✅ + 设置策略（musicMode 已用；设置 UI 待做）
  8b. 图片上传 / 粘贴 ✅ · 聊天室右键菜单 ✅ · 在线列表用户菜单 ✅

Sprint C（桌面与通知）
  9. 通知点击跳转
  10. 托盘角标
  11. 设置页屏蔽/关心入口 ✅
  12. 重连增强（视 SDK）
```

---

## 附录：命令侧已注册

`auth_*` · `chat_*` · `chatroom_*`（含 barrager / filters / emoji） · `article_*` / `comment_post` / `comment_delete` / `comment_thank` / `comment_vote` · `breezemoon_*` · `notice_*` · `user_*`（含 `user_checkin`，SDK 无写 API 时返回 business 错误） · `redpacket_*` · `settings_*` · `window_*` · `music_resolve` · `update_*` · `config_import` · `extension_*` · `offline_*` · `reconnect_*` · `notify_show`

---

## 文档索引

| 文件 | 内容 |
|------|------|
| `REFACTOR_PLAN.md` | 总体架构与 P0–P3 验收 |
| `src/features/chatroom/PARITY.md` | 聊天室对照 |
| `src/features/desktop/PARITY.md` | 桌面能力 / 扩展 / 离线库 |
| `src/features/settings/PARITY.md` | 通知与活跃度差异 |
| `src/features/article/PARITY.md` | 帖子互动 |
| `src/features/im/TODO.md` | 私聊缺口（**部分过时**，chat_* 已存在） |
| `src/features/redpacket/TODO.md` | 红包命令约定 |
