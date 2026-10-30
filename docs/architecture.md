# 架构总览

本文只描述仓库源码层的当前稳定分层，不描述 live 安装细节。

## 顶层分层

```text
CLI router
  <- command hook or Codex MCP hook adapter
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
- `src/hook-event-adapter.ts`、`src/hook-shell-analyzer.ts`、`src/hook-dry-run.ts`、`src/hook-batch.ts`、`src/hook-runner.ts`、`src/task-lifecycle-authorization.ts`：事件适配、命令判定、可信任务生命周期授权和 dry-run 执行
- `src/mcp-server.ts`、`src/mcp-hook-adapter.ts`：Codex `mcp_tool` 生命周期入口；暴露只读 `runtime_identity`，并将生命周期事件结构化转发到 CLI，错误继续 fail closed
- `src/runtime-identity.ts`、`scripts/write-runtime-identity.mjs`：加载、校验和比较构建身份；`npm run build` 在编译后生成 `dist/src/runtime-identity.json`
- `src/cli/hook.ts`、`src/hook-runner.ts`、`src/hook-decision-audit.ts`、`src/post-tool-audit.ts`、`src/session-lifecycle.ts`：hook 拦截、授权、快照/追加审计和生命周期输出
- `src/atomic-file.ts`、`src/runtime-deployment.ts`：以成熟进程锁串行化审计和部署，校验 clean build 与完整 package payload，保存不可变 release，通过稳定启动器和原子 `current.json` 指针切换、恢复及回滚
- `src/agents-entry.ts`、`src/project-bootstrap.ts`：AGENTS.md 托管块和项目初始化
- `src/codex-session-*.ts`、`src/codex-sidebar*.ts`、`src/paneforge-session-snapshot.ts`、`src/session-federation*.ts`：会话桥接、索引和侧边栏归因
- `src/hook-install-plan.ts`、`src/hook-package*.ts`、`src/hook-apply-plan.ts`、`src/hook-write-*.ts`、`src/hook-production-readiness.ts`、`src/hook-go-live-approval.ts`、`src/hook-final-runbook.ts`、`src/production-toolkit.ts`、`src/acceptance*.ts`：发布、审批、写入和验收产物

## 命令流

```text
external event
  -> command hook -> cli.ts
  or Codex mcp_tool -> mcp-server.ts -> mcp-hook-adapter.ts -> cli.ts
  -> adapter / binding / policy
  -> dry-run or enforce
  -> audit / artifact
```

常见命令族：

- task / policy / plan：`bootstrap-project`、`agents-install`、`agents-validate`、`policy-*`、`plan-*`、`classify-task-risk`、`classify-workflow`、`host-adapter-registry`
- hook pipeline：`dry-run-hook`、`adapt-hook-event`、`hook-runner`、`hook-enforce`、`permission-enforce`、`post-enforce`、`session-start`、`stop-check`、`hook-shadow`
- release / live：`plan-hook-install`、`create-hook-package`、`rehearse-hook-package`、`release-gate`、`create-hook-apply-plan`、`check-hook-approval`、`preview-hook-write`、`apply-hook-write`、`restore-hook-write`、`production-readiness`、`create-go-live-approval-package`、`create-final-runbook`、`deploy-runtime`、`recover-runtime`、`rollback-runtime`、`verify-installed-hooks`、`verify-live-consistency`
- session / sidebar：`codex-sessions` 家族、`probe`、`handoff generate`

## 边界约定

1. `cli.ts` 只保留入口和 handler registry；命令族解析放在 `src/cli/*.ts`，领域规则继续回到 owner 模块。
2. 规则、状态和路径判断都回到 owner 模块。
3. `dist/`、`live/`、`.tmp-smoke/`、`/.paneforge-task/` 这类目录属于运行产物或状态边界，不手改成源码。
4. 任何 repo/live 同步先在 repo 走 `npm run verify`，再走 live 的只读一致性校验。
5. Codex MCP 安装必须同时覆盖 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse` 和 `Stop`；工具 matcher 至少覆盖 `apply_patch`、`Bash` 与 FastCtx 的 `inspect_local_file`、`grep`、`glob`、`replace`。
6. `archive` 默认继续阻断实现写入；只有当前可信 CLI、精确任务路径和单命令语法同时匹配时，才允许读取 `verify-acceptance`、定向写入 `.paneforge-task/acceptance.json`，或将同一 task 从 `archive` 回退到 `verify`。该例外不得开启 `build`、切换 task 或覆盖 project policy block。
7. 运行时身份是证据，不是授权旁路。`runtimeTaskHeadStatus=mismatch` 明确表示当前进程加载的 commit 与 task HEAD 不同，必须重启到正确版本后再验收。
8. PreToolUse / PermissionRequest 的 `*-audit.json` 保持最新快照兼容；同名 `*.jsonl` 是 append-only 决策历史。二者都记录 runtime identity，但身份不改变既有 allow/deny 语义。
