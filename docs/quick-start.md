# Quick Start

This guide gives a first-time reader a short path into the repo.
For public positioning, start with the README. For compatibility details, see
[`compatibility.md`](./compatibility.md). For common questions, see
[`faq.md`](./faq.md). For operational details, see
[`MAINTENANCE.md`](../MAINTENANCE.md).

## Mental model

```text
project/worktree
  -> current task binding
  -> project policy
  -> agent hook event
  -> hook-enforce / permission-enforce / post-enforce
  -> audit artifact / acceptance evidence
```

The important rule: if ownership, policy, or path scope is unclear, the hook
should fail closed.

## Install and verify

```powershell
git clone https://github.com/lihuabin1516-design/hooks.git
cd hooks
npm ci
npm run verify
```

## 5-minute end-to-end example

This example starts with a clean scratch project, writes task binding and
policy, then proves that hook enforcement blocks the policy-matched command.

```powershell
$demoRoot = Join-Path $env:TEMP 'hooks-demo'
New-Item -ItemType Directory -Force $demoRoot | Out-Null

node .\dist\src\cli.js bootstrap-project `
  --root $demoRoot `
  --task-id demo-task `
  --phase shape

node .\dist\src\cli.js policy-capture-plan `
  --root $demoRoot `
  --utterance "计划阶段规则：禁止运行 publish-artifact，除非我明确解除。"

$event = [ordered]@{
  hook_event_name = 'PreToolUse'
  cwd = $demoRoot
  tool_name = 'Bash'
  tool_input = @{
    command = 'node scripts/publish-artifact.mjs'
  }
} | ConvertTo-Json -Depth 6

$decision = $event | node .\dist\src\cli.js hook-enforce `
  --resolve-task-from-cwd `
  --audit-root (Join-Path $demoRoot 'audits') | ConvertFrom-Json

$decision.hookSpecificOutput.permissionDecision
$decision.hookSpecificOutput.permissionDecisionReason
Get-ChildItem -Recurse (Join-Path $demoRoot 'audits')
```

You should see `deny`, and the reason should contain
`ccpanes-task-probe: project_policy_block:plan_block_command`.

## Bootstrap a project

```powershell
node dist/src/cli.js bootstrap-project `
  --root <project-root> `
  --task-id <task-id> `
  --phase shape
```

This writes the task binding and policy scaffolding for a project.

## Add or capture policy

```powershell
node dist/src/cli.js policy-capture-plan `
  --root <project-root> `
  --utterance "计划阶段规则：禁止运行 publish-artifact，除非我明确解除。"
```

```powershell
node dist/src/cli.js policy-add `
  --root <project-root> `
  --id block-publish `
  --effect block `
  --reason user_blocked_publish `
  --tool shell `
  --command-contains publish-artifact
```

## Hook flow

```text
Agent hook event
  -> node dist/src/cli.js hook-enforce --resolve-task-from-cwd --audit-root <audit-root>
  -> resolve current task from cwd
  -> load policy
  -> allow / block / audit
```

Other common entry points:

- `session-start`
- `workflow-advisory`
- `permission-enforce`
- `post-enforce`
- `stop-check`
- `verify-installed-hooks`
- `verify-live-consistency`

## Policy conflict semantics

- Rules are evaluated in file order.
- The last matching enabled rule wins.
- A later `allow` can override an earlier `block`, and a later `block` can re-lock a broader `allow`.
- If you need an override, put the more specific rule later in the file.
- If the policy JSON is malformed, enforcement fails closed instead of guessing.

## Debug checklist

1. `git status --short`
2. current task binding
3. policy rules
4. hook audit output
5. repository verification
6. live consistency verification
