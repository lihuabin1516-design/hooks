# Codex Session Bridge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Codex session federation and Codex App sidebar projection so only live, project-scoped CLI threads can be mutated and every native side effect has durable, privacy-safe, execution-bound evidence.

**Architecture:** Move the Codex thread ID contract and index artifact projection into core-owned modules, then upgrade the session index, CC-Panes snapshot, and federation graph with clean-break schemas. Build sidebar selection on fresh graph/host evidence plus one shared live-thread validator. Execute name changes through a durable apply journal, preserve ambiguous outcomes as `unknown`, and bind reconciliation to one exact plan, apply execution, host action set, receipt, and fresh host snapshot.

**Tech Stack:** Node.js 22 standard library, TypeScript, `node:sqlite` read-only access, Vitest, Codex App Server JSONL protocol, SHA-256 canonical digests, atomic same-directory JSON replacement.

**Authorization note:** Current authorization excludes stage, commit, push, integration, release, native Codex store edits, CC-Panes store edits, and global configuration changes. Every Git checkpoint below is inspection-only.

**Baseline note:** The approved design and live Git inspection use `main` at `53ae96a737d51c7ab7c02998c2320ea5f723408b`. `.ccpanes-task/current-task.json` still records `e5e4fbd81a4c7870d1f1569de842f4ef9dc5b6f0`; implementation must report that stale metadata mismatch and must not rewrite it without separate authorization.

---

## File Map

### Create

- `src/codex-session-identity.ts`
  - sole owner of the bounded Codex thread ID contract;
  - imported by ingestion, federation, App Server, sidebar artifacts, and CLI parsing.
- `src/codex-session-index-artifact.ts`
  - owns index v3 source descriptors, typed diagnostics, final record projection, and strict artifact validation.
- `src/codex-sidebar-live-thread.ts`
  - owns exact ID, `source === "cli"`, absolute cwd, project equality/descendant, and bounded display checks.
- `src/codex-sidebar-journal.ts`
  - owns apply journal v1 schemas, digests, state transitions, durable replacement, path identity, and resume validation.

### Modify

- `src/codex-session-index.ts`
  - use the core identity owner;
  - emit typed diagnostics;
  - treat `threadHistoryDb` as availability-only;
  - project every record before returning index v3.
- `src/codex-session-resolver.ts`
  - emit resolution v3 from projected records.
- `src/codex-session-handoff.ts`
  - emit retention v2 through strict projection;
  - keep handoff selection based on validated records.
- `src/current-task.ts`
  - compare pre-open, open-handle, and post-read file identity.
- `src/ccpanes-session-snapshot.ts`
  - require snapshot v2 lifecycle;
  - validate `active | historical | unknown`.
- `src/session-federation.ts`
  - emit graph v2 source state;
  - calculate per-concrete-thread `automaticSidebarEligible`.
- `src/session-federation-artifact.ts`
  - strictly validate graph v2 source state and thread eligibility.
- `src/codex-app-server-client.ts`
  - import the core identity owner;
  - preserve typed client/transport metadata for upper layers.
- `src/codex-sidebar.ts`
  - upgrade sidebar artifacts to v2;
  - add action-set binding, unknown outcome, cleanup errors, and exact reconciliation.
- `src/codex-sidebar-cli.ts`
  - apply the live-thread validator to list/read/post-write results;
  - require journal/apply inputs;
  - orchestrate journal recovery and structured errors.
- `src/cli.ts`
  - wire new schemas and required options without dual readers.
- `README.md`
  - update concise command examples and clean-break migration order.
- `docs/codex-session-bridge.md`
  - document source authority, eligibility, journal recovery, reconciliation, and acceptance.

### Tests

- `tests/current-task.test.ts`
- `tests/codex-session-bridge.test.ts`
- `tests/codex-session-cli.test.ts`
- `tests/ccpanes-session-snapshot.test.ts`
- `tests/session-federation.test.ts`
- `tests/session-federation-artifact.test.ts`
- `tests/codex-app-server-client.test.ts`
- `tests/codex-sidebar.test.ts`

---

## Candidate 1: Session Federation Core

### Task 1: Establish the Core Thread Identity Owner

**Files:**
- Create: `src/codex-session-identity.ts`
- Modify: `src/codex-session-index.ts`
- Modify: `src/session-federation.ts`
- Modify: `src/session-federation-artifact.ts`
- Modify: `src/codex-app-server-client.ts`
- Modify: `src/codex-sidebar.ts`
- Modify: `src/codex-sidebar-cli.ts`
- Test: `tests/codex-session-bridge.test.ts`
- Test: `tests/session-federation-artifact.test.ts`
- Test: `tests/codex-app-server-client.test.ts`
- Test: `tests/codex-sidebar.test.ts`
- Test: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add one cross-consumer failing contract test**

Append focused assertions that use the same accepted and rejected values through every public boundary:

```ts
import { isCodexThreadId } from '../src/codex-session-identity.js';

const validThreadId = `a${'b'.repeat(511)}`;
const invalidThreadIds = [
  '',
  `a${'b'.repeat(512)}`,
  ' leading',
  'trailing ',
  'thread/with/slash',
  'thread\nwith-control',
  'sk-proj-secret-shaped'
];

test('uses one core Codex thread ID contract across all consumers', () => {
  expect(isCodexThreadId(validThreadId)).toBe(true);
  for (const value of invalidThreadIds) {
    expect(isCodexThreadId(value)).toBe(false);
  }
});
```

Add consumer assertions that invalid values fail with their existing typed boundary errors and never appear in error text.

- [ ] **Step 2: Run the focused tests and confirm the missing module/contract failure**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts tests/session-federation-artifact.test.ts tests/codex-app-server-client.test.ts tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because `src/codex-session-identity.ts` does not exist and consumers still own separate validators.

- [ ] **Step 3: Create the identity owner and replace local implementations**

Create `src/codex-session-identity.ts`:

```ts
import {
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
} from './codex-session-privacy.js';
import {
  sanitizeCodexSessionArtifactExcerpt
} from './codex-session-artifact-privacy.js';

export const CODEX_THREAD_ID_MAX_LENGTH =
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH;

export function isCodexThreadId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CODEX_THREAD_ID_MAX_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) &&
    sanitizeCodexSessionArtifactExcerpt(value) === value;
}

export function requireCodexThreadId(
  value: unknown,
  onInvalid: () => never
): string {
  return isCodexThreadId(value) ? value : onInvalid();
}
```

Then:

- replace `isCodexAppServerThreadId` with a compatibility re-export of `isCodexThreadId`;
- replace `isSessionFederationCodexThreadId` with a compatibility re-export or thin alias;
- make index ingestion, sidebar artifact validation, and CLI `--thread-id` parsing import `isCodexThreadId`;
- remove every duplicate regular expression and length constant for thread IDs.

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts tests/session-federation-artifact.test.ts tests/codex-app-server-client.test.ts tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the identity-owner checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: only task-scoped source/test changes plus the already-known working-tree files; no staged paths.

### Task 2: Replace Free-Form Index Warnings with Index v3 Projection

**Files:**
- Create: `src/codex-session-index-artifact.ts`
- Modify: `src/codex-session-index.ts`
- Test: `tests/codex-session-bridge.test.ts`

- [ ] **Step 1: Add failing privacy and schema tests**

Add tests that create unsafe SQLite rows, rollout metadata, source paths, prompt excerpts, and thrown error messages:

```ts
test('projects index v3 records and diagnostics without raw unsafe values', async () => {
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  const index = await buildCodexSessionIndex({
    sessionsDir,
    stateDb,
    threadHistoryDb,
    project,
    taskContext
  });

  expect(index.schemaVersion).toBe('hooks.codex-session-index/v3');
  expect(index).toMatchObject({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringMatching(
          /^(source-missing|source-unreadable|record-skipped|rollout-unreadable|rollout-jsonl-invalid|privacy-projection-dropped)$/
        ),
        field: expect.anything(),
        subjectDigest: expect.anything()
      })
    ])
  });
  expect(JSON.stringify(index)).not.toContain(secret);
  expect(JSON.stringify(index)).not.toContain('raw exception payload');
});

test('drops an unsafe identity instead of persisting a redacted pseudo identity', async () => {
  const index = await buildCodexSessionIndex(fixtureWithUnsafeThreadId());
  expect(index.sessions).toHaveLength(0);
  expect(index.diagnostics).toContainEqual(expect.objectContaining({
    code: 'record-skipped',
    source: 'state-row',
    field: 'threadId',
    reason: 'unsafe-identity'
  }));
});
```

- [ ] **Step 2: Run the focused index tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts
```

Expected: `FAIL` because the current index is v2 and emits `warnings: string[]`.

- [ ] **Step 3: Add exact v3 artifact types and a final projector**

Create `src/codex-session-index-artifact.ts` with these public contracts:

```ts
import { createHash } from 'node:crypto';
import type { CodexSessionRecord } from './codex-session-index.js';

export type CodexSessionDiagnosticCode =
  | 'source-missing'
  | 'source-unreadable'
  | 'record-skipped'
  | 'rollout-unreadable'
  | 'rollout-jsonl-invalid'
  | 'privacy-projection-dropped';

export type CodexSessionDiagnosticSource =
  | 'sessions-dir'
  | 'state-db'
  | 'thread-history-db'
  | 'task-context'
  | 'rollout'
  | 'state-row';

export interface CodexSessionDiagnostic {
  code: CodexSessionDiagnosticCode;
  source: CodexSessionDiagnosticSource;
  field: string | null;
  reason:
    | 'missing'
    | 'unreadable'
    | 'invalid-json'
    | 'unsafe-identity'
    | 'unsafe-path'
    | 'unsafe-string'
    | 'invalid-record'
    | 'capacity-exceeded';
  subjectDigest: string | null;
}

export interface CodexSessionSourceState {
  path: string | null;
  availability: 'present' | 'missing' | 'unreadable';
}

export interface CodexThreadHistorySourceState
  extends CodexSessionSourceState {
  role: 'availability-only';
}

export interface CodexSessionIndexV3 {
  schemaVersion: 'hooks.codex-session-index/v3';
  generatedAt: string;
  sources: {
    sessionsDir: CodexSessionSourceState;
    stateDb: CodexSessionSourceState;
    threadHistoryDb: CodexThreadHistorySourceState;
    taskContext: CodexSessionSourceState | null;
  };
  sessions: CodexSessionRecord[];
  diagnostics: CodexSessionDiagnostic[];
}

export function digestDiagnosticSubject(value: string): string {
  return createHash('sha256')
    .update(value.slice(0, 4096), 'utf8')
    .digest('hex');
}

export function projectCodexSessionRecord(
  value: CodexSessionRecord,
  diagnostics: CodexSessionDiagnostic[]
): CodexSessionRecord | null {
  return projectCompleteSessionRecord(value, diagnostics);
}

export function validateCodexSessionIndexArtifact(
  value: unknown
): CodexSessionIndexV3 {
  return validateAndReconstructIndexV3(value);
}
```

Implement `projectCompleteSessionRecord` and `validateAndReconstructIndexV3` as strict reconstructors:

- reject unknown fields;
- validate all enums and booleans;
- require the core thread ID unchanged;
- normalize/project paths or set nullable fields to `null` with a diagnostic;
- omit the whole record when an authoritative identity is unsafe;
- sanitize display fields;
- canonicalize timestamps;
- validate finite bounded confidence values;
- reconstruct relation reasons and evidence entry-by-entry with capacity limits.

In `src/codex-session-index.ts`, keep raw parsing internal, collect only typed diagnostics, project each candidate through `projectCodexSessionRecord`, and return `validateCodexSessionIndexArtifact(...)`.

- [ ] **Step 4: Run the index tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts
```

Expected: `PASS`, including no raw secret/path/exception value in serialized output.

- [ ] **Step 5: Inspect the index v3 checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: index artifact module, index implementation, and focused tests only within this task boundary.

### Task 3: Make `threadHistoryDb` Availability-Only and Upgrade Resolution/Retention

**Files:**
- Modify: `src/codex-session-index.ts`
- Modify: `src/codex-session-resolver.ts`
- Modify: `src/codex-session-handoff.ts`
- Modify: `src/cli.ts`
- Test: `tests/codex-session-bridge.test.ts`
- Test: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing availability and clean-break tests**

```ts
test.each([
  ['present', createReadableEmptyHistoryDb],
  ['missing', leaveHistoryDbAbsent],
  ['unreadable', createUnreadableHistoryDb]
] as const)(
  'treats threadHistoryDb %s as diagnostics-only',
  async (availability, arrange) => {
    await arrange(threadHistoryDb);
    const index = await buildCodexSessionIndex(fixtureInput());
    expect(index.sources.threadHistoryDb).toEqual({
      path: expect.anything(),
      availability,
      role: 'availability-only'
    });
    expect(index.sessions.map((session) => session.threadId))
      .toEqual(expectedStateAndRolloutThreadIds);
  }
);

test('uses v3 resolution and v2 retention with no legacy reader', async () => {
  expect(resolveCodexSessions(records, project).schemaVersion)
    .toBe('hooks.codex-session-resolution/v3');
  expect(createRetentionManifest(records).schemaVersion)
    .toBe('hooks.codex-session-retention/v2');
  await expect(runCli(['codex-sessions', 'graph', '--project', project,
    '--ccpanes-snapshot', oldSnapshotPath]))
    .rejects.toThrow(/unsupported-schema/);
});
```

- [ ] **Step 2: Run focused bridge and CLI tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because history availability is boolean-only, resolution is v2, retention is v1, and old inputs are still accepted at some boundaries.

- [ ] **Step 3: Implement availability-only probing and strict output schemas**

Use a metadata-only probe:

```ts
async function inspectAvailabilityOnlyFile(
  file: string
): Promise<'present' | 'missing' | 'unreadable'> {
  try {
    const handle = await fs.open(file, 'r');
    await handle.close();
    return 'present';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'missing'
      : 'unreadable';
  }
}
```

Do not construct `DatabaseSync` for `threadHistoryDb`. Do not query its schema or rows.

Update the public schemas:

```ts
export interface CodexSessionResolution {
  schemaVersion: 'hooks.codex-session-resolution/v3';
  project: string;
  projectNorm: string;
  totals: ReturnType<typeof summarizeProjectRelations>;
  sessions: ResolvedCodexSession[];
}

export interface CodexSessionRetentionManifest {
  schemaVersion: 'hooks.codex-session-retention/v2';
  generatedAt: string;
  sessions: CodexSessionRetentionEntry[];
  diagnostics: CodexSessionDiagnostic[];
}
```

Before JSON printing/writing, validate/project index, resolution, and retention values. Remove all v1/v2 compatibility branches for affected artifacts and return typed `unsupported-schema` errors.

- [ ] **Step 4: Run focused bridge and CLI tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the clean-break checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: no generated v1/v2 artifact rewrites and no SQLite writes.

### Task 4: Verify `current-task.json` Entity Identity Through the Open Handle

**Files:**
- Modify: `src/current-task.ts`
- Modify: `tests/current-task.test.ts`

- [ ] **Step 1: Add failing path-swap tests**

Use injected filesystem operations so the race is deterministic:

```ts
test('rejects a path replaced after open but before acceptance', async () => {
  const first = await createTaskFile('first');
  const replacement = await createTaskFile('replacement');
  await expect(readCurrentTaskFile(first.path, {
    afterOpenForTest: async () =>
      fs.rename(replacement.path, first.path)
  })).rejects.toMatchObject({
    code: 'CURRENT_TASK_FILE_INVALID',
    reason: 'read-failed'
  });
});

test('reads one stable regular file and closes the handle', async () => {
  const fixture = await createTaskFile('stable');
  await expect(readCurrentTaskFile(fixture.path))
    .resolves.toMatchObject({ taskId: fixture.task.taskId });
  expect(await canRenameAfterRead(fixture.path)).toBe(true);
});
```

- [ ] **Step 2: Run the focused current-task tests**

Run:

```powershell
npx vitest run tests/current-task.test.ts
```

Expected: `FAIL` because the current implementation does not compare the handle identity with pre/post `lstat`.

- [ ] **Step 3: Add stable identity comparison and fail-closed reading**

Add an internal identity type and use bigint stats:

```ts
export interface CurrentTaskFileReadOptions {
  afterOpenForTest?: () => Promise<void>;
}

interface FileEntityIdentity {
  dev: bigint;
  ino: bigint;
  mode: bigint;
}

function fileEntityIdentity(
  stat: import('node:fs').BigIntStats
): FileEntityIdentity | null {
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  if (stat.dev < 0n || stat.ino <= 0n) return null;
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode };
}

function sameFileEntity(
  left: FileEntityIdentity,
  right: FileEntityIdentity
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode;
}
```

Implement this exact sequence in `readCurrentTaskFile`:

1. `fs.lstat(file, { bigint: true })`;
2. require regular non-symlink and extract identity;
3. `fs.open(file, 'r')`;
4. invoke `options.afterOpenForTest?.()` only when provided by a test;
5. `handle.stat({ bigint: true })`, require matching identity;
6. read at most 16 KiB plus one byte from the handle;
7. `fs.lstat(file, { bigint: true })` again;
8. require the post-read identity to match the handle;
9. parse and validate;
10. close in `finally`.

If stable identity is unavailable at any observation, throw `CurrentTaskFileReadError('read-failed')`.

- [ ] **Step 4: Run current-task tests**

Run:

```powershell
npx vitest run tests/current-task.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the current-task checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: only the pre-existing task-scoped current-task files changed by this task; `.ccpanes-task/current-task.json` remains untouched.

### Task 5: Require CC-Panes Snapshot v2 Lifecycle

**Files:**
- Modify: `src/ccpanes-session-snapshot.ts`
- Modify: `tests/ccpanes-session-snapshot.test.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing lifecycle and old-schema rejection tests**

```ts
test.each(['active', 'historical', 'unknown'] as const)(
  'accepts normalized lifecycle %s',
  (lifecycle) => {
    const snapshot = validateCcPanesSessionSnapshot({
      ...validSnapshot(),
      schemaVersion: 'hooks.ccpanes-session-snapshot/v2',
      sessions: [{
        ...validSnapshot().sessions[0],
        lifecycle
      }]
    });
    expect(snapshot.sessions[0]?.lifecycle).toBe(lifecycle);
  }
);

test('rejects v1 and refuses to infer lifecycle from status or title', () => {
  expect(() => validateCcPanesSessionSnapshot(validSnapshot()))
    .toThrow(/unsupported-schema/);
  expect(() => validateCcPanesSessionSnapshot({
    ...validSnapshot(),
    schemaVersion: 'hooks.ccpanes-session-snapshot/v2',
    sessions: validSnapshot().sessions
  })).toThrow(/lifecycle/);
});
```

- [ ] **Step 2: Run focused snapshot and CLI tests**

Run:

```powershell
npx vitest run tests/ccpanes-session-snapshot.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because snapshot v1 has no lifecycle field.

- [ ] **Step 3: Upgrade the snapshot contract**

Add:

```ts
export type CcPanesSessionLifecycle =
  | 'active'
  | 'historical'
  | 'unknown';

export interface CcPanesRuntimeSessionSnapshot {
  sessionId: string;
  launchId: string | null;
  taskId: string | null;
  projectPath: string | null;
  projectPathNorm: string | null;
  status: string;
  lifecycle: CcPanesSessionLifecycle;
  title: string | null;
  observedCodexThreadId: string | null;
}

export interface CcPanesSessionSnapshot {
  schemaVersion: 'hooks.ccpanes-session-snapshot/v2';
  generatedAt: string;
  launches: CcPanesLaunchSnapshot[];
  sessions: CcPanesRuntimeSessionSnapshot[];
}
```

Require `lifecycle` as a known session field and validate it only against the three literals. Change schema rejection to a typed `unsupported-schema` reason and keep freshness timestamp behavior unchanged.

- [ ] **Step 4: Run focused snapshot and CLI tests**

Run:

```powershell
npx vitest run tests/ccpanes-session-snapshot.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the snapshot v2 checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: no producer-side guessing logic based on `status`, `title`, or timestamp proximity.

### Task 6: Emit Federation v2 Source State and Per-Thread Automatic Eligibility

**Files:**
- Modify: `src/session-federation.ts`
- Modify: `src/session-federation-artifact.ts`
- Modify: `tests/session-federation.test.ts`
- Modify: `tests/session-federation-artifact.test.ts`

- [ ] **Step 1: Add failing freshness/lifecycle eligibility tests**

```ts
test.each([
  ['missing', null, false],
  ['stale', snapshotAt('2026-08-15T00:00:00.000Z', 'active'), false],
  ['future', snapshotAt('2026-08-18T00:00:00.000Z', 'active'), false],
  ['historical', snapshotAt('2026-08-17T10:00:00.000Z', 'historical'), false],
  ['unknown', snapshotAt('2026-08-17T10:00:00.000Z', 'unknown'), false],
  ['active', snapshotAt('2026-08-17T10:00:00.000Z', 'active'), true]
] as const)(
  'sets automatic eligibility for %s evidence to %s',
  (_label, snapshot, expected) => {
    const graph = buildSessionFederation({
      generatedAt: '2026-08-17T10:01:00.000Z',
      project,
      codexSessions: [ownedCliSession()],
      ccpanes: snapshot
    });
    const node = graph.nodes.find((item) =>
      item.type === 'codex-thread' && item.attributes.inferred !== true
    );
    expect(node?.attributes.automaticSidebarEligible).toBe(expected);
  }
);

test('requires an exact active Session join, not a launch-only edge', () => {
  const graph = buildSessionFederation({
    generatedAt,
    project,
    codexSessions: [ownedCliSession()],
    ccpanes: freshLaunchOnlySnapshot()
  });
  expect(concreteThread(graph).attributes.automaticSidebarEligible).toBe(false);
});
```

Also extend input-order tests to compare the entire v2 graph and its canonical digest.

- [ ] **Step 2: Run focused federation tests**

Run:

```powershell
npx vitest run tests/session-federation.test.ts tests/session-federation-artifact.test.ts
```

Expected: `FAIL` because graph v1 only emits snapshot diagnostics and launch/session links.

- [ ] **Step 3: Add exact graph v2 contracts and eligibility calculation**

Add:

```ts
export interface FederationCcPanesSourceState {
  availability: 'missing' | 'present';
  freshness: 'fresh' | 'stale' | 'future' | 'unknown';
  generatedAt: string | null;
  freshForAutomaticSelection: boolean;
}

export interface SessionFederation {
  schemaVersion: 'hooks.session-federation/v2';
  generatedAt: string;
  project: string;
  ccpanesSource: FederationCcPanesSourceState;
  nodes: FederationNode[];
  edges: FederationEdge[];
  diagnostics: FederationDiagnostic[];
}
```

For every concrete Codex thread node, add:

```ts
automaticSidebarEligible: boolean
```

Calculate it only when all conditions are true:

```ts
const eligible = sourceState.freshForAutomaticSelection &&
  matchedRuntimeSessions.some((runtime) =>
    runtime.lifecycle === 'active' &&
    runtime.projectPathNorm === projectNorm &&
    runtime.observedCodexThreadId === session.threadId
  );
```

Do not grant eligibility from launches, historical sessions, unknown lifecycle, inferred nodes, descendant project matches, stale snapshots, or future snapshots.

Update `validateSessionFederationArtifact` to:

- require schema v2 and root `ccpanesSource`;
- strictly reconstruct source state;
- require `automaticSidebarEligible` on concrete thread attributes;
- reject that field on inferred nodes and non-thread nodes;
- recompute semantic constraints so `true` requires a valid active exact-project `hosts` chain;
- preserve deterministic node/edge ordering and capacity checks.

- [ ] **Step 4: Run focused federation tests**

Run:

```powershell
npx vitest run tests/session-federation.test.ts tests/session-federation-artifact.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect Candidate 1 implementation checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: core changes remain separable from sidebar side-effect changes and no task-external file is modified.

### Task 7: Run the Candidate 1 Focused Gate

**Files:**
- Inspect: all Candidate 1 files listed above
- Test: core focused suites

- [ ] **Step 1: Run the complete core-focused suite**

Run:

```powershell
npx vitest run tests/current-task.test.ts tests/codex-session-bridge.test.ts tests/codex-session-cli.test.ts tests/ccpanes-session-snapshot.test.ts tests/session-federation.test.ts tests/session-federation-artifact.test.ts tests/codex-app-server-client.test.ts
npm run typecheck
```

Expected: both commands `PASS`.

- [ ] **Step 2: Verify core acceptance assertions**

Inspect test output and artifacts to confirm:

```text
index=v3
resolution=v3
retention=v2
snapshot=v2
federation=v2
threadHistoryDb.role=availability-only
automaticSidebarEligible requires fresh + active + exact-project + explicit Session join
current-task entity replacement returns read-failed
```

Expected: every assertion is directly covered by a passing test.

- [ ] **Step 3: Inspect Candidate 1 diff without staging**

Run:

```powershell
git diff -- src/codex-session-identity.ts src/codex-session-index-artifact.ts src/codex-session-index.ts src/codex-session-resolver.ts src/codex-session-handoff.ts src/current-task.ts src/ccpanes-session-snapshot.ts src/session-federation.ts src/session-federation-artifact.ts tests/current-task.test.ts tests/codex-session-bridge.test.ts tests/codex-session-cli.test.ts tests/ccpanes-session-snapshot.test.ts tests/session-federation.test.ts tests/session-federation-artifact.test.ts
git diff --check
git status --short
```

Expected: `PASS`; every changed path is explained by Candidate 1 or was already present before execution.

---

## Candidate 2: Sidebar Projection

### Task 8: Preserve Structured App Server Failures Through the Sidebar CLI

**Files:**
- Modify: `src/codex-app-server-client.ts`
- Modify: `src/codex-sidebar-cli.ts`
- Modify: `tests/codex-app-server-client.test.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing structured-error projection tests**

```ts
test('preserves safe client metadata and drops raw messages', async () => {
  const rawMessage = 'server leaked C:\\secret\\token.txt';
  const client = fakeClientThatRejects(
    new CodexAppServerClientError(
      'app-server-error',
      409,
      'conflict'
    ),
    rawMessage
  );

  await expect(runCodexSidebarCli(
    'sidebar-plan',
    validPlanArgs(),
    () => client
  )).rejects.toMatchObject({
    code: 'CODEX_SIDEBAR_CLI_CLIENT',
    failure: {
      stage: 'plan-list',
      causeKind: 'app-server-client',
      reason: 'app-server-error',
      serverCode: 409,
      category: 'conflict',
      transportReason: null
    }
  });
  await expect(runCodexSidebarCli(
    'sidebar-plan',
    validPlanArgs(),
    () => client
  )).rejects.not.toThrow(rawMessage);
});

test('preserves an allowlisted transport reason', async () => {
  const error = projectSidebarClientFailure(
    new AppServerTransportError('process-exit'),
    'apply-read-post-write'
  );
  expect(error.failure).toMatchObject({
    causeKind: 'transport',
    transportReason: 'process-exit',
    serverCode: null,
    category: null
  });
});
```

- [ ] **Step 2: Run focused App Server and CLI tests**

Run:

```powershell
npx vitest run tests/codex-app-server-client.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because `CodexSidebarCliClientError` currently retains only a stage.

- [ ] **Step 3: Implement one privacy-safe failure projector**

Add:

```ts
export type SidebarClientStage =
  | 'factory'
  | 'initialize'
  | 'plan-list'
  | 'plan-read-explicit'
  | 'apply-list-initial'
  | 'apply-read-initial'
  | 'apply-set-name'
  | 'apply-read-post-write'
  | 'resume-list'
  | 'resume-read'
  | 'close';

export interface SidebarClientFailure {
  stage: SidebarClientStage;
  causeKind: 'app-server-client' | 'transport' | 'unexpected';
  reason: string;
  serverCode: number | null;
  category: string | null;
  transportReason: AppServerTransportErrorReason | null;
}

export class CodexSidebarCliClientError extends Error {
  readonly code = 'CODEX_SIDEBAR_CLI_CLIENT' as const;
  readonly field = 'appServerClient' as const;
  readonly reason = 'client-failure' as const;

  constructor(readonly failure: SidebarClientFailure) {
    super(`CODEX_SIDEBAR_CLI_CLIENT: ${failure.stage}: ${failure.reason}`);
    this.name = 'CodexSidebarCliClientError';
  }
}
```

Implement `projectSidebarClientFailure(error, stage)`:

- `CodexAppServerClientError` preserves `reason`, integer `serverCode`, and allowlisted `category`;
- `AppServerTransportError` preserves only its closed-union `reason`;
- every other value becomes `causeKind: 'unexpected'`, `reason: 'unexpected'`;
- raw `message`, `stack`, stderr, params, paths, prompts, and response payloads are never copied.

Make every `clientCall` stage use the projector.

- [ ] **Step 4: Run focused App Server and CLI tests**

Run:

```powershell
npx vitest run tests/codex-app-server-client.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the error-contract checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: serialized errors contain only structured allowlisted metadata.

### Task 9: Validate Every Live Sidebar Thread Against ID, Source, and Project

**Files:**
- Create: `src/codex-sidebar-live-thread.ts`
- Modify: `src/codex-sidebar-cli.ts`
- Modify: `tests/codex-sidebar.test.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing list/read/apply/post-write scope tests**

```ts
test.each([
  ['foreign cwd', appThread({ cwd: 'D:\\other-project' }),
    'live-thread-scope-mismatch'],
  ['non-cli source', appThread({ source: 'vscode' }),
    'live-thread-source-mismatch'],
  ['wrong returned ID', appThread({ id: 'different-thread' }),
    'live-thread-id-mismatch']
] as const)(
  'rejects %s from thread/read fallback',
  async (_label, thread, reason) => {
    const client = fakeClient({
      list: [],
      read: thread
    });
    await expect(runPlanWithExplicitThread(client))
      .rejects.toMatchObject({ reason });
  }
);

test('reuses live scope checks before apply and after name write', async () => {
  const client = fakeClientWithObservationSequence([
    appThread({ cwd: project, source: 'cli', name: null }),
    appThread({ cwd: 'D:\\foreign', source: 'cli', name: desiredName })
  ]);
  const result = await runApply(client);
  expect(result.entries[0]).toMatchObject({
    status: 'unknown',
    error: 'name-outcome-unknown'
  });
});
```

- [ ] **Step 2: Run focused sidebar and CLI tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because list results and `thread/read` fallbacks are trusted without shared source/cwd enforcement.

- [ ] **Step 3: Create and use the live-thread validator**

Create `src/codex-sidebar-live-thread.ts`:

```ts
import path from 'node:path';
import type { AppServerThread } from './codex-app-server-client.js';
import { isCodexPathInside, normalizeCodexPath }
  from './codex-session-path.js';
import { isCodexThreadId } from './codex-session-identity.js';
import { sanitizeCodexSessionArtifactExcerpt }
  from './codex-session-artifact-privacy.js';

export type LiveSidebarThreadErrorReason =
  | 'live-thread-id-mismatch'
  | 'live-thread-source-mismatch'
  | 'live-thread-scope-mismatch'
  | 'live-thread-display-invalid';

export class LiveSidebarThreadError extends Error {
  readonly code = 'CODEX_SIDEBAR_LIVE_THREAD' as const;

  constructor(readonly reason: LiveSidebarThreadErrorReason) {
    super(`CODEX_SIDEBAR_LIVE_THREAD: ${reason}`);
    this.name = 'LiveSidebarThreadError';
  }
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

export function validateLiveSidebarThread(
  thread: AppServerThread,
  project: string,
  expectedThreadId: string
): AppServerThread {
  if (!isCodexThreadId(expectedThreadId) ||
      thread.id !== expectedThreadId ||
      !isCodexThreadId(thread.id)) {
    throw new LiveSidebarThreadError('live-thread-id-mismatch');
  }
  if (thread.source !== 'cli') {
    throw new LiveSidebarThreadError('live-thread-source-mismatch');
  }
  if (!isAbsoluteFilesystemPath(thread.cwd)) {
    throw new LiveSidebarThreadError('live-thread-scope-mismatch');
  }
  const projectNorm = normalizeCodexPath(project);
  const cwdNorm = normalizeCodexPath(thread.cwd);
  if (!projectNorm || !cwdNorm ||
      (cwdNorm !== projectNorm &&
       !isCodexPathInside(projectNorm, cwdNorm))) {
    throw new LiveSidebarThreadError('live-thread-scope-mismatch');
  }
  if (sanitizeCodexSessionArtifactExcerpt(thread.name) !== thread.name ||
      sanitizeCodexSessionArtifactExcerpt(thread.preview) !== thread.preview) {
    throw new LiveSidebarThreadError('live-thread-display-invalid');
  }
  return thread;
}
```

Call this function for:

- every matching `thread/list` result used by plan;
- explicit plan `thread/read`;
- every apply initial list/read result;
- every post-write read;
- every resume list/read observation.

An explicit `--thread-id` bypasses only `automaticSidebarEligible`; it still requires concrete graph membership, active user storage, `owned | supporting`, fresh host before snapshot, and this live validator.

- [ ] **Step 4: Run focused sidebar and CLI tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the live-thread checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: no cwd-filter request is treated as proof of returned-thread scope.

### Task 10: Upgrade Sidebar Artifacts to v2 and Bind the Canonical Action Set

**Files:**
- Modify: `src/codex-sidebar.ts`
- Modify: `tests/codex-sidebar.test.ts`

- [ ] **Step 1: Add failing v2 schema and action-set digest tests**

```ts
test('binds plan, apply, receipt, reconciliation, and rollback to one action set', () => {
  const plan = createSidebarPlan(validCreateInput());
  expect(plan.schemaVersion).toBe('hooks.codex-sidebar-plan/v2');
  expect(plan.actionSetDigest).toMatch(/^[a-f0-9]{64}$/);

  const tampered = {
    ...plan,
    actions: [...plan.actions].reverse()
  };
  expect(() => validateSidebarPlan(tampered))
    .toThrow(/actionSetDigest/);
});

test.each([
  'hooks.codex-sidebar-plan/v1',
  'hooks.codex-sidebar-apply/v1',
  'hooks.codex-sidebar-host-receipt/v1',
  'hooks.codex-sidebar-reconciliation/v1',
  'hooks.codex-sidebar-rollback-plan/v1'
])('rejects old sidebar schema %s', (schemaVersion) => {
  expect(() => validateAffectedSidebarArtifact({
    ...validArtifactFor(schemaVersion),
    schemaVersion
  })).toThrow(/unsupported-schema/);
});
```

- [ ] **Step 2: Run sidebar artifact tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: `FAIL` because the affected artifacts are v1 and no action-set digest exists.

- [ ] **Step 3: Define exact v2 binding fields**

Use one canonical action projection:

```ts
export interface SidebarCanonicalAction {
  threadId: string;
  currentName: string | null;
  desiredName: string;
  currentPinned: boolean | null;
  desiredPinned: true;
}

export function digestSidebarActionSet(
  actions: readonly SidebarCanonicalAction[]
): string {
  return sha256(canonicalJson(actions.map(projectCanonicalAction)));
}
```

Upgrade the root contracts:

```ts
export interface SidebarPlan {
  schemaVersion: 'hooks.codex-sidebar-plan/v2';
  generatedAt: string;
  project: string;
  actionSetDigest: string;
  actions: SidebarAction[];
  digest: string;
}

export interface SidebarApplyResult {
  schemaVersion: 'hooks.codex-sidebar-apply/v2';
  generatedAt: string;
  operationId: string;
  planDigest: string;
  actionSetDigest: string;
  executionDigest: string;
  entries: SidebarApplyEntry[];
  pendingHostActions: SidebarPendingHostAction[];
  cleanupErrors: SidebarCleanupError[];
}

export interface SidebarHostReceipt {
  schemaVersion: 'hooks.codex-sidebar-host-receipt/v2';
  generatedAt: string;
  operationId: string;
  planDigest: string;
  actionSetDigest: string;
  executionDigest: string;
  entries: SidebarHostReceiptEntry[];
}

export interface SidebarReconciliation {
  schemaVersion: 'hooks.codex-sidebar-reconciliation/v2';
  generatedAt: string;
  operationId: string;
  planDigest: string;
  actionSetDigest: string;
  applyExecutionDigest: string;
  receiptPlanDigest: string;
  receiptExecutionDigest: string;
  status: 'reconciled' | 'partial' | 'unknown' | 'binding-mismatch';
  entries: SidebarReconciliationEntry[];
}

export interface SidebarRollbackPlan {
  schemaVersion: 'hooks.codex-sidebar-rollback-plan/v2';
  generatedAt: string;
  operationId: string;
  planDigest: string;
  sourceExecutionDigest: string;
  actionSetDigest: string;
  executable: boolean;
  actions: SidebarRollbackAction[];
  digest: string;
}
```

Strict validators must reject old schemas, unknown fields, digest mismatch, action cardinality mismatch, duplicate IDs, unsafe identities, and inconsistent pending-action ordering.

- [ ] **Step 4: Run sidebar artifact tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Inspect the v2 artifact checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: no dual-reader or compatibility alias for old sidebar artifacts.

### Task 11: Create the Durable Apply Journal and Resume Contract

**Files:**
- Create: `src/codex-sidebar-journal.ts`
- Modify: `src/codex-sidebar.ts`
- Modify: `tests/codex-sidebar.test.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing journal ordering, durability, and resume tests**

```ts
test('persists prepared before client creation and intent before dispatch', async () => {
  const events: string[] = [];
  await runSidebarApply({
    beforeClientCreate: () => events.push('client-create'),
    journalWrite: (journal) => {
      events.push(`journal:${journal.state}:${
        journal.actions[0]?.state ?? 'none'
      }`);
    },
    setName: async () => events.push('set-name')
  });
  expect(events).toEqual([
    'journal:prepared:planned',
    'client-create',
    'journal:running:planned',
    'journal:running:intent-durable',
    'journal:running:write-dispatched',
    'set-name',
    'journal:running:applied',
    'journal:effects-recorded:applied',
    'journal:completed:applied'
  ]);
});

test('stops before mutation when the required journal transition fails', async () => {
  const setName = vi.fn();
  await expect(runApplyWithJournalFailure('intent-durable', setName))
    .rejects.toThrow(/journal/);
  expect(setName).not.toHaveBeenCalled();
});

test('resumes dispatched and unknown actions by observation without redispatch', async () => {
  const setName = vi.fn();
  const result = await resumeMatchingJournal({
    actionState: 'write-dispatched',
    liveName: desiredName,
    setName
  });
  expect(result.entries[0]?.status).toBe('name-applied');
  expect(setName).not.toHaveBeenCalled();
});

test('regenerates a missing result from effects-recorded without another write', async () => {
  const setName = vi.fn();
  const result = await resumeMatchingJournal({
    rootState: 'effects-recorded',
    actionState: 'applied',
    resultExists: false,
    setName
  });
  expect(result.schemaVersion).toBe('hooks.codex-sidebar-apply/v2');
  expect(setName).not.toHaveBeenCalled();
  expect(readJournal().state).toBe('completed');
});

test('returns an existing completed result without client startup', async () => {
  const factory = vi.fn();
  const result = await resumeCompletedJournalWithValidResult(factory);
  expect(result.operationId).toBe(readJournal().operationId);
  expect(factory).not.toHaveBeenCalled();
});

test('rejects a changed output parent identity before the next transition', async () => {
  const setName = vi.fn();
  await expect(runApplyAfterReplacingOutputDirectory(setName))
    .rejects.toThrow(/journal/);
  expect(setName).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused journal tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because no journal module or resume contract exists.

- [ ] **Step 3: Define journal schemas and legal transitions**

Create `src/codex-sidebar-journal.ts`:

```ts
import type {
  SidebarApplyEntryError,
  SidebarCanonicalAction,
  SidebarCleanupError
} from './codex-sidebar.js';

export type SidebarJournalRootState =
  | 'prepared'
  | 'running'
  | 'effects-recorded'
  | 'completed'
  | 'unknown'
  | 'aborted';

export type SidebarJournalActionState =
  | 'planned'
  | 'intent-durable'
  | 'write-dispatched'
  | 'unchanged'
  | 'conflict'
  | 'missing'
  | 'applied'
  | 'rejected'
  | 'unknown';

export interface SidebarApplyJournalAction {
  threadId: string;
  previousName: string | null;
  desiredName: string;
  state: SidebarJournalActionState;
  observedName: string | null;
  error: SidebarApplyEntryError | null;
}

export interface SidebarApplyJournal {
  schemaVersion: 'hooks.codex-sidebar-apply-journal/v1';
  createdAt: string;
  updatedAt: string;
  operationId: string;
  planDigest: string;
  actionSetDigest: string;
  canonicalActions: SidebarCanonicalAction[];
  state: SidebarJournalRootState;
  actions: SidebarApplyJournalAction[];
  resultPath: string;
  resultDigest: string | null;
  cleanupErrors: SidebarCleanupError[];
}
```

Implement legal-transition tables rather than ad hoc assignments:

```ts
const ROOT_TRANSITIONS = new Map<SidebarJournalRootState,
  ReadonlySet<SidebarJournalRootState>>([
  ['prepared', new Set(['running', 'aborted'])],
  ['running', new Set(['effects-recorded', 'unknown', 'aborted'])],
  ['effects-recorded', new Set(['completed', 'unknown'])],
  ['completed', new Set()],
  ['unknown', new Set(['running', 'effects-recorded', 'completed'])],
  ['aborted', new Set()]
]);
```

Use equivalent explicit action transition sets matching the approved state machine.

- [ ] **Step 4: Implement path identity and same-directory durable replacement**

Expose:

```ts
export interface SidebarJournalPaths {
  journalPath: string;
  resultPath: string;
  parentPath: string;
  parentIdentity: SidebarJournalDirectoryIdentity;
}

export interface SidebarJournalDirectoryIdentity {
  dev: bigint;
  ino: bigint;
}

export async function prepareSidebarJournalPaths(
  journalPath: string,
  resultPath: string
): Promise<SidebarJournalPaths>;

export async function writeSidebarApplyJournalDurable(
  paths: SidebarJournalPaths,
  journal: SidebarApplyJournal
): Promise<void>;
```

`prepareSidebarJournalPaths` must:

- resolve both paths before client startup;
- require different file paths;
- require one identical resolved parent directory;
- reject a symlink parent and non-directory parent;
- reject an existing journal/result path that is a symlink or non-regular file;
- capture parent device/inode identity with bigint stats.

`writeSidebarApplyJournalDurable` must:

```ts
const tempPath = path.join(
  paths.parentPath,
  `.${path.basename(paths.journalPath)}.${process.pid}.${randomUUID()}.tmp`
);
const handle = await fs.open(tempPath, 'wx', 0o600);
try {
  await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  await handle.sync();
} finally {
  await handle.close();
}
await assertSameParentIdentity(paths);
await fs.rename(tempPath, paths.journalPath);
await syncDirectoryWhenSupported(paths.parentPath);
```

Validate and reconstruct the journal before every write and after every read. Reuse is accepted only when `planDigest`, `actionSetDigest`, canonical actions, and `resultPath` match.

- [ ] **Step 5: Run journal tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 6: Inspect the journal checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: journal writes stay inside the caller-provided output directory and no native write occurs before durable intent.

### Task 12: Classify Unknown Name Outcomes and Preserve Cleanup Errors

**Files:**
- Modify: `src/codex-sidebar.ts`
- Modify: `src/codex-sidebar-cli.ts`
- Modify: `src/codex-sidebar-journal.ts`
- Modify: `tests/codex-sidebar.test.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing unknown/rejected/cleanup tests**

```ts
test.each([
  new CodexAppServerClientError('timeout'),
  new AppServerTransportError('process-exit'),
  new CodexAppServerClientError('invalid-response')
])('keeps a post-dispatch %s outcome unknown', async (error) => {
  const result = await applyWithPostDispatchFailure(error);
  expect(result.entries[0]).toMatchObject({
    status: 'unknown',
    error: 'name-outcome-unknown'
  });
  expect(result.pendingHostActions).toEqual([]);
  expect(readJournal().state).toBe('unknown');
});

test('records deterministic rejection without overwriting it on close failure', async () => {
  const result = await applyWith({
    setNameError: new CodexAppServerClientError(
      'app-server-error',
      409,
      'conflict'
    ),
    closeError: new AppServerTransportError('close-timeout')
  });
  expect(result.entries[0]?.status).toBe('rejected');
  expect(result.cleanupErrors).toContainEqual({
    stage: 'client-close',
    causeKind: 'transport',
    reason: 'close-timeout'
  });
});
```

- [ ] **Step 2: Run focused apply tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because current apply logic can classify ambiguous writes as `failed` or infer certainty from one reread.

- [ ] **Step 3: Replace `failed` with the approved result contract**

Use:

```ts
export type SidebarApplyStatus =
  | 'unchanged'
  | 'name-applied'
  | 'rejected'
  | 'thread-missing'
  | 'conflict'
  | 'unknown';

export type SidebarApplyEntryError =
  | 'thread-missing'
  | 'before-state-conflict'
  | 'name-write-rejected'
  | 'name-outcome-unknown';

export interface SidebarCleanupError {
  stage: 'client-close' | 'journal-finalize' | 'result-write';
  causeKind: 'client' | 'transport' | 'filesystem' | 'unexpected';
  reason: string;
}
```

Implement these rules:

- no command sent and desired name already present → `unchanged`;
- valid success response plus valid agreeing live observation → `name-applied`;
- deterministic App Server rejection plus no contradictory success observation → `rejected`;
- before-state differs from plan and desired name → `conflict`;
- valid live absence → `thread-missing`;
- timeout, transport loss, malformed response after dispatch, failed close before trustworthy observation, or conflicting post-write observation → `unknown`.

Only `unchanged` and `name-applied` emit pending host pin actions. Rollback validation rejects any apply result containing `unknown`.

- [ ] **Step 4: Implement resume certainty rules**

For `write-dispatched` or `unknown`:

1. confirm the original client close completed;
2. initialize a fresh client;
3. collect a valid project-scoped list observation;
4. collect a valid exact-ID read observation;
5. require list/read agreement on presence and name;
6. resolve to `name-applied`, `rejected`, `conflict`, or `missing` only when evidence proves that state;
7. otherwise leave `unknown`;
8. never call `setThreadName` for the resumed dispatched action.

Persist each resolved action state before advancing to the next action.

- [ ] **Step 5: Run focused apply tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 6: Inspect the outcome checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: primary action outcomes and cleanup errors remain independently represented.

### Task 13: Reconcile One Exact Apply Execution and Complete Host Action Set

**Files:**
- Modify: `src/codex-sidebar.ts`
- Modify: `tests/codex-sidebar.test.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing binding/cardinality/freshness tests**

```ts
test.each([
  ['different execution', receiptFromAnotherApply()],
  ['missing action', receiptWithoutLastAction()],
  ['extra action', receiptWithExtraAction()],
  ['reordered actions', receiptWithReorderedActions()],
  ['modified pin', receiptWithModifiedPin()]
] as const)(
  'returns binding-mismatch for %s',
  (_label, receipt) => {
    const result = createSidebarReconciliation({
      plan,
      applyResult,
      receipt,
      snapshot: freshAfterSnapshot(),
      generatedAt
    });
    expect(result.status).toBe('binding-mismatch');
  }
);

test('requires every expected pin to be visible in a fresh after snapshot', () => {
  const result = createSidebarReconciliation({
    plan,
    applyResult,
    receipt,
    snapshot: freshSnapshotWithOneThreadNotPinned(),
    generatedAt
  });
  expect(result.status).toBe('partial');
  expect(result.entries).toContainEqual(expect.objectContaining({
    status: 'not-visible'
  }));
});
```

- [ ] **Step 2: Run focused reconciliation tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `FAIL` because reconciliation currently accepts a plan digest plus receipt and does not require the apply artifact.

- [ ] **Step 3: Implement exact binding validation**

Change the input:

```ts
export interface CreateSidebarReconciliationInput {
  plan: SidebarPlan;
  applyResult: SidebarApplyResult;
  receipt: SidebarHostReceipt;
  snapshot: CodexAppSidebarSnapshot;
  generatedAt?: string;
}
```

Before visibility classification:

```ts
const plan = validateSidebarPlan(input.plan);
const apply = validateSidebarApplyResult(input.applyResult);
const receipt = validateSidebarHostReceipt(input.receipt);
const snapshot = validateCodexAppSidebarSnapshot(input.snapshot);

const bindingMatches =
  digestSidebarPlan(stripDigest(plan)) === plan.digest &&
  apply.planDigest === plan.digest &&
  apply.actionSetDigest === plan.actionSetDigest &&
  receipt.planDigest === apply.planDigest &&
  receipt.executionDigest === apply.executionDigest &&
  receipt.operationId === apply.operationId &&
  receipt.actionSetDigest === apply.actionSetDigest &&
  receiptEntriesExactlyMatchPendingActions(
    receipt.entries,
    apply.pendingHostActions
  ) &&
  applyEntriesExactlyMatchPlanActions(apply.entries, plan.actions);
```

If any binding check fails, return root `binding-mismatch` with privacy-safe per-thread entries.

For matching inputs:

- reject receipt actions for `unknown`, `rejected`, `conflict`, or `thread-missing` apply entries;
- require snapshot `generatedAt >= receipt.generatedAt`;
- require snapshot no more than one minute in the future relative to reconciliation time;
- require bounded unique IDs;
- classify applied host entries as `visible`, `not-visible`, `host-failed`, or `inconclusive`;
- root is `reconciled` only when every expected entry is `visible`;
- root is `partial` when any host action failed or is proven not visible;
- root is `unknown` when fresh native evidence is inconclusive.

- [ ] **Step 4: Keep rollback exact and reject unknown source outcomes**

Require rollback input to match:

```ts
receipt.planDigest === apply.planDigest
receipt.executionDigest === apply.executionDigest
receipt.operationId === apply.operationId
receipt.actionSetDigest === apply.actionSetDigest
```

Require receipt entries to exactly match `pendingHostActions`. Preserve the existing unsupported clear-name adapter when `previousName === null`.

- [ ] **Step 5: Run focused reconciliation and rollback tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts tests/codex-session-cli.test.ts
```

Expected: `PASS`.

- [ ] **Step 6: Inspect the reconciliation checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: digest-only matches never produce `reconciled`.

### Task 14: Wire Fresh Selection, `--journal`, and `--apply` Through the CLI

**Files:**
- Modify: `src/codex-sidebar-cli.ts`
- Modify: `src/cli.ts`
- Modify: `tests/codex-session-cli.test.ts`
- Modify: `tests/codex-sidebar.test.ts`

- [ ] **Step 1: Add failing CLI and freshness tests**

```ts
test('requires --journal for apply and --apply for reconcile', async () => {
  await expect(runCli([
    'codex-sessions', 'sidebar-apply',
    '--plan', planPath,
    '--confirm-digest', plan.digest,
    '--out', applyPath
  ])).rejects.toThrow('missing --journal');

  await expect(runCli([
    'codex-sessions', 'sidebar-reconcile',
    '--plan', planPath,
    '--host-receipt', receiptPath,
    '--app-sidebar-snapshot', afterSnapshotPath,
    '--out', reconciliationPath
  ])).rejects.toThrow('missing --apply');
});

test.each([
  ['stale', snapshotGeneratedAtMinutesAgo(6)],
  ['future', snapshotGeneratedAtMinutesAhead(2)]
] as const)(
  'rejects a %s host before snapshot before App Server startup',
  async (_label, generatedAt) => {
    const factory = vi.fn();
    await expect(runPlanWithSnapshotTime(generatedAt, factory))
      .rejects.toThrow(/snapshot-freshness/);
    expect(factory).not.toHaveBeenCalled();
  }
);

test('automatic selection requires graph eligibility while explicit selection bypasses only that flag', async () => {
  expect(defaultCandidates(graphWithEligibility(false))).toEqual([]);
  expect(explicitCandidates(graphWithEligibility(false), threadId))
    .toEqual([threadId]);
  await expect(planExplicitThreadWithForeignLiveCwd())
    .rejects.toMatchObject({ reason: 'live-thread-scope-mismatch' });
});
```

- [ ] **Step 2: Run focused CLI tests**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts tests/codex-sidebar.test.ts
```

Expected: `FAIL` because current CLI has neither required option and selection still derives from generic graph links.

- [ ] **Step 3: Update option parsing with exact required paths**

Change the option types:

```ts
interface SidebarApplyCliOptions {
  action: 'sidebar-apply';
  planPath: string;
  confirmDigest: string;
  journalPath: string;
  outPath: string;
}

interface SidebarReconcileCliOptions {
  action: 'sidebar-reconcile';
  planPath: string;
  applyPath: string;
  receiptPath: string;
  snapshotPath: string;
  outPath: string;
}
```

Update allowed options:

```ts
'sidebar-apply': new Set([
  '--plan',
  '--confirm-digest',
  '--journal',
  '--out'
]),
'sidebar-reconcile': new Set([
  '--plan',
  '--apply',
  '--host-receipt',
  '--app-sidebar-snapshot',
  '--out'
])
```

Resolve every path before client startup. For apply, call `prepareSidebarJournalPaths(journalPath, outPath)` before creating the App Server client.

- [ ] **Step 4: Wire plan selection and host snapshot freshness**

For automatic selection, use:

```ts
node.type === 'codex-thread' &&
node.attributes.inferred !== true &&
node.attributes.automaticSidebarEligible === true
```

For explicit selection, require:

```ts
node.attributes.inferred !== true &&
node.attributes.threadSource === 'user' &&
node.attributes.storageState === 'active' &&
(node.attributes.projectRelation === 'owned' ||
 node.attributes.projectRelation === 'supporting')
```

Validate the host before snapshot:

```ts
const ageMs = Date.parse(planGeneratedAt) -
  Date.parse(snapshot.generatedAt);
const futureByMs = Date.parse(snapshot.generatedAt) -
  Date.parse(planGeneratedAt);
if (ageMs > 5 * 60_000 || futureByMs > 60_000) {
  throw new CodexSidebarError(
    'appSidebarSnapshot',
    'snapshot-freshness'
  );
}
```

Do this before App Server initialization.

- [ ] **Step 5: Wire journal-driven apply and apply-bound reconcile**

Apply order:

1. read/validate plan;
2. verify confirmation digest;
3. prepare journal/result paths;
4. create or validate matching `prepared` journal durably;
5. initialize App Server;
6. revalidate live threads;
7. transition/apply/resume actions;
8. write `effects-recorded`;
9. validate and durably write apply v2;
10. update journal to `completed`;
11. close the client and preserve cleanup errors.

Reconcile order:

1. read/validate plan v2;
2. read/validate apply v2;
3. read/validate receipt v2;
4. read/validate after snapshot;
5. call `createSidebarReconciliation({ plan, applyResult, receipt, snapshot })`;
6. validate/write reconciliation v2.

- [ ] **Step 6: Run focused CLI tests**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts tests/codex-sidebar.test.ts
```

Expected: `PASS`.

- [ ] **Step 7: Inspect Candidate 2 implementation checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: required CLI breaks are explicit and no side effect happens before plan, snapshot, path, and journal validation.

### Task 15: Update Operator Documentation After Behavior Converges

**Files:**
- Modify: `README.md`
- Modify: `docs/codex-session-bridge.md`
- Test: documentation command/schema scan

- [ ] **Step 1: Add the exact migration sequence to both documents**

Document this order:

```text
CC-Panes snapshot v2
  -> session index v3
  -> resolution v3 / retention v2
  -> federation graph v2
  -> fresh App sidebar before snapshot
  -> sidebar plan v2
  -> apply journal v1
  -> sidebar apply v2
  -> host receipt v2
  -> fresh App sidebar after snapshot
  -> reconciliation v2
  -> rollback plan v2
```

State explicitly:

- Codex App, Codex CLI, and CC-Panes remain separate authorities;
- the bridge is a derived federation and controlled projection;
- `threadHistoryDb` is availability-only;
- automatic selection requires a fresh active exact-project CC-Panes Session join;
- explicit selection still requires live CLI source and project scope;
- timeout/transport ambiguity remains `unknown`;
- journal/result paths must be different files in the same directory;
- old affected schemas are rejected and regenerated rather than dual-read.

- [ ] **Step 2: Replace command examples with current contracts**

Use these concrete examples:

```powershell
node dist/src/cli.js codex-sessions scan `
  --project "D:\cc-pane\tool\repos\hooks" `
  --ccpanes-snapshot "live\codex-session-bridge-hardening-20260817\ccpanes-session-snapshot-v2.json" `
  --out "live\codex-session-bridge-hardening-20260817\codex-session-index-v3.json"

node dist/src/cli.js codex-sessions graph `
  --project "D:\cc-pane\tool\repos\hooks" `
  --ccpanes-snapshot "live\codex-session-bridge-hardening-20260817\ccpanes-session-snapshot-v2.json" `
  --out "live\codex-session-bridge-hardening-20260817\session-federation-v2.json"

node dist/src/cli.js codex-sessions sidebar-apply `
  --plan "live\codex-session-bridge-hardening-20260817\codex-sidebar-plan-v2.json" `
  --confirm-digest $plan.digest `
  --journal "live\codex-session-bridge-hardening-20260817\codex-sidebar-apply-journal-v1.json" `
  --out "live\codex-session-bridge-hardening-20260817\codex-sidebar-apply-v2.json"

node dist/src/cli.js codex-sessions sidebar-reconcile `
  --plan "live\codex-session-bridge-hardening-20260817\codex-sidebar-plan-v2.json" `
  --apply "live\codex-session-bridge-hardening-20260817\codex-sidebar-apply-v2.json" `
  --host-receipt "live\codex-session-bridge-hardening-20260817\codex-sidebar-host-receipt-v2.json" `
  --app-sidebar-snapshot "live\codex-session-bridge-hardening-20260817\codex-app-sidebar-snapshot.after.json" `
  --out "live\codex-session-bridge-hardening-20260817\codex-sidebar-reconciliation-v2.json"
```

Immediately before the apply example, define the concrete PowerShell value:

```powershell
$plan = Get-Content `
  "live\codex-session-bridge-hardening-20260817\codex-sidebar-plan-v2.json" `
  -Raw | ConvertFrom-Json
```

- [ ] **Step 3: Scan documentation for stale schemas/options**

Run:

```powershell
$files = @(
  "README.md",
  "docs/codex-session-bridge.md"
)
Select-String -Path $files -Pattern `
  "hooks\.codex-session-index/v2|hooks\.codex-session-resolution/v2|hooks\.codex-session-retention/v1|hooks\.ccpanes-session-snapshot/v1|hooks\.session-federation/v1|hooks\.codex-sidebar-plan/v1|hooks\.codex-sidebar-apply/v1|hooks\.codex-sidebar-host-receipt/v1|hooks\.codex-sidebar-reconciliation/v1|hooks\.codex-sidebar-rollback-plan/v1"
```

Expected: no active command/contract section uses an old schema. Historical design references may retain old version strings only when explicitly labeled historical.

- [ ] **Step 4: Inspect the documentation checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: docs match the implemented command names, required options, and schema versions.

### Task 16: Run All Repository Gates

**Files:**
- Inspect: complete task diff and working tree

- [ ] **Step 1: Re-load verification discipline**

Required sub-skill before completion claims:

```text
superpowers:verification-before-completion
```

- [ ] **Step 2: Run the required gates in order**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short
```

Expected:

```text
npm test: pass
npm run typecheck: pass
npm run build: pass
npm run smoke: pass
git diff --check: pass
git status --short: pass with every path explained
```

- [ ] **Step 3: Apply the three-attempt repair limit**

For any failure caused by the task:

1. identify the root cause;
2. add or tighten the focused regression test;
3. make the smallest scoped repair;
4. rerun the focused test;
5. rerun the failed repository gate.

Stop after three repair rounds for one root cause and report `blocked` with the exact command and privacy-safe evidence.

- [ ] **Step 4: Verify task boundaries**

Run:

```powershell
git diff --name-only
git status --short
```

Expected:

- no staged changes;
- no commit;
- no push;
- no edits under `.codex`, Codex SQLite/rollouts, CC-Panes application storage, or global configuration;
- task-external pre-existing untracked files remain unchanged;
- `.ccpanes-task/current-task.json` is not rewritten.

### Task 17: Perform a Second Independent Review

**Files:**
- Review: complete Candidate 1 and Candidate 2 diff
- Artifact: `live/codex-session-bridge-hardening-20260817/independent-review.md`

- [ ] **Step 1: Dispatch a read-only reviewer**

Use a fresh reviewer with no implementation ownership. Give it:

```text
Review the diff against:
docs/superpowers/specs/2026-08-17-codex-session-bridge-hardening-design.md

Focus on:
1. cross-project or non-CLI rename/pin paths;
2. missing durable evidence before native writes;
3. timeout/transport outcomes incorrectly classified as certain;
4. digest/action-set/cardinality gaps in reconciliation;
5. raw sensitive values in artifacts or CLI-safe errors;
6. threadHistoryDb row access;
7. current-task path replacement races;
8. stale/future/historical snapshot auto-selection;
9. old-schema compatibility readers.

Return findings by critical/important/minor severity with exact file and line.
Do not modify files.
```

- [ ] **Step 2: Resolve all critical and important findings**

For each finding:

1. verify it against code and tests;
2. add a failing regression test when valid;
3. make a scoped repair;
4. rerun the focused suite;
5. update the review artifact with `resolved`, `not-reproduced`, or `design-conflict` plus evidence.

Expected: zero unresolved critical or important findings.

- [ ] **Step 3: Re-run affected gates**

Run the focused suites named by changed files, then:

```powershell
npm test
npm run typecheck
git diff --check
```

Expected: `PASS`.

- [ ] **Step 4: Preserve the review as bounded evidence**

The review artifact may contain repository-relative paths, finding IDs, test names, and commands. It must not contain raw Codex prompts, tokens, rollout content, SQLite messages, or App Server payloads.

### Task 18: Regenerate Acceptance Evidence in a New `live/` Directory

**Files:**
- Create: `live/codex-session-bridge-hardening-20260817/`
- Read only: Codex session sources, approved CC-Panes snapshot, App Server state
- Conditional native metadata actions: official Codex name operation and official Codex App host pin only after exact confirmation

- [ ] **Step 1: Create a non-overwriting evidence directory**

Run:

```powershell
$evidence = "D:\cc-pane\tool\repos\hooks\live\codex-session-bridge-hardening-20260817"
New-Item -ItemType Directory -Path $evidence -ErrorAction Stop
```

Expected: directory creation succeeds only when it does not already exist. If it exists, stop and choose a new dated/suffixed directory rather than overwriting evidence.

- [ ] **Step 2: Verify the CC-Panes snapshot v2 input**

Place the official bounded snapshot at:

```text
D:\cc-pane\tool\repos\hooks\live\codex-session-bridge-hardening-20260817\ccpanes-session-snapshot-v2.json
```

Run:

```powershell
node dist/src/cli.js codex-sessions graph `
  --project "D:\cc-pane\tool\repos\hooks" `
  --ccpanes-snapshot "$evidence\ccpanes-session-snapshot-v2.json" `
  --out "$evidence\session-federation-v2.json"
```

Expected: graph validates as v2 and records source freshness plus per-thread eligibility.

- [ ] **Step 3: Generate index, resolution, and retention artifacts**

Run:

```powershell
node dist/src/cli.js codex-sessions scan `
  --project "D:\cc-pane\tool\repos\hooks" `
  --ccpanes-snapshot "$evidence\ccpanes-session-snapshot-v2.json" `
  --out "$evidence\codex-session-index-v3.json"

node dist/src/cli.js codex-sessions resolve `
  --project "D:\cc-pane\tool\repos\hooks" `
  --ccpanes-snapshot "$evidence\ccpanes-session-snapshot-v2.json" `
  --json > "$evidence\codex-session-resolution-v3.json"

node dist/src/cli.js codex-sessions retention `
  --project "D:\cc-pane\tool\repos\hooks" `
  --ccpanes-snapshot "$evidence\ccpanes-session-snapshot-v2.json" `
  --out "$evidence\codex-session-retention-v2.json"
```

Expected: every artifact uses its new schema and contains no free-form warnings.

- [ ] **Step 4: Generate and inspect a sidebar plan**

Collect a fresh bounded host before snapshot at:

```text
D:\cc-pane\tool\repos\hooks\live\codex-session-bridge-hardening-20260817\codex-app-sidebar-snapshot.before.json
```

Run:

```powershell
node dist/src/cli.js codex-sessions sidebar-plan `
  --graph "$evidence\session-federation-v2.json" `
  --app-sidebar-snapshot "$evidence\codex-app-sidebar-snapshot.before.json" `
  --thread-id "01a00490-90c0-7dc2-9fac-fbdb4d7baa0f" `
  --out "$evidence\codex-sidebar-plan-v2.json"
```

Expected:

- the selected thread is concrete, active, user-owned/supporting, readable, `source === "cli"`, and scoped to the project;
- the plan contains `digest` and `actionSetDigest`;
- no name or pin mutation has occurred.

- [ ] **Step 5: Require exact confirmation before native metadata actions**

Read the plan digest:

```powershell
$plan = Get-Content "$evidence\codex-sidebar-plan-v2.json" -Raw |
  ConvertFrom-Json
$plan.digest
```

Before running `sidebar-apply` or the host pin action, obtain explicit confirmation for:

```text
threadId=01a00490-90c0-7dc2-9fac-fbdb4d7baa0f
planDigest=$plan.digest from the validated plan file
journalPath=live/codex-session-bridge-hardening-20260817/codex-sidebar-apply-journal-v1.json
resultPath=live/codex-session-bridge-hardening-20260817/codex-sidebar-apply-v2.json
```

If confirmation is absent, stop after the validated plan and report the native acceptance portion as `blocked`; do not synthesize a receipt.

- [ ] **Step 6: Execute and reconcile only after confirmation**

After confirmation:

```powershell
node dist/src/cli.js codex-sessions sidebar-apply `
  --plan "$evidence\codex-sidebar-plan-v2.json" `
  --confirm-digest $plan.digest `
  --journal "$evidence\codex-sidebar-apply-journal-v1.json" `
  --out "$evidence\codex-sidebar-apply-v2.json"
```

Apply the exact `pendingHostActions` through the official Codex App host operation, then write the bounded v2 receipt to:

```text
D:\cc-pane\tool\repos\hooks\live\codex-session-bridge-hardening-20260817\codex-sidebar-host-receipt-v2.json
```

Collect a fresh after snapshot and run:

```powershell
node dist/src/cli.js codex-sessions sidebar-reconcile `
  --plan "$evidence\codex-sidebar-plan-v2.json" `
  --apply "$evidence\codex-sidebar-apply-v2.json" `
  --host-receipt "$evidence\codex-sidebar-host-receipt-v2.json" `
  --app-sidebar-snapshot "$evidence\codex-app-sidebar-snapshot.after.json" `
  --out "$evidence\codex-sidebar-reconciliation-v2.json"
```

Expected: `reconciled` only when the exact confirmed action set is visibly pinned in the fresh after snapshot. Any ambiguity remains `partial`, `unknown`, or `binding-mismatch`.

- [ ] **Step 7: Record and verify acceptance evidence**

First verify that the stale task HEAD metadata issue has been resolved by an authorized task-selection update. If `.ccpanes-task/current-task.json` still records `e5e4fbd...` while Git is `53ae96a...` or later, stop before acceptance recording and report the metadata mismatch.

When task authority and Git state agree, run the repository's existing `record-acceptance` and `verify-acceptance` flow using:

- all required gate results;
- index, graph, plan, journal, apply, receipt, reconciliation, and review artifacts;
- truth layers for Codex source state, CC-Panes snapshot state, App Server observation, host receipt, and after snapshot.

Expected: acceptance verification `PASS` without copying raw native store content.

### Task 19: Present Two Commit Candidates Without Creating Commits

**Files:**
- Inspect: complete task diff
- Deliver: Candidate 1 and Candidate 2 path lists and gate evidence

- [ ] **Step 1: Capture the final repository state**

Run:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
```

Expected: root is `D:/cc-pane/tool/repos/hooks`, branch is `main`, no staged paths exist, and whitespace check passes.

- [ ] **Step 2: Present Candidate 1 scope**

Candidate 1 contains only:

```text
src/codex-session-identity.ts
src/codex-session-index-artifact.ts
src/codex-session-index.ts
src/codex-session-resolver.ts
src/codex-session-handoff.ts
src/current-task.ts
src/ccpanes-session-snapshot.ts
src/session-federation.ts
src/session-federation-artifact.ts
tests/current-task.test.ts
tests/codex-session-bridge.test.ts
tests/codex-session-cli.test.ts
tests/ccpanes-session-snapshot.test.ts
tests/session-federation.test.ts
tests/session-federation-artifact.test.ts
tests/codex-app-server-client.test.ts
directly governing core documentation sections
```

Report focused and full-gate evidence for this boundary.

- [ ] **Step 3: Present Candidate 2 scope**

Candidate 2 contains only:

```text
src/codex-sidebar-live-thread.ts
src/codex-sidebar-journal.ts
src/codex-app-server-client.ts
src/codex-sidebar.ts
src/codex-sidebar-cli.ts
src/cli.ts
tests/codex-app-server-client.test.ts
tests/codex-sidebar.test.ts
tests/codex-session-cli.test.ts
README.md
docs/codex-session-bridge.md
bounded live acceptance/review evidence
```

Report Candidate 2's dependency on Candidate 1 and all unknown/cleanup/reconciliation evidence.

- [ ] **Step 4: Stop before Git mutation**

Do not run:

```text
git add
git commit
git merge
git rebase
git push
```

Wait for explicit user authorization naming the candidate and requested Git action.

---

## Plan Self-Review Checklist

Before implementation handoff, verify:

- [x] Every requirement in `docs/superpowers/specs/2026-08-17-codex-session-bridge-hardening-design.md` maps to a task above.
- [x] No task introduces a reader for `thread_history_1.sqlite` rows.
- [x] No task grants automatic eligibility from a launch-only, stale, future, historical, unknown, descendant-project, or inferred relationship.
- [x] Explicit selection bypasses only the CC-Panes automatic eligibility flag.
- [x] List, read fallback, apply before-state, resume, and post-write paths use `validateLiveSidebarThread`.
- [x] Journal `prepared`, `intent-durable`, and `write-dispatched` ordering is tested.
- [x] Timeout and transport loss after dispatch remain `unknown`.
- [x] Pending host actions exist only for `unchanged` and `name-applied`.
- [x] Reconciliation requires plan, apply, receipt, exact action set, and fresh after snapshot.
- [x] Rollback rejects unknown name outcomes and preserves unsupported clear-name behavior.
- [x] All affected artifacts use only the approved clean-break schema versions.
- [x] No step authorizes stage, commit, push, native store edits, or task metadata rewrites.
- [x] Final status explains every changed and untracked path.

## Execution Handoff

Plan implementation order is strictly Candidate 1 → Candidate 1 focused gate → Candidate 2 → full gates → independent review → new acceptance evidence → commit-candidate presentation.

Two execution modes:

1. **Subagent-Driven (recommended):** dispatch one fresh implementation worker per task, then perform specification and code-quality review before advancing.
2. **Inline Execution:** execute tasks in this session with `superpowers:executing-plans`, using the checkpoints above and stopping after each candidate boundary.
