# 架构总览

本文只描述仓库源码层的当前稳定分层，不描述 live 安装细节。

## 顶层分层

```text
CLI router
  -> owner modules
  -> policy / binding / profile
  -> dry-run / enforce / audit
  -> release / approval / runbook artifacts
```

## 主要 owner

- `src/cli.ts`、`src/cli-router.ts`、`src/cli-shared.ts`、`src/cli-types.ts`、`src/cli/*.ts`：入口、路由、共享解析和按命令族拆分的 CLI handler
- `src/current-task.ts`、`src/paths.ts`、`src/types.ts`：task binding、路径归一化和共享类型
- `src/project-policy.ts`、`src/project-policy-capture.ts`、`src/project-policy-ledger.ts`、`src/plan-policy-capture.ts`：项目规则模型、台账和沉淀入口
- `src/plan-intake.ts`、`src/task-risk.ts`、`src/workflow-profile.ts`、`src/runtime-profile.ts`：plan / risk / workflow / runtime 的分类和提示
- `src/hook-event-adapter.ts`、`src/hook-shell-analyzer.ts`、`src/hook-dry-run.ts`、`src/hook-batch.ts`、`src/hook-runner.ts`：事件适配、命令判定和 dry-run 执行
- `src/cli/hook.ts`、`src/hook-runner.ts`、`src/post-tool-audit.ts`、`src/session-lifecycle.ts`：hook 拦截、授权、审计和生命周期输出
- `src/agents-entry.ts`、`src/project-bootstrap.ts`：AGENTS.md 托管块和项目初始化
- `src/codex-session-*.ts`、`src/codex-sidebar*.ts`、`src/ccpanes-session-snapshot.ts`、`src/session-federation*.ts`：会话桥接、索引和侧边栏归因
- `src/hook-install-plan.ts`、`src/hook-package*.ts`、`src/hook-apply-plan.ts`、`src/hook-write-*.ts`、`src/hook-production-readiness.ts`、`src/hook-go-live-approval.ts`、`src/hook-final-runbook.ts`、`src/production-toolkit.ts`、`src/acceptance*.ts`：发布、审批、写入和验收产物

## 命令流

```text
external event
  -> cli.ts
  -> adapter / binding / policy
  -> dry-run or enforce
  -> audit / artifact
```

常见命令族：

- task / policy / plan：`bootstrap-project`、`agents-install`、`agents-validate`、`policy-*`、`plan-*`、`classify-task-risk`、`classify-workflow`、`host-adapter-registry`
- hook pipeline：`dry-run-hook`、`adapt-hook-event`、`hook-runner`、`hook-enforce`、`permission-enforce`、`post-enforce`、`session-start`、`stop-check`、`hook-shadow`
- release / live：`plan-hook-install`、`create-hook-package`、`rehearse-hook-package`、`release-gate`、`create-hook-apply-plan`、`check-hook-approval`、`preview-hook-write`、`apply-hook-write`、`restore-hook-write`、`production-readiness`、`create-go-live-approval-package`、`create-final-runbook`、`verify-installed-hooks`、`verify-live-consistency`
- session / sidebar：`codex-sessions` 家族、`probe`、`handoff generate`

## 边界约定

1. `cli.ts` 只保留入口和 handler registry；命令族解析放在 `src/cli/*.ts`，领域规则继续回到 owner 模块。
2. 规则、状态和路径判断都回到 owner 模块。
3. `dist/`、`live/`、`.tmp-smoke/`、`/.ccpanes-task/` 这类目录属于运行产物或状态边界，不手改成源码。
4. 任何 repo/live 同步先在 repo 走 `npm run verify`，再走 live 的只读一致性校验。
