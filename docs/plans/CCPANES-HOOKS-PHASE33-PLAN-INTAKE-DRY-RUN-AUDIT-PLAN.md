# CC-Panes Hooks Phase 33 — Plan Intake Dry-Run Audit Plan

日期：2026-08-07
目标仓库：`D:\cc-pane\tool\repos\hooks`

## Change Contract

Intent: 将 Phase 32 的 `classify-workflow` 与 Phase 31 的 plan policy 识别组合成
plan 阶段入口，让真实 plan 生命周期接入前先具备 dry-run 预览和 audit artifact。

Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、HANDOFF、PROJECT-DIRECTORY、smoke 和计划文档。
- 仅写本仓库与 smoke/acceptance 显式 fixture/audit artifact。

In Scope:
- 新增 `src/plan-intake.ts` 作为 plan 阶段 dry-run/audit owner。
- 新增 CLI：`plan-intake --root <project-root> --prompt <text> --utterance <plan text> --changed-path <path> --audit-out <json>`。
- 复用 `detectPlanPolicyInstructions` 预览 policy candidates，不调用写入型 `capturePlanPolicyInstructions`。
- 复用 `classifyWorkflowProfile` 输出 task route、rigor、closure 和 checks。
- 默认不写 `.ccpanes-task/policy.md` / `.ccpanes-task/policy.json`。
- 只有显式 `--audit-out` 写 `ccpanes.plan-intake.v1` JSON artifact。

Out of Scope:
- 不接入真实 CC-Panes plan event 配置。
- 不写用户级 Codex / Claude / CC-Panes 配置。
- 不同步 live prototype。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 reference repo 内容。

Expected Behavior:
- 明确 plan 规则输出 `would_capture` / `would_clear`，同时给出建议的
  `policy-capture-plan` 后续命令。
- 无 policy candidate 时输出 `skipped`，但仍给出 workflow profile。
- `changed=false` 且 `mode=dry-run` 固定，证明该入口不是 mutation owner。
- `--audit-out` 可生成可归档 JSON，供后续真实 plan lifecycle dry-run 使用。

Fatal Failures:
- plan-intake 写入 `.ccpanes-task/policy.*`。
- plan-intake 绕过 `policy-capture-plan` 成为第二套 policy 写入 authority。
- workflow profile 被解释为 hard gate。
- audit-out 未显式提供时产生落盘副作用。

Verification:
- Focused tests: `npm test -- tests/plan-intake.test.ts tests/plan-policy-capture.test.ts tests/workflow-profile.test.ts tests/cli.test.ts`
- Full tests: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Smoke: `npm run smoke`
- Diff hygiene: `git diff --check`

Recovery:
- 源仓库：反向 patch 或 `git revert <commit>`。
- 本阶段未写真实用户配置，无用户配置恢复步骤。

## Architecture Decision

Decision: 新增 `plan-intake` 作为 plan lifecycle 的 dry-run/audit seam；它只组合
现有 readers/classifiers，不拥有 policy 写入权。

Owners:
- `plan-intake.ts`：plan text intake、workflow profile、policy candidate preview、audit artifact。
- `plan-policy-capture.ts`：明确 plan policy 的实际写入 owner。
- `workflow-profile.ts`：任务路由和闭环强度 owner。
- `project-policy.ts` / `project-policy-ledger.ts`：policy schema 与 ledger owner。

Compatibility:
- 现有 `policy-capture-plan` CLI 保持不变。
- 新入口可被未来 CC-Panes plan event 调用为 dry-run 子步骤；真实配置接入仍需独立授权包。
