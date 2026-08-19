# CC-Panes Hooks Tooling

<p align="center">
  <a href="https://github.com/lihuabin1516-design/hooks/actions/workflows/verify.yml"><img src="https://github.com/lihuabin1516-design/hooks/actions/workflows/verify.yml/badge.svg" alt="verify" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-339933" alt="Node.js >= 22" />
  <img src="https://img.shields.io/badge/hooks-fail--closed-111827" alt="fail closed hooks" />
</p>

> Codex App 与 CC-Panes 的外部 hooks 治理层：把 task binding、project policy、workflow advisory、session bridge 和 acceptance evidence 串成可审计、可测试、可推广的 AI 编程边界系统。

当一个项目同时被多个 AI 实例、多个终端、多个 worktree 操作时，真正危险的通常不是“模型能不能写代码”，而是：

- 当前会话到底属于哪个 task；
- 哪些路径、命令和副作用被本轮授权；
- plan 阶段追加的限制能否进入机械执行边界；
- hook 阻断、放行、审计和验收能否留下证据；
- Codex App 与 CC-Panes 的上下文能否被归因、索引和交接。

本仓库把这些口头约定落成 TypeScript CLI、项目策略文件、hook gate、审计 artifact 和验证命令。

## 定位

CC-Panes 是宿主工具；本仓库是外部 hooks 工具层。两者互补，不重复。

| 归属 | 负责内容 |
| --- | --- |
| CC-Panes | 桌面工作台、终端分屏、workspace / project / task、MCP、skills、Git、本地历史、编排执行 |
| 本仓库 | task binding、project policy、hook enforcement、workflow advisory、session bridge、acceptance evidence、live consistency |
| 接入边界 | hook event、prompt lifecycle、session attribution、安装和验证流程 |

推荐理解方式：**CC-Panes 管“工作台和会话”，本仓库管“边界、规则和证据”。**

本仓库不替代 CC-Panes 的桌面 UI、Pane / PTY、CLI adapter、MCP 编排、项目管理或本地历史能力；它运行在 Codex / CC-Panes 可触发的 hook 生命周期旁边，提供独立的 task scope、policy gate、audit 和验收证据层。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| Task Binding | 为 project / worktree 写入并校验当前 task，阻止 task scope mismatch。 |
| Project Policy Gate | 把用户规则沉淀为人类可读 ledger 和机器可执行 policy。 |
| Hook Enforcement | 适配 Codex hook event，在关键阶段执行 allow / deny / audit。 |
| Workflow Advisory | 对 prompt 做风险分级、工作流建议和检查项提示。 |
| Session Bridge | 只读索引 Codex 会话，支持项目归因、留存、交接和 sidebar artifact。 |
| Acceptance Evidence | 记录检查、artifact hash、truth layer 和完成门禁。 |
| Live Consistency | 校验仓库源码、构建产物和 live runtime 的一致性。 |

## 运行链路

```text
Codex / CC-Panes event
  -> node dist/src/cli.js <command>
  -> resolve current task from cwd
  -> load task binding and project policy
  -> evaluate hook / workflow / session command
  -> write audit or acceptance artifact
  -> allow, deny, or report
```

默认策略是 fail closed：task、路径、policy、Git topology 或命令读写性质不确定时，不靠猜测放行。

## Quick Start

要求 Node.js `>=22`。

```powershell
git clone https://github.com/lihuabin1516-design/hooks.git
cd hooks
npm ci
npm run verify
```

初始化一个项目：

```powershell
node dist/src/cli.js bootstrap-project `
  --root <project-root> `
  --task-id <task-id> `
  --phase shape
```

捕获一条 plan 阶段规则：

```powershell
node dist/src/cli.js policy-capture-plan `
  --root <project-root> `
  --utterance "计划阶段规则：禁止运行 publish-artifact，除非我明确解除。"
```

执行 hook gate：

```powershell
node dist/src/cli.js hook-enforce `
  --resolve-task-from-cwd `
  --audit-root <audit-root>
```

## 常用命令

| 命令族 | 入口 |
| --- | --- |
| project bootstrap | `bootstrap-project`, `agents-install`, `agents-validate` |
| task binding | `write-current`, `verify-task-binding` |
| policy | `policy-capture`, `policy-capture-plan`, `policy-add`, `policy-list`, `policy-validate`, `policy-disable`, `policy-clear` |
| plan / workflow | `plan-intake`, `plan-lifecycle-intake`, `classify-task-risk`, `classify-workflow`, `workflow-advisory` |
| hook pipeline | `dry-run-hook`, `adapt-hook-event`, `hook-runner`, `hook-enforce`, `permission-enforce`, `post-enforce`, `session-start`, `stop-check`, `hook-shadow` |
| session bridge | `codex-sessions`, `handoff generate`, `probe` |
| release / evidence | `verify-installed-hooks`, `verify-live-consistency`, `record-acceptance`, `verify-acceptance` |

## 安全模型

- **Task scope first**：写操作必须匹配当前 task / worktree。
- **Policy as code**：用户规则进入 policy 后由 hook 机械执行。
- **Path canonicalization**：路径比较使用规范化结果，避免别名和 junction 误判。
- **Read-only proof**：shell 命令只有被明确证明为只读时才按只读处理。
- **Audit before trust**：阻断、放行和验收都输出可检查 artifact。
- **Repo / live separated**：仓库代码通过验证，不等于 live runtime 已同步。

## 文档地图

- [`docs/quick-start.md`](./docs/quick-start.md)：更短的上手入口。
- [`docs/architecture.md`](./docs/architecture.md)：源码分层、owner 和命令流。
- [`docs/artifacts.md`](./docs/artifacts.md)：核心 JSON artifact 与 schema 索引。
- [`docs/codex-session-bridge.md`](./docs/codex-session-bridge.md)：Codex 会话索引、归因和交接。
- [`MAINTENANCE.md`](./MAINTENANCE.md)：维护、验证、repo/live 同步和本地运行细节。

## 开发

```powershell
npm run typecheck
npm test
npm run build
npm run smoke
```

完整门禁：

```powershell
npm run verify
```

## 适合谁

- 长期在 Codex App / CC-Panes 中维护多个项目的人；
- 需要多 AI 实例协作但又想保留清晰边界的团队；
- 想把“授权、规则、阻断、验收”从 prompt 约定变成可验证机制的工程用户。

## Support

- Issues: [github.com/lihuabin1516-design/hooks/issues](https://github.com/lihuabin1516-design/hooks/issues)
- Discussions: [github.com/lihuabin1516-design/hooks/discussions](https://github.com/lihuabin1516-design/hooks/discussions)
