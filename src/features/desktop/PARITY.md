# 桌面能力对照

本文件只说明旧客户端能力在新客户端里的落地情况。配色、字体、侧栏宽度和气泡没有改。

## 已经挂上的入口

`AppShell` 在设置页渲染 `DesktopMount` 和 `ExtensionMount`，侧栏「播放列表」渲染 `PlaylistMount`。设置页用 `hidden` 保持挂载，启动后就会开始重连监听和本地消息写入。

聊天室和私聊页面仍不会在拉在线历史之前先画出这份离线记录。`DesktopMount` 只负责把之后到达的 `chatroom://msg` / `chat://msg` 写入库。发送失败仍应调用 `failOfflineSend`，不要把失败标成已发出。聊天里的单曲卡片没有改；要进播放列表时调用 `playNeteaseSong(歌曲编号)`。

## 1. 检查更新

已接上。

对齐旧版 `update.js`：先请求 `api.github.com` 的 `imlinhanchao/fishpi-desktop` latest，失败再试 `gitapi.librejo.cn`。下载地址只把 `https://github.com` 换成镜像主机，空镜像用 `dgm.librejo.cn`。不执行旧版 bat/sh，下载失败或没有安装包会返回错误。界面在 `installed === false` 时标明没有安装。

命令：`update_check`、`update_apply`、`update_open_release`、`desktop_prefs_get`、`desktop_prefs_set`。

## 2. 导入旧客户端配置

已接上读取路径，本机目前没有旧数据。

旧版 `token` 和 `setting` 在 Electron `localStorage`，不在普通 json。Electron 16 的 userData 在 Windows 上是 `%APPDATA%\<应用名>`。`package.json` 的 name 是 `fishpi-app`，electron-builder 的 productName 是 `fishpi`，所以只查这两个目录下的 `Local Storage\leveldb`。本机 `C:\Users\Admin\AppData\Roaming` 里这两个目录都不存在，导入会明确说找不到，不会写成导入成功。

凭据只调用 `credentials::save`，不进 store、localStorage 或日志。能对应的普通设置走现有 `settings_set`。扩展目录、主题、更新镜像和播放模式进应用数据目录的 `desktop-prefs.json`。

命令：`config_import`。

## 3. 断网 / 休眠恢复

部分接上。SDK 有 `reconnect`，但当前状态拿不到可变连接句柄，不能安全调用。

`fishpi-sdk` 1.1.0 的 `ChatRoomConnection::reconnect`、`ChatConnection::reconnect`、`NoticeConnection::reconnect` 都要 `&mut self`。`AppState` 只有 `take_*`（会拆掉已挂上的监听）和幂等 `connect`（句柄还在就直接返回）。因此：

- Windows 上注册休眠唤醒和网络恢复，各通道在没有句柄时调用一次现有 `chatroom_connect` / `chat_connect` / `notice_connect`。
- 句柄还在时不调用，界面写明未自动重连。
- 不循环重试。8 秒内重复的系统通知只处理一次。

命令：`reconnect_watch`、`reconnect_now`。事件：`desktop://reconnect`。

## 4. 自定义主题

已接上本地文件，没有重做视觉。

只从用户本机扩展目录（默认 `~/.fishpi`，也可沿用旧 `extensions.root`）读取一个主题 CSS。拒绝 `@import`、远程 `url(`、`expression(`、`javascript:`。找不到或读失败就撤掉注入样式，继续用现有内置主题。

命令：`extension_load_theme`。

## 5. 本地 JS 插件

只列出，不执行。

对齐旧扩展目录，只读本机 `package.json`。不下载远程插件，不把凭据或 shell 交给插件，不执行插件脚本来读 token。

做不到安全等价、调用时返回明确错误的 API：

- `electron`
- `electron.shell`
- `electron.ipcRenderer`
- `child_process`
- `context.fishpi`（旧版会在 login 时拿到 token）
- `login` 事件
- `require`
- 远程下载插件

`activate`、`hooks.messageEvent`、`hooks.sendMsgEvent`、`hooks.liveness`、`setSidebar`、`setHookJs`、`getSettingUrl` 都依赖上面这些能力，因此都没有实现。

命令：`extension_scan`、`extension_call`。

## 6. 网易云播放列表

播放器已接上。聊天里的单曲卡片没有接进来。

播放方式对齐旧 `setting.global.music`：0 替换为这一首，1 加入列表且不切歌，2 加入并播最后一首。歌曲信息用旧 `main.js` 的 `http://music.163.com/api/song/detail/`，播放地址用 `http://music.163.com/song/media/outer/url?id=`。只交给 `<audio>` 播放，不保存音频文件，不处理付费。

卡片仍由聊天室自己的播放按钮负责。父组件若要进这个列表，挂上 `PlaylistMount` 后调用 `playNeteaseSong(id)`。

命令：`music_resolve`。

## 7. 离线消息库

库已接上。聊天室和私聊页面还不会自动先读它。

文件在应用数据目录 `offline-messages.json`。写入前去掉 token 一类字段。没有消息 ID 的内容不会当成发送成功。`offline_fail_send` 只记失败。

`DesktopMount` 挂上之后会先读本地记录，并在 `chatroom://msg`、`chat://msg` 到达后合并。聊天页面要同样先显示，必须按上面的方式调用 `loadOffline` / `mergeOffline`。这次不能改 `src/features/chatroom` 和 `src/features/im`。
