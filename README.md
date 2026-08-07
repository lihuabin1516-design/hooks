# CC-Panes Task Probe Prototype

This is an isolated prototype for CC-Panes task ownership, resume-probe, hook dry-run checks, and acceptance evidence verification.

## Recommended Daily Use

Install the global hook stack once, then let each project opt in through its
`AGENTS.md` rules. A normal project should not install its own duplicate hooks.
The global hooks resolve the active project from `cwd` and read:

```text
<project>/.ccpanes-task/current-task.json
```

For CC-Panes project import, append the template below to the generated
`AGENTS.md`:

```text
templates/AGENTS.ccpanes-hooks.md
```

After that, Codex can maintain `.ccpanes-task/current-task.json` during planning
and requirement discussion, so the user does not need to remember the bootstrap
command for daily work. The bootstrap command remains available for scripts and
manual recovery:

```powershell
node dist/src/cli.js write-current --root <project-root> --task-id <task-id> --phase shape
node dist/src/cli.js agents-install --root <project-root>
node dist/src/cli.js agents-validate --root <project-root>
```

Conversation-level rules such as "禁止继续建议 X", "开放 Y", or "清除限制"
should be recorded in:

```text
<project>/.ccpanes-task/policy.md
```

When a rule needs hook-level enforcement, mirror the effective rule into:

```text
<project>/.ccpanes-task/policy.json
```

`policy.md` is the project-local model-readable ledger. `policy.json` is the
mechanical allow/block contract consumed by `hook-enforce`, `permission-enforce`,
and `hook-runner`.

## Quick Start

```powershell
cd D:\cc-pane\tool\experiments\ccpanes-task-probe
npm install
npm test
npm run typecheck
npm run build
npm run smoke
```

`npm run smoke` runs an end-to-end synthetic fixture covering:

1. `write-current`
2. `agents-install` / `agents-validate`
3. `policy-add` / `policy-list` / `policy-validate` / `policy-disable` / `policy-clear`
4. `probe --workspace-root`
5. `dry-run-hook --input`
6. `adapt-hook-event --task --event`
7. adapted batch -> `dry-run-hook --input`
8. `hook-runner --task` with stdin event
9. `hook-enforce --task` Codex `PreToolUse` deny-shape output for blocked calls
10. `permission-enforce` Codex `PermissionRequest` deny/no-decision output
11. `post-enforce` append-only `PostToolUse` audit output
12. `session-start` Codex `SessionStart` additionalContext output
13. `stop-check` Codex `Stop` non-blocking verification reminder
14. `verify-installed-hooks` read-only production hook self-check
15. `create-production-toolkit` reviewable production toolkit generation
16. `hook-shadow --task` with stdin event and optional audit output
17. `plan-hook-install` review-only install plan generation
18. `create-hook-package` review-only rollback package generation
19. `rehearse-hook-package` dry-run package rehearsal
20. `release-gate` final preflight report
21. `create-hook-apply-plan` staged apply-plan generation
22. `check-hook-approval` manual approval preflight
23. `preview-hook-write` dry-run config write preview
24. `apply-hook-write` guarded synthetic config write
25. `restore-hook-write` guarded synthetic config restore
26. `production-readiness` final readiness report
27. `create-go-live-approval-package` manual approval package generation
28. `create-final-runbook` manual execution runbook generation
29. `record-acceptance`
30. `verify-acceptance`

Expected final line:

```text
SMOKE_PASS
```

## Commands

```powershell
node dist/src/cli.js write-current --root <task-dir> --task-id <id> --phase build
node dist/src/cli.js agents-install --root <project-root>
node dist/src/cli.js agents-validate --root <project-root>
node dist/src/cli.js policy-add --root <project-root> --id block-publish --effect block --reason user_blocked_publish --tool shell --command-contains publish-artifact
node dist/src/cli.js policy-add --root <project-root> --id allow-docs-shape --effect allow --reason user_opened_docs --tool apply_patch --path-contains docs/ --phase shape
node dist/src/cli.js policy-list --root <project-root>
node dist/src/cli.js policy-validate --root <project-root>
node dist/src/cli.js policy-disable --root <project-root> --id block-publish
node dist/src/cli.js policy-clear --root <project-root>
node dist/src/cli.js probe --utterance "继续" --session leader-1 --workspace-root <workspace-dir>
node dist/src/cli.js dry-run-hook --input <hook-batch.json>
node dist/src/cli.js adapt-hook-event --task <current-task.json> --event <hook-event.json>
Get-Content <hook-event.json> -Raw | node dist/src/cli.js hook-runner --task <current-task.json>
Get-Content <hook-event.json> -Raw | node dist/src/cli.js hook-enforce --task <current-task.json> --audit-out <audit.json>
Get-Content <hook-event.json> -Raw | node dist/src/cli.js hook-enforce --resolve-task-from-cwd --audit-root <audit-root>
Get-Content <permission-event.json> -Raw | node dist/src/cli.js permission-enforce --resolve-task-from-cwd --audit-root <audit-root>
Get-Content <post-event.json> -Raw | node dist/src/cli.js post-enforce --resolve-task-from-cwd --audit-root <audit-root>
Get-Content <session-start-event.json> -Raw | node dist/src/cli.js session-start --resolve-task-from-cwd --audit-root <audit-root>
Get-Content <stop-event.json> -Raw | node dist/src/cli.js stop-check --resolve-task-from-cwd --audit-root <audit-root>
node dist/src/cli.js verify-installed-hooks --hooks-json C:\Users\AI001\.codex\hooks.json --prototype-root <prototype-root> --audit-root <audit-root> --config C:\Users\AI001\.codex\config.toml
node dist/src/cli.js create-production-toolkit --out-dir <toolkit-dir> --prototype-root <prototype-root> --audit-root <audit-root> --hooks-json C:\Users\AI001\.codex\hooks.json --config C:\Users\AI001\.codex\config.toml --expected-upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --expected-upstream-sha256 F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
Get-Content <hook-event.json> -Raw | node dist/src/cli.js hook-shadow --task <current-task.json> --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out <audit.json>
node dist/src/cli.js plan-hook-install --prototype-root <prototype-root> --task <current-task.json> --target both --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out <install-plan.json>
node dist/src/cli.js create-hook-package --prototype-root <prototype-root> --task <current-task.json> --target both --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out-dir <package-dir>
node dist/src/cli.js rehearse-hook-package --package-dir <package-dir> --expected-upstream-sha256 F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4 --out <rehearsal.json>
node dist/src/cli.js release-gate --package-dir <package-dir> --expected-upstream-sha256 F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4 --config C:\Users\AI001\.codex\config.toml --config C:\Users\AI001\.cc-panes\config.toml --repo D:\cc-pane\tool\repos\comet --repo D:\cc-pane\tool\repos\fastctx --check "smoke=pass=SMOKE_PASS" --out <release-gate.json>
node dist/src/cli.js create-hook-apply-plan --release-gate <release-gate.json> --out-dir <apply-plan-dir>
node dist/src/cli.js check-hook-approval --apply-plan <apply-plan.json> --approval <approval.json> --out <approval-check.json>
node dist/src/cli.js preview-hook-write --approval-check <approval-check.json> --out-dir <write-preview-dir>
node dist/src/cli.js apply-hook-write --write-preview <write-preview.json> --approval-check <approval-check.json> --out <apply-report.json> --allow-root <synthetic-config-root>
node dist/src/cli.js restore-hook-write --apply-report <apply-report.json> --out <restore-report.json> --allow-root <synthetic-config-root>
node dist/src/cli.js production-readiness --release-gate <release-gate.json> --approval-check <approval-check.json> --write-preview <write-preview.json> --apply-report <apply-report.json> --restore-report <restore-report.json> --out <production-readiness.json>
node dist/src/cli.js create-go-live-approval-package --readiness <production-readiness.json> --out-dir <go-live-approval-package-dir> --approved-by AI001 --approval-note "manual authorization approved" --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
node dist/src/cli.js create-final-runbook --go-live-manifest <go-live-approval-package-dir>\manifest.json --out-dir <final-runbook-dir>
node dist/src/cli.js record-acceptance --task <current-task.json> --artifact <file> --check "unit tests=pass=42 tests passed"
node dist/src/cli.js verify-acceptance --input <acceptance.json>
```

## Examples

See `examples/` for synthetic input files and schema examples:

- `examples/hook-batch.json`: already-adapted dry-run batch.
- `examples/hook-events/*.json`: generic / Claude-like / Codex-like hook event adapter inputs.
- `examples/hook-runner-event.json`: stdin fixture for the hook-runner dry-run entrypoint.
- `examples/hook-shadow-event.json`: stdin fixture for the hook-shadow audit entrypoint.
- `examples/hook-install-plan-request.json`: flag-level request fixture for review-only install plan generation.
- `examples/hook-package-request.json`: flag-level request fixture for review-only rollback package generation.
- `examples/hook-package-rehearsal-request.json`: flag-level request fixture for dry-run package rehearsal.
- `examples/hook-release-gate-request.json`: flag-level request fixture for final preflight gate generation.
- `examples/hook-apply-plan-request.json`: flag-level request fixture for staged apply-plan generation.
- `examples/hook-approval-request.json`: approval JSON shape and flag-level request fixture for manual approval preflight.
- `examples/hook-write-preview-request.json`: flag-level request fixture for dry-run write preview generation.
- `examples/hook-write-apply-request.json`: flag-level request fixture for guarded synthetic config write.
- `examples/hook-write-restore-request.json`: flag-level request fixture for guarded synthetic config restore.
- `examples/hook-production-readiness-request.json`: flag-level request fixture for final readiness report generation.
- `examples/hook-go-live-approval-package-request.json`: flag-level request fixture for manual approval package generation.
- `examples/hook-final-runbook-request.json`: flag-level request fixture for final manual execution runbook generation.
- `templates/AGENTS.ccpanes-hooks.md`: AGENTS.md block for project-level no-touch hook entry.
- `templates/policy.example.md`: project-local conversation policy ledger example.
- `templates/policy.example.json`: project-local mechanical allow/block rule example.

## Safety Boundaries

- State is written only inside synthetic fixture worktrees or this prototype directory.
- The prototype does not install Comet.
- The prototype does not write to `~/.codex`, `~/.claude`, or `~/.cc-panes`.
- `apply-hook-write` and `restore-hook-write` require explicit `--allow-root`; smoke covers only a synthetic config under `.tmp-smoke`.
- The prototype does not execute or register `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`.
- `create-final-runbook` generates review/runbook artifacts only; it does not execute `PRE-FLIGHT.ps1` or `POST-FLIGHT.ps1`.
- `hook-enforce` is the live Codex hook entrypoint: allowed calls emit no stdout; blocked `PreToolUse` calls emit the documented Codex deny JSON shape and optionally write an audit artifact.
- Phase 19 coverage includes `apply_patch`, `Edit`, `Write`, `Bash` / `shell_command`, and FastCtx MCP `read` / `grep` / `glob` / `replace` style events. Shell coverage extracts common PowerShell and redirection write targets, allows known read-only verification commands, and blocks high-risk commands such as destructive git clean/reset, global installs, and git push.
- `permission-enforce` is the Phase 20 Codex `PermissionRequest` entrypoint. Blocked requests emit the documented `PermissionRequest` deny JSON shape. Allowed requests emit no stdout so Codex continues the normal approval flow; the tool intentionally does not auto-approve escalations.
- Phase 25 project policy reads `<project>/.ccpanes-task/policy.json` when present. A malformed file fails closed with a `project_policy_invalid` deny reason. Rules support `allow` / `block`, `enabled`, `tools` / `tool`, `pathContains`, `commandContains`, `phases` / `phase`, and `reasons` / `reason`. Later matching rules win among project rules. Project `allow` rules can open phase or project-policy blocks inside the active worktree, but they do not override hard boundaries such as user config paths, reference repositories, destructive Git commands, global installs, or writes without target paths.
- Phase 27 adds project policy management commands. `policy-add` creates or replaces a rule with `--replace`; `policy-disable` turns one rule off while preserving it; `policy-clear` disables all rules in the executable JSON file; `policy-list` and `policy-validate` are read-oriented inspection commands. These commands write only `<project>/.ccpanes-task/policy.json`.
- Phase 28 adds `agents-install` / `agents-validate`. `agents-install` creates or merges a managed CC-Panes hook block in `<project>/AGENTS.md` using `<!-- ccpanes-hooks:begin -->` / `<!-- ccpanes-hooks:end -->` markers, preserving other project instructions. Re-running it replaces only the managed block and is idempotent. `BOOTSTRAP-PROJECT.ps1` now runs `write-current`, `agents-install`, and `agents-validate`.
- `post-enforce` is the Phase 21 Codex `PostToolUse` audit entrypoint. It appends compact JSONL records to `<audit-root>/<base64url(taskId)>/post-tool-use-audit.jsonl` and emits no stdout, so it does not alter Codex's normal tool result handling.
- `session-start` is the Phase 22 Codex `SessionStart` entrypoint. It emits compact `hookSpecificOutput.additionalContext` for the resolved current task and audit paths.
- `stop-check` is the Phase 22 Codex `Stop` entrypoint. It emits a JSON `systemMessage` reminder and `continue: true`; it does not emit `decision: "block"` or create continuation prompts.
- `verify-installed-hooks` is the Phase 23 read-only production self-check. It validates the live hook commands, matchers, audit root, CLI path, and optional Codex hook trust state.
- `create-production-toolkit` is the Phase 23 packaging entrypoint. It generates reviewable `INSTALL-HOOKS.ps1`, `VERIFY-INSTALLED.ps1`, `BOOTSTRAP-PROJECT.ps1`, `ROLLBACK-HOOKS.ps1`, `PRODUCTION-README.md`, and a manifest under an isolated output directory.
- For multi-project use, prefer `--resolve-task-from-cwd --audit-root <audit-root>` on all live hook entrypoints and ensure each project has `<project>/.ccpanes-task/current-task.json`.

## Multi-project Hook Bootstrap

The global Codex hook can run as a dispatcher. On every matching `PreToolUse`
event it reads the event `cwd`, walks upward until it finds
`.ccpanes-task/current-task.json`, and uses that file as the project boundary.
If no task file is found, it exits without output.

Initialize a project during planning or project startup:

```powershell
node dist/src/cli.js write-current --root <project-root> --task-id <task-id> --phase shape
node dist/src/cli.js agents-install --root <project-root>
node dist/src/cli.js agents-validate --root <project-root>
```

Update the phase when the task moves:

```powershell
node dist/src/cli.js write-current --root <project-root> --task-id <task-id> --phase build
node dist/src/cli.js write-current --root <project-root> --task-id <task-id> --phase verify
```

## Production Gate

Before considering any real Hook integration, require:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
```

Also verify reference repos remain clean and user config directories have no writes during the execution window.
