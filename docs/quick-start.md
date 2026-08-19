# Quick Start

这份文档给第一次接触本仓库的人一个 3-5 分钟入口。完整架构和运行边界分别见
[`architecture.md`](./architecture.md) 与 [`runtime-state.md`](./runtime-state.md)。

## 1. Mental Model

CC-Panes Hooks Tooling 解决的是多 AI 实例协作里的“边界和证据”问题：

```text
project/worktree
  -> .ccpanes-task/current-task.json  # 当前 task 归属
  -> .ccpanes-task/policy.json        # 机械可执行项目规则
  -> Codex/CC-Panes hook event        # 工具调用前后事件
  -> hook-enforce / permission-enforce / post-enforce
  -> audit artifact / acceptance evidence
```

核心原则：

- **task binding 是写入边界的 source of truth**：当前实例只能在匹配的 task/worktree 范围内写。
- **project policy 是用户规则的机械表达**：plan 阶段追加的禁止/允许规则进入 `policy.json` 后由 hook 读取。
- **hook 只在证据足够时放行**：路径、命令、task、policy 或 Git topology 不确定时按 fail-closed 处理。
- **repo 和 live 分开判断**：仓库代码通过不代表全局 hook 已使用同一版本，live 需要单独验证。

## 2. Install and Verify

要求 Node.js `>=22`。

```powershell
git clone https://github.com/lihuabin1516-design/hooks.git
cd hooks
npm ci
npm run verify
```

`npm run verify` 等价于：

```powershell
npm run typecheck
npm test
npm run build
npm run smoke
```

依赖安全检查：

```powershell
npm audit --audit-level=high
```

## 3. Bootstrap a Project

把工具层接入一个项目时，对目标项目根目录执行：

```powershell
node dist/src/cli.js bootstrap-project `
  --root <project-root> `
  --task-id <task-id> `
  --phase shape
```

它会写入或维护：

```text
<project-root>\AGENTS.md
<project-root>\.ccpanes-task\current-task.json
<project-root>\.ccpanes-task\policy.md
<project-root>\.ccpanes-task\policy.json
<project-root>\.ccpanes-task\bootstrap-report.json
```

已有 `AGENTS.md` 会保留原内容，只更新 `<!-- ccpanes-hooks:begin -->` 到
`<!-- ccpanes-hooks:end -->` 之间的托管块。

## 4. Add a Project Policy Rule

从自然语言 plan 规则生成 policy：

```powershell
node dist/src/cli.js policy-capture-plan `
  --root <project-root> `
  --utterance "计划阶段规则：禁止运行 publish-artifact，除非我明确解除。"
```

需要精确 matcher 时直接添加机械规则：

```powershell
node dist/src/cli.js policy-add `
  --root <project-root> `
  --id block-publish `
  --effect block `
  --reason user_blocked_publish `
  --tool shell `
  --command-contains publish-artifact
```

校验：

```powershell
node dist/src/cli.js policy-validate --root <project-root>
```

## 5. Hook Event Flow

生产 hook 通常把 Codex / CC-Panes 事件交给已构建的 CLI：

```text
Codex hook event
  -> node <live-root>\dist\src\cli.js hook-enforce --resolve-task-from-cwd --audit-root <audit-root>
  -> resolve current task from cwd
  -> load .ccpanes-task/policy.json
  -> allow / block / audit
```

常用入口：

```text
session-start          注入当前任务上下文
workflow-advisory      对 prompt 给出工作流和检查建议
hook-enforce           PreToolUse hard gate
permission-enforce     PermissionRequest hard gate
post-enforce           PostToolUse JSONL audit
stop-check             Stop 阶段验收提醒
verify-installed-hooks 检查本机 hook 安装状态
verify-live-consistency 检查 repo/live 源码和 dist 哈希一致性
```

## 6. Debug Checklist

遇到阻断或行为不一致时，按这个顺序看：

1. `git status --short`：确认是否存在未解释变更。
2. `.ccpanes-task/current-task.json`：确认 `taskId`、`projectPath`、`worktreeRoot`、`phase`。
3. `.ccpanes-task/policy.json`：确认规则是否 enabled，matcher 是否命中。
4. hook audit 目录：查看 `hook-enforce-audit.json`、`permission-enforce-audit.json`、`post-tool-use-audit.jsonl`。
5. `node dist/src/cli.js verify-task-binding --resolve-task-from-cwd`：确认 task binding 与 Git topology。
6. `node dist/src/cli.js verify-installed-hooks ...`：确认用户配置里的 hook 指向。
7. `node dist/src/cli.js verify-live-consistency ...`：确认 live 目录确实与 repo 版本一致。

## 7. What to Read Next

- [`artifacts.md`](./artifacts.md)：核心 schema 和 artifact 索引。
- [`architecture.md`](./architecture.md)：模块 owner、调用链和边界。
- [`runtime-state.md`](./runtime-state.md)：repo、live、本地运行状态的区别。
- [`codex-session-bridge.md`](./codex-session-bridge.md)：Codex 会话索引、归因、交接和 sidebar artifact。
