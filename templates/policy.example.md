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

## Mechanical enforcement note

The current production hook stack mechanically enforces task/worktree/user-config
boundaries from `.ccpanes-task/current-task.json`. This policy file is the
project-local model-readable ledger for dialogue-level preferences and temporary
allow/block decisions.
