# Maintenance Notes

This file collects operational details that do not belong in the public README.

## Authority and boundaries

- Source repo: `D:\cc-pane\tool\repos\hooks`
- Live runtime: `D:\cc-pane\tool\experiments\ccpanes-task-probe`
- Task state: `<project>\.ccpanes-task`
- User configs: `C:\Users\AI001\.codex`, `C:\Users\AI001\.cc-panes`
- Upstream hook executable: `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`
- FastCtx executable: `C:\Users\AI001\.fastctx\bin\fastctx.exe`

## Standard verification

Repository:

```powershell
cd D:\cc-pane\tool\repos\hooks
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short
```

Live runtime:

```powershell
cd D:\cc-pane\tool\experiments\ccpanes-task-probe
npm run verify
node dist/src/cli.js verify-installed-hooks `
  --hooks-json C:\Users\AI001\.codex\hooks.json `
  --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe `
  --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits `
  --config C:\Users\AI001\.codex\config.toml
node dist/src/cli.js verify-live-consistency `
  --repo-root D:\cc-pane\tool\repos\hooks `
  --live-root D:\cc-pane\tool\experiments\ccpanes-task-probe
```

## Sync flow

1. Finish changes in the repo.
2. Run the repository checks.
3. Update the live runtime.
4. Re-run the live checks.
5. Record the live consistency result and any acceptance evidence.

## What belongs here

- Repo/live path notes
- Verification commands
- Release and sync order
- User configuration and executable hash checks
- Operational notes for maintainers
