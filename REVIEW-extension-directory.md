# extension-directory 在途批（10-12 遗留）审读记录

审读人：前端（外包）｜审读日：2026-10-19｜基线：537d505
性质：**孤儿在途工作留证分支，不合 master**（PM seq=405 三/seq=410 一 口径）

## 归属证据
- 批内全部文件 mtime = 2026-10-12 16:27~16:32，与 notification-target/shell 批同一时段；
- 王华琛（seq=410）与前端（外包）均自证当日无源文件写操作；作者按现有证据不可考。

## 文件清单（原样保留，未改写）
- `src-tauri/src/commands/extension_directory.rs`（新增，未跟踪→已入库）：`extension_choose_directory` 命令，rfd::AsyncFileDialog 实现，复用 `config_import::valid_extension_root`/`load_prefs`，自带单元测试。
- `src/features/extension/api.ts`（M）：新增 `extensionChooseDirectory()` invoke 封装。
- `src/features/extension/ExtensionMount.tsx`（M）：目录选择按钮 + draft/pendingPicker 修订守卫（模式与 useArticles 的 revision 守卫一致，质量合格）。
- `src/features/extension/directory.test.mjs`（新增）：3 条用例（命令注册对账×2 + cancel 保留草稿）。
- `docs/migration/extensions.md`（M）：迁移文档同步。

## 审读结论
1. **代码质量：可接受**。Rust 侧校验前置（相对路径/UNC/URL/NUL 拒绝有测试）；前端侧 mounted+revision 守卫完整，无越权写设置。
2. **阻塞项：依赖无法满足**。`rfd` 不在 Cargo.toml（grep 0）、不在 Cargo.lock（0）、不在本机离线 cargo 缓存（348 crates 无 rfd；tauri-plugin-dialog 亦无）。离线 `cargo build` 无法引入 ⇒ **本分支不注册该命令进 mod.rs/lib.rs**（注册即全 crate 编译失败，污染 Rust T0=95 基线）。
3. **已知红点**：本分支上 `directory.test.mjs` 3 条 FAIL 是**预期内**（命令未注册），随依赖决策销项，不入 T0 已知失败清单（测试 seq=407 已同样定性为在途特性缺陷）。

## 收口路径（三选一，需 PM/后端裁）
- A. CI 联网后 `cargo add rfd`（Win 下走原生 IFileDialog，无新增运行时依赖冲突）→ 补 mod.rs/lib.rs 注册 → 红转绿。
- B. 改挂 tauri-plugin-dialog（需插件 crate + capability 注册，改动面更大，后端熟）。
- C. 弃原生弹窗，沿用旧版式手输路径输入框（前端 <0.2d，功能降级但零依赖）。
本分支保持"留证不合并"，直至 A/B/C 落定。
