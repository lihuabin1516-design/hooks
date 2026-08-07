# CC-Panes Hooks Phase 35 — Plan Lifecycle Intake

## Goal

把 Phase 33 的 `plan-intake` dry-run 能力接到 CC-Panes 真实 plan 生命周期事件侧，
新增一个 task-scoped audit 调用面，让 plan 文本在进入 policy 写入前先形成可验证的
`ccpanes.plan-intake.v1` 预览证据。

## Architecture contract

- Canonical owner: `src/plan-intake.ts` owns plan lifecycle event normalization,
  workflow profile composition, policy candidate preview, and audit path semantics.
- CLI seam: `src/cli.ts` owns argument parsing and current task resolution only.
- Source of truth: `.ccpanes-task/current-task.json` remains the task scope authority.
- Audit state: `<audit-root>/<base64url(taskId)>/plan-intake-audit.json` is derived
  audit evidence, not project policy authority.
- Policy authority: `policy-capture-plan` remains the only plan-stage command that
  writes `.ccpanes-task/policy.md` or `.ccpanes-task/policy.json`.

## New command

```powershell
node dist/src/cli.js plan-lifecycle-intake `
  --resolve-task-from-cwd `
  --audit-root <audit-root> `
  [--event <event.json>] `
  [--prompt "<current user prompt>"] `
  [--changed-path <path> ...]
```

Synthetic CC-Panes-ready event shape:

```json
{
  "schema": "ccpanes.plan-lifecycle-event.v1",
  "cwd": "D:\\cc-pane",
  "prompt": "用户原始请求",
  "planText": "计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。",
  "changedPaths": ["src/plan-intake.ts"],
  "source": "cc-panes-plan"
}
```

## Behavior

1. Resolve nearest `.ccpanes-task/current-task.json` from event `cwd` or CLI cwd.
2. If no task is found, emit empty stdout and do not create audit files.
3. If a task is found, run `createPlanIntake` with `projectRoot = task.worktreeRoot`.
4. Write the dry-run audit to `<audit-root>/<base64url(taskId)>/plan-intake-audit.json`.
5. Print the same `ccpanes.plan-intake.v1` JSON to stdout.
6. Do not write project policy files and do not mutate user/global configuration.

## Verification

- Focused: `npm test -- tests/plan-intake.test.ts tests/cli.test.ts`
- Full repo: `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke`
- Hygiene: `git diff --check`, `git status --short`
- Acceptance evidence:
  `phase35-plan-lifecycle-intake-acceptance.json` plus `.verify.json` under the
  current task audit directory.
