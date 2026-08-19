# CC-Panes Hooks Tooling

> 面向 CC-Panes / Codex 的 TypeScript Hook 治理工具层：把 task binding、project policy、workflow advisory、session federation 和验收证据串成可审计的 AI 编程工作流。

当一个项目同时被多个 AI 实例、多个终端、多个 worktree 操作时，最容易出问题的不是“能不能写代码”，而是：

- 当前实例到底属于哪个 task；
- 哪些路径和命令被本轮任务授权；
- 用户在 plan 阶段追加的限制能否进入机械执行边界；
- hook 阻断、放行、验收和 live 安装状态能否留下证据；
- Codex / CC-Panes 会话之间的上下文能否被归因和交接。

这个仓库提供一套本地优先、fail-closed、可测试的工具层，把这些边界落成 CLI、策略文件、审计 artifact 和验证命令。

## 快速入口

- 3-5 分钟上手：[`docs/quick-start.md`](./docs/quick-start.md)
- 核心 schema / artifact 索引：[`docs/artifacts.md`](./docs/artifacts.md)
- 架构总览：[`docs/architecture.md`](./docs/architecture.md)
- repo / live / runtime state 边界：[`docs/runtime-state.md`](./docs/runtime-state.md)

## 核心能力

- **Task Binding**：为每个项目 / worktree 写入并校验 `.ccpanes-task/current-task.json`，阻止 task scope mismatch。
- **Project Policy Gate**：把用户规则沉淀为 `policy.md` 与 `policy.json`，由 hook-enforce / permission-enforce 读取执行。
- **Hook Enforcement**：适配 Codex hook event，在 PreToolUse、PermissionRequest、PostToolUse、Stop 等阶段执行拦截、审计和验收提醒。
- **Workflow Advisory**：对 prompt 做风险分级和工作流建议，辅助选择 plan 强度、检查项和边界提示。
- **Session Bridge**：只读索引 Codex 会话，支持项目归因、留存检查、轻量交接和 sidebar artifact 流程。
- **Production Verification**：内置 `verify-installed-hooks`、`verify-live-consistency`、`record-acceptance`、`verify-acceptance` 等发布前检查。

## 适合场景

- 在 CC-Panes / Codex 中长期维护多个项目、多个 AI 会话和多个 worktree。
- 希望把“用户授权、项目规则、任务归属、hook 阻断、验收证据”从口头约定变成可检查 artifact。
- 需要给团队或多实例协作提供统一的 AI 编程治理层，而不是只依赖单次 prompt 记忆。

当前定位：**Beta+ / 内部生产可用**。仓库已经具备完整 TypeScript 类型检查、Vitest 覆盖、构建、smoke、live 一致性和 hook 安装验证流程；外部分发前仍建议按自己的宿主环境复核路径、hook 配置和安全策略。

## 仓库与固定路径

远端仓库明文固定为：

```text
https://github.com/lihuabin1516-design/hooks.git
```

本机维护仓库：

```text
D:\cc-pane\tool\repos\hooks
```

当前 live 安装/验证路径：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe
```

Codex 全局 hooks 当前指向 live 路径下的 CLI：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js
```

仓库能力与 live 生效状态分开判断：仓库文档描述当前 repo 版本，live 是否已
获得同一能力，必须以最近一次 `verify-live-consistency`、
`verify-installed-hooks` 和 live 完整门禁结果为准。

详细远端记录见 [`REMOTE.md`](./REMOTE.md)。

## 架构与运行状态

- 快速上手见 [`docs/quick-start.md`](./docs/quick-start.md)
- 架构总览见 [`docs/architecture.md`](./docs/architecture.md)
- 运行状态与边界见 [`docs/runtime-state.md`](./docs/runtime-state.md)
- schema / artifact 索引见 [`docs/artifacts.md`](./docs/artifacts.md)

## 日常使用

### Codex 会话桥接

外部只读会话索引、项目归因、留存检查、轻量交接，以及
`sidebar-plan` / `sidebar-apply` / `sidebar-reconcile` /
`sidebar-rollback-plan` 的两阶段 name + host pin artifact 流程见
[`docs/codex-session-bridge.md`](./docs/codex-session-bridge.md)。本仓库当前 Codex
0.147.0 adapter 中，pin/unpin 由 Codex App host 执行，App Server adapter 负责
thread name。

### 1. 新项目接入

在 CC-Panes 新开工作区并导入项目后，对项目根目录执行：

```powershell
node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js bootstrap-project `
  --root <project-root> `
  --task-id <task-id> `
  --phase shape
```

该命令会写入：

```text
<project>\AGENTS.md
<project>\.ccpanes-task\current-task.json
<project>\.ccpanes-task\policy.md
<project>\.ccpanes-task\policy.json
<project>\.ccpanes-task\bootstrap-report.json
```

已有 `AGENTS.md` 会保留原内容，只维护 `<!-- ccpanes-hooks:begin -->` 到 `<!-- ccpanes-hooks:end -->` 之间的托管块。已有 `.ccpanes-task\policy.md` 也会保留。

### 2. plan 阶段规则自动沉淀

需求讨论或 plan 阶段出现明确的“禁止、开放、清除、限制”等项目规则时，先用 `plan-intake`
做 dry-run 预览和审计；接入真实 CC-Panes plan 生命周期事件时，用
`plan-lifecycle-intake` 从事件 `cwd` 自动解析当前任务并写入 task-scoped audit；再由
`policy-capture-plan` 写入人类可读 ledger 和 Hook 可执行规则：

```powershell
node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js plan-intake `
  --root <project-root> `
  --prompt "<current user request>" `
  --utterance "计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。" `
  --audit-out <audit-json>

node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js plan-lifecycle-intake `
  --resolve-task-from-cwd `
  --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits `
  --event <ccpanes-plan-lifecycle-event.json>

node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js policy-capture-plan `
  --root <project-root> `
  --utterance "计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。"
```

`plan-intake` 输出 `ccpanes.plan-intake.v1`，组合 `classify-workflow` 和 plan policy
候选识别；默认不写 `.ccpanes-task\policy.md` 或 `.ccpanes-task\policy.json`。
`plan-lifecycle-intake` 输出同一 schema，并把 audit 固定写到
`<audit-root>\<base64url(taskId)>\plan-intake-audit.json`；找不到当前 task 时不输出也不写 audit。
`policy-capture-plan` 只识别明确的命令级和路径级表达，未识别到规则时返回 `changed=false`，不创建项目 policy 文件。需要精确指定 matcher 时，继续使用底层 `policy-capture`：

```powershell
node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js policy-capture `
  --root <project-root> `
  --id block-publish `
  --instruction "禁止运行 publish-artifact，除非我明确解除。" `
  --effect block `
  --reason user_blocked_publish `
  --tool shell `
  --command-contains publish-artifact
```

输出文件：

```text
<project>\.ccpanes-task\policy.md    # 人类/模型可读规则台账
<project>\.ccpanes-task\policy.json  # hook-enforce / permission-enforce 读取的机械规则
```

### 3. prompt 风险分级

`classify-task-risk` 对 prompt 进行 Light / Standard / Heavy 分级，输出机器可读
`ccpanes.task-risk.v1`，供后续 UI、启动策略和计划强度使用。
`classify-workflow` 在此基础上增加长期工作流路由、闭环强度、必要检查和边界提示，
输出 `ccpanes.workflow-profile.v1`。两者都只提供提示信号，实际写入边界仍由
`hook-enforce`、`permission-enforce` 和项目 policy 决定。

```powershell
node dist/src/cli.js classify-task-risk --prompt "修改 src/foo.ts 并更新测试" --cwd <project-root>
node dist/src/cli.js classify-workflow --prompt "扩展 hook-event-adapter 并更新测试" --cwd <project-root> --changed-path src/hook-event-adapter.ts --changed-path tests/hook-event-adapter.test.ts
```

### 4. 宿主适配 registry

`host-adapter-registry` 输出机器可读 `ccpanes.host-adapter-registry.v1`，集中记录
Codex、CC-Panes / Claude、Cursor、Gemini、Kimi、OpenCode 的接入状态、hook
surface、审计 artifact、验证命令和边界。它只描述能力和证据要求，不替代
`hook-enforce` / `permission-enforce` 的 hard gate。

```powershell
node dist/src/cli.js host-adapter-registry
node dist/src/cli.js host-adapter-registry --host codex
```

### 5. 低层机械规则维护

`policy-add`、`policy-disable`、`policy-clear`、`policy-list`、`policy-validate` 直接维护 `.ccpanes-task\policy.json`：

```powershell
node dist/src/cli.js policy-add --root <project-root> --id block-publish-json-only --effect block --reason user_blocked_publish --tool shell --command-contains publish-artifact
node dist/src/cli.js policy-list --root <project-root>
node dist/src/cli.js policy-validate --root <project-root>
node dist/src/cli.js policy-disable --root <project-root> --id block-publish-json-only
node dist/src/cli.js policy-clear --root <project-root>
```

## Hook 运行链路

全局 hooks 负责把 Codex 事件转交给本工具层：

```text
Codex hook event
  -> dist/src/cli.js
  -> resolve-task-from-cwd / verify-task-binding
  -> Git worktree root + common-dir topology
  -> <worktreeRoot>\.ccpanes-task\current-task.json
  -> <worktreeRoot>\.ccpanes-task\policy.json
  -> allow / deny / audit
```

`projectPath` 表示 canonical 项目目录，`worktreeRoot` 表示当前 task 的实际
checkout 和所有 task-scoped 写入边界。父级 workspace binding 不会跨 Git root
授权嵌套项目写入；三个声明路径只接受规范化绝对路径。Git topology 探测失败
返回 `git-topology-unavailable`，无法推导 canonical project 的 Git topology
返回 `project-root-mismatch`，两类 mismatch 写调用都 fail-closed。
`.ccpanes-task` 目录和 `current-task.json` 不接受 symlink/junction，原子写入前
会复核物理目录身份。Shell 命令只有命中明确只读分类时才按只读处理，未知命令
或带额外写入参数/复合语法的命令默认视为可能写入。

`stale-parent-binding` 只开放一个自修复 bootstrap 例外：PreToolUse 与
PermissionRequest 都仅接受单条 `node` / `node.exe` / 当前 `process.execPath`
调用当前 hook CLI 入口执行 `write-current`，且 `--root` 必须等于当前
`TaskBindingCheck.gitRoot`，`--task-id` 非空，`--phase` 为合法 task phase。
可选参数仅限 `--workspace`、`--leader-session-id`、`--notes`；未知参数、重复
参数、缺值、重定向、换行、管道、连接符、反引号和 `$()` 均继续 fail-closed。
放行 reason 固定为 `task_binding_bootstrap_write`，普通 mismatch 写入仍使用
`task_binding_scope_mismatch:<TaskBindingStatus>` 阻断。

主要入口：

```text
session-start       注入当前任务上下文
plan-intake         plan 阶段 workflow/policy dry-run 和 audit
plan-lifecycle-intake  从真实 plan lifecycle event 解析 task 并写 task-scoped dry-run audit
classify-task-risk  prompt 级 Light / Standard / Heavy 风险分级
classify-workflow   SBA 风格任务路由、闭环强度和检查建议
workflow-advisory   Codex UserPromptSubmit 生产级实现建议与隐私保护审计
host-adapter-registry  机器可读宿主适配能力目录
hook-enforce        PreToolUse 执行前拦截
permission-enforce  PermissionRequest 拦截高风险授权请求
post-enforce        PostToolUse 追加审计记录
stop-check          Stop 阶段给出验收提醒
verify-task-binding 校验 task 文件、active worktree 与 canonical project topology
verify-live-consistency  repo/live 源码与 dist 一致性只读自检
```

主要 JSON artifact 与 schema version 见 [`docs/artifacts.md`](./docs/artifacts.md)。

## 目录说明

长期维护目录和职责见 [`PROJECT-DIRECTORY.md`](./PROJECT-DIRECTORY.md)。关键约定：

```text
src/        TypeScript 源码，按工具层能力拆分
tests/      Vitest 测试，每个 src 能力尽量有对应测试
scripts/    smoke 和维护脚本
examples/   合成事件、请求、配置示例
templates/  AGENTS.md 与 policy 模板
docs/       分阶段计划和长期设计记录
dist/       构建产物，本仓库忽略，由 npm run build 生成
```

## 接手入口

下一任维护者先读：

1. [`HANDOFF.md`](./HANDOFF.md)
2. [`PROJECT-DIRECTORY.md`](./PROJECT-DIRECTORY.md)
3. [`REMOTE.md`](./REMOTE.md)
4. 本文件的“日常使用”和“验收命令”

## 开发与验收命令

```powershell
cd D:\cc-pane\tool\repos\hooks
npm ci
npm run verify
```

单项排查时可分别运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run smoke`。
GitHub Actions 会在 `main` push、pull request 和手动触发时执行同一组验证，并额外运行 `npm audit --audit-level=high`。

生产路径同步后，在 live 路径重复执行：

```powershell
cd D:\cc-pane\tool\experiments\ccpanes-task-probe
npm run verify
node dist/src/cli.js verify-installed-hooks `
  --hooks-json C:\Users\AI001\.codex\hooks.json `
  --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe `
  --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits `
  --config C:\Users\AI001\.codex\config.toml
node dist/src/cli.js verify-live-consistency `
  --repo-root D:\cc-pane\tool\repos\hooks `
  --live-root D:\cc-pane\tool\experiments\ccpanes-task-probe
```

## 安全边界

- 用户配置路径作为已安装状态读取和哈希核验对象：`C:\Users\AI001\.codex`、`C:\Users\AI001\.cc-panes`。
- `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe` 是上游 hook 可执行文件引用；本工具层维护中保持哈希核验，不直接运行。
- `C:\Users\AI001\.fastctx\bin\fastctx.exe` 是 FastCtx 本机落盘可执行文件；本工具层维护中只记录存在状态、大小和 SHA-256，不直接执行。
- `D:\cc-pane\tool\repos\comet` 和 `D:\cc-pane\tool\repos\fastctx` 是参考仓库，上游分别固定为 `https://github.com/rpamis/comet.git` 和 `https://github.com/yc-duan/fastctx.git`；常规维护只检查 status、remote 和 HEAD。
- 真实写入应限定在本仓库、live prototype、或合成 fixture 目录内。

## 仓库能力状态

以下清单描述当前 repo 版本；不得仅凭此清单推断 live/global hook 已完成同步。

已实现并验证的主链路：

```text
bootstrap-project
agents-install / agents-validate
policy-capture
plan-intake
plan-lifecycle-intake
policy-capture-plan
policy-add / policy-list / policy-validate / policy-disable / policy-clear
classify-task-risk
classify-workflow
workflow-advisory
host-adapter-registry
hook-enforce / permission-enforce / post-enforce
session-start / stop-check
verify-task-binding
verify-installed-hooks
verify-live-consistency
record-acceptance / verify-acceptance with layered truth summary
production toolkit / release gate / runbook artifact generation
```

当前项目已进入可长期维护状态：远端、目录职责、交接文件、生产验收命令均在仓库明文记录。
