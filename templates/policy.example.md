# CC-Panes Project Policy Ledger

This file is project-local. It captures conversation-level constraints that
Codex should apply alongside the mechanical hook guardrails.

## Effective rules

- No project-specific rules recorded yet.

## Rule log

| Time | User instruction | Effective action | Notes |
|---|---|---|---|
|  |  |  |  |

## Clearing or opening rules

When the user says "清除限制", "开放权限", "这个允许", or equivalent:

1. Add a new rule-log row.
2. Mark the older matching rule as cleared in notes.
3. Keep the current effective rules list accurate.
4. If the rule has a matching `.ccpanes-task/policy.json` entry, disable it or
   add a narrower `allow` rule there as the mechanical counterpart.

Preferred mechanical commands:

```powershell
node <ccpanes-hooks-root>\dist\src\cli.js plan-intake --root <project-root> --prompt "<current user request>" --utterance "<current plan/user rule text>" --audit-out <audit-json>
node <ccpanes-hooks-root>\dist\src\cli.js policy-capture-plan --root <project-root> --utterance "<current plan/user rule text>"
node <ccpanes-hooks-root>\dist\src\cli.js policy-capture --root <project-root> --id block-publish --instruction "禁止运行 publish-artifact。" --effect block --reason user_blocked_publish --tool shell --command-contains publish-artifact
node <ccpanes-hooks-root>\dist\src\cli.js policy-add --root <project-root> --id block-publish --effect block --reason user_blocked_publish --tool shell --command-contains publish-artifact
node <ccpanes-hooks-root>\dist\src\cli.js policy-disable --root <project-root> --id block-publish
node <ccpanes-hooks-root>\dist\src\cli.js policy-clear --root <project-root>
node <ccpanes-hooks-root>\dist\src\cli.js policy-list --root <project-root>
node <ccpanes-hooks-root>\dist\src\cli.js policy-validate --root <project-root>
```

## Mechanical enforcement note

The production hook stack mechanically enforces task/worktree/user-config
boundaries from `.ccpanes-task/current-task.json` and optional executable rules
from `.ccpanes-task/policy.json`. This Markdown file is the project-local
model-readable ledger; JSON is the hook-enforced contract.

Use `templates/policy.example.json` as the starting shape for mechanical rules.
`allow` rules are project-local only and do not open hard safety boundaries such
as user-level config files, reference repositories, destructive Git commands, or
global dependency installs.
