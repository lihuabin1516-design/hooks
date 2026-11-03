# hooks

> PaneForge hooks governance repo

## Purpose

This repository uses the PaneForge hook stack and the managed AGENTS template for
downstream projects. Do not install ad hoc project-local hooks here.

## Local Git checkpoint cadence

- Take a local Git checkpoint before a large edit burst, after the burst, and
  after a major update.
- Take one when a session crosses a day boundary with uncommitted work.
- Take one when the branch has stayed dirty for roughly 4 hours.
- Treat cross-file refactors, batch replacements, dependency upgrades, schema
  changes, migrations, and multi-bug repair batches as large edits.
- Minimum evidence: `git status --short --branch` and `git diff --stat`.
- If the task is authorized for commits, make a local checkpoint commit;
  otherwise keep the snapshot and continue.

## Template propagation

If you update `templates/AGENTS.paneforge-hooks.md`, refresh existing projects
with `agents-install` or `bootstrap-project` so they load the updated managed
block in a fresh session.

<!-- paneforge-hooks:begin -->
# PaneForge Hooks Project Entry

## Purpose

This project uses the global PaneForge hook stack. Do not install project-local
hooks. The global hooks resolve the current project from `cwd` and read:

```text
<project>/.paneforge-task/current-task.json
```

## Startup behavior

When Codex starts in this project or begins planning a concrete task:

1. Ensure `.paneforge-task/current-task.json` exists for the active task.
2. If it is missing, create it before implementation work.
3. If the user changes the task phase, update `phase`.
4. Ensure this managed PaneForge hook entry exists in `AGENTS.md`.
5. Keep all hook/task state inside `.paneforge-task/`.

## Local Git checkpoint cadence

Use a local Git checkpoint to reduce lost-work risk:

- Take one before a large edit burst, after the burst, and after a major update.
- Take one when a session crosses a day boundary with uncommitted work.
- Take one when the current branch has stayed dirty for roughly 4 hours.
- Treat cross-file refactors, batch replacements, dependency upgrades, interface or schema
  changes, migrations, and multi-bug repair batches as large edits.
- Minimum evidence: `git status --short --branch` and `git diff --stat`.
- If the current task is authorized for commits, make a local checkpoint commit; otherwise
  keep the status/diff snapshot and continue.
- `SessionStart`, `PreToolUse`, and `PostToolUse` are reminder points for this cadence.

Preferred command when the PaneForge hooks CLI is available:

```powershell
node <paneforge-hooks-root>\dist\src\cli.js bootstrap-project --root <project-root> --task-id <task-id> --phase shape
```

Known local default for this workstation:

```powershell
node {hooks-repository-root}\dist\src\cli.js bootstrap-project --root <project-root> --task-id <task-id> --phase shape
```

## Phase meanings

- `shape`: requirement shaping and planning; implementation writes are guarded.
- `build`: implementation is active inside the project worktree.
- `verify`: minimal fixes and verification are active.
- `archive`: only documentation, handoff, and final artifacts are expected.

## Workflow routing and progressive rigor

For non-trivial or long-lived tasks, use the PaneForge workflow profile as an
advisory router before implementation:

```powershell
node <paneforge-hooks-root>\dist\src\cli.js classify-workflow --prompt "<user request>" --cwd <project-root> --changed-path <path>
```

The result `paneforge.workflow-profile.v1` gives:

- `route`: read-only review, project bootstrap, project policy, hook runtime,
  production gate, implementation, documentation, or other.
- `rigor`: Light / Standard / Heavy, inherited from task risk.
- `closure`: none / light / full / production.
- `checks`: recommended local, audit, and production checks.

This routing signal never replaces the hard gates below: `current-task.json`
remains the task scope authority, `policy.json` remains the executable project
policy authority, and `hook-enforce` / `permission-enforce` remain the write
boundary.

## Conversation-level hook policy ledger

When the user says a clear project rule during planning, such as "禁止运行 X",
"开放修改 Y", "清除限制", or gives a project-specific permission boundary:

1. Record the current effective rule in `.paneforge-task/policy.md`.
2. If the rule needs mechanical enforcement, also update
   `.paneforge-task/policy.json`.
3. Treat newer explicit user instructions as overriding older policy entries.
4. Keep policy scoped to this project unless the user explicitly says it is global.
5. If the user says to clear/open a policy, update `.paneforge-task/policy.md`
   and note the cleared item.
6. For mechanical clearing/opening, disable or add an `allow` rule in
   `.paneforge-task/policy.json`; do not write user-level Codex config for
   project-specific policy.

Preferred plan-stage CLI form when the PaneForge hooks CLI is available:

```powershell
node <paneforge-hooks-root>\dist\src\cli.js plan-intake --root <project-root> --prompt "<current user request>" --utterance "<current plan/user rule text>" --audit-out <audit-json>
node <paneforge-hooks-root>\dist\src\cli.js policy-capture-plan --root <project-root> --utterance "<current plan/user rule text>"
```

Run `plan-intake` first when the session is still in discussion or plan mode; it
is dry-run and only previews `workflow-profile` plus policy candidates. Run
`policy-capture-plan` only when the rule should become project-local policy.

Use the lower-level forms when the matcher must be explicit:

```powershell
node <paneforge-hooks-root>\dist\src\cli.js policy-capture --root <project-root> --id <rule-id> --instruction "<user rule>" --effect block --reason <reason> --tool shell --command-contains <text>
node <paneforge-hooks-root>\dist\src\cli.js policy-add --root <project-root> --id <rule-id> --effect block --reason <reason> --tool shell --command-contains <text>
node <paneforge-hooks-root>\dist\src\cli.js policy-add --root <project-root> --id <rule-id> --effect allow --reason <reason> --tool apply_patch --path-contains docs/ --phase shape
node <paneforge-hooks-root>\dist\src\cli.js policy-disable --root <project-root> --id <rule-id>
node <paneforge-hooks-root>\dist\src\cli.js policy-clear --root <project-root>
node <paneforge-hooks-root>\dist\src\cli.js policy-validate --root <project-root>
```

Known local default for this workstation:

```powershell
node {hooks-repository-root}\dist\src\cli.js plan-intake --root <project-root> --prompt "<current user request>" --utterance "<current plan/user rule text>" --audit-out <audit-json>
node {hooks-repository-root}\dist\src\cli.js policy-capture-plan --root <project-root> --utterance "<current plan/user rule text>"
node {hooks-repository-root}\dist\src\cli.js policy-validate --root <project-root>
```

Mechanical hooks enforce tool/file/command boundaries from `current-task.json`
and optional project-local rules from `.paneforge-task/policy.json`.
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

## Explicit session scope authorization

`UserPromptSubmit` recognizes clear natural-language authorization, including
phrases such as "我明确授权你继续这项修改" and "I explicitly authorize you to
make this change". No special CLI syntax is required. The authorization applies
to concrete file writes in the current task and session until the next user
prompt or for 15 minutes, whichever comes first. If it covers a write that the
task path, phase, or an older project policy would otherwise block, proceed
without asking the user to repeat the authorization.

Discussion about authorization wording, format, or trigger behavior is not an
authorization. Negated and hypothetical wording is not an authorization either.
The hook only opens `edit`, `write`, and `apply_patch` calls. Protected
configuration paths, task binding failures, dangerous commands, and shell writes
remain blocked.

If the UserPromptSubmit hook is unavailable and an exact manual grant is needed,
the fallback command is:

```powershell
node <paneforge-hooks-root>\dist\src\cli.js session-scope-grant --root <project-root> --path <absolute-file-path> --tool edit --reason "<short purpose>" --instruction "<verbatim user authorization>"
```

Repeat `--path` and `--tool` for each specifically authorized file and write
tool. Use `--recursive` only when the user authorized changes to the whole
directory tree. Manual grants can last at most 60 minutes. Shell commands do
not inherit these grants.

```powershell
node <paneforge-hooks-root>\dist\src\cli.js session-scope-list --root <project-root>
node <paneforge-hooks-root>\dist\src\cli.js session-scope-revoke --root <project-root> --id <grant-id>
```

The grant can bypass task-path, phase, and older project-policy blocks only for
its task, paths, tools, and lifetime. Protected configuration paths, task
binding failures, dangerous-command checks, and writes without a concrete target
remain blocked. Grant records retain the user's instruction, purpose, issue
time, expiry, and revocation time under `.paneforge-task/`.

## Completion gate

Before claiming completion:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
node <paneforge-hooks-root>\dist\src\cli.js verify-acceptance --input <acceptance.json>
```

Also inspect diff/status and keep unrelated repositories untouched.
<!-- paneforge-hooks:end -->
