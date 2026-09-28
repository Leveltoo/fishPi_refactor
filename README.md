<p align="center">
  <a href="https://fishpi.cn">
    <img width="200" src="./static/images/256x256.png">
  </a>
</p>

<h1 align="center">摸鱼派桌面</h1>

基于摸鱼打工人社区——[摸鱼派](https://fishpi.cn)开放 API 开发而成，可以在里面愉快的吹水摸鱼。

旧版 Electron 客户端的 Tauri 重构。

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
