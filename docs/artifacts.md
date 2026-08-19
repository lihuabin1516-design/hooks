# Artifact and Schema Index

本仓库把关键运行事实写成 JSON artifact。artifact 的主要用途是：

- 给 hook / policy / workflow 提供机器可读输入；
- 为阻断、放行、验收和发布留下可复核证据；
- 降低多实例协作时对单次对话记忆的依赖。

## Core Runtime Artifacts

| Schema / Version | 默认位置或输出 | Owner | 用途 |
|---|---|---|---|
| `ccpanes.task-selection.v1` | `.ccpanes-task/current-task.json` | `src/current-task.ts` | 当前 task、workspace、project/worktree、owner、phase 的绑定事实。 |
| `ccpanes.task-binding-check.v1` | `verify-task-binding` stdout | `src/current-task.ts` | 校验 cwd、Git topology、task 文件和 canonical project 是否匹配。 |
| `ccpanes.project-policy.v1` | `.ccpanes-task/policy.json` | `src/project-policy.ts` | 机械可执行项目规则，供 enforce 阶段读取。 |
| `ccpanes.project-policy-cli-result.v1` | policy CLI stdout | `src/cli.ts` | `policy-add`、`policy-disable`、`policy-clear`、`policy-list`、`policy-validate` 的统一输出。 |
| `ccpanes.project-policy-capture-result.v1` | `policy-capture` stdout | `src/project-policy-capture.ts` | 将明确规则写入人类 ledger 和机械 policy 的结果。 |
| `ccpanes.plan-policy-capture-result.v1` | `policy-capture-plan` stdout | `src/plan-policy-capture.ts` | 从 plan utterance 识别规则并落入 project policy。 |
| `ccpanes.project-bootstrap-result.v1` | `.ccpanes-task/bootstrap-report.json` | `src/project-bootstrap.ts` | 项目接入时写入 AGENTS、task binding、policy 文件的结果。 |
| `ccpanes.agents-entry-result.v1` | `agents-install` stdout | `src/agents-entry.ts` | AGENTS.md 托管块写入结果。 |
| `ccpanes.agents-entry-validate.v1` | `agents-validate` stdout | `src/agents-entry.ts` | AGENTS.md 托管块校验结果。 |

## Hook and Enforcement Artifacts

| Schema / Version | 默认位置或输出 | Owner | 用途 |
|---|---|---|---|
| `ccpanes.hook-event.v1` | synthetic/generic hook event input | `src/hook-event-adapter.ts` | 通用 hook event 输入格式。 |
| `ccpanes.hook-dry-run-batch.v1` | dry-run input | `src/hook-batch.ts` | 一批 HookCall 的 dry-run 输入。 |
| `ccpanes.hook-dry-run-batch-result.v1` | `dry-run-hook` stdout | `src/hook-batch.ts` | 批量 allow/block 决策结果。 |
| `ccpanes.hook-runner-result.v1` | hook audit JSON / stdout | `src/hook-runner.ts` | PreToolUse / PermissionRequest 的最终 allow/block/audit 结果。 |
| `ccpanes.post-tool-use-audit.v1` | `post-tool-use-audit.jsonl` | `src/post-tool-audit.ts` | PostToolUse 追加审计记录。 |
| `ccpanes.workflow-advisory.v1` | UserPromptSubmit additional context | `src/workflow-advisory-hook.ts` | 给当前 prompt 注入工作流、检查项和实现标准建议。 |
| `ccpanes.workflow-advisory-audit.v1` | workflow advisory audit JSON | `src/workflow-advisory-hook.ts` | workflow advisory 的任务级审计记录。 |
| `ccpanes.hook-shadow-audit.v1` | hook shadow audit | `src/hook-shadow.ts` | hook 接入前 shadow 模式检查。 |

## Classification and Advisory Artifacts

| Schema / Version | 默认位置或输出 | Owner | 用途 |
|---|---|---|---|
| `ccpanes.task-risk.v1` | `classify-task-risk` stdout | `src/task-risk.ts` | Light / Standard / Heavy prompt 风险分级。 |
| `ccpanes.workflow-profile.v1` | `classify-workflow` stdout | `src/workflow-profile.ts` | SBA 风格工作流路由、闭环强度和检查建议。 |
| `ccpanes.implementation-standard.v1` | embedded advisory payload | `src/implementation-standard.ts` | production-grade 实现标准和复杂度控制原则。 |
| `ccpanes.host-adapter-registry.v1` | `host-adapter-registry` stdout | `src/host-adapter-registry.ts` | Codex、CC-Panes、Cursor、Gemini、Kimi、OpenCode 的 hook surface 和验证边界。 |
| `ccpanes.host-adapter.v1` | `host-adapter-registry --host <id>` stdout | `src/cli.ts` | 单个 host adapter 的机器可读描述。 |
| `ccpanes.plan-intake.v1` | `plan-intake` / `plan-lifecycle-intake` stdout 或 audit | `src/plan-intake.ts` | plan 阶段 workflow/profile/policy dry-run 结果。 |
| `ccpanes.plan-lifecycle-event.v1` | lifecycle event input | `src/plan-intake.ts` | CC-Panes plan 生命周期事件输入格式。 |
| `ccpanes.resume-probe.v1` | `probe` stdout | `src/resume-probe.ts` | “继续/恢复”意图和候选 task 判断。 |

## Acceptance and Live Verification Artifacts

| Schema / Version | 默认位置或输出 | Owner | 用途 |
|---|---|---|---|
| `ccpanes.acceptance.v1` | `record-acceptance` stdout / saved JSON | `src/acceptance.ts` | 绑定 task、artifact hashes、checks、truth layers 的验收证据。 |
| `ccpanes.acceptance.verify.v1` | `verify-acceptance` stdout | `src/acceptance-verify.ts` | 重新计算 artifact hash 并验证 checks 是否仍为 pass。 |
| `ccpanes.installed-hooks.verify.v1` | `verify-installed-hooks` stdout | `src/installed-hooks.ts` | 检查用户配置中的 hook 安装、matcher、命令和 trusted hash。 |
| `ccpanes.live-consistency.verify.v1` | `verify-live-consistency` stdout | `src/live-consistency.ts` | 对比 repo/live 的源码、测试、脚本、模板和 dist 哈希。 |

## Release and Manual Go-Live Artifacts

| Schema / Version | 默认位置或输出 | Owner | 用途 |
|---|---|---|---|
| `ccpanes.production-toolkit-manifest.v1` | production toolkit manifest | `src/production-toolkit.ts` | 生成 reviewable production toolkit 的 manifest。 |
| `ccpanes.hook-install-plan.v1` | hook package `install-plan.json` | `src/hook-install-plan.ts` | hook 安装计划，review-only。 |
| `ccpanes.hook-package-manifest.v1` | hook package `manifest.json` | `src/hook-package.ts` | hook package 清单。 |
| `ccpanes.hook-rollback-plan.v1` | hook package `rollback-plan.json` | `src/hook-package.ts` | 手工回滚计划。 |
| `ccpanes.hook-package-rehearsal.v1` | rehearsal report | `src/hook-package-rehearsal.ts` | hook package dry-run rehearsal 结果。 |
| `ccpanes.hook-release-gate.v1` | `release-gate` stdout / JSON | `src/hook-release-gate.ts` | 真实接入前最终 release gate 聚合。 |
| `ccpanes.hook-apply-plan.v1` | staged apply plan | `src/hook-apply-plan.ts` | 已通过 release gate 后的 staged review apply plan。 |
| `ccpanes.hook-approval.v1` | manual approval input | `src/hook-approval.ts` | 人工授权批准记录输入。 |
| `ccpanes.hook-approval-check.v1` | approval preflight report | `src/hook-approval.ts` | 人工批准、config、reference repo、package artifact 的 preflight 检查。 |
| `ccpanes.hook-write-preview.v1` | write preview report | `src/hook-write-preview.ts` | 写入前 dry-run 预览和 backup manifest。 |
| `ccpanes.hook-backup-manifest.v1` | backup manifest | `src/hook-write-preview.ts` | 写入前备份文件索引。 |
| `ccpanes.hook-write-apply.v1` | guarded apply report | `src/hook-write-apply.ts` | guarded apply 执行报告。 |
| `ccpanes.hook-write-restore.v1` | guarded restore report | `src/hook-write-restore.ts` | guarded restore 执行报告。 |
| `ccpanes.hook-production-readiness.v1` | production readiness report | `src/hook-production-readiness.ts` | 聚合 release gate、approval、preview、apply、restore 的最终生产就绪判定。 |
| `ccpanes.hook-go-live-approval-package.v1` | go-live approval package manifest | `src/hook-go-live-approval.ts` | 把人工授权固化为可审计批准包。 |
| `ccpanes.hook-final-runbook.v1` | final runbook manifest | `src/hook-final-runbook.ts` | 生成最终人工执行和回滚 runbook。 |

## Codex Session Bridge Artifacts

这些 artifact 使用 `schemaVersion` 字段，属于 session bridge 子系统。

| Schema Version | 默认位置或输出 | Owner | 用途 |
|---|---|---|---|
| `hooks.codex-session-index/v3` | `live/codex-session-index.json` | `src/codex-session-index*.ts` | 只读索引 Codex session、state DB、thread history 和 task context。 |
| `hooks.codex-session-resolution/v3` | `codex-sessions resolve` stdout | `src/codex-session-resolver.ts` | 按项目解析 owned/supporting/related/ambient session。 |
| `hooks.codex-session-retention/v2` | `live/session-retention-manifest.json` | `src/codex-session-handoff.ts` | Codex session 留存检查 manifest。 |
| `hooks.session-federation/v1` | `live/session-federation.json` | `src/session-federation*.ts` | Codex 与 CC-Panes session 的项目归因和联邦图。 |
| `hooks.codex-sidebar-plan/v1` | sidebar plan JSON | `src/codex-sidebar.ts` | Codex App sidebar name/pin 两阶段计划。 |
| `hooks.codex-sidebar-apply/v1` | sidebar apply result | `src/codex-sidebar.ts` | sidebar plan apply 结果。 |
| `hooks.codex-app-sidebar-snapshot/v1` | app sidebar snapshot input | `src/codex-sidebar.ts` | Codex App sidebar 可见状态快照。 |
| `hooks.codex-sidebar-host-receipt/v1` | host receipt input | `src/codex-sidebar.ts` | host 执行 pin/name 操作后的回执。 |
| `hooks.codex-sidebar-reconciliation/v1` | sidebar reconciliation JSON | `src/codex-sidebar.ts` | plan、host receipt、app snapshot 的一致性复核。 |
| `hooks.codex-sidebar-rollback-plan/v1` | rollback plan JSON | `src/codex-sidebar.ts` | sidebar apply 后的回滚计划。 |

## Compatibility Rules

- 新增 schema 时优先放在独立 owner 模块，并在本文件登记。
- 修改既有 schema 语义时，优先增加新版本，不静默改变旧版本字段含义。
- artifact 写入路径必须遵守 `runtime-state.md` 的 repo/live/runtime state 边界。
- 所有用于发布、hook 接入、用户配置写入的 artifact 都要能被后续命令重新验证。
