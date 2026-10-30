# Maintenance Notes

This file collects operational details that do not belong in the public README.

## Authority and boundaries

- Source repo: `{workspace-root}\tool\repos\hooks`
- Live runtime: `{workspace-root}\tool\experiments\ccpanes-task-probe`
- Task state: `<project>\.ccpanes-task`
- User configs: `{user-home}\.codex`, `{user-home}\.cc-panes`
- Upstream hook executable: `{user-home}\skills-hub\bin\skills-hub-hook.exe`
- FastCtx executable: `{user-home}\.fastctx\bin\fastctx.exe`

## Standard verification

Repository:

```powershell
cd {workspace-root}\tool\repos\hooks
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short
```

Live runtime:

```powershell
cd {workspace-root}\tool\experiments\ccpanes-task-probe
npm run verify
node dist/src/cli.js verify-installed-hooks `
  --hooks-json {user-home}\.codex\hooks.json `
  --prototype-root {workspace-root}\tool\experiments\ccpanes-task-probe `
  --audit-root {workspace-root}\tool\experiments\ccpanes-task-probe\live\dynamic-audits `
  --config {user-home}\.codex\config.toml
node dist/src/cli.js verify-live-consistency `
  --repo-root {workspace-root}\tool\repos\hooks `
  --live-root {workspace-root}\tool\experiments\ccpanes-task-probe
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
