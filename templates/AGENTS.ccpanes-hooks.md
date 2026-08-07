# CC-Panes Hooks Project Entry

## Purpose

This project uses the global CC-Panes hook stack. Do not install project-local
hooks. The global hooks resolve the current project from `cwd` and read:

```text
<project>/.ccpanes-task/current-task.json
```

## Startup behavior

When Codex starts in this project or begins planning a concrete task:

1. Ensure `.ccpanes-task/current-task.json` exists for the active task.
2. If it is missing, create it before implementation work.
3. If the user changes the task phase, update `phase`.
4. Ensure this managed CC-Panes hook entry exists in `AGENTS.md`.
5. Keep all hook/task state inside `.ccpanes-task/`.

Preferred command when the CC-Panes hooks CLI is available:

```powershell
node <ccpanes-hooks-root>\dist\src\cli.js bootstrap-project --root <project-root> --task-id <task-id> --phase shape
```

Known local default for this workstation:

```powershell
node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js bootstrap-project --root <project-root> --task-id <task-id> --phase shape
```

## Phase meanings

- `shape`: requirement shaping and planning; implementation writes are guarded.
- `build`: implementation is active inside the project worktree.
- `verify`: minimal fixes and verification are active.
- `archive`: only documentation, handoff, and final artifacts are expected.

## Conversation-level hook policy ledger

When the user says a rule such as "禁止 X", "不要再建议 Y", "开放 X",
"清除限制", or gives a project-specific permission boundary:

1. Record the current effective rule in `.ccpanes-task/policy.md`.
2. If the rule needs mechanical enforcement, also update
   `.ccpanes-task/policy.json`.
3. Treat newer explicit user instructions as overriding older policy entries.
4. Keep policy scoped to this project unless the user explicitly says it is global.
5. If the user says to clear/open a policy, update `.ccpanes-task/policy.md`
   and note the cleared item.
6. For mechanical clearing/opening, disable or add an `allow` rule in
   `.ccpanes-task/policy.json`; do not write user-level Codex config for
   project-specific policy.

Preferred CLI form when the CC-Panes hooks CLI is available:

```powershell
node <ccpanes-hooks-root>\dist\src\cli.js policy-add --root <project-root> --id <rule-id> --effect block --reason <reason> --tool shell --command-contains <text>
node <ccpanes-hooks-root>\dist\src\cli.js policy-add --root <project-root> --id <rule-id> --effect allow --reason <reason> --tool apply_patch --path-contains docs/ --phase shape
node <ccpanes-hooks-root>\dist\src\cli.js policy-disable --root <project-root> --id <rule-id>
node <ccpanes-hooks-root>\dist\src\cli.js policy-clear --root <project-root>
node <ccpanes-hooks-root>\dist\src\cli.js policy-validate --root <project-root>
```

Known local default for this workstation:

```powershell
node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js policy-validate --root <project-root>
```

Mechanical hooks enforce tool/file/command boundaries from `current-task.json`
and optional project-local rules from `.ccpanes-task/policy.json`.
`policy.md` remains the model-readable ledger; `policy.json` is the executable
allow/block rule file.

Supported `policy.json` match dimensions:

- `tools` / `tool`
- `pathContains`
- `commandContains`
- `phases` / `phase`
- `reasons` / `reason`
- `enabled`

`allow` rules can open project-local phase or project-policy blocks inside the
active worktree. They do not override hard boundaries such as user-level config
paths, reference repositories, destructive Git commands, global installs, or
write calls without a target path.

## Completion gate

Before claiming completion:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
node <ccpanes-hooks-root>\dist\src\cli.js verify-acceptance --input <acceptance.json>
```

Also inspect diff/status and keep unrelated repositories untouched.
