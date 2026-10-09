# 私聊迁移交接

完整旧版 checklist、实现差异、自检与剩余验收记录统一见 `docs/migration/im.md`。

- 私聊列表、历史、发送、已读、撤回、搜人及事件已有真实 Bridge 接线，不再使用本文件旧版的“命令缺失”清单。
- 持久测试：`node src/features/im/tests/migration-im.test.mjs`，15 项通过，无新增依赖。
- 浏览器回归：`node src/features/im/tests/browser-selfcheck.mjs`（已有 Vite/Playwright）；唯一 sibling key 修复通过 A→B→A、分页/实时/草稿与卸载断言。
- state 同锁代次条件 send/take 和 live 快照契约已接入，pending 不再返回成功；实现与 Cargo 验证由父级负责。
- 剩余：原生通知点击与真账号/Windows 验收。
- Cargo 与桌面调试 exe 由主线程统一处理；本 feature 不修改中心注册、共享状态、离线存储或旧项目。
