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

## Debug checklist

1. `git status --short`
2. current task binding
3. policy rules
4. hook audit output
5. repository verification
6. live consistency verification
