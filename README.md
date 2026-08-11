# CC-Panes Hooks 工具层

这是 CC-Panes / Codex 项目上下文与 Hook 治理工具层。它的职责是：让每个项目在导入或启动时自动拥有任务上下文、项目级规则、AGENTS.md 接入块和可审计的 Hook 执行边界。

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

## 日常使用

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
host-adapter-registry  机器可读宿主适配能力目录
hook-enforce        PreToolUse 执行前拦截
permission-enforce  PermissionRequest 拦截高风险授权请求
post-enforce        PostToolUse 追加审计记录
stop-check          Stop 阶段给出验收提醒
verify-task-binding 校验 task 文件、active worktree 与 canonical project topology
verify-live-consistency  repo/live 源码与 dist 一致性只读自检
```

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
npm install
npm test
npm run typecheck
npm run build
npm run smoke
```

生产路径同步后，在 live 路径重复执行：

```powershell
cd D:\cc-pane\tool\experiments\ccpanes-task-probe
npm test
npm run typecheck
npm run build
npm run smoke
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
