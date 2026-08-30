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

## Integration boundary

This first slice is a read-only probe and CLI contract.

It does not:

- edit `context.md`;
- rotate context snapshots;
- modify user `hooks.json`;
- start a background polling process;
- block a prompt;
- claim that context token usage can be known before Codex writes the next
  `token_count` event.

The next integration slice can call the probe from the existing
`UserPromptSubmit` chain and inject a bounded advisory only for `soft`, `hard`
or post-compaction actions. User-level hook configuration remains a separately
authorized deployment step.

## Verification

Focused:

```powershell
npm test -- --run tests/codex-context-pressure.test.ts
npm run typecheck
npm run build
node dist/src/cli.js codex-context-pressure
```

Full:

```powershell
npm run verify
```
