# Codex Workflow Advisory Hook Design

## Goal

Make the production-grade implementation standard available to Codex App on
each relevant prompt without replacing the existing skills-hub or CC-Panes
prompt lifecycle hooks and without turning advisory guidance into permission or
completion authority.

## Context

The repository owns `ccpanes.workflow-profile.v1` and
`ccpanes.implementation-standard.v1`. Codex currently loads user hooks from
`C:\Users\AI001\.codex\hooks.json`, while the installed CC-Panes hook commands
execute the live runtime at
`D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js`.

The existing `UserPromptSubmit` chain contains:

1. `skills-hub-hook.exe` for cold skill routing.
2. `cc-panes-cli-hook.exe prompt-before` for CC-Panes lifecycle intake.

Neither command consumes the repository workflow profile directly. Repository
availability and Codex runtime consumption are therefore separate states.

## Decision

Add a third `UserPromptSubmit` command named `workflow-advisory`. It reads the
official Codex hook event from stdin, resolves the nearest active task from the
event `cwd`, classifies the prompt through the canonical workflow-profile owner,
and emits a Codex `UserPromptSubmit` `additionalContext` response only when the
route has a non-null implementation standard.

The order remains:

1. skills-hub routing
2. CC-Panes prompt lifecycle intake
3. workflow advisory

No existing hook is replaced or repurposed.

## Components and Ownership

### `workflow-advisory-hook.ts`

Owns:

- validation and normalization of the Codex `UserPromptSubmit` input shape
- deterministic advisory context formatting
- privacy-preserving audit records
- the `ccpanes.workflow-advisory-audit.v1` record schema

Does not own:

- workflow classification rules
- implementation-standard semantics
- task binding
- permission, completion, deployment, or policy authority

### `workflow-profile.ts`

Remains the canonical owner of route classification and the decision whether an
implementation standard applies.

### `implementation-standard.ts`

Remains the canonical owner of production-grade solution-economy semantics.

### `installed-hooks.ts`

Owns the expected installed hook topology and read-only verification of the
third `UserPromptSubmit` command.

## Input Contract

The command accepts one JSON object from stdin. Required fields:

- `hook_event_name`: must be `UserPromptSubmit` when present
- `cwd`: non-empty string
- `prompt`: non-empty string

Optional official Codex fields are ignored after boundary validation.

Malformed, unsupported, empty, or out-of-task events produce no stdout hook
response. They never gain permission authority.

## Output Contract

For code-affecting routes, stdout is one JSON object:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "..."
  }
}
```

The context is deterministic and bounded. It contains:

- advisory schema
- route and rigor
- production-grade level
- optimization target
- non-negotiable production properties
- ordered implementation guidance
- an explicit statement that hard gates and completion evidence remain
  authoritative elsewhere

For `read-only-review`, `documentation`, and `other`, stdout is empty.

## Failure and Recovery

This hook is advisory. Invalid input, missing task binding, an out-of-worktree
cwd, or advisory processing failure must not block prompt submission. The
existing `PreToolUse`, `PermissionRequest`, and completion gates remain
unchanged.

Rollback consists of removing the third `UserPromptSubmit` group and restoring
the pre-change `hooks.json` snapshot. No persistent business data or migration
is involved.

## Audit and Privacy

For a matched task, append one JSONL record under:

```text
<audit-root>/<base64url-task-id>/workflow-advisory-audit.jsonl
```

The record contains task id, prompt SHA-256, prompt length, route, injection
decision, reason, context length, and timestamp. It does not contain the raw
prompt or user secrets.

Audit write failure does not suppress a valid advisory response and does not
block the prompt.

## Resource Bounds

- Hook timeout: 5 seconds.
- `additionalContextLimit`: 1800 characters.
- The formatter enforces a stricter internal maximum of 1600 characters.
- Input prompt classification uses the existing bounded in-process classifier;
  no network or subprocess is introduced.

## Verification

Required evidence:

- valid code prompt emits production-grade additional context
- documentation and read-only prompts emit no context
- malformed input and unmatched task bindings are non-blocking
- audit contains a prompt hash but not raw prompt text
- context remains within the configured bound
- expected hook config preserves both existing `UserPromptSubmit` groups
- installed-hook verification requires the new command and trust entry
- repository tests, typecheck, build, smoke, and diff check pass
- repo/live consistency passes after synchronization
- installed-hook verification passes after Codex trust
- a fresh Codex invocation produces an advisory audit record for a code prompt

## Rejected Approaches

### Replace `skills-hub-hook.exe`

Rejected because skill routing and engineering workflow advice have different
owners and failure domains.

### Modify `cc-panes-cli-hook.exe prompt-before`

Rejected because it crosses into another repository and hides the workflow
profile dependency behind an external executable.

### Add the standard to `SessionStart`

Rejected because workflow classification depends on each prompt. Session-level
context would be stale or over-broad.
