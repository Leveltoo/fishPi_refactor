# 内容模块迁移核对

核对日期：2026-10-09。旧版 `fishpi-desktop`；新版 `fishpi-desktop-refactor-tauri`。
只编辑内容模块独占路径；不创建 worktree、不提交、不修改 Cargo/lock、中心模块、AppShell、state/realtime 或 shared lib。

## 核对依据

- 逐项阅读旧 `src/renderer/view/articles.vue`、`article.vue`、`breezemoons.vue`、`components/comments.vue`。
- 阅读旧 `components/messagebox.vue`：回复、匿名、仅楼主可见、图片上传/粘贴、表情/@ 补全、Enter 换行与 Ctrl+Enter 发送、调高、网易云链接转换。
- SDK 以 `C:/Users/Admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fishpi-sdk-1.1.1/src` 发布源码为准，核对 `client/article.rs`、`comment.rs`、`breezemoon.rs` 及对应 domain/wire。
- 旧版没有文章发布/编辑/删除、评论编辑、清风明月编辑/删除入口，不将 SDK 新增能力当作迁移需求。

## 帖子列表与详情

- [x] 默认 `ArticleListType::Reply`，分页追加、ID 去重、头像/作者名片、标题、浏览量展示值。
- [x] 打开详情、返回原列表；列表不卸载，保留已加载页及滚动位置。详情动态标题与旧版一致。
- [x] 正文、作者、浏览/评论数、创建/更新时间；HTML 经净化，Markdown 使用现有 GFM/breaks 渲染。
- [x] 感谢 20 积分确认、不能感谢自己的帖子、成功后更新计数。
- [x] 赞/踩与取消、互斥切换；SDK 返回 `type == -1`，只在确定成功后变更状态及两侧计数。
- [x] 打赏积分确认；SDK `reward()` 返回 `()`，随后回读详情。只有 `rewarded == true` 才返回/显示隐藏正文。
- [x] 未打赏 DTO 不序列化 `rewardContent`，前端也再次按 rewarded/ack 边界过滤，结果不明不解锁。
- [x] `heat()` 初始人数和文章频道 `articleHeat` 的 `+/-`；失败显示未知，不伪造 0。
- [x] 文章频道实时评论，严格匹配帖子 ID、会话/监听代次，ID 去重；返回/换帖关闭本代监听。
- [x] 初始人数失败不阻断评论频道订阅；监听回包前缓存推送，监听成立后过滤代次。
- [x] 同会话 `desktop://reconnect` 重建活跃文章 watch，旧监听按代次关闭；不重放任何写请求。

## 评论

- [x] 默认打开最后一页，向前加载更早评论；展示 newest-first，不再原地 `reverse()` 修改父级数组。
- [x] 评论 HTML/Markdown、头像/名字、时间、图片预览、外链、引用原评论跳转。
- [x] 回复 chip 与取消、`commentOriginalCommentId`、匿名/仅楼主可见按真实选择传 SDK。
- [x] 自己的评论可删除，确认后调用 `remove()`；其他评论感谢 15 积分确认；成功才更新。
- [x] 评论赞踩：发布 SDK 的 `vote()` 对 down 恒 false，不用它判断方向；成功后按已有状态切换并更新互斥计数。
- [x] 图片选择/剪贴板图片上传；HTML 仅解析 `img`，远程图片转 Markdown；本地图片复用已有粘贴 helper，不授予任意文件读取。
- [x] 表情面板/短码补全、@ 用户补全、网易云歌曲/专辑链接转换。
- [x] Enter 换行、Ctrl/Meta+Enter 发送；中文输入法组合中 Enter 不发送。输入高度复用 `message-height`，48–400px。
- [x] 发送成功回读详情，不插入草稿冒充真实评论；失败保留草稿/回复，结果不明禁止自动重发。
- [x] 换帖/返回后迟到的读写结果不覆盖当前详情；显式刷新按钮用于核对未知结果。

## 清风明月

- [x] 真实 SDK 全站/指定用户列表、分页、去重、作者头像/名片、城市/时间、富文本正文。
- [x] 顶部输入、Enter/按钮发送，输入法组合中 Enter 不发送。
- [x] 发送一次，成功后回读第一页并合入已加载列表，不丢更早页和后续页码；滚动回顶部，不假造本地条目。
- [x] 非明确 accepted 不清空草稿；列表回读失败单独提示“已发送，列表刷新失败”，不重发已成功写入。
- [x] 删除旧版没有的编辑/删除按钮及常驻 SDK 说明；不强制 dark 覆盖宿主皮肤。
- [x] SDK `send()` 无新 ID，无法可靠识别首条一定是自己的发送，因此合入真实首页而非冒认首页第一条。

## 安全与已知限制

- 所有写请求调用一次；现有鉴权构建 `max_retries(0)` 已核对，SDK transport 本身可能重试，中心鉴权须继续保持该设置。
- 内容模块复用 DOMPurify 后再约束 URL/去除内联 style；iframe 仅允许 HTTPS `music.163.com/outchain/player` 的数字 ID/type 1、2，附 sandbox。禁止任意 iframe/script/srcdoc/事件属性及危险协议。
- SDK 详情评论没有 `commentOriginalAuthorThumbnailURL`，只使用已加载原评论头像或频道自带值，不伪造头像。
- 引用目标不在已加载范围时明确提示加载更早评论，不猜测页码，也不自动循环请求全部历史。
- 本地 `file://` 图片是否可读取取决于现有 Tauri asset 访问范围；失败提示，不扩大权限。
- SDK `ArticleConnection` 无公开 open/close/error 事件；“live”仅表示订阅建立成功，不能宣称断线状态已准确观测。
- 清风明月结果不明时保留并锁定草稿以防重复写入；刷新用于人工核对，不能凭列表相同文本自动确认成功。

## 中心接线请求

- `lib.rs` / commands / dto 中现有内容命令注册已核对，未增加命令，不需要新增中心导出。
- [x] 主 agent 已在 auth logout、restore 失效、新账号 `replace_session_if()` 两条分支接入 `crate::commands::article_heat::disconnect_article_channel()`，本模块已只读核对。同步 helper 主动关闭静态槽并废止 pending 代次，安装连接时在静态槽锁内再次检查会话，避免迟到连接被放回。
- [x] 主 agent 已在 `App.tsx` 给 AppShell 加 `key={auth.phase.session.sessionGeneration}`，换号整组内容宿主重建，本模块已只读核对。
- 请主 agent 在全量 Cargo 验证中覆盖 DTO 字段新增、`article://heat` / `article://comment` 新增 `watchGeneration`。Rust 与前端契约本模块已同时更新。
- shared 安全渲染不在独占范围，本模块加严封装只供帖子/评论/清风明月使用，未修改 shared lib。

## 持久测试与验证

- `node src/features/article/selfcheck.mjs`：Node assert + 已安装 TypeScript，无新依赖。覆盖投票选择/取消/切换/下界、批次去重、首页合入保留旧页、会话/监听代次过滤、详情/旧字段映射、未打赏和未知结果正文屏蔽、异常 ack 不假成功、写操作调用次数、清风明月时间戳。
- `scripts/migration-content.test.mjs` 用 Node test 包装持久自检，纳入现有 `pnpm test`（`node --test`）；未修改 package.json。
- Rust 持久单测：`dto/article.rs` 覆盖隐藏正文不序列化、富文本/时间、频道严格帖子匹配；原有 heat 帧测试保留。
- `commands/comment_post.rs` 新增持久单测核对回复、匿名、仅楼主可见字段及无凭据 DTO。
- 本轮没有执行 Cargo test/check/build/update；按分工由主 agent 做最终全量验证。
- 已执行且通过：`node src/features/article/selfcheck.mjs`、`pnpm build`、`tsc --noEmit`。
- 最终集成复跑：`pnpm test` 16/16 通过（包括内容 wrapper），`pnpm build` 通过；未使用导入与 HeatWatch 未用字段已清理。
- `src/features/article/browser-selfcheck.mjs` 是持久浏览器自检，使用现有 Playwright runtime/本机 Edge，所有 invoke 都为测试假实现，不发真实写请求。覆盖 HTML/图片粘贴安全、评论顺序/自身感谢、同/异会话 reconnect、未知写入保留草稿且只调一次、返回关闭监听、清风明月分页保留与真实回读。1100×760 / 390×844 截图检查通过。
- 浏览器脚本接已有 Vite：设置 `CONTENT_TEST_URL`、`PLAYWRIGHT_MODULE`、可选 `CONTENT_BROWSER` 后运行 `node src/features/article/browser-selfcheck.mjs`，不增加 package 依赖。
- `rustfmt --edition 2021` 已针对本轮 4 个 Rust 修改文件执行。Rust 单测留给主 agent 全量 Cargo。
- build 仅有现有 Vite 配置/大 chunk/动态导入告警，无 TypeScript 错误。
