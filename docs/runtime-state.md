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

## 构建身份与 stale 进程

`npm run build` 在 TypeScript 编译后生成 `dist/src/runtime-identity.json`。构建清单包含 Git commit、dirty 状态、全部 `dist/src/**/*.js` 的确定性 SHA-256、包版本和构建时间。运行时只读取随当前模块部署的清单；缺失或无效时返回 `source=unavailable`，不会用工作目录中的 Git 状态冒充已加载代码。部署阶段另生成 release 根部的 `runtime-package-identity.json`，它覆盖 `dist`、package metadata 和复制后的生产依赖全部文件，不能与仅证明编译输出的 build SHA 混用。

身份通过三个观察面暴露：

- MCP `runtime_identity` 工具返回结构化身份、PID、进程启动时间，并可比较预期 task HEAD。
- SessionStart additional context 返回 `runtimeGitCommit`、`runtimeBuildSha256` 和 `runtimeTaskHeadStatus`。
- PreToolUse、PermissionRequest、PostToolUse 及 runtime error 审计记录运行时身份。

`match` 表示运行时 commit 精确等于 task HEAD；`mismatch` 是明确的 stale-runtime 证据；`unknown` 表示任一侧缺少可验证 commit。重新构建不会热更新已经运行的 MCP，完成构建或切换后必须启动新的 Codex/MCP 进程。

## 决策审计

每个 task 的审计目录同时保留：

```text
hook-enforce-audit.json       # 最新 PreToolUse 快照，兼容原 schema
hook-enforce-audit.jsonl      # append-only PreToolUse 历史
permission-enforce-audit.json # 最新 PermissionRequest 快照，兼容原 schema
permission-enforce-audit.jsonl# append-only PermissionRequest 历史
*-audit.json.pending.json     # 快照/历史双写中断时的短暂恢复 journal
post-tool-use-audit.jsonl     # append-only PostToolUse 历史
```

决策历史记录 allow/deny、主 reason、target path、task/workspace/worktree、session/turn/tool-use 标识、时间、运行时身份和完整 runner result。每条记录有唯一 `auditId`；历史追加与快照替换之间先写 pending journal，下一次写入会按 `auditId` 补齐未完成事务且不会重复追加。快照根部仍为 `ccpanes.hook-runner-result.v1`，新增的 `auditContext` 只提供证据，不参与裁决。

## 版本化 runtime 部署

部署目录由操作者显式选择，且命令必须提供包含 source 与 runtime root 的 `--allow-root`。推荐布局：

```text
<runtime-root>/
  cli.mjs
  mcp-server.mjs
  current.json
  previous.json              # 第二个版本切换后出现
  deploy-pending.json         # 仅在部署指针事务进行中短暂存在
  rollback-pending.json       # 仅在回滚事务进行中短暂存在
  releases/
    <git-commit>-<build-sha256>-<payload-sha256>/
      runtime-package-identity.json
      dist/
      package.json
      package-lock.json
      node_modules/
```

稳定启动器只从 `current.json` 的受限 release ID 推导模块路径，并在 import 前重算完整 payload SHA 和文件数，新进程因此只加载与指针身份一致且 package metadata、生产依赖未漂移的当前 release。部署会独立 stage 两次并比较完整 payload，再复核 source HEAD、status 和 build SHA；复制窗口内发生的源码、构建物或生产依赖变化会在指针写入前失败。部署还拒绝 dirty/unavailable identity、任何失败或不确定的 Git HEAD/status probe、source Git HEAD 不匹配、build/payload SHA 不匹配、非法依赖名、非“路径不存在”的依赖探测错误、软链接等不受支持的 payload 条目和 allow-root 外路径；runtime-root 的 pointer、journal、launcher、staging 与 releases 路径必须同时通过词法、真实路径和 symlink/junction 检查。已有 release 必须重新通过完整性检查才视为幂等。

部署、恢复与回滚共用由 `proper-lockfile` 管理的 runtime-root 独占锁。锁使用原子目录获取、stale 检测、持有期间心跳和有界重试，避免一个等待者删除仍由其他进程持有的锁。部署与回滚分别先持久化 from/to 事务记录，再切换 current 和 previous；`recover-runtime` 只依赖 runtime-root 内不可变 release 与 journal，可在原 source 已删除或变脏时完成中断事务。`deploy-runtime` 对已有 runtime 也会在 source 校验前先执行同样恢复。

```powershell
node .\dist\src\cli.js deploy-runtime --source-dir <clean-repository-root> --runtime-root <runtime-root> --allow-root <approved-root>
node .\dist\src\cli.js recover-runtime --runtime-root <runtime-root> --allow-root <approved-root>
node .\dist\src\cli.js rollback-runtime --runtime-root <runtime-root> --allow-root <approved-root>
```

每个 release 包含 `dist`、package metadata 和从 source `node_modules` 递归解析出的生产依赖，可以脱离源码仓库的祖先目录启动。source Git clean/HEAD 校验、build SHA 与完整 payload SHA 共同证明来源工作树和部署包自洽，但不是签名或可复现构建证明；需要更高供应链保证时仍应在受信 CI 中签名发布包。

生产引用应在单独获批的配置变更中固定指向 `<runtime-root>/mcp-server.mjs` 或 `<runtime-root>/cli.mjs`。本命令不修改用户配置。切换或回滚后必须新开进程，并使用 `runtime_identity` 核对 commit/build SHA；旧进程继续报告其原身份，这是预期的 fail-observable 行为。
