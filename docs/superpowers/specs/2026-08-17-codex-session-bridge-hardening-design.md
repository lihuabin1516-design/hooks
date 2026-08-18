# Codex Session Bridge Hardening Design

## Goal

Harden the existing Codex + CC-Panes session federation and Codex App sidebar
projection before submission. The change closes the independent review findings
without replacing Codex or CC-Panes authority, without editing their native
session stores, and without widening the current bridge into a general session
manager.

The protected invariant is:

> A sidebar name or pin action may target only a live Codex CLI thread whose
> current App Server identity, source, and runtime project scope agree with the
> confirmed project plan; every attempted side effect must leave durable,
> privacy-safe evidence whose final state is either proven or explicitly
> unknown.

## Confirmed Baseline

The design is based on the repository state observed on 2026-08-17:

- repository: `D:\cc-pane\tool\repos\hooks`
- branch: `main`
- HEAD: `53ae96a737d51c7ab7c02998c2320ea5f723408b`
- the current session-federation and sidebar implementation is an uncommitted
  task change layered over that HEAD;
- a real Codex App name and pin acceptance succeeded for thread
  `01a00490-90c0-7dc2-9fac-fbdb4d7baa0f`;
- the current rollback plan is intentionally not fully executable when the
  previous name is `null`, because Codex 0.147.0 exposes no supported clear-name
  operation;
- the last complete gate run passed 52 test files and 1,158 tests, typecheck,
  build, smoke, and whitespace checks;
- an independent review found one critical, seven important, and one minor
  issue in the current task change.

This document supersedes conflicting hardening details in
`2026-08-15-codex-ccpanes-session-federation-design.md`. That earlier document
remains the feature design and historical decision record.

## Scope

### In scope

1. Final artifact privacy projection and typed diagnostics for session index,
   resolution, retention, and federation output.
2. One core-owned Codex thread identity validator.
3. File-handle identity verification when reading `current-task.json`.
4. Explicit `threadHistoryDb` availability-only semantics.
5. Freshness and active-session eligibility for automatic sidebar selection.
6. Live App Server source and project-scope checks for both list and
   `thread/read` fallback results.
7. A durable sidebar apply journal written before the first native name change.
8. Explicit unknown-outcome handling for timeout, transport loss, and ambiguous
   post-write observations.
9. Reconciliation bound to the exact plan, apply execution, pending host action
   set, host receipt, and fresh App sidebar snapshot.
10. Privacy-safe propagation of App Server client and transport error
    classification through the CLI.
11. Focused tests, full repository gates, and a second independent review.

### Out of scope

- modifying Codex rollout JSONL, Codex SQLite, CC-Panes storage, global Codex
  configuration, or either official application;
- adding a background service, watcher, scheduler, or retry daemon;
- reading `thread_history_1.sqlite` projection rows or `item_json`;
- automatically executing rollback when Codex lacks a supported clear-name
  operation;
- importing all Codex App or CLI conversations into CC-Panes;
- changing CC-Panes Session, Pane, PTY, Task, or launch-history authority;
- deleting or rewriting existing v1/v2 generated artifacts;
- committing, pushing, integrating, or releasing as part of this specification
  phase.

## Authority and State Classes

| Concept | Canonical owner | State class | Bridge role |
| --- | --- | --- | --- |
| Codex thread ID, cwd, source, name | Codex App Server | authoritative current state | query and controlled name command |
| Codex rollout and state SQLite | Codex | authoritative/history inputs | bounded read-only source |
| CC-Panes Session, PTY, Task, launch | official CC-Panes | authoritative current/history state | explicit typed snapshot input |
| App sidebar listed/pinned state | Codex App host | authoritative current host state | snapshot plus host pin command |
| Federation graph | hooks repository | derived projection | rebuildable read model |
| Sidebar plan | hooks repository | derived control intent | immutable digest-bound proposal |
| Apply journal | hooks repository | durable audit/execution state | append-by-replacement recovery record |
| Apply result and reconciliation | hooks repository | derived audit evidence | proof or explicit uncertainty |
| `current-task.json` | current task worktree | authoritative task binding | bounded validated input |

The federation graph, plan, journal, apply result, receipt, and reconciliation
never become an authority for native Codex or CC-Panes state. Mutations continue
to route through the official owner operation.

## Component Boundaries

### Session federation core

Owns:

- Codex thread identity syntax;
- path and identity privacy projection;
- session artifact schemas;
- CC-Panes snapshot validation and freshness classification;
- project attribution and graph construction;
- final artifact diagnostics;
- current-task file safety.

Does not own:

- App Server transport;
- name or pin execution;
- CC-Panes live state collection;
- sidebar host mutation.

### App Server adapter

Owns:

- App Server protocol initialization;
- request and response validation;
- typed protocol, server, timeout, and transport errors;
- raw App Server thread projection into a bounded adapter type.

It imports the core thread identity validator. It does not redefine thread ID
syntax or decide project eligibility.

### Sidebar projection and CLI orchestration

Owns:

- converting a validated graph and live App Server observations into a plan;
- checking live source and runtime project scope;
- apply journal transitions;
- name mutation orchestration;
- pending host action generation;
- plan/apply/receipt/snapshot reconciliation;
- privacy-safe CLI error translation.

It does not infer native state from a historical graph when a current App Server
query disagrees.

## Core Contract Changes

### Core-owned thread identity

Create one owner for the Codex thread ID contract, independent of the App Server
adapter. The validator accepts a non-empty, bounded identifier matching the
existing safe character set and rejects any value changed by privacy projection.

All of these consumers import that owner:

- rollout and SQLite ingestion;
- federation nodes and edges;
- App Server requests and responses;
- sidebar graph, plan, apply, receipt, reconciliation, and rollback artifacts;
- CLI `--thread-id` and `--rename-thread-id` parsing.

The App Server adapter may expose a compatibility re-export during the same
implementation change, but no second validator implementation remains.

### Complete artifact privacy projection

Raw ingestion values remain internal. Before any session index, resolution,
retention, graph, sidebar artifact, warning, or CLI-safe error is persisted or
printed, the owning schema validator constructs a new projected value.

The projection rules are type-specific:

- identity fields must survive validation and redaction unchanged or become
  absent with a typed diagnostic; an altered identity is never persisted as a
  replacement string;
- filesystem paths must survive bounded path projection unchanged and normalize
  successfully or become `null` with a typed diagnostic;
- display strings use the existing bounded redact-and-excerpt operation;
- enum and boolean values are reconstructed from allowed values;
- timestamps are canonical timezone-bearing ISO values;
- numeric confidence and age fields must be finite and bounded;
- arrays are capacity-bounded and reconstructed element by element;
- unknown fields are rejected.

The projection covers, at minimum:

- thread IDs from SQLite rows, rollout metadata, filenames, delegation, task
  binding, and CC-Panes references;
- `cwdRaw`, `cwdNorm`, rollout paths, source database paths, task-context paths,
  project paths, and evidence paths;
- `originator`, source labels, titles, summaries, and previews;
- task IDs, launch IDs, Session IDs, and edge endpoints;
- warnings and caught-error metadata.

Free-form warning strings are replaced by typed diagnostics such as:

```ts
interface CodexSessionDiagnostic {
  code:
    | "source-missing"
    | "source-unreadable"
    | "record-skipped"
    | "rollout-unreadable"
    | "rollout-jsonl-invalid"
    | "privacy-projection-dropped";
  source:
    | "sessions-dir"
    | "state-db"
    | "thread-history-db"
    | "task-context"
    | "rollout"
    | "state-row";
  field: string | null;
  reason: string;
  subjectDigest: string | null;
}
```

`reason` is a closed machine-readable value. `subjectDigest`, when useful, is a
SHA-256 digest of a bounded canonical subject and never contains the raw path,
identity, SQLite message, prompt, or exception text.

### `threadHistoryDb` availability only

`thread_history_1.sqlite` remains a read-only availability diagnostic. The
session index records:

- its privacy-projected configured path or `null`;
- `availability: "present" | "missing" | "unreadable"`;
- `role: "availability-only"`.

No table is queried and no `thread_items`, `thread_turns`,
`thread_history_projection_state`, or `item_json` value enters the bridge. Its
presence or absence does not add sessions, change attribution, or affect sidebar
eligibility.

### Current-task handle identity

`readCurrentTaskFile` uses this fail-closed sequence:

1. `lstat` the path and require a regular non-symlink file.
2. Open the file read-only.
3. Obtain `handle.stat()` and require a regular file.
4. Compare pre-open path identity with handle identity.
5. Read at most 16 KiB plus one byte from the open handle.
6. `lstat` the path again before accepting parsed content.
7. Compare post-read path identity with the same open handle.
8. Reject when type, device, inode/file identity, or other stable identity
   attributes disagree.
9. Close the handle in all paths.

The implementation uses bigint stats where available. If the platform does not
provide a stable comparable identity for the three observations, the read fails
as `read-failed`; size and timestamp equality alone are not accepted as entity
identity.

## Snapshot Freshness and Automatic Eligibility

### CC-Panes snapshot lifecycle

The CC-Panes snapshot contract gains a normalized Session lifecycle field:

```ts
type CcPanesSessionLifecycle = "active" | "historical" | "unknown";
```

The snapshot producer derives this field from official CC-Panes state. The hooks
repository validates but does not invent or upgrade it from title or timestamp
proximity.

The federation graph records a first-class source state:

```ts
interface FederationCcPanesSourceState {
  availability: "missing" | "present";
  freshness: "fresh" | "stale" | "future" | "unknown";
  generatedAt: string | null;
  freshForAutomaticSelection: boolean;
}
```

`freshForAutomaticSelection` describes only the graph-wide snapshot condition.
Each concrete Codex thread node separately records
`automaticSidebarEligible: boolean`. That per-thread value is true only when:

- a snapshot is present;
- its timestamp is within the configured maximum age and future-skew bounds;
- the relevant Codex thread is joined by explicit IDs to a CC-Panes Session
  whose normalized lifecycle is `active`;
- the Session project exactly matches the graph project;
- the linked thread and graph node are concrete rather than inferred.

A fresh snapshot containing only `historical` or `unknown` Sessions does not
enable automatic selection. A launch record without an active joined Session is
diagnostic evidence only.

### Explicit selection

An explicit `--thread-id` may bypass missing, stale, future, historical, or
unknown CC-Panes automatic-selection evidence. It does not bypass:

- concrete graph membership;
- active user-thread storage eligibility;
- project relation `owned | supporting`;
- current App Server readability;
- current App Server source `cli`;
- current App Server cwd equal to or below the confirmed project;
- current App sidebar before-state freshness.

This preserves controlled recovery for historical CLI threads without allowing
stale data to drive an automatic write.

### App sidebar snapshot freshness

The before snapshot used by `sidebar-plan` must be generated within five minutes
of plan generation and no more than one minute in the future. An invalid,
missing, stale, or future before snapshot prevents plan generation because pin
rollback state would otherwise be guessed.

The after snapshot used by reconciliation must be generated at or after the host
receipt and must satisfy the same future-skew check relative to reconciliation
time.

## Live App Server Eligibility

Every App Server thread used for plan or apply is checked by one sidebar-owned
function:

```ts
validateLiveSidebarThread(thread, project, expectedThreadId)
```

It requires:

- `thread.id === expectedThreadId`;
- the core thread ID validator accepts the ID;
- `thread.source === "cli"`;
- normalized `thread.cwd` equals the normalized project or is a descendant of
  it;
- the cwd is a valid absolute filesystem path;
- name and preview already satisfy adapter privacy bounds.

The check applies equally to:

- `thread/list` results;
- explicit `thread/read` fallback during plan;
- `thread/read` fallback during apply;
- post-write observations.

A `thread/read` result with a conflicting cwd or source is a typed
`live-thread-scope-mismatch` or `live-thread-source-mismatch` failure. It cannot
make a candidate readable, cannot enter a plan, and cannot supply a current name
for apply. A list response containing a conflicting thread ID is treated the
same way rather than trusted because the request contained a cwd filter.

Apply revalidates all plan actions against current live threads. A plan created
from valid state does not authorize a later cross-project or cross-source
thread.

## Durable Apply Journal

### CLI contract

`sidebar-apply` requires an explicit journal path:

```powershell
node dist/src/cli.js codex-sessions sidebar-apply `
  --plan live/codex-sidebar-plan-v2.json `
  --confirm-digest SHA256 `
  --journal live/codex-sidebar-apply-journal.json `
  --out live/codex-sidebar-apply-v2.json
```

The journal and final output paths must differ. Both are resolved before App
Server startup. They must have the same resolved parent directory so journal and
result replacement use one filesystem boundary. The parent directory identity
is captured before client startup; symlink targets, non-regular existing files,
or a changed parent identity stop before mutation.

### Journal state machine

The journal schema is `hooks.codex-sidebar-apply-journal/v1`.

Root states:

```text
prepared -> running -> effects-recorded -> completed
                    -> unknown
                    -> aborted
```

Per-action states:

```text
planned -> unchanged | conflict | missing
planned -> intent-durable -> write-dispatched
                            -> applied | rejected | unknown
```

Rules:

1. The journal is created and durably replaced with `prepared` before the App
   Server client is initialized.
2. It contains an operation ID, plan digest, canonical action set, action-set
   digest, creation time, and no native side effect.
3. Before each `thread/name/set`, the action becomes `intent-durable` and the
   journal replacement completes.
4. Immediately before transport dispatch it becomes `write-dispatched`.
5. Every observation updates the journal before the next action begins.
6. Root `effects-recorded` means every action has a durable proven terminal
   state, but the final apply artifact is not yet durably available.
7. Root `completed` additionally requires a validated, durably written final
   apply artifact.
8. Any ambiguous dispatched action makes the root `unknown`.
9. A pre-side-effect fatal validation failure makes the root `aborted`.
10. Cleanup errors are recorded separately and do not overwrite the primary
   action outcome.

Journal replacement uses a same-directory temporary file, file flush, atomic
rename, and a supported directory flush when available. Failure to persist the
next required journal transition stops before the corresponding side effect.

### Resume and idempotency

Reusing a journal path is accepted only when its plan digest and canonical action
set match the current request.

- A completed journal with a matching valid output returns the existing result.
- A prepared journal may continue normally.
- A running or unknown journal is resumed by live observation; actions in
  `write-dispatched` or `unknown` are never blindly redispatched.
- An `effects-recorded` journal regenerates and validates the final apply output
  without repeating native writes.
- A mismatched, malformed, or privacy-invalid journal stops before mutation.

This provides recovery evidence when App Server close, stdout, or final artifact
write fails after a name change.

## Unknown Outcome and Error Contract

### Name mutation classification

The apply result distinguishes transport certainty from observed value:

- `unchanged`: no name command was sent and live name already matched.
- `name-applied`: the command received a valid success response and a valid live
  observation reports the desired name.
- `rejected`: the App Server returned a typed deterministic rejection and no
  contradictory successful observation exists.
- `conflict`: live before-state differs from both the plan before-state and
  desired state.
- `thread-missing`: the thread is absent in a valid live query.
- `unknown`: a timeout, transport loss, malformed response after dispatch,
  cleanup loss before a trustworthy final observation, or conflicting
  post-write observation leaves the native result uncertain.

A timeout or transport error after dispatch is never translated to `rejected`
or `failed` from one immediate reread. Resuming `sidebar-apply` with the same
journal may resolve `unknown` only after the original App Server process is
confirmed closed and a fresh client obtains agreeing `thread/list` and
`thread/read` observations. A failed original-process close or disagreeing
observations leave the state `unknown`.

Pending pin actions are emitted only for `unchanged` and `name-applied`.

### Cleanup errors

Client close and artifact finalization failures are represented as:

```ts
interface SidebarCleanupError {
  stage: "client-close" | "journal-finalize" | "result-write";
  causeKind: "client" | "transport" | "filesystem" | "unexpected";
  reason: string;
}
```

The journal remains the recovery source when the final result cannot be written.
Cleanup failure may make the command exit non-zero, but it does not erase or
reclassify a proven name result.

### CLI client error projection

`CodexSidebarCliClientError` preserves privacy-safe structured metadata:

```ts
interface SidebarClientFailure {
  stage: SidebarClientStage;
  causeKind: "app-server-client" | "transport" | "unexpected";
  reason: string;
  serverCode: number | null;
  category: string | null;
  transportReason: string | null;
}
```

Known App Server `reason`, safe numeric `serverCode`, allowlisted `category`, and
allowlisted transport reason survive translation. Raw server messages, stderr,
paths, prompts, payloads, and exception strings do not.

## Reconciliation Contract

### Inputs

`sidebar-reconcile` becomes:

```powershell
node dist/src/cli.js codex-sessions sidebar-reconcile `
  --plan live/codex-sidebar-plan-v2.json `
  --apply live/codex-sidebar-apply-v2.json `
  --host-receipt live/codex-sidebar-host-receipt-v2.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.after.json `
  --out live/codex-sidebar-reconcile-v2.json
```

The apply artifact is required. Recording an execution digest copied from a
receipt is no longer sufficient.

### Binding checks

Reconciliation validates all of the following before reporting a successful
root status:

1. The plan digest recomputes and equals `apply.planDigest`.
2. The apply execution digest recomputes.
3. The apply journal operation ID and action-set digest are present in the apply
   artifact.
4. The host receipt plan digest, execution digest, operation ID, and action-set
   digest equal the apply artifact.
5. Receipt entries exactly match apply `pendingHostActions` in thread ID,
   requested pin value, cardinality, and canonical order.
6. Apply entries correspond exactly to plan actions.
7. No receipt entry exists for an apply action with unknown or unconfirmed name
   outcome.
8. The after snapshot is fresh relative to the receipt and contains bounded,
   unique thread IDs.
9. Each applied receipt entry is listed, readable, and pinned as requested in the
   after snapshot.

The reconciliation root statuses are:

- `reconciled`: every expected host action is proven visible;
- `partial`: at least one expected action failed or is not visible;
- `unknown`: required native evidence is fresh but inconclusive;
- `binding-mismatch`: any digest, operation, action-set, or cardinality check
  fails.

The output includes the plan digest, apply execution digest, operation ID,
action-set digest, receipt digests, and per-thread status. It never labels a
digest-only match as reconciled.

Rollback-plan generation continues to require exact apply/receipt execution
binding and rejects apply results containing unknown name outcomes.

## Schema and Compatibility Strategy

This repository is in development and the affected artifacts are rebuildable.
Use a clean break rather than dual readers or compatibility aliases.

Changed schemas:

| Artifact | New schema |
| --- | --- |
| Codex session index | `hooks.codex-session-index/v3` |
| Codex session resolution | `hooks.codex-session-resolution/v3` |
| Session retention manifest | `hooks.codex-session-retention/v2` |
| CC-Panes session snapshot | `hooks.ccpanes-session-snapshot/v2` |
| Session federation graph | `hooks.session-federation/v2` |
| Sidebar plan | `hooks.codex-sidebar-plan/v2` |
| Sidebar apply journal | `hooks.codex-sidebar-apply-journal/v1` |
| Sidebar apply result | `hooks.codex-sidebar-apply/v2` |
| Sidebar host receipt | `hooks.codex-sidebar-host-receipt/v2` |
| Sidebar reconciliation | `hooks.codex-sidebar-reconciliation/v2` |
| Sidebar rollback plan | `hooks.codex-sidebar-rollback-plan/v2` |

Existing v1/v2 artifacts remain historical evidence and are not overwritten or
deleted automatically. New commands reject old schema inputs with typed
`unsupported-schema` errors. Operators regenerate index, graph, plan, apply,
receipt, reconciliation, and rollback artifacts in dependency order.

Command names remain stable. The intentional CLI breaks are:

- `sidebar-apply` requires `--journal`;
- `sidebar-reconcile` requires `--apply`;
- snapshot producers must emit v2 normalized lifecycle;
- old index, graph, sidebar, receipt, and rollback schemas are rejected.

README and `docs/codex-session-bridge.md` are updated in the same implementation
delivery after behavior and tests converge.

## Data and Control Flow

```text
Codex rollout/state SQLite (read-only)
  -> bounded raw ingestion
  -> core validation and privacy projection
  -> session index v3
  -> federation graph v2
       + CC-Panes snapshot v2 freshness/lifecycle
  -> sidebar plan v2
       + fresh App Server list/read
       + fresh App host before snapshot
  -> durable apply journal
  -> App Server thread/name/set
  -> apply result v2 or journal-held unknown state
  -> Codex App host pin
  -> host receipt v2
  -> fresh App host after snapshot
  -> reconciliation v2
```

Structural dependency direction:

```text
identity/privacy core
  <- index/snapshot/federation
  <- App Server adapter
  <- sidebar domain
  <- sidebar CLI
```

The core does not import the App Server adapter or sidebar modules.

## Failure and Recovery

| Failure | Required behavior | Recovery |
| --- | --- | --- |
| Unsafe raw index field | omit/skip according to field authority; emit typed diagnostic | fix source or regenerate |
| `threadHistoryDb` missing/unreadable | availability diagnostic only | no session impact |
| current-task path swap | fail `read-failed` | restore stable regular file and retry |
| stale/future CC-Panes snapshot | disable automatic selection | collect v2 snapshot or use explicit thread selection |
| historical/unknown CC-Panes Session | disable automatic selection | explicit selection with live checks |
| fallback thread cwd/source conflict | reject candidate/action | rebuild graph or select correct thread |
| journal prepare/update failure | stop before next mutation | repair output path and resume |
| timeout/transport loss after dispatch | journal and result `unknown` | explicit fresh-client apply reconciliation |
| App Server close failure | retain primary outcome plus cleanup error | inspect journal/result; retry cleanup separately |
| final apply output write failure | journal remains authoritative recovery evidence | resume from journal and regenerate output |
| receipt/action-set mismatch | reconciliation `binding-mismatch` | produce receipt for exact apply execution |
| after snapshot stale/not visible | `partial` or `unknown`, never success | recollect snapshot and reconcile |
| previous name is `null` | rollback plan remains non-executable for name clear | wait for supported official clear-name capability |

No recovery path edits Codex rollout JSONL or SQLite directly.

## TDD Implementation Requirements

Each hardening concern starts with a focused failing test before implementation.

### Session federation core tests

1. Unsafe thread ID, cwd, rollout path, originator, source path, warning, or
   caught error cannot appear raw in a persisted index.
2. An unsafe identity is omitted or its record is skipped with a typed diagnostic
   rather than replaced by redacted pseudo-identity.
3. Typed diagnostics contain no raw path, prompt, credential, or exception
   message.
4. `threadHistoryDb` present, missing, and unreadable states change diagnostics
   only and never add sessions.
5. The core identity validator is used by index, federation, App Server, sidebar,
   and CLI tests.
6. A path swap between pre-`lstat`, open handle, and post-`lstat` fails closed.
7. A normal stable current-task file still reads and validates.
8. Stale, future, historical, and unknown CC-Panes snapshot states cannot grant
   automatic sidebar eligibility.
9. A fresh snapshot with an explicitly joined active Session can grant automatic
   eligibility.
10. Input order remains irrelevant to graph semantics and digests.

### Sidebar projection tests

1. A fallback `thread/read` with the requested ID but another cwd is rejected.
2. A fallback `thread/read` with non-CLI source is rejected.
3. The same live checks apply during plan, apply before-state, and post-write
   observation.
4. Explicit selection bypasses CC-Panes freshness only, not live scope, source,
   project relation, storage, or snapshot freshness.
5. Journal `prepared` exists before client initialization and before any
   `setThreadName` call.
6. Journal reaches `intent-durable` before dispatch for each action.
7. A journal write failure prevents the corresponding native write.
8. A name write followed by client close or result-write failure remains
   recoverable from the journal.
9. Timeout and transport loss after dispatch produce `unknown`, not `failed` or
   `rejected`.
10. Unknown actions do not emit pending pin actions and are not eligible for
    rollback-plan generation.
11. A matching interrupted journal resumes by observation without blind
    redispatch.
12. App Server error reason, safe category, server code, and transport reason
    survive CLI translation; raw messages do not.
13. Reconciliation rejects a receipt copied from another apply execution even
    when the plan digest matches.
14. Reconciliation rejects missing, extra, reordered, or modified receipt
    actions.
15. Root `reconciled` requires every expected action to be visible in a fresh
    after snapshot.
16. Host failure, not-visible state, and inconclusive evidence produce `partial`
    or `unknown`, not `reconciled`.
17. Existing unsupported clear-name rollback behavior remains explicit and
    non-executable.

## Verification and Acceptance

### Focused checks

- `tests/current-task.test.ts`
- `tests/codex-session-bridge.test.ts`
- `tests/codex-session-cli.test.ts`
- `tests/session-federation.test.ts`
- `tests/session-federation-artifact.test.ts`
- `tests/ccpanes-session-snapshot.test.ts`
- `tests/codex-app-server-client.test.ts`
- `tests/codex-sidebar.test.ts`

### Required repository gates

```text
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short
```

Each check is reported as `pass`, `fail`, or `blocked`. The final status must
explain every changed or untracked path and preserve task-external user work.

### Acceptance assertions

1. No graph or fallback App Server mismatch can create a cross-project
   rename/pin plan.
2. No native name command occurs before durable intent evidence exists.
3. Timeout or transport uncertainty remains queryable as `unknown`.
4. Reconciliation proves one exact apply execution and its complete host action
   set.
5. Persisted artifacts and CLI-safe errors contain only schema-approved,
   privacy-projected fields.
6. `threadHistoryDb` is documented and tested as availability-only.
7. Stable current-task reads succeed; entity replacement races fail closed.
8. Existing native acceptance behavior remains available through regenerated v2
   sidebar artifacts.
9. A second independent review reports no unresolved critical or important
   finding before commit candidacy.

## Commit Candidate Boundaries

Implementation is prepared as two independently reviewable commit candidates.
Creating either commit still requires explicit user authorization.

### Candidate 1: session federation core

Contains only the core-owned concern:

- shared thread identity owner;
- complete artifact privacy projection and typed diagnostics;
- index/resolution/retention schema updates;
- CC-Panes snapshot lifecycle/freshness contract;
- federation v2 eligibility;
- current-task handle identity;
- `threadHistoryDb` availability-only behavior;
- focused core tests and directly governing documentation.

### Candidate 2: sidebar projection

Contains only the side-effect concern:

- live App Server cwd/source checks;
- privacy-safe client error propagation;
- durable apply journal and resume semantics;
- unknown-outcome and cleanup-error contract;
- apply/receipt/reconciliation/rollback v2 binding;
- sidebar-focused tests and CLI documentation.

Candidate 2 depends on Candidate 1's identity, privacy, snapshot, and graph
contracts. The dependency order does not authorize either commit or integration.

## Audit, Stop Conditions, and Residual Risk

Stop implementation and return for design review when:

- official Codex protocol behavior contradicts the assumed name-set or
  `thread/read` contract;
- official CC-Panes state cannot provide a trustworthy normalized active versus
  historical lifecycle;
- a platform cannot expose stable current-task file identity;
- durable journal replacement cannot be completed before side effects;
- an unknown name outcome would require direct SQLite or rollout modification;
- unrelated tracked, staged, or untracked user work would be overwritten;
- schema consumers outside the current repository require coexistence rather
  than the selected clean break.

Known residual risk after this design:

- Codex 0.147.0 still has no supported clear-name operation, so rollback from a
  previously unnamed thread remains partially manual/non-executable;
- App host pin remains a second authority boundary and requires a receipt plus
  fresh snapshot for proof;
- explicit selection intentionally permits controlled handling of historical
  threads, but only after current App Server and host-state validation;
- the bridge remains a derived federation layer, not native shared storage
  between Codex App, Codex CLI, and CC-Panes.

## Delivery Order

1. User reviews and approves this written specification.
2. Create a detailed TDD implementation plan with exact files, tests, and
   checkpoints.
3. Implement Candidate 1 and run focused core checks.
4. Implement Candidate 2 and run focused sidebar checks.
5. Run all repository gates.
6. Perform the second independent review.
7. Regenerate bounded acceptance artifacts in a new `live/` evidence directory.
8. Present the two commit candidates; do not stage, commit, push, or integrate
   without explicit authorization.
