# 聊天室交互对照

最新完整核对记录位于 `docs/migration/chatroom.md`，依据旧 Electron 实际源码及 crates.io fishpi-sdk 1.1.1，不依据旧 README 的完成声明。

已补齐消息合并/撤回提升、引用与话题拼装、输入图片和快捷动作、重连历史刷新、配置导入后的筛选同步。音乐交给共享播放器，不再使用独立单曲 audio。

默认表情、服务器分组和本机最近记录分别保留；旧 cloud 收藏用 Rust 固定端点窄桥独立迁移，支持读取、添加、删除、上传与旧 `.txt` 导入导出，不与服务器分组 JSON 混同。音乐右键已接强制入队，普通封面点击仍遵循播放模式。父级已补同代真实在线帧缓存重播，不称为主动在线探测。

持久自检：`node --test src/features/chatroom/migration-chatroom.test.mjs src/features/chatroom/cloud-emoji.test.mjs`。无真实请求的 `browser-selfcheck.mjs` 覆盖收藏/服务器独立页签、导入导出及未知结果刷新闸门。Rust 单测留给父级统一运行。
