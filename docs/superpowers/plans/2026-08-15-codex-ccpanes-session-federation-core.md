# Codex + CC-Panes Session Federation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cwd-only session counting with evidence-based attribution and build a typed graph linking Codex threads to imported CC-Panes launch, Session, and Task facts.

**Architecture:** Preserve Codex and CC-Panes as separate authorities. Extend the existing Codex reader with explicit runtime/storage metadata, validate CC-Panes snapshots at the boundary, classify project relations through a pure resolver, and build a derived federation graph with typed evidence and confidence. Keep v1 commands readable during migration while new artifacts use versioned schemas.

**Tech Stack:** Node.js 22 standard library, TypeScript, `node:sqlite` read-only access, Vitest, atomic JSON file writes.

**Authorization note:** Current authorization excludes stage, commit, and push. The checkpoints below record review boundaries; execute Git commits only after a separate explicit user instruction.

---

## File Map

- Modify `src/codex-session-index.ts`
  - retain bounded rollout/SQLite readers;
  - expose storage state, typed evidence, and explicit App visibility;
  - emit `hooks.codex-session-index/v2`.
- Create `src/codex-session-attribution.ts`
  - own runtime-scope and project-relation classification;
  - own default filters and relation summaries.
- Create `src/ccpanes-session-snapshot.ts`
  - validate `hooks.ccpanes-session-snapshot/v1`;
  - normalize CC-Panes paths without discovering credentials;
  - report typed freshness diagnostics and reject duplicate identity keys.
- Create `src/session-federation.ts`
  - attach exact-project CC-Panes evidence to matching Codex threads;
  - build graph nodes/edges from Codex index and CC-Panes snapshot;
  - preserve explicit launch-to-Session and controller relationships.
- Modify `src/codex-session-resolver.ts`
  - consume the v2 attribution owner;
  - support explicit include flags and separated totals.
- Modify `src/codex-session-handoff.ts`
  - use owned/supporting user threads instead of the first three cwd matches.
- Modify `src/cli.ts`
  - wire v2 scan/resolve/graph flags and atomic outputs.
- Create `tests/codex-session-attribution.test.ts`
  - reproduce and close the over-counting bug.
- Create `tests/ccpanes-session-snapshot.test.ts`
  - validate trust-boundary behavior.
- Create `tests/session-federation.test.ts`
  - verify deterministic graph construction.
- Modify `tests/codex-session-bridge.test.ts`
  - cover rollout evidence and v1-to-v2 migration behavior.
- Modify `tests/codex-session-cli.test.ts`
  - cover CLI defaults and include flags.
- Modify `docs/codex-session-bridge.md`
  - document ownership versus relation and graph usage.

### Task 1: Lock the Correct Counting Contract

**Files:**
- Create: `src/codex-session-path.ts`
- Modify: `src/codex-session-index.ts`
- Create: `tests/codex-session-attribution.test.ts`
- Create: `src/codex-session-attribution.ts`
- Modify: `tests/codex-session-bridge.test.ts`
- Modify: `docs/superpowers/specs/2026-08-15-codex-ccpanes-session-federation-design.md`

- [ ] **Step 1: Write failing tests for path namespaces and observed over-count**

Create `tests/codex-session-attribution.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  classifyProjectRelation,
  summarizeProjectRelations,
  type AttributionInput
} from '../src/codex-session-attribution.js';

function input(overrides: Partial<AttributionInput>): AttributionInput {
  return {
    project: 'D:\\cc-pane\\tool\\repos\\hooks',
    cwdNorm: null,
    storageState: 'active',
    threadSource: 'user',
    primaryTargetNorm: null,
    promptMentionsProject: false,
    taskBinding: null,
    ccpanesLaunch: null,
    ...overrides
  };
}

describe('classifyProjectRelation', () => {
  test('keeps an ancestor cwd ambient instead of project-owned', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'd:/cc-pane'
    }))).toMatchObject({
      runtimeScope: 'ancestor',
      projectRelation: 'ambient',
      relationConfidence: 0.2,
      evidence: [{ kind: 'cwd', relation: 'ancestor' }]
    });
  });

  test('keeps prompt-only evidence mentioned instead of project-owned', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'c:/other',
      promptMentionsProject: true
    }))).toMatchObject({
      runtimeScope: 'unrelated',
      projectRelation: 'mentioned',
      relationConfidence: 0.35
    });
  });

  test('treats exact cwd as unrelated when primary target conflicts', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'd:/cc-pane/tool/repos/hooks',
      primaryTargetNorm: 'd:/codex-cc-pane'
    }))).toMatchObject({
      runtimeScope: 'exact',
      projectRelation: 'unrelated',
      relationConfidence: 0
    });
  });

  test('uses an exact matched task binding as ownership evidence', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'd:/cc-pane/tool/repos/hooks',
      taskBinding: {
        taskId: 'hooks-task',
        projectPathNorm: 'd:/cc-pane/tool/repos/hooks'
      }
    }))).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      evidence: expect.arrayContaining([{
        kind: 'task-binding',
        projectPath: 'd:/cc-pane/tool/repos/hooks',
        taskId: 'hooks-task'
      }])
    });
  });

  test('lets conflicting evidence override an exact task binding', () => {
    expect(classifyProjectRelation(input({
      primaryTargetNorm: 'd:/other/project',
      taskBinding: {
        taskId: 'hooks-task',
        projectPathNorm: 'd:/cc-pane/tool/repos/hooks'
      }
    }))).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: expect.arrayContaining([
        'matched task binding',
        'primary target conflicts with project'
      ])
    });
  });
});

test('default totals exclude ambient, mentioned, archived, and subagent records', () => {
  const totals = summarizeProjectRelations([
    { projectRelation: 'owned', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'supporting', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'ambient', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'mentioned', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'owned', storageState: 'archived', threadSource: 'user' },
    { projectRelation: 'owned', storageState: 'active', threadSource: 'subagent' }
  ]);

  expect(totals).toEqual({
    defaultVisible: 2,
    owned: 3,
    supporting: 1,
    mentioned: 1,
    ambient: 1,
    archived: 1,
    subagents: 1
  });
});
```

Add namespace regressions to `tests/codex-session-bridge.test.ts` for Windows
drive/device/UNC paths, WSL mapping, native POSIX case sensitivity, dot
segments, drive roots, sibling prefixes, rejected drive-relative paths, and WSL
dot segments that cross mount directories. Add prompt matcher regressions for
Windows drive/backslash, WSL, UNC, native POSIX case sensitivity, and sibling
prefixes. Add an index-boundary regression proving relative filesystem inputs
and distinct relative `rollout_path` rows resolve to absolute, non-colliding
paths.

- [ ] **Step 2: Run the focused tests and verify the contract failures**

Run:

```powershell
npx vitest run tests/codex-session-attribution.test.ts tests/codex-session-bridge.test.ts
```

Expected: FAIL on namespace handling and mixed-evidence conflict precedence.

- [ ] **Step 3: Implement the path and attribution owners**

Create `src/codex-session-path.ts` as the leaf owner for namespace-aware path
normalization and containment. `src/codex-session-index.ts` imports it and
continues to re-export `normalizeCodexPath` for compatibility. The normalizer
accepts absolute filesystem paths only: Windows drive/UNC filesystem forms use
Win32 case-insensitive semantics, native POSIX paths preserve case, and WSL
paths are POSIX-normalized before a surviving `/mnt/<drive>` form is mapped.

Create `src/codex-session-attribution.ts`:

```ts
import {
  isCodexPathInside,
  normalizeCodexPath
} from './codex-session-path.js';

export type RuntimeScope =
  | 'exact'
  | 'descendant'
  | 'ancestor'
  | 'unrelated'
  | 'unknown';

export type ProjectRelation =
  | 'owned'
  | 'supporting'
  | 'mentioned'
  | 'ambient'
  | 'unrelated'
  | 'unknown';

export type StorageState = 'active' | 'archived' | 'missing';
export type AppVisibility = 'listed' | 'readable-hidden' | 'unknown';

export type SessionEvidence =
  | { kind: 'task-binding'; projectPath: string; taskId: string }
  | { kind: 'ccpanes-launch'; projectPath: string; launchId: string }
  | { kind: 'ccpanes-session'; projectPath: string; sessionId: string }
  | { kind: 'cwd'; relation: 'exact' | 'descendant' | 'ancestor' }
  | { kind: 'primary-target'; target: string }
  | { kind: 'prompt-mention'; target: string }
  | { kind: 'delegation'; sourceThreadId: string };

export interface AttributionInput {
  project: string | null;
  cwdNorm: string | null;
  storageState: StorageState;
  threadSource: 'user' | 'subagent' | 'automation' | 'unknown';
  primaryTargetNorm: string | null;
  promptMentionsProject: boolean;
  taskBinding: {
    taskId: string;
    projectPathNorm: string;
  } | null;
  ccpanesLaunch: {
    launchId: string;
    projectPathNorm: string;
  } | null;
}

export interface AttributionResult {
  runtimeScope: RuntimeScope;
  projectRelation: ProjectRelation;
  relationConfidence: number;
  reasons: string[];
  evidence: SessionEvidence[];
}

export function promptMentionsProjectPath(
  prompt: string | null,
  project: string | null
): boolean;

export function classifyRuntimeScope(
  cwdNorm: string | null,
  project: string | null
): RuntimeScope {
  if (!cwdNorm || !project?.trim()) return 'unknown';
  const projectNorm = normalizeCodexPath(project);
  const normalizedCwd = normalizeCodexPath(cwdNorm);
  if (!projectNorm || !normalizedCwd) return 'unknown';
  if (normalizedCwd === projectNorm) return 'exact';
  if (isCodexPathInside(projectNorm, normalizedCwd)) return 'descendant';
  if (isCodexPathInside(normalizedCwd, projectNorm)) return 'ancestor';
  return 'unrelated';
}

type ExplicitPathRelation = 'exact' | 'descendant' | 'conflict' | 'missing';

function classifyExplicitPath(
  projectNorm: string,
  candidate: string | null
): ExplicitPathRelation {
  if (!candidate?.trim()) return 'missing';
  const candidateNorm = normalizeCodexPath(candidate);
  if (!candidateNorm) return 'missing';
  if (candidateNorm === projectNorm) return 'exact';
  if (isCodexPathInside(projectNorm, candidateNorm)) return 'descendant';
  return 'conflict';
}

export function classifyProjectRelation(
  input: AttributionInput
): AttributionResult {
  const runtimeScope = classifyRuntimeScope(input.cwdNorm, input.project);
  const projectNorm = input.project?.trim()
    ? normalizeCodexPath(input.project)
    : '';
  const evidence: SessionEvidence[] = [];
  if (runtimeScope === 'exact' ||
      runtimeScope === 'descendant' ||
      runtimeScope === 'ancestor') {
    evidence.push({ kind: 'cwd', relation: runtimeScope });
  }
  if (input.primaryTargetNorm) {
    evidence.push({ kind: 'primary-target', target: input.primaryTargetNorm });
  }
  if (input.promptMentionsProject) {
    evidence.push({ kind: 'prompt-mention', target: projectNorm });
  }
  if (input.taskBinding) {
    evidence.push({
      kind: 'task-binding',
      projectPath: input.taskBinding.projectPathNorm,
      taskId: input.taskBinding.taskId
    });
  }
  if (input.ccpanesLaunch) {
    evidence.push({
      kind: 'ccpanes-launch',
      projectPath: input.ccpanesLaunch.projectPathNorm,
      launchId: input.ccpanesLaunch.launchId
    });
  }

  if (!projectNorm) {
    return {
      runtimeScope: 'unknown',
      projectRelation: 'unknown',
      relationConfidence: 0.1,
      reasons: ['project path is missing'],
      evidence
    };
  }

  const primaryTargetRelation = classifyExplicitPath(
    projectNorm,
    input.primaryTargetNorm
  );
  const taskRelation = classifyExplicitPath(
    projectNorm,
    input.taskBinding?.projectPathNorm ?? null
  );
  const launchRelation = classifyExplicitPath(
    projectNorm,
    input.ccpanesLaunch?.projectPathNorm ?? null
  );
  const ownershipReasons: string[] = [];
  if (taskRelation === 'exact') ownershipReasons.push('matched task binding');
  if (launchRelation === 'exact') {
    ownershipReasons.push('matched CC-Panes launch');
  }
  const conflictReasons: string[] = [];
  if (primaryTargetRelation === 'conflict') {
    conflictReasons.push('primary target conflicts with project');
  }
  if (taskRelation === 'conflict') {
    conflictReasons.push('task binding conflicts with project');
  }
  if (launchRelation === 'conflict') {
    conflictReasons.push('CC-Panes launch conflicts with project');
  }
  if (conflictReasons.length > 0) {
    return {
      runtimeScope,
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: [...conflictReasons, ...ownershipReasons],
      evidence
    };
  }
  if (ownershipReasons.length > 0) {
    return {
      runtimeScope,
      projectRelation: 'owned',
      relationConfidence: 1,
      reasons: ownershipReasons,
      evidence
    };
  }

  if (runtimeScope === 'exact' || runtimeScope === 'descendant') {
    const hasCompatibleTarget = [
      primaryTargetRelation,
      taskRelation,
      launchRelation
    ].some((relation) => relation === 'exact' || relation === 'descendant');
    return {
      runtimeScope,
      projectRelation: 'supporting',
      relationConfidence: hasCompatibleTarget ? 0.8 : 0.6,
      reasons: [
        `${runtimeScope} runtime cwd`,
        hasCompatibleTarget
          ? 'explicit target is compatible with project'
          : 'no strong ownership evidence'
      ],
      evidence
    };
  }

  if (input.promptMentionsProject) {
    return {
      runtimeScope,
      projectRelation: 'mentioned',
      relationConfidence: 0.35,
      reasons: ['prompt mentions project'],
      evidence
    };
  }

  if (runtimeScope === 'ancestor') {
    return {
      runtimeScope,
      projectRelation: 'ambient',
      relationConfidence: 0.2,
      reasons: ['runtime cwd is only a project ancestor'],
      evidence
    };
  }

  return {
    runtimeScope,
    projectRelation: runtimeScope === 'unrelated' ? 'unrelated' : 'unknown',
    relationConfidence: runtimeScope === 'unrelated' ? 0 : 0.1,
    reasons: ['no project ownership evidence'],
    evidence
  };
}

export function summarizeProjectRelations(records: Array<{
  projectRelation: ProjectRelation;
  storageState: StorageState;
  threadSource: AttributionInput['threadSource'];
}>) {
  const count = (predicate: (record: typeof records[number]) => boolean) =>
    records.filter(predicate).length;

  return {
    defaultVisible: count((record) =>
      record.storageState === 'active' &&
      record.threadSource === 'user' &&
      (record.projectRelation === 'owned' ||
        record.projectRelation === 'supporting')),
    owned: count((record) => record.projectRelation === 'owned'),
    supporting: count((record) => record.projectRelation === 'supporting'),
    mentioned: count((record) => record.projectRelation === 'mentioned'),
    ambient: count((record) => record.projectRelation === 'ambient'),
    archived: count((record) => record.storageState === 'archived'),
    subagents: count((record) => record.threadSource === 'subagent')
  };
}
```

`promptMentionsProjectPath` owns bounded matching of a known project path inside
prompt text; callers must not pass prompt text to `normalizeCodexPath`.
`classifyCodexScope` imports this matcher from attribution while attribution
continues to depend only on the path leaf, preserving one-way dependencies.

At the `buildCodexSessionIndex` entry boundary, capture `process.cwd()` once and
resolve `sessionsDir`, `stateDb`, `threadHistoryDb`, and a present `taskContext`
with `path.resolve`. Resolve relative SQLite `rollout_path` rows against the same
captured root before normalization, lookup, existence checks, parsing, and
emitting `sources`.

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
npx vitest run tests/codex-session-attribution.test.ts tests/codex-session-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only task-scoped files plus existing no-touch
files appear. Do not stage or commit under the current authorization.

### Task 2: Extend Rollout Parsing and Emit Index v2

**Files:**
- Modify: `src/codex-session-index.ts`
- Modify: `tests/codex-session-bridge.test.ts`

- [ ] **Step 1: Add failing rollout-evidence tests**

Extend `tests/codex-session-bridge.test.ts` with:

```ts
test('extracts task binding, delegation, storage, and primary-target evidence', async () => {
  const rolloutPath = path.join(tempRoot, 'rollout.jsonl');
  await fs.writeFile(rolloutPath, [
    JSON.stringify({
      timestamp: '2026-08-15T01:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'thread-1',
        cwd: 'D:\\cc-pane\\tool\\repos\\hooks',
        originator: 'Codex Desktop',
        source: 'vscode',
        thread_source: 'user'
      }
    }),
    JSON.stringify({
      timestamp: '2026-08-15T01:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{
          type: 'input_text',
          text: [
            'ccpanes-task-probe lifecycle context',
            'taskId: hooks-task',
            'projectPath: D:\\cc-pane\\tool\\repos\\hooks',
            'worktreeRoot: D:\\cc-pane\\tool\\repos\\hooks'
          ].join('\\n')
        }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-08-15T01:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: '<codex_delegation><source_thread_id>parent-1</source_thread_id><input>Audit D:\\codex-cc-pane</input></codex_delegation>'
        }]
      }
    })
  ].join('\\n'), 'utf8');

  const parsed = await parseCodexRolloutFile(rolloutPath);

  expect(parsed.taskBinding).toEqual({
    taskId: 'hooks-task',
    projectPathRaw: 'D:\\cc-pane\\tool\\repos\\hooks',
    worktreeRootRaw: 'D:\\cc-pane\\tool\\repos\\hooks'
  });
  expect(parsed.delegatedFromThreadId).toBe('parent-1');
  expect(parsed.primaryTargetRaw).toBe('D:\\codex-cc-pane');
});
```

Add a storage assertion to the SQLite index test:

```ts
expect(index.sessions[0]).toMatchObject({
  storageState: 'active',
  runtimeScope: 'exact',
  projectRelation: 'owned'
});
expect(index.schemaVersion).toBe('hooks.codex-session-index/v2');
```

- [ ] **Step 2: Run the focused tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts
```

Expected: FAIL on missing evidence fields and the v1 schema.

- [ ] **Step 3: Extend the parsed record and session record**

In `src/codex-session-index.ts`, add:

```ts
import {
  classifyProjectRelation,
  type AppVisibility,
  type ProjectRelation,
  type RuntimeScope,
  type SessionEvidence,
  type StorageState
} from './codex-session-attribution.js';

export interface ParsedTaskBindingEvidence {
  taskId: string;
  projectPathRaw: string;
  worktreeRootRaw: string;
}

export interface ParsedCodexRollout {
  // existing fields remain
  taskBinding: ParsedTaskBindingEvidence | null;
  delegatedFromThreadId: string | null;
  primaryTargetRaw: string | null;
}

export interface CodexSessionRecord {
  // existing v1 fields remain during migration
  storageState: StorageState;
  runtimeScope: RuntimeScope;
  projectRelation: ProjectRelation;
  relationConfidence: number;
  relationReasons: string[];
  evidence: SessionEvidence[];
  appVisibility: AppVisibility;
  taskBinding: ParsedTaskBindingEvidence | null;
  delegatedFromThreadId: string | null;
  primaryTargetRaw: string | null;
  primaryTargetNorm: string | null;
}

export interface CodexSessionIndex {
  schemaVersion: 'hooks.codex-session-index/v2';
  // remaining fields unchanged
}
```

Add bounded parsers:

```ts
function parseTaskBinding(text: string): ParsedTaskBindingEvidence | null {
  if (!text.includes('ccpanes-task-probe lifecycle context')) return null;
  const value = (key: string) =>
    new RegExp(`(?:^|\\\\n)${key}:\\\\s*([^\\\\r\\\\n]+)`).exec(text)?.[1]?.trim() ?? null;
  const taskId = value('taskId');
  const projectPathRaw = value('projectPath');
  const worktreeRootRaw = value('worktreeRoot');
  return taskId && projectPathRaw && worktreeRootRaw
    ? { taskId, projectPathRaw, worktreeRootRaw }
    : null;
}

function parseDelegatedFrom(text: string): string | null {
  return /<source_thread_id>([^<]+)<\\/source_thread_id>/.exec(text)?.[1]?.trim() ?? null;
}

function parsePrimaryTarget(text: string): string | null {
  const localPath = /(?:审计|目录|工作树|仓库|projectPath)[:：]?\\s*`?([A-Za-z]:\\\\[^`\\r\\n，。；]+)/.exec(text);
  if (localPath?.[1]) return localPath[1].trim();
  const url = /https:\\/\\/github\\.com\\/[^\\s)\\]]+/.exec(text);
  return url?.[0] ?? null;
}
```

Initialize new parsed fields to `null`. Inspect developer message text only for
the bounded `ccpanes-task-probe lifecycle context` block. Inspect user message
text for delegation and primary-target evidence. Do not feed lifecycle
`projectPath` lines into `parsePrimaryTarget`, otherwise the lifecycle project
would mask a conflicting external target from the actual user request. Retain
the first non-null value within each evidence class.

- [ ] **Step 4: Derive storage and attribution in one place**

Add:

```ts
function storageStateFor(rolloutPath: string | null, rolloutPresent: boolean): StorageState {
  if (!rolloutPresent || !rolloutPath) return 'missing';
  return normalizeCodexPath(rolloutPath).includes('/archived_sessions/')
    ? 'archived'
    : 'active';
}
```

Before each `sessions.push`, compute:

```ts
const primaryTargetNorm = parsed?.primaryTargetRaw
  ? normalizeCodexPath(parsed.primaryTargetRaw)
  : null;
const taskBinding = parsed?.taskBinding ?? null;
const storageState = storageStateFor(rolloutPath, rolloutPresent);
const attribution = classifyProjectRelation({
  project: input.project ?? null,
  cwdNorm,
  storageState,
  threadSource,
  primaryTargetNorm,
  promptMentionsProject: promptMentionsProjectPath(
    firstUserPrompt,
    input.project ?? null
  ),
  taskBinding: taskBinding && input.project
    ? {
        taskId: taskBinding.taskId,
        projectPathNorm: normalizeCodexPath(taskBinding.projectPathRaw)
      }
    : null,
  ccpanesLaunch: null
});
```

Populate all new record fields from `attribution` and the parsed evidence.
Set `evidence` to `attribution.evidence`, append a `delegation` item when
`delegatedFromThreadId` exists, and initialize `appVisibility` to `unknown`;
the sidebar phase owns the App-list observation.

- [ ] **Step 5: Run bridge and attribution tests**

Run:

```powershell
npx vitest run tests/codex-session-bridge.test.ts tests/codex-session-attribution.test.ts
```

Expected: PASS.

- [ ] **Step 6: Record the checkpoint**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; no stage/commit.

### Task 3: Validate CC-Panes Snapshots at the Trust Boundary

**Files:**
- Create: `src/ccpanes-session-snapshot.ts`
- Create: `tests/ccpanes-session-snapshot.test.ts`

- [ ] **Step 1: Write failing schema-validation tests**

Create `tests/ccpanes-session-snapshot.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  inspectCcPanesSnapshotFreshness,
  validateCcPanesSessionSnapshot
} from '../src/ccpanes-session-snapshot.js';

const valid = {
  schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
  generatedAt: '2026-08-15T08:46:58.097Z',
  launches: [{
    launchId: 'launch-1',
    projectPath: 'D:\\cc-pane\\tool\\repos\\hooks',
    workspaceName: 'hooks',
    cliTool: 'codex',
    resumeSessionId: 'thread-old',
    launchedAt: '2026-08-15T08:36:14.400Z'
  }],
  sessions: [{
    sessionId: 'pty-1',
    launchId: 'launch-1',
    taskId: 'task-1',
    projectPath: 'D:\\cc-pane\\tool\\repos\\hooks',
    status: 'active',
    title: 'hooks resume',
    observedCodexThreadId: 'thread-old'
  }]
};

test('normalizes a valid CC-Panes snapshot', () => {
  expect(validateCcPanesSessionSnapshot(valid)).toMatchObject({
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    launches: [{
      launchId: 'launch-1',
      projectPathNorm: 'd:/cc-pane/tool/repos/hooks'
    }],
    sessions: [{
      sessionId: 'pty-1',
      launchId: 'launch-1',
      projectPathNorm: 'd:/cc-pane/tool/repos/hooks'
    }]
  });
});

describe('invalid snapshots', () => {
  test.each([
    [{ ...valid, schemaVersion: 'wrong' }, 'schemaVersion'],
    [{ ...valid, generatedAt: 'not-a-date' }, 'generatedAt'],
    [{ ...valid, launches: [{ ...valid.launches[0], launchId: '' }] }, 'launchId'],
    [{ ...valid, sessions: [{ ...valid.sessions[0], sessionId: '' }] }, 'sessionId']
  ])('rejects %j', (value, field) => {
    expect(() => validateCcPanesSessionSnapshot(value)).toThrow(field);
  });

  test('rejects duplicate launch and Session identities', () => {
    expect(() => validateCcPanesSessionSnapshot({
      ...valid,
      launches: [valid.launches[0], valid.launches[0]]
    })).toThrow('duplicate launchId');
    expect(() => validateCcPanesSessionSnapshot({
      ...valid,
      sessions: [valid.sessions[0], valid.sessions[0]]
    })).toThrow('duplicate sessionId');
  });
});

test('reports stale snapshots as typed diagnostics', () => {
  expect(inspectCcPanesSnapshotFreshness(
    '2026-08-13T08:00:00.000Z',
    '2026-08-15T09:00:00.000Z',
    24 * 60 * 60 * 1_000
  )).toEqual({
    state: 'stale',
    ageMs: 176_400_000,
    maxAgeMs: 86_400_000
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```powershell
npx vitest run tests/ccpanes-session-snapshot.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict validation without a dependency**

Create `src/ccpanes-session-snapshot.ts`:

```ts
import { normalizeCodexPath } from './codex-session-index.js';

export interface CcPanesLaunchSnapshot {
  launchId: string;
  projectPath: string;
  projectPathNorm: string;
  workspaceName: string | null;
  cliTool: string;
  resumeSessionId: string | null;
  launchedAt: string;
}

export interface CcPanesRuntimeSessionSnapshot {
  sessionId: string;
  launchId: string | null;
  taskId: string | null;
  projectPath: string | null;
  projectPathNorm: string | null;
  status: string;
  title: string | null;
  observedCodexThreadId: string | null;
}

export interface CcPanesSessionSnapshot {
  schemaVersion: 'hooks.ccpanes-session-snapshot/v1';
  generatedAt: string;
  launches: CcPanesLaunchSnapshot[];
  sessions: CcPanesRuntimeSessionSnapshot[];
}

export interface CcPanesSnapshotFreshness {
  state: 'fresh' | 'stale';
  ageMs: number;
  maxAgeMs: number;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid CC-Panes snapshot: ${field}`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`invalid CC-Panes snapshot: ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field);
}

function iso(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (Number.isNaN(Date.parse(text))) {
    throw new Error(`invalid CC-Panes snapshot: ${field}`);
  }
  return new Date(text).toISOString();
}

export function validateCcPanesSessionSnapshot(
  value: unknown
): CcPanesSessionSnapshot {
  const root = record(value, 'root');
  if (root.schemaVersion !== 'hooks.ccpanes-session-snapshot/v1') {
    throw new Error('invalid CC-Panes snapshot: schemaVersion');
  }
  if (!Array.isArray(root.launches)) {
    throw new Error('invalid CC-Panes snapshot: launches');
  }
  if (!Array.isArray(root.sessions)) {
    throw new Error('invalid CC-Panes snapshot: sessions');
  }

  const normalized: CcPanesSessionSnapshot = {
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: iso(root.generatedAt, 'generatedAt'),
    launches: root.launches.map((entry, index) => {
      const item = record(entry, `launches[${index}]`);
      const projectPath = requiredString(
        item.projectPath,
        `launches[${index}].projectPath`
      );
      return {
        launchId: requiredString(item.launchId, `launches[${index}].launchId`),
        projectPath,
        projectPathNorm: normalizeCodexPath(projectPath),
        workspaceName: optionalString(
          item.workspaceName,
          `launches[${index}].workspaceName`
        ),
        cliTool: requiredString(item.cliTool, `launches[${index}].cliTool`),
        resumeSessionId: optionalString(
          item.resumeSessionId,
          `launches[${index}].resumeSessionId`
        ),
        launchedAt: iso(item.launchedAt, `launches[${index}].launchedAt`)
      };
    }),
    sessions: root.sessions.map((entry, index) => {
      const item = record(entry, `sessions[${index}]`);
      const projectPath = optionalString(
        item.projectPath,
        `sessions[${index}].projectPath`
      );
      return {
        sessionId: requiredString(item.sessionId, `sessions[${index}].sessionId`),
        launchId: optionalString(item.launchId, `sessions[${index}].launchId`),
        taskId: optionalString(item.taskId, `sessions[${index}].taskId`),
        projectPath,
        projectPathNorm: projectPath ? normalizeCodexPath(projectPath) : null,
        status: requiredString(item.status, `sessions[${index}].status`),
        title: optionalString(item.title, `sessions[${index}].title`),
        observedCodexThreadId: optionalString(
          item.observedCodexThreadId,
          `sessions[${index}].observedCodexThreadId`
        )
      };
    })
  };
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate(normalized.launches.map((entry) => entry.launchId))) {
    throw new Error('invalid CC-Panes snapshot: duplicate launchId');
  }
  if (duplicate(normalized.sessions.map((entry) => entry.sessionId))) {
    throw new Error('invalid CC-Panes snapshot: duplicate sessionId');
  }
  return normalized;
}

export function inspectCcPanesSnapshotFreshness(
  generatedAt: string,
  now = new Date().toISOString(),
  maxAgeMs = 24 * 60 * 60 * 1_000
): CcPanesSnapshotFreshness {
  const ageMs = Math.max(0, Date.parse(now) - Date.parse(generatedAt));
  return {
    state: ageMs > maxAgeMs ? 'stale' : 'fresh',
    ageMs,
    maxAgeMs
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npx vitest run tests/ccpanes-session-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 4: Build the Deterministic Federation Graph

**Files:**
- Create: `src/session-federation.ts`
- Create: `tests/session-federation.test.ts`

- [ ] **Step 1: Write failing graph tests**

Create `tests/session-federation.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  attachCcPanesAttribution,
  buildSessionFederation
} from '../src/session-federation.js';
import type { CodexSessionRecord } from '../src/codex-session-index.js';
import type { CcPanesSessionSnapshot } from '../src/ccpanes-session-snapshot.js';

test('links Codex, launch, PTY Session, and Task nodes deterministically', () => {
  const graph = buildSessionFederation({
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\cc-pane\\tool\\repos\\hooks',
    codexSessions: [{
      threadId: 'thread-old',
      source: 'codex-app',
      threadSource: 'user',
      originator: 'Codex Desktop',
      cwdRaw: 'D:\\cc-pane\\tool\\repos\\hooks',
      cwdNorm: 'd:/cc-pane/tool/repos/hooks',
      projectOwner: 'D:\\cc-pane\\tool\\repos\\hooks',
      scopeMatch: 'exact',
      confidence: 1,
      rolloutPath: 'C:\\rollout.jsonl',
      stateDbPresent: true,
      rolloutPresent: true,
      updatedAt: '2026-08-15T08:00:00.000Z',
      firstUserPrompt: 'Work',
      lastSummary: null,
      storageState: 'active',
      runtimeScope: 'exact',
      projectRelation: 'owned',
      relationConfidence: 1,
      relationReasons: ['matched task binding'],
      evidence: [{
        kind: 'task-binding',
        projectPath: 'd:/cc-pane/tool/repos/hooks',
        taskId: 'task-1'
      }],
      appVisibility: 'unknown',
      taskBinding: {
        taskId: 'task-1',
        projectPathRaw: 'D:\\cc-pane\\tool\\repos\\hooks',
        worktreeRootRaw: 'D:\\cc-pane\\tool\\repos\\hooks'
      },
      delegatedFromThreadId: null,
      primaryTargetRaw: null,
      primaryTargetNorm: null
    }],
    ccpanes: {
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: '2026-08-15T08:59:00.000Z',
      launches: [{
        launchId: 'launch-1',
        projectPath: 'D:\\cc-pane\\tool\\repos\\hooks',
        projectPathNorm: 'd:/cc-pane/tool/repos/hooks',
        workspaceName: 'hooks',
        cliTool: 'codex',
        resumeSessionId: 'thread-old',
        launchedAt: '2026-08-15T08:36:14.400Z'
      }],
      sessions: [{
        sessionId: 'pty-1',
        launchId: 'launch-1',
        taskId: 'task-1',
        projectPath: 'D:\\cc-pane\\tool\\repos\\hooks',
        projectPathNorm: 'd:/cc-pane/tool/repos/hooks',
        status: 'active',
        title: 'hooks resume',
        observedCodexThreadId: 'thread-old'
      }]
    }
  });

  expect(graph.schemaVersion).toBe('hooks.session-federation/v1');
  expect(graph.nodes.map((node) => node.id)).toEqual([
    'ccpanes-launch:launch-1',
    'ccpanes-session:pty-1',
    'ccpanes-task:task-1',
    'codex-thread:thread-old'
  ]);
  expect(graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'resumed-from',
      from: 'ccpanes-launch:launch-1',
      to: 'codex-thread:thread-old'
    }),
    expect.objectContaining({
      type: 'hosts',
      from: 'ccpanes-session:pty-1',
      to: 'codex-thread:thread-old'
    }),
    expect.objectContaining({
      type: 'launched',
      from: 'ccpanes-launch:launch-1',
      to: 'ccpanes-session:pty-1'
    }),
    expect.objectContaining({
      type: 'belongs-to-task',
      from: 'ccpanes-session:pty-1',
      to: 'ccpanes-task:task-1'
    })
  ]));
});

test('uses exact-project launch and Session IDs as ownership evidence', () => {
  const base = {
    threadId: 'controller-thread',
    source: 'codex-cli',
    threadSource: 'user',
    originator: 'codex-tui',
    cwdRaw: 'D:\\Repo',
    cwdNorm: 'd:/repo',
    projectOwner: 'D:\\Repo',
    scopeMatch: 'exact',
    confidence: 1,
    rolloutPath: 'C:\\rollout.jsonl',
    stateDbPresent: true,
    rolloutPresent: true,
    updatedAt: '2026-08-15T08:00:00.000Z',
    firstUserPrompt: 'Work',
    lastSummary: null,
    storageState: 'active',
    runtimeScope: 'exact',
    projectRelation: 'supporting',
    relationConfidence: 0.6,
    relationReasons: ['exact runtime cwd'],
    evidence: [{ kind: 'cwd', relation: 'exact' }],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null
  } satisfies CodexSessionRecord;
  const snapshot = {
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: '2026-08-15T08:59:00.000Z',
    launches: [{
      launchId: 'launch-1',
      projectPath: 'D:\\Repo',
      projectPathNorm: 'd:/repo',
      workspaceName: 'hooks',
      cliTool: 'codex',
      resumeSessionId: 'original-thread',
      launchedAt: '2026-08-15T08:36:14.400Z'
    }],
    sessions: [{
      sessionId: 'pty-1',
      launchId: 'launch-1',
      taskId: 'task-1',
      projectPath: 'D:\\Repo',
      projectPathNorm: 'd:/repo',
      status: 'active',
      title: 'hooks resume',
      observedCodexThreadId: 'controller-thread'
    }]
  } satisfies CcPanesSessionSnapshot;

  expect(attachCcPanesAttribution({
    project: 'D:\\Repo',
    sessions: [base],
    ccpanes: snapshot
  })[0]).toMatchObject({
    projectRelation: 'owned',
    relationConfidence: 1,
    evidence: expect.arrayContaining([{
      kind: 'ccpanes-session',
      projectPath: 'd:/repo',
      sessionId: 'pty-1'
    }])
  });

  expect(buildSessionFederation({
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\Repo',
    codexSessions: [base],
    ccpanes: snapshot
  }).edges).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'controller-for',
      from: 'codex-thread:controller-thread',
      to: 'codex-thread:original-thread'
    })
  ]));
});
```

- [ ] **Step 2: Run the test**

Run:

```powershell
npx vitest run tests/session-federation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement graph types and stable ordering**

Create `src/session-federation.ts`:

```ts
import { normalizeCodexPath, type CodexSessionRecord } from './codex-session-index.js';
import {
  inspectCcPanesSnapshotFreshness,
  type CcPanesSessionSnapshot
} from './ccpanes-session-snapshot.js';
import type { SessionEvidence } from './codex-session-attribution.js';

export type FederationNodeType =
  | 'codex-thread'
  | 'ccpanes-launch'
  | 'ccpanes-session'
  | 'ccpanes-task';

export type FederationEdgeType =
  | 'resumed-from'
  | 'hosts'
  | 'launched'
  | 'belongs-to-task'
  | 'delegated-from'
  | 'controller-for';

export interface FederationNode {
  id: string;
  type: FederationNodeType;
  externalId: string;
  attributes: Record<string, unknown>;
}

export interface FederationEdge {
  id: string;
  type: FederationEdgeType;
  from: string;
  to: string;
  confidence: number;
  evidence: FederationEvidence[];
  observedAt: string;
}

export type FederationEvidence =
  | SessionEvidence
  | { kind: 'ccpanes-runtime-link'; sessionId: string }
  | { kind: 'snapshot-field'; field: string; value: string };

export type FederationDiagnostic =
  | { kind: 'ccpanes-snapshot-missing' }
  | { kind: 'ccpanes-snapshot-stale'; ageMs: number; maxAgeMs: number };

export interface SessionFederation {
  schemaVersion: 'hooks.session-federation/v1';
  generatedAt: string;
  project: string;
  nodes: FederationNode[];
  edges: FederationEdge[];
  diagnostics: FederationDiagnostic[];
}

const nodeId = (type: FederationNodeType, id: string) => `${type}:${id}`;

export function attachCcPanesAttribution(input: {
  project: string;
  sessions: CodexSessionRecord[];
  ccpanes: CcPanesSessionSnapshot | null;
}): CodexSessionRecord[] {
  if (!input.ccpanes) return input.sessions;
  const projectNorm = normalizeCodexPath(input.project);
  const launchByThread = new Map(
    input.ccpanes.launches
      .filter((launch) =>
        launch.projectPathNorm === projectNorm && launch.resumeSessionId
      )
      .map((launch) => [launch.resumeSessionId as string, launch])
  );
  const runtimeByThread = new Map(
    input.ccpanes.sessions
      .filter((session) =>
        session.projectPathNorm === projectNorm &&
        session.observedCodexThreadId
      )
      .map((session) => [session.observedCodexThreadId as string, session])
  );

  return input.sessions.map((session) => {
    const launch = launchByThread.get(session.threadId);
    const runtime = runtimeByThread.get(session.threadId);
    if (!launch && !runtime) return session;
    const evidence: SessionEvidence = launch
      ? {
          kind: 'ccpanes-launch',
          projectPath: launch.projectPathNorm,
          launchId: launch.launchId
        }
      : {
          kind: 'ccpanes-session',
          projectPath: runtime!.projectPathNorm!,
          sessionId: runtime!.sessionId
        };
    return {
      ...session,
      projectRelation: 'owned',
      relationConfidence: 1,
      relationReasons: [
        ...new Set([
          ...session.relationReasons,
          launch
            ? 'matched exact-project CC-Panes launch'
            : 'matched exact-project CC-Panes Session'
        ])
      ],
      evidence: session.evidence.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(evidence)
      )
        ? session.evidence
        : [...session.evidence, evidence]
    };
  });
}

export function buildSessionFederation(input: {
  generatedAt?: string;
  project: string;
  codexSessions: CodexSessionRecord[];
  ccpanes?: CcPanesSessionSnapshot | null;
}): SessionFederation {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const nodes = new Map<string, FederationNode>();
  const edges = new Map<string, FederationEdge>();
  const diagnostics: FederationDiagnostic[] = [];

  const addNode = (
    type: FederationNodeType,
    externalId: string,
    attributes: Record<string, unknown>
  ) => {
    const id = nodeId(type, externalId);
    const existing = nodes.get(id);
    nodes.set(id, {
      id,
      type,
      externalId,
      attributes: existing
        ? { ...attributes, ...existing.attributes }
        : attributes
    });
    return id;
  };

  const addEdge = (
    type: FederationEdgeType,
    from: string,
    to: string,
    confidence: number,
    evidence: FederationEvidence[],
    observedAt = generatedAt
  ) => {
    const id = `${type}:${from}->${to}`;
    edges.set(id, { id, type, from, to, confidence, evidence, observedAt });
  };

  for (const session of input.codexSessions) {
    const threadNode = addNode('codex-thread', session.threadId, {
      host: session.source,
      threadSource: session.threadSource,
      storageState: session.storageState,
      projectRelation: session.projectRelation,
      cwdNorm: session.cwdNorm,
      updatedAt: session.updatedAt
    });
    if (session.delegatedFromThreadId) {
      const parent = addNode(
        'codex-thread',
        session.delegatedFromThreadId,
        { inferred: true }
      );
      addEdge(
        'delegated-from',
        threadNode,
        parent,
        1,
        [{ kind: 'delegation', sourceThreadId: session.delegatedFromThreadId }]
      );
    }
  }

  for (const launch of input.ccpanes?.launches ?? []) {
    const launchNode = addNode('ccpanes-launch', launch.launchId, {
      projectPathNorm: launch.projectPathNorm,
      workspaceName: launch.workspaceName,
      cliTool: launch.cliTool,
      launchedAt: launch.launchedAt
    });
    if (launch.resumeSessionId) {
      const threadNode = addNode(
        'codex-thread',
        launch.resumeSessionId,
        { inferred: true }
      );
      addEdge(
        'resumed-from',
        launchNode,
        threadNode,
        1,
        [{
          kind: 'snapshot-field',
          field: 'launch.resumeSessionId',
          value: launch.resumeSessionId
        }],
        launch.launchedAt
      );
    }
  }

  for (const session of input.ccpanes?.sessions ?? []) {
    const sessionNode = addNode('ccpanes-session', session.sessionId, {
      status: session.status,
      title: session.title,
      projectPathNorm: session.projectPathNorm
    });
    if (session.launchId) {
      const launchNode = addNode('ccpanes-launch', session.launchId, {
        inferred: true
      });
      addEdge(
        'launched',
        launchNode,
        sessionNode,
        1,
        [{ kind: 'ccpanes-runtime-link', sessionId: session.sessionId }]
      );
    }
    if (session.taskId) {
      const taskNode = addNode('ccpanes-task', session.taskId, {});
      addEdge(
        'belongs-to-task',
        sessionNode,
        taskNode,
        1,
        [{
          kind: 'snapshot-field',
          field: 'session.taskId',
          value: session.taskId
        }]
      );
    }
    if (session.observedCodexThreadId) {
      const threadNode = addNode(
        'codex-thread',
        session.observedCodexThreadId,
        { inferred: true }
      );
      addEdge(
        'hosts',
        sessionNode,
        threadNode,
        1,
        [{
          kind: 'snapshot-field',
          field: 'session.observedCodexThreadId',
          value: session.observedCodexThreadId
        }]
      );
    }
  }

  for (const session of input.codexSessions) {
    if (!session.taskBinding) continue;
    const taskNode = addNode('ccpanes-task', session.taskBinding.taskId, {
      inferred: true
    });
    addEdge(
      'belongs-to-task',
      nodeId('codex-thread', session.threadId),
      taskNode,
      1,
      [{
        kind: 'task-binding',
        projectPath: normalizeCodexPath(session.taskBinding.projectPathRaw),
        taskId: session.taskBinding.taskId
      }]
    );
  }

  for (const runtime of input.ccpanes?.sessions ?? []) {
    if (!runtime.launchId || !runtime.observedCodexThreadId) continue;
    const launch = input.ccpanes?.launches.find(
      (candidate) => candidate.launchId === runtime.launchId
    );
    if (!launch?.resumeSessionId ||
        launch.resumeSessionId === runtime.observedCodexThreadId) continue;
    addEdge(
      'controller-for',
      nodeId('codex-thread', runtime.observedCodexThreadId),
      nodeId('codex-thread', launch.resumeSessionId),
      0.9,
      [
        { kind: 'ccpanes-runtime-link', sessionId: runtime.sessionId },
        {
          kind: 'snapshot-field',
          field: 'session.launchId',
          value: runtime.launchId
        }
      ]
    );
  }

  if (!input.ccpanes) {
    diagnostics.push({ kind: 'ccpanes-snapshot-missing' });
  } else {
    const freshness = inspectCcPanesSnapshotFreshness(
      input.ccpanes.generatedAt,
      generatedAt
    );
    if (freshness.state === 'stale') {
      diagnostics.push({
        kind: 'ccpanes-snapshot-stale',
        ageMs: freshness.ageMs,
        maxAgeMs: freshness.maxAgeMs
      });
    }
  }

  return {
    schemaVersion: 'hooks.session-federation/v1',
    generatedAt,
    project: input.project,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics
  };
}
```

- [ ] **Step 4: Run snapshot and federation tests**

Run:

```powershell
npx vitest run tests/ccpanes-session-snapshot.test.ts tests/session-federation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 5: Replace Resolver Defaults and Preserve Explicit Broad Views

**Files:**
- Modify: `src/codex-session-resolver.ts`
- Modify: `tests/codex-session-attribution.test.ts`
- Modify: `tests/codex-session-bridge.test.ts`

- [ ] **Step 1: Add failing filter and totals tests**

Add to `tests/codex-session-attribution.test.ts`:

```ts
import { filterResolvedSessions } from '../src/codex-session-resolver.js';

test('default resolve returns active owned/supporting user threads only', () => {
  const records = [
    { threadId: 'owned', projectRelation: 'owned', storageState: 'active', threadSource: 'user' },
    { threadId: 'supporting', projectRelation: 'supporting', storageState: 'active', threadSource: 'user' },
    { threadId: 'ambient', projectRelation: 'ambient', storageState: 'active', threadSource: 'user' },
    { threadId: 'archived', projectRelation: 'owned', storageState: 'archived', threadSource: 'user' },
    { threadId: 'subagent', projectRelation: 'owned', storageState: 'active', threadSource: 'subagent' }
  ];

  expect(filterResolvedSessions(records as never, {} as never)
    .map((record) => record.threadId))
    .toEqual(['owned', 'supporting']);
});
```

Add a second test with:

```ts
{
  includeArchived: true,
  includeSubagents: true,
  includeRelated: true,
  includeAmbient: true
}
```

Expected IDs: all five records.

- [ ] **Step 2: Run the focused tests**

Run:

```powershell
npx vitest run tests/codex-session-attribution.test.ts tests/codex-session-bridge.test.ts
```

Expected: FAIL because the filter API and v2 result totals are absent.

- [ ] **Step 3: Implement resolver options and separated totals**

Replace the resolver result contract with:

```ts
export interface ResolveOptions {
  includeArchived?: boolean;
  includeSubagents?: boolean;
  includeRelated?: boolean;
  includeAmbient?: boolean;
}

export interface CodexSessionResolution {
  schemaVersion: 'hooks.codex-session-resolution/v2';
  project: string;
  projectNorm: string;
  totals: ReturnType<typeof summarizeProjectRelations>;
  sessions: ResolvedCodexSession[];
}

export function filterResolvedSessions(
  sessions: CodexSessionRecord[],
  options: ResolveOptions
): CodexSessionRecord[] {
  return sessions.filter((session) => {
    if (!options.includeArchived && session.storageState !== 'active') return false;
    if (!options.includeSubagents && session.threadSource !== 'user') return false;
    if (session.projectRelation === 'owned' || session.projectRelation === 'supporting') {
      return true;
    }
    if (options.includeRelated && session.projectRelation === 'mentioned') return true;
    if (options.includeAmbient && session.projectRelation === 'ambient') return true;
    return false;
  });
}
```

Sort by relation rank, storage, update time, and ID. Human output begins with:

```text
owned=<n> supporting=<n> mentioned=<n> ambient=<n> archived=<n> subagents=<n>
default-visible=<n>
```

- [ ] **Step 4: Run resolver tests**

Run:

```powershell
npx vitest run tests/codex-session-attribution.test.ts tests/codex-session-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 6: Wire CLI Migration and Graph Output

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Extend `tests/codex-session-cli.test.ts`:

```ts
test('resolve defaults exclude ambient and archived records', async () => {
  const output = JSON.parse(await runCli([
    'codex-sessions', 'resolve',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', 'D:\\Repo',
    '--json'
  ]));

  expect(output.schemaVersion).toBe('hooks.codex-session-resolution/v2');
  expect(output.totals.defaultVisible).toBe(1);
});

test('graph imports an explicit CC-Panes snapshot', async () => {
  const snapshotPath = path.join(root, 'ccpanes.json');
  const graphPath = path.join(root, 'live', 'graph.json');
  await fs.writeFile(snapshotPath, JSON.stringify({
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: '2026-08-15T09:00:00.000Z',
    launches: [],
    sessions: []
  }), 'utf8');

  const graph = JSON.parse(await runCli([
    'codex-sessions', 'graph',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', 'D:\\Repo',
    '--ccpanes-snapshot', snapshotPath,
    '--out', graphPath
  ]));

  expect(graph.schemaVersion).toBe('hooks.session-federation/v1');
  await expect(fs.stat(graphPath)).resolves.toBeTruthy();
});
```

- [ ] **Step 2: Run CLI tests**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts
```

Expected: FAIL on v2 resolution, unknown `graph`, and missing snapshot-aware
scan/resolve behavior.

- [ ] **Step 3: Wire options and graph action**

At the start of the `codex-sessions` branch, validate the optional snapshot
before any output write, then attach its evidence once and use the enriched
records for `scan`, `resolve`, `retention`, and `graph`:

```ts
const snapshotPath = valueAfter(args, '--ccpanes-snapshot');
const snapshot = snapshotPath
  ? validateCcPanesSessionSnapshot(
      JSON.parse(await readFile(path.resolve(snapshotPath), 'utf8'))
    )
  : null;
const enrichedSessions = project
  ? attachCcPanesAttribution({
      project,
      sessions: index.sessions,
      ccpanes: snapshot
    })
  : index.sessions;
const enrichedIndex = {
  ...index,
  sessions: enrichedSessions,
  warnings: snapshot
    ? index.warnings
    : [...index.warnings, 'CC-Panes snapshot not supplied']
};
```

For `scan`, write and return `enrichedIndex`. In `src/cli.ts`, add:

```ts
const resolveOptions = {
  includeArchived: args.includes('--include-archived'),
  includeSubagents: args.includes('--include-subagents'),
  includeRelated: args.includes('--include-related'),
  includeAmbient: args.includes('--include-ambient')
};
```

For `resolve`, pass `enrichedSessions` and `resolveOptions`.

For `graph`:

```ts
if (action === 'graph') {
  if (!project) throw new Error('missing --project');
  const graph = buildSessionFederation({
    project,
    codexSessions: enrichedSessions,
    ccpanes: snapshot
  });
  const outPath = valueAfter(args, '--out') ??
    path.join(process.cwd(), 'live', 'session-federation.json');
  await writeCodexSessionJson(outPath, graph);
  return `${JSON.stringify(graph, null, 2)}\n`;
}
```

Import `readFile`, the snapshot validator, `attachCcPanesAttribution`, and the
federation builder using existing NodeNext import conventions. Add a CLI test
that runs `scan --ccpanes-snapshot` with a launch or Session referencing the
fixture thread ID and asserts that the emitted record is `owned` with typed
CC-Panes evidence.

- [ ] **Step 4: Run CLI and core tests**

Run:

```powershell
npx vitest run `
  tests/codex-session-cli.test.ts `
  tests/codex-session-bridge.test.ts `
  tests/codex-session-attribution.test.ts `
  tests/ccpanes-session-snapshot.test.ts `
  tests/session-federation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 7: Update Handoff and Documentation

**Files:**
- Modify: `src/codex-session-handoff.ts`
- Modify: `tests/codex-session-cli.test.ts`
- Modify: `docs/codex-session-bridge.md`
- Modify: `README.md`

- [ ] **Step 1: Add a failing handoff assertion**

In `tests/codex-session-cli.test.ts`, extend the existing handoff test:

```ts
expect(handoff).toContain('owned/supporting user sessions');
expect(handoff).not.toContain('(ancestor,');
```

- [ ] **Step 2: Run the CLI test**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts
```

Expected: FAIL on the new handoff wording.

- [ ] **Step 3: Render only default-visible sessions**

In `src/codex-session-handoff.ts`, replace the current `slice(0, 3)` source with:

```ts
const visible = input.resolution.sessions.filter((session) =>
  session.storageState === 'active' &&
  session.threadSource === 'user' &&
  (session.projectRelation === 'owned' ||
    session.projectRelation === 'supporting')
);
const top = visible.slice(0, 3)
  .map((session) =>
    `${session.threadId} (${session.projectRelation}, cwd=${session.cwdRaw ?? 'unknown'})`
  )
  .join('; ') || 'none';
```

Add:

```ts
`sessionScope: owned/supporting user sessions; broader relations require explicit flags`,
```

- [ ] **Step 4: Update user documentation**

Document:

- `runtimeScope` versus `projectRelation`;
- why 67/75 was an over-broad relation count;
- default exclusions and include flags;
- CC-Panes snapshot contract;
- graph nodes and edges;
- migration from v1 files to versioned v2 files;
- exact PowerShell examples from the design.

In `README.md`, add one concise link to
`docs/codex-session-bridge.md`; preserve unrelated README edits.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 8: Full Verification and Live Count Reconciliation

**Files:**
- Generated: `live/codex-session-index-v2.json`
- Generated: `live/codex-session-resolution-v2.json`
- Generated: `live/session-federation.json`
- Inspect: all task-scoped source, test, and documentation files

- [ ] **Step 1: Run the complete repository checks**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

Expected:

- all Vitest files pass;
- typecheck exits 0;
- build exits 0;
- smoke prints `SMOKE_PASS`;
- diff check exits 0.

- [ ] **Step 2: Generate a fresh v2 Codex-only index**

Run:

```powershell
node dist/src/cli.js codex-sessions scan `
  --project D:\cc-pane\tool\repos\hooks `
  --out live/codex-session-index-v2.json
```

Expected: schema `hooks.codex-session-index/v2`.

- [ ] **Step 3: Verify corrected default counts**

Run:

```powershell
node dist/src/cli.js codex-sessions resolve `
  --project D:\cc-pane\tool\repos\hooks `
  --json |
  Set-Content -LiteralPath live/codex-session-resolution-v2.json -Encoding utf8
```

Assert from the generated JSON:

- `totals.defaultVisible` is materially smaller than the old 142 related total;
- ancestor-only records are absent from `sessions`;
- archived and subagent records are absent by default;
- `--include-related --include-ambient --include-archived --include-subagents`
  exposes the broader diagnostic population.

- [ ] **Step 4: Import a fresh read-only CC-Panes snapshot**

From a Codex App conversation with a READY Companion preflight, collect only:

- `list_launch_history(projectPath=hooks)`;
- `list_sessions`;
- matched Session status/output-derived Codex thread ID when present.

Write the bounded normalized snapshot to:

```text
live/ccpanes-session-snapshot.json
```

Do not store endpoint, token, or full terminal output.

- [ ] **Step 5: Generate and inspect the federation graph**

Run:

```powershell
node dist/src/cli.js codex-sessions graph `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --out live/session-federation.json
```

Assert that the known chain contains:

- Codex App thread `01a0040d-9521-73f1-b4d8-baf87c498c90`;
- controller CLI thread `01a00490-90c0-7dc2-9fac-fbdb4d7baa0f` when represented by snapshot evidence;
- CC-Panes Session `a078a6a2-652b-49a4-876e-fc0bf6b75873`;
- CC-Panes Task `8ab8356e-2c52-4f37-9e2d-de9cd64698d1`;
- typed edges with evidence rather than ID replacement.

- [ ] **Step 6: Inspect final diff and status**

Run:

```powershell
git diff --stat
git diff -- `
  src/codex-session-index.ts `
  src/codex-session-attribution.ts `
  src/ccpanes-session-snapshot.ts `
  src/session-federation.ts `
  src/codex-session-resolver.ts `
  src/codex-session-handoff.ts `
  src/cli.ts `
  tests/codex-session-attribution.test.ts `
  tests/ccpanes-session-snapshot.test.ts `
  tests/session-federation.test.ts `
  tests/codex-session-bridge.test.ts `
  tests/codex-session-cli.test.ts `
  docs/codex-session-bridge.md `
  README.md
git status --short
```

Expected: only task-scoped changes plus previously recorded no-touch files.
Report checks as `pass/fail/blocked`. Do not stage, commit, or push.
