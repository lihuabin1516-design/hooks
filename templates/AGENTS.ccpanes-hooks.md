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
4. Keep all hook/task state inside `.ccpanes-task/`.

Preferred command when the CC-Panes hooks CLI is available:

```powershell
node <ccpanes-hooks-root>\dist\src\cli.js write-current --root <project-root> --task-id <task-id> --phase shape
```

Known local default for this workstation:

```powershell
node D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js write-current --root <project-root> --task-id <task-id> --phase shape
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
2. Treat newer explicit user instructions as overriding older policy entries.
3. Keep policy scoped to this project unless the user explicitly says it is global.
4. If the user says to clear/open a policy, update `.ccpanes-task/policy.md`
   and note the cleared item.
5. Do not write user-level Codex config for project-specific policy.

Current mechanical hooks enforce tool/file/command boundaries from
`current-task.json`. The policy ledger is the model-readable source of truth for
dialogue-level preferences and project-local allow/block decisions. If a policy
needs hard mechanical enforcement, add it as a future hook-policy JSON rule under
`.ccpanes-task/` and verify with the production toolkit before relying on it.

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
