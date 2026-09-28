# 帖子互动与 SDK 1.1.0

对照 crates.io `fishpi-sdk` 1.1.0（`Cargo.lock` 里的 registry 包，不是 path 依赖）的 `ArticleApi`。感谢、赞踩、打赏、在看都由 Rust invoke，WebView 不直连 fishpi.cn。

## 感谢 — 已接上

- SDK：`article().thank(id) -> Result<()>`
- 命令：`article_thank`
- 只有确定成功才把界面标成已感谢，并给感谢数 +1。超时或无法确认时保持未感谢，不自动重试。

## 点赞 / 点踩 — 已接上

- SDK：`article().vote(id, like) -> Result<bool>`。`true` 表示响应 `type == -1`，即该方向现在选中。
- 命令：`article_vote`，`direction` 为 `up` 或 `down`
- 计数沿用旧客户端：确定成功后，按点击前的状态对该方向 ±1。结果不明不改赞踩状态。

## 打赏后可见 — 已接上

- SDK：`article().reward(id) -> Result<()>`。成功体不含隐藏正文。
- 命令：`article_reward`。确定成功后再拉一次详情；只有详情 `rewarded == true` 才带回正文。
- 未打赏、打赏失败、结果无法确认时都不下发隐藏正文，界面也不标成已打赏。
- 正文走现有规则：Markdown 原文，或剥掉标签的文本，不转发原始 HTML。

## 在看人数 — 已接上（HTTP 初始值 + 频道加减）

- SDK：`article().heat(id) -> Result<u32>` 拉当前人数。
- SDK：`article().connect(id, articleType)` 与 `on_message`。只认 `type == "articleHeat"` 且 `operation` 为 `+` 或 `-`。
- 命令：`article_heat`、`article_heat_watch`、`article_heat_close`
- 事件：`article://heat`，`delta` 只有 `1` 或 `-1`。
- 没拉到 HTTP 人数时，不用 0 当基数去做本地加减。监听失败时只显示已经拉到的人数。

## 评论

`comment_post` 没有改，发送仍走原来的命令。

### 删除 / 感谢 / 赞踩 — 已接上

- SDK：`comment().remove(id) -> Result<String>`、`comment().thank(id) -> Result<()>`、`comment().vote(id, like) -> Result<bool>`
- 命令：`comment_delete`、`comment_thank`、`comment_vote`（`direction` 为 `up` / `down`）
- 删除：仅自己的评论可点（`userName` 对齐 `auth_me`），确认后调用；只有确定成功才从列表移除。
- 感谢：不能感谢自己的评论；确定成功后 `thanked` 与 `thankCount + 1`。旧客户端提示 15 积分。
- 赞踩：SDK `comment().vote` 返回的 bool 对 down 恒为 false，不能当「当前方向是否选中」。确定成功后由前端按点击前状态切换（对齐旧客户端 `comments.vue`），结果不明不改状态。
- 命令缺失时对应按钮禁用并给出 tooltip，不伪装成功。
