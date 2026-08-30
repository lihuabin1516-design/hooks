# Codex context pressure probe

Updated: 2026-08-30

## Purpose

`codex-context-pressure` provides a read-only, privacy-bounded signal for
Codex App and Codex CLI context pressure.

It is intended to drive the long-task checkpoint policy:

```text
normal
  -> continue

soft threshold
  -> update context.md

hard threshold
  -> rotate context snapshots and create a Git/Workflow checkpoint

heuristic post-compaction drop
  -> reconcile the system summary, context.md, Git, Goal and runtime state
```

The default policy is:

```text
model context window: discovered from the rollout token_count event
soft threshold: 220000 tokens
hard threshold: 240000 tokens
```

When the discovered model context window is smaller than the absolute policy,
the probe uses 85% and 93% scaled thresholds instead of emitting impossible
limits.

## Open-source intake

The data-source semantics were evaluated against:

- `graykode/abtop`: cross-platform Rust TUI that reads Codex rollout JSONL and
  derives current context usage from the latest `token_count` event;
- `JChristensen/codex-request-meter`: Codex hook-driven per-request token
  reporting, used as evidence that prompt/turn hooks are an appropriate
  integration surface;
- `KevinKE93/Codex-Monitor`: Codex Desktop monitoring through CDP, rejected as a
  core dependency because the current implementation is macOS-oriented and
  depends on a debug-port launch path.

This repository does not vendor or depend on those projects. It reuses the
public Codex rollout event contract through the existing Hooks TypeScript
runtime and standard Node.js APIs.

## Command

Build first:

```powershell
npm run build
```

Probe the current Codex thread:

```powershell
node dist/src/cli.js codex-context-pressure
```

The command uses:

```text
CODEX_THREAD_ID
%USERPROFILE%\.codex\state_5.sqlite
%USERPROFILE%\.codex\sessions\**\*.jsonl
```

If `CODEX_THREAD_ID` is absent, it selects the most recently updated thread
with a rollout path from the read-only state database.

Explicit fixture or diagnostic invocation:

```powershell
node dist/src/cli.js codex-context-pressure `
  --codex-root <codex-root> `
  --state-db <state-db> `
  --thread-id <thread-id> `
  --soft-tokens 220000 `
  --hard-tokens 240000
```

Supported options:

```text
--codex-root
--state-db
--thread-id
--soft-tokens
--hard-tokens
--max-tail-bytes
--stale-after-ms
```

Unknown, duplicate, empty and invalid options fail before file or database
access.

## Output contract

Schema:

```text
hooks.codex-context-pressure/v1
```

Important fields:

```text
availability
contextTokens
modelContextWindow
remainingTokens
percentUsed
softThresholdTokens
hardThresholdTokens
pressure
compactionSignal
checkpointRequired
action
freshness
diagnostics
```

Actions:

```text
continue
update-context
rotate-context-and-checkpoint
reconcile-after-compaction
inspect
```

## Current and compatibility shapes

The parser accepts both observed forms:

```text
payload.model_context_window
payload.info.model_context_window
```

Context usage is taken from:

```text
payload.info.last_token_usage.input_tokens
```

It deliberately does not use:

```text
payload.info.total_token_usage.input_tokens
```

The total value is cumulative usage across turns and is not the current
context-window pressure.

## Privacy and trust boundaries

The probe:

- opens the Codex SQLite database read-only;
- reads only the bounded tail of the selected rollout;
- parses only `event_msg/token_count` records;
- does not parse user messages, assistant messages, prompts or tool output;
- accepts rollout paths only under the configured Codex
  `sessions`/`archived_sessions` roots;
- resolves real paths before admission;
- emits only truncated SHA-256 references for the thread and rollout;
- does not output a thread ID, rollout path, prompt, Session ID, Token,
  Authorization value or PTY content;
- returns typed `unavailable` output instead of guessing missing metrics.

## Compaction signal

Codex rollout files do not currently provide a stable, documented
cross-version compaction event consumed by this probe.

The probe therefore exposes:

```text
compactionSignal=heuristic-token-drop
```

only when consecutive observed context-token values show a material drop from
at least the active soft threshold.

This is an advisory recovery signal, not proof that a particular internal
compaction implementation ran.

## UserPromptSubmit advisory

The existing `workflow-advisory` command consumes the pressure result in the
same UserPromptSubmit process. This does not add another user-level hook group
and does not modify the real user `hooks.json`.

Injection policy:

```text
normal
  -> no pressure context

unavailable / stale
  -> no pressure context; emit a typed audit decision

soft
  -> advise updating context.md after the current atomic step

hard
  -> advise stopping scope expansion, rotating snapshots and checkpointing

heuristic-token-drop
  -> advise reconciliation against system summary, context.md, Git, Goal,
     Workflow and Session authorities
```

The pressure advisory schema is:

```text
hooks.codex-context-pressure-advisory/v1
```

The task-scoped privacy-bounded audit schema is:

```text
ccpanes.codex-context-advisory-audit.v1
```

The workflow and pressure contexts are composed under the installed
`additionalContextLimit=1800`. If the full workflow advice would exceed that
combined bound, the workflow section is reduced to its schema, route, rigor,
implementation-standard identity, level, optimization target and authority;
the pressure instruction is retained.

## Three-generation snapshot rotation

Coordinator/Leader code can apply a prepared next snapshot with:

```powershell
node dist/src/cli.js codex-context-snapshot rotate `
  --root <checkpoint-root> `
  --next <checkpoint-root>\next-context.md `
  --expected-current-sha256 <CURRENT_CONTEXT_SHA256>
```

The command validates:

- the fixed first heading;
- `schema: ccpanes.context.v1`;
- `retentionPolicy: current-plus-two-previous`;
- sections `0` through `9`;
- sequential `snapshotGeneration`;
- current/previous/previous2 generation continuity;
- an uppercase optimistic-lock SHA-256;
- a real root and a regular next-snapshot file contained under that root.

The transaction order is:

```text
exclusive single-writer lock
  -> validate current chain and expected SHA-256
  -> stage all desired generations durably
  -> atomically publish .context-rotation.json
  -> context.prev2.md
  -> context.prev.md
  -> context.md last as the commit point
  -> read back and validate
  -> remove owned stage files and journal
```

If the process stops after the journal is published, the staged source files
remain. The next invocation can finish the same desired state idempotently:

```powershell
node dist/src/cli.js codex-context-snapshot recover `
  --root <checkpoint-root>
```

The rotator changes only context snapshot files. It does not create a Git
commit, push a branch, modify a Goal, or claim that Workflow/Session state has
been reconciled. Those remain Coordinator/Leader gates.

## Remaining integration boundary

The current implementation still does not:

- modify the real user `hooks.json`;
- start a background polling process;
- block a prompt;
- generate the semantic contents of the next `context.md`;
- create a Git/Workflow checkpoint automatically;
- query or mutate Goal, Workflow, Worker, Binding, Result or Session state;
- claim that context token usage can be known before Codex writes the next
  `token_count` event.

Coordinator/Leader action consumption is now possible through the typed
pressure result, bounded advisory, and transaction-safe snapshot CLI. Automatic
checkpoint content generation and cross-authority reconciliation remain the
next integration slice.

## Verification

Focused:

```powershell
npm test -- --run tests/codex-context-pressure.test.ts
npm test -- --run tests/codex-context-advisory.test.ts
npm test -- --run tests/context-snapshot-rotation.test.ts
npm run typecheck
npm run build
node dist/src/cli.js codex-context-pressure
```

Full:

```powershell
npm run verify
```
