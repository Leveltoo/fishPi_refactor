<p align="center">
  <a href="https://fishpi.cn">
    <img width="200" src="./static/images/256x256.png">
  </a>
</p>

<h1 align="center">摸鱼派桌面</h1>

基于摸鱼打工人社区——[摸鱼派](https://fishpi.cn)开放 API 开发而成，可以在里面愉快的吹水摸鱼。

本仓库是 [fishpi-desktop](https://github.com/FishPiOffical/fishpi-desktop) 的 Tauri 重构。后端由 [fishpi-rust](https://github.com/FishPiOffical/fishpi-rust) 提供。

感谢 [午安宝贝](https://github.com/KwdeTfpv) 提供的 [fishpi-rust](https://github.com/FishPiOffical/fishpi-rust)，以及 [跳佬](https://github.com/imlinhanchao) 的旧版 [fishpi-desktop](https://github.com/FishPiOffical/fishpi-desktop)。

## ✨ 功能

- 😎 聊天室吹水；
- 💬 单人私聊；
- 📷 大图查看；
- 👉 @ 列表选择；
- 🍃 清风明月；
- 🎶 网易云音乐播放列表；
- 📰 社区看帖评论；
- ⚙️ 丰富的自定义设置功能；
- 🎨 自定义主题；

## 🗺️ 里程碑

对照旧版 [fishpi-desktop](https://github.com/FishPiOffical/fishpi-desktop) 的日常能力，当前大约 **85%**（不含旧 JS 插件；安全模型不同，不兼容）。主路径能日常用：登录吹水、私聊、看帖、发清风明月、开红包和听歌。剩下主要是 SDK / 平台做不到的能力，界面会禁用并说明，不假装成功。

- [x] **M1 登录与聊天室** — 凭据恢复、收发、历史、撤回、合并 +1、话题、弹幕、天气/音乐卡、表情、@、上传图、右键菜单、在线列表
- [x] **M2 社交闭环** — 私聊、红包收发与领取状态、通知分类、活跃度、昨日奖励、特别关心上线提醒
- [x] **M3 内容与桌面壳** — 帖子/评论、清风明月列表与发送、托盘/老板键/置顶/透明、四套内置主题、播放列表、检查更新
- [x] **M4 体验打磨** — 看图缩放拖拽、托盘闪烁、设置语义、红包卡片状态、插入光标、自定义滚动条
- [ ] **M5 SDK / 平台受限** — 签到写入、云端表情、名片 MBTI、弹幕无服务端 ID、运行中掉线感知、通知点击跳转

### 相对旧版还没做完

**SDK / 平台受限**（已禁用或降级，不假装成功）

- 签到写入：当前 SDK 只有 `is_checkin` 查询
- 云端表情收藏（cloud 存储）读不了，只能管理服务器分组
- 名片 MBTI：`UserInfo` 无此字段；有数据才显示，不编造
- 弹幕无服务端 oId（客户端已用时间戳 + 序号避免同文去重，仍不能当撤回 ID）
- 运行中掉线无公开回调，不会把「暂时没消息」当成离线
- 清风明月无编辑 / 删除接口
- 系统通知点击无法跳到对应页（`tauri-plugin-notification` 2.4 在 Windows 上没有点击回调）
- 网易云专辑不伪造可播地址

**明确不做**

- 旧 JS 插件执行、明文存密码、自动执行下载的安装包

## 🛡 编译运行

需要本机已安装 [Node.js](https://nodejs.org/) 与 [Rust](https://www.rust-lang.org/)。

``` bash
# 安装依赖
pnpm install

# 开发运行，前端挂靠在 localhost:1420
pnpm tauri dev

# 编译生成桌面应用
pnpm tauri build

```

## 👀 界面

![picture 1](./static/images/preview.png)
