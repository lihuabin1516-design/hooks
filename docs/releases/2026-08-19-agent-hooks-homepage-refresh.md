# 2026-08-19 — Agent Hooks Homepage Refresh

## Summary

- Reworked the public README into a product-style homepage for agent hooks governance.
- Moved CC-Panes from the headline story into compatibility.
- Added `docs/compatibility.md`, `docs/faq.md`, and this release note.
- Kept maintainer-only paths and operational details in `MAINTENANCE.md`.

## What changed

- The README now leads with the problem it solves, why teams choose it, and how the contract fits into generic agent workflows.
- Compatibility is now documented as a matrix instead of a side note.
- The public docs now separate first-time reader material from maintainer material.

## Upgrade notes

- No migration is required.
- If you keep a live runtime in sync, pull the latest repo, run verification, then copy the updated repo content into the live workspace and rerun the live checks.
- If you only consume the repo as documentation, no runtime action is needed.

## Verification

Recommended checks:

```powershell
npm run verify
npm audit --audit-level=high
node dist/src/cli.js verify-installed-hooks --hooks-json <hooks-json> --prototype-root <runtime-root> --audit-root <audit-root> --config <config-toml>
node dist/src/cli.js verify-live-consistency --repo-root <repo-root> --live-root <live-root>
```

## Known limits

- Windows is still the primary validated environment.
- CC-Panes compatibility exists, but the project is intentionally broader than one host.
- Additional runtimes stay in the candidate lane until they have fixtures and verification evidence.
