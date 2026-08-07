# CC-Panes Hooks Phase 30 Policy Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-shot `policy-capture` CLI that records conversation-level project rules into both `.ccpanes-task/policy.md` and `.ccpanes-task/policy.json`.

**Architecture:** Keep `policy.json` as the executable source for hooks and `policy.md` as the human/model-readable ledger. Add a small ledger owner module, reuse existing `project-policy` validation/writer functions, and expose one CLI command that combines ledger append plus rule add/replace.

**Tech Stack:** TypeScript ESM, Node fs/promises, Vitest, existing CC-Panes hooks CLI.

---

### Task 1: RED tests for capture contract

**Files:**
- Create: `tests/project-policy-capture.test.ts`
- Modify: `tests/cli.test.ts`

- [ ] Add a test that calls `captureProjectPolicyInstruction` with root, id, instruction, effect, reason, tool and command matcher. Assert `policy.md` contains escaped instruction/effective action and `policy.json` contains the executable rule.
- [ ] Add a preservation test with an existing `policy.md` and existing `policy.json`; assert ledger content remains and `--replace` semantics update the JSON rule.
- [ ] Add a CLI test for `policy-capture --root ... --id ... --instruction ... --effect block --reason ... --tool shell --command-contains publish-artifact`.
- [ ] Run `npm test -- tests/project-policy-capture.test.ts tests/cli.test.ts` and verify the new tests fail because the module/command is missing.

### Task 2: GREEN implementation

**Files:**
- Create: `src/project-policy-ledger.ts`
- Create: `src/project-policy-capture.ts`
- Modify: `src/project-bootstrap.ts`
- Modify: `src/cli.ts`

- [ ] Move policy ledger path/default/ensure behavior into `project-policy-ledger.ts`.
- [ ] Implement `appendProjectPolicyLedgerEntry` with atomic append-by-rewrite, markdown table escaping, and automatic ledger initialization when missing.
- [ ] Implement `captureProjectPolicyInstruction` by creating a `ProjectPolicyRule`, adding/replacing it through existing `project-policy` functions, writing `policy.json`, and appending the ledger row.
- [ ] Add `policy-capture` CLI parsing. Reuse existing `--tool`, `--path-contains`, `--command-contains`, `--phase`, `--match-reason`, `--replace`, plus required `--instruction`.
- [ ] Run focused tests and make them pass.

### Task 3: Docs and production toolkit alignment

**Files:**
- Modify: `README.md`
- Modify: `scripts/smoke.mjs` if smoke coverage should include the new command.

- [ ] Document `policy-capture` as the recommended conversation-rule entrypoint.
- [ ] Keep `policy-add` documented as the lower-level mechanical JSON command.
- [ ] Add smoke coverage only if it remains deterministic and bounded inside temp fixtures.

### Task 4: Verification, publish, live sync

**Commands:**
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `node dist/src/cli.js verify-installed-hooks --hooks-json C:\Users\AI001\.codex\hooks.json --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits --config C:\Users\AI001\.codex\config.toml`

- [ ] Commit and push to `https://github.com/lihuabin1516-design/hooks.git` on `main`.
- [ ] Sync repo files to `D:\cc-pane\tool\experiments\ccpanes-task-probe` after backing up live files.
- [ ] Repeat full live verification and a fixture run that proves `policy-capture` creates ledger + JSON and `hook-enforce` blocks the captured rule.
