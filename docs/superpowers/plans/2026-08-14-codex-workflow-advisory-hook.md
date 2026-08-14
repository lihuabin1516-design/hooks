# Codex Workflow Advisory Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject the canonical production-grade implementation standard into relevant Codex App prompts through a bounded, audited `UserPromptSubmit` hook.

**Architecture:** A focused boundary adapter parses the Codex event and delegates classification to `workflow-profile.ts`. The CLI resolves task scope, emits advisory context only for applicable routes, and appends privacy-preserving JSONL audit evidence. `installed-hooks.ts` adds a third prompt hook without replacing existing handlers.

**Tech Stack:** TypeScript, Node.js, Vitest, Codex hooks JSON

---

### Task 1: Define the advisory boundary contract

**Files:**
- Create: `tests/workflow-advisory-hook.test.ts`
- Create: `src/workflow-advisory-hook.ts`

- [ ] Write failing tests for valid code prompts, null advisory routes, invalid
  input, bounded context, and prompt-hash audit records.
- [ ] Run `npx vitest run tests/workflow-advisory-hook.test.ts` and confirm the
  module-not-found failure.
- [ ] Implement the parser, formatter, audit record factory, and atomic JSONL
  append using the canonical workflow classifier.
- [ ] Run the focused test and confirm all assertions pass.

### Task 2: Add the CLI execution path

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `src/cli.ts`

- [ ] Write failing CLI tests for matched task injection, unmatched task no-op,
  documentation no-op, and invalid-event fail-open behavior.
- [ ] Run the focused CLI tests and confirm `workflow-advisory` is unknown.
- [ ] Add `workflow-advisory --resolve-task-from-cwd --audit-root` using stdin
  JSON and the existing task-binding resolver.
- [ ] Keep output empty for all non-applicable cases and append an audit only
  after a task binding is matched.
- [ ] Run the focused CLI tests and confirm they pass.

### Task 3: Extend installed hook topology

**Files:**
- Modify: `tests/installed-hooks.test.ts`
- Modify: `src/installed-hooks.ts`
- Modify: `tests/production-toolkit.test.ts`
- Modify: `src/production-toolkit.ts`

- [ ] Write failing tests requiring a third `UserPromptSubmit` group with
  `workflow-advisory`, five-second timeout, and 1800-character context limit.
- [ ] Verify the tests fail because the expected hook is absent.
- [ ] Add the command after the two existing prompt hooks and require its trust
  state in installed-hook verification.
- [ ] Update production package documentation to describe all three prompt
  handlers.
- [ ] Run focused installed-hook and toolkit tests.

### Task 4: Update registry, smoke coverage, and operating docs

**Files:**
- Modify: `src/host-adapter-registry.ts`
- Modify: `tests/host-adapter-registry.test.ts`
- Modify: `scripts/smoke.mjs`
- Modify: `docs/CCPANES-HOOK-HOST-ADAPTER-MATRIX.md`
- Modify: `docs/PONYTAIL-ADOPTION.md`
- Modify: `README.md`
- Modify: `PROJECT-DIRECTORY.md`

- [ ] Add runtime-consumption and live verification expectations.
- [ ] Ensure smoke proves the advisory command and expected hook topology.
- [ ] Document rollback, trust, and fresh Codex canary steps.

### Task 5: Repository gates and review

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run smoke`.
- [ ] Run `git diff --check`.
- [ ] Inspect task diff and status without touching `.ccpanes/` or `CLAUDE.md`.

### Task 6: Publish repository change

- [ ] Stage only task-owned files.
- [ ] Commit one production workflow-advisory concern.
- [ ] Push `main` after confirming the commit contains no user configuration,
  audit output, secrets, or unrelated untracked files.

### Task 7: Synchronize live and install the hook

- [ ] Record existence, size, and SHA-256 for
  `C:\Users\AI001\.codex\hooks.json` and
  `C:\Users\AI001\.codex\config.toml`.
- [ ] Snapshot `hooks.json` to the task audit directory.
- [ ] Synchronize the committed runtime files from the repo into
  `D:\cc-pane\tool\experiments\ccpanes-task-probe`.
- [ ] Install dependencies only if the existing live dependency tree is
  insufficient; otherwise reuse it.
- [ ] Build and test in the live root.
- [ ] Merge the expected third `UserPromptSubmit` group into `hooks.json` while
  preserving unrelated hook events and handlers.
- [ ] Record post-change existence, size, and SHA-256.

### Task 8: Live acceptance

- [ ] Run `verify-live-consistency`.
- [ ] Run `verify-installed-hooks`; if the new group lacks a trusted hash, use
  the Codex hook trust flow and rerun.
- [ ] Run the live full test, typecheck, build, and smoke gates.
- [ ] Submit a synthetic official Codex `UserPromptSubmit` event to the live
  command and verify bounded additional context and an audit record.
- [ ] Start a fresh Codex task in the project and verify a code prompt produces
  `ccpanes.workflow-advisory.v1` context while a documentation prompt does not.
- [ ] Record and verify final acceptance evidence with artifact hashes and all
  required truth layers.
