# 运行状态与边界

本文把仓库源码、live 安装、副作用状态和用户级引用拆开。

## 权威边界

| 层级 | 路径 | 用途 |
|---|---|---|
| 源码仓库 | `D:\cc-pane\tool\repos\hooks` | TypeScript 源码、测试、文档和 package 元数据 |
| live 运行副本 | `D:\cc-pane\tool\experiments\ccpanes-task-probe` | 已构建 CLI、全局 hooks、生效验证 |
| 项目本地任务状态 | `<project>\.ccpanes-task` | 当前 task、policy、bootstrap report |
| 项目接入点 | `<project>\AGENTS.md` | 托管块和项目级接手说明 |
| 用户级引用 | `C:\Users\AI001\.codex`、`C:\Users\AI001\.cc-panes`、`C:\Users\AI001\.fastctx\bin\fastctx.exe`、`C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe` | 只读核验对象或上游引用 |

## 忽略目录

这些目录属于生成物或运行状态：

- `dist/`
- `live/`
- `.tmp-smoke/`
- `/.ccpanes/`
- `/.ccpanes-task/`
- `node_modules/`
- `*.log`
- `.env`、`.env.*`

## 维护规则

1. 不把运行状态当源码改。
2. 不手改生成产物替代源文件。
3. repo 改动完成后，先在仓库跑 `npm run verify`。
4. 同步到 live 后，再跑 `verify-installed-hooks` 和 `verify-live-consistency`。
5. 如果状态边界和源码边界看起来冲突，以当前仓库文档和最近一次只读验证结果为准。
