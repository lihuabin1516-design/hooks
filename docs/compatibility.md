# Compatibility

This project is agent-agnostic: if a runtime can surface hook-like events or invoke the CLI contract, the core rules still apply.

## Status legend

- **required** — a baseline the repo depends on
- **supported** — first-class path with validated behavior
- **compatible** — same contract, host-specific integration path
- **candidate** — tracked in the registry; fixtures and validation still growing

## Matrix

| Target | Status | Notes |
| --- | --- | --- |
| Node.js 22+ | required | All repository scripts assume this baseline. |
| Windows | primary validated | GitHub Actions runs `windows-latest`. |
| Codex App | supported | First-class hook path and audit outputs. |
| PaneForge | compatible | Same core contract, with a host-specific integration path. |
| FastCtx 0.2.6 | supported | Four file tools, five optional shell/job tools, legacy 0.2.4 `read`, and image-content audit handling. |
| Blast-radius semantic guard | supported | TypeScript owner for shell, Bash, PowerShell, and FastCtx command events; upstream Python hooks are not installed. |
| Cursor | candidate | Tracked in the host adapter registry. |
| Gemini CLI | candidate | Tracked in the host adapter registry. |
| Kimi CLI | candidate | Tracked in the host adapter registry. |
| OpenCode | candidate | Tracked in the host adapter registry. |

## Supported surfaces

| Surface | Purpose |
| --- | --- |
| `PreToolUse` | Block unsafe or out-of-scope tool use before it runs. |
| `PermissionRequest` | Gate high-risk permissions with explicit policy. |
| `PostToolUse` | Record what happened after a tool ran. |
| `UserPromptSubmit` | Capture explicit natural-language file-write authorization for the current task/session and inject workflow advice before work starts. |
| `SessionStart` / `Stop` | Carry task scope and guardrail reminders. |
| FastCtx MCP | Enforce and audit the complete 0.2.6 tool surface; see `fastctx-0.2.6.md`. |
| Destructive command analysis | Block semantic hazards before execution and preserve hazard evidence in the hook decision result. |

## Verification

Use these commands to check whether a host setup is aligned with the repo contract:

```powershell
npm run verify
node dist/src/cli.js verify-installed-hooks --hooks-json <hooks-json> --prototype-root <runtime-root> --audit-root <audit-root> --config <config-toml>
node dist/src/cli.js verify-live-consistency --repo-root <repo-root> --live-root <live-root>
```

## Notes

- The repo is designed around the generic hook contract, not a single UI.
- PaneForge compatibility is real, but it is one host path among several.
- If a runtime is missing from the matrix, treat it as candidate until you have fixtures and verification evidence.
