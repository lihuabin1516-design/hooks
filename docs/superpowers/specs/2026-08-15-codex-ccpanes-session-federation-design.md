# Codex + CC-Panes Session Federation Design

## Goal

Provide one externally governed session view for Codex App, Codex CLI, and
CC-Panes without replacing any product's state authority. The bridge must:

1. report project-owned sessions separately from merely related sessions;
2. map Codex thread IDs to CC-Panes Session, Task, and launch records;
3. choose the correct continuation route for each session;
4. make selected CLI-backed threads visible in the Codex App native sidebar
   through official App Server naming plus the Codex App host pin operation.

## Confirmed Problem

The current `hooks.codex-session-index/v1` projection uses one `scopeMatch`
field for several different meanings:

- `exact`: runtime cwd equals the project path;
- `ancestor`: runtime cwd is a parent of the project;
- `prompt-mention`: prompt text contains the project path.

This makes a related-session count look like a project-ownership count. In the
current live index, the previously reported 67 Codex App and 75 Codex CLI
records are composed of:

| Source | exact | ancestor | prompt-mention |
|---|---:|---:|---:|
| Codex App | 30 | 33 | 4 |
| Codex CLI | 1 | 73 | 1 |

The user-facing active, non-archived, user-thread, exact-cwd subset is five App
threads plus one CLI thread. Even this subset is not a semantic ownership
proof because an external-project evaluation can run with the hooks repository
as cwd.

The current implementation also defines `source: ccpanes` and
`scopeMatch: launch-history` but does not ingest CC-Panes launch history,
Session, Task, or PTY facts. It therefore cannot express the observed chain:

```text
Codex App thread
  -> controller CLI thread
  -> CC-Panes launch record
  -> CC-Panes PTY Session and Task
  -> resumed Codex thread
```

## Authority and Invariants

### State authorities

- Codex owns Codex thread identity, rollout history, thread metadata, and
  resume semantics.
- Official CC-Panes owns Pane, Session, PTY, launch history, and terminal
  output.
- Companion Coordinator owns Workflow, Worker, Binding, Outbox, and result
  state.
- The hooks repository owns only the external federation schema, attribution
  rules, generated plans, and audit artifacts.

### Invariants

1. A CC-Panes Session ID is not rewritten into a Codex thread ID.
2. A derived federation edge never becomes authority for either product.
3. Direct edits to Codex rollout JSONL or SQLite files are outside the design.
4. Codex thread naming uses only the official App Server protocol; pinning uses
   the official Codex App host operation.
5. CC-Panes live facts are imported from an explicit snapshot or adapter
   response; no token, dynamic port, or private endpoint is persisted.
6. Default project counts exclude ancestor-only, prompt-only, archived, and
   subagent records.

## Approaches Considered

### A. Keep cwd-only attribution

Smallest implementation, but it preserves the current over-counting and cannot
map CC-Panes runtime identities. Rejected.

### B. Copy CC-Panes and Codex state into one new database

This would create a competing source of truth, introduce migrations and
reconciliation risk, and couple the bridge to private persistence layouts.
Rejected.

### C. Build a read model with explicit evidence and controlled metadata writes

Use product-owned data as inputs, generate an idempotent federation graph, and
apply only selected Codex thread display metadata through the official App
Server. Recommended.

## Data Model

### Session index v2

`hooks.codex-session-index/v2` replaces overloaded attribution fields with:

```ts
interface FederatedCodexThread {
  threadId: string;
  host: "codex-app" | "codex-cli" | "unknown";
  threadSource: "user" | "subagent" | "automation" | "unknown";
  storageState: "active" | "archived" | "missing";
  runtimeScope: "exact" | "descendant" | "ancestor" | "unrelated" | "unknown";
  projectRelation:
    | "owned"
    | "supporting"
    | "mentioned"
    | "ambient"
    | "unrelated"
    | "unknown";
  relationConfidence: number;
  evidence: SessionEvidence[];
  appVisibility: "listed" | "readable-hidden" | "unknown";
}
```

Evidence is typed rather than encoded into one enum:

```ts
type SessionEvidence =
  | { kind: "task-binding"; projectPath: string; taskId: string }
  | { kind: "ccpanes-launch"; projectPath: string; launchId: string }
  | { kind: "ccpanes-session"; projectPath: string; sessionId: string }
  | { kind: "cwd"; relation: "exact" | "descendant" | "ancestor" }
  | { kind: "primary-target"; target: string }
  | { kind: "prompt-mention"; target: string }
  | { kind: "delegation"; sourceThreadId: string };
```

Filesystem normalization and prompt matching have separate owners.
`normalizeCodexPath` accepts only absolute filesystem paths: Windows drive and
UNC filesystem forms use Win32 case-insensitive semantics, `/mnt/<drive>` is
mapped only after POSIX dot-segment normalization, and native POSIX paths retain
case. Prompt evidence uses a bounded `promptMentionsProjectPath(prompt, project)`
matcher derived from the known project path, so free-form text is never sent to
the filesystem normalizer and sibling prefixes do not match.

The session-index filesystem boundary captures the invocation cwd once and
resolves `sessionsDir`, `stateDb`, `threadHistoryDb`, an optional task-context
path, and relative SQLite `rollout_path` values against that root. Sources and
rollout records therefore expose absolute paths and relative rollout rows cannot
collapse onto an empty normalized key.

### CC-Panes snapshot

The bridge accepts a typed, read-only snapshot:

```ts
interface CcPanesSessionSnapshot {
  schemaVersion: "hooks.ccpanes-session-snapshot/v1";
  generatedAt: string;
  launches: Array<{
    launchId: string;
    projectPath: string;
    workspaceName: string | null;
    cliTool: string;
    resumeSessionId: string | null;
    launchedAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    launchId: string | null;
    taskId: string | null;
    projectPath: string | null;
    status: string;
    title: string | null;
    observedCodexThreadId: string | null;
  }>;
}
```

The snapshot can be produced by a Codex App agent using registered CC-Panes
tools or by a future Companion adapter. The hooks CLI validates the file but
does not discover or persist CC-Panes credentials.

`sessions[].launchId` is the explicit join key between a CC-Panes launch-history
record and the PTY Session it created. When the installed CC-Panes inventory
cannot establish that join, the value remains `null`; the bridge does not infer
it from title or timestamp proximity.

### Federation graph

`hooks.session-federation/v1` contains typed nodes and edges:

- nodes: `codex-thread`, `ccpanes-session`, `ccpanes-task`, `ccpanes-launch`;
- edges: `resumed-from`, `launched`, `hosts`, `belongs-to-task`,
  `delegated-from`, `controller-for`.

Each edge includes evidence, confidence, and observation time. Ambiguous edges
remain explicit and never replace exact identifiers.

## Attribution Rules

Explicit conflicts are exclusion gates and are evaluated before positive
attribution:

1. any conflicting primary target, task binding, or CC-Panes launch evidence
   -> `unrelated`, even when another task/launch item exactly matches;
2. matched task binding, or a thread ID referenced by an exact-project
   CC-Panes launch/Session record -> `owned`;
3. exact/descendant cwd with a compatible primary target -> `supporting`;
4. prompt-only evidence -> `mentioned`;
5. ancestor cwd without stronger evidence -> `ambient`;
6. missing evidence -> `unknown`.

Default `resolve` output includes:

- active storage only;
- user threads only;
- `owned` and `supporting` relations.

Optional flags expose broader sets:

```text
--include-subagents
--include-archived
--include-related
--include-ambient
```

Human-readable output reports separate totals for owned, supporting, related,
ambient, archived, and subagent records. It never labels their sum as project
ownership.

## Codex App Sidebar Projection

### Plan

`codex-sessions sidebar-plan` reads the federation graph and produces:

```text
hooks.codex-sidebar-plan/v1
```

Only threads satisfying all of these conditions are selected by default:

- relation is `owned` or `supporting`;
- thread source is `user`;
- storage is active;
- App visibility is `readable-hidden`;
- the thread is linked to a live/recent CC-Panes launch or explicitly selected
  by thread ID.

The command opens the installed App Server read-only while building the plan so
that `readable-hidden`, current name, and exact thread identity are observed
rather than inferred from cwd. Repeatable `--thread-id` flags provide the
explicit-selection path and are required for controlled live acceptance.

The Codex App host snapshot records `listed`, `readable`, and the current pin
state for both listed threads and explicitly selected hidden threads. This
before-state is retained in the plan/apply audit so rollback never guesses that
an absent sidebar entry was previously unpinned.

The plan contains desired `name` and `pinned` values, current values when
known, reasons, required adapter, and a SHA-256 plan digest.

### Apply

`codex-sessions sidebar-apply`:

1. requires the plan path and matching confirmation digest;
2. starts the official `codex app-server --stdio`;
3. performs the initialize handshake;
4. re-reads current thread metadata through `thread/list`;
5. rejects a concurrent name change relative to the confirmed plan;
6. sends `thread/name/set` only when the desired name differs;
7. records pin/unpin as a pending Codex App host action only for entries whose
   name step is `unchanged` or verified `name-applied`;
8. re-reads the name to verify the App Server write;
9. writes an audit result under `live/`.

The Codex App agent consumes pending host actions with
`codex_app.set_thread_pinned`, then writes a bounded host receipt for
`codex-sessions sidebar-reconcile`. Reconciliation verifies that the thread
appears in the App sidebar list.

The operation is idempotent. A partial failure leaves successful name updates
and pending pin actions reported and allows a retry. Unknown-outcome name
writes are reconciled by re-reading the thread before reporting failure.

### Sidebar naming

Generated names are bounded and preserve the original title:

```text
[CC-Panes] <original title>
```

The bridge does not rename already user-customized threads unless the plan
explicitly records and confirms that change.

The installed `codex-cli 0.147.0` generated protocol schema is the capability
contract for this implementation. It exposes `thread/list` and
`thread/name/set`, while its `ThreadMetadataUpdateParams` contains only
`gitInfo`; therefore pin/unpin remains a Codex App host operation for this
acceptance. A future CLI version is re-probed rather than assumed to have the
same metadata surface.

## CLI Surface

Existing commands remain compatible. New or changed commands:

```powershell
node dist/src/cli.js codex-sessions scan `
  --project PROJECT `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --out live/codex-session-index-v2.json

node dist/src/cli.js codex-sessions resolve `
  --project PROJECT `
  --json

node dist/src/cli.js codex-sessions graph `
  --project PROJECT `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --out live/session-federation.json

node dist/src/cli.js codex-sessions sidebar-plan `
  --graph live/session-federation.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.before.json `
  --thread-id THREAD_ID `
  --out live/codex-sidebar-plan.json

node dist/src/cli.js codex-sessions sidebar-apply `
  --plan live/codex-sidebar-plan.json `
  --confirm-digest SHA256 `
  --out live/codex-sidebar-apply.json

node dist/src/cli.js codex-sessions sidebar-reconcile `
  --plan live/codex-sidebar-plan.json `
  --host-receipt live/codex-sidebar-host-receipt.json `
  --out live/codex-sidebar-reconcile.json
```

The v1 index remains readable during migration. New outputs use versioned file
names until v2 acceptance is complete.

## Failure, Recovery, and Rollback

- Missing CC-Panes snapshot: Codex-only indexing continues with a warning.
- Invalid snapshot: federation generation fails before output replacement.
- App Server unavailable: plan generation remains available; name apply reports
  a typed connection failure.
- Codex App host operation unavailable: pin actions remain pending and can be
  retried from a Codex App conversation.
- Thread absent during apply: mark `thread-missing`, continue other entries.
- Concurrent name change: re-read and report conflict.
- Rollback: generate a reverse plan from the apply audit, restore the previous
  name through App Server, and restore pin state through the Codex App host.

Generated JSON writes remain atomic. No original transcript is deleted or
rewritten.

## Privacy and Observability

Artifacts contain IDs, paths, relation evidence, timestamps, and bounded
titles/summaries. They exclude raw credentials, CC-Panes endpoint data, full
transcripts, screenshot payloads, and raw prompts unless a bounded prompt
excerpt is already part of the existing index contract.

Diagnostics include:

- count by relation, source, storage, and thread source;
- excluded-count reasons;
- edge-confidence distribution;
- App Server request result and reconciliation state;
- CC-Panes snapshot age.

## Verification

Required tests:

1. ancestor and prompt-only records stay out of default ownership totals;
2. archived and subagent records require explicit flags;
3. exact cwd with conflicting primary-target evidence is `unrelated` and stays
   out of default-visible totals;
4. CC-Panes launch and Session records create deterministic graph edges;
5. duplicate snapshots produce identical graph semantics;
6. malformed or stale snapshots produce typed diagnostics;
7. sidebar plan includes readable-hidden threads and excludes listed threads;
8. App Server apply changes only the thread name and emits pending pin actions;
9. apply retry and unknown-outcome reconciliation are idempotent;
10. host receipt reconciliation verifies pinned sidebar visibility;
11. rollback restores captured name and pin state;
12. v1 consumers continue to work during migration;
13. tests, typecheck, build, smoke, diff check, and final status inspection pass.

Live acceptance uses one selected CLI thread. It verifies:

- the thread is readable by Codex App before projection;
- it is absent from the normal sidebar list before apply;
- the confirmed App Server apply names it and emits one pin action;
- the Codex App host applies the pin action;
- it appears in the sidebar after refresh;
- rollback returns the original name and pin state.

## Delivery Boundaries

This phase changes only the hooks repository and generated `live/` artifacts.
It does not modify the CC-Panes application, Codex application executable,
Codex rollout files, Codex SQLite files directly, global Codex configuration,
or Companion source repository.

Native display of the CC-Panes PTY itself is represented by its linked Codex
thread. The PTY Session ID and live status remain CC-Panes-owned metadata shown
through the federation graph, not a synthetic Codex thread.
