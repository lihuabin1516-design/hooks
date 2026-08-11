# Hooks Phase51 Task Binding Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
> Follow every RED → GREEN → REFACTOR gate in order.

**Goal:** Prevent parent-workspace task capture while preserving the distinction
between the canonical Hooks project and the linked worktree used by the current
task.

**Architecture:** `src/current-task.ts` remains the sole task-binding authority.
`src/git-state.ts` supplies read-only Git topology facts. A task is selected only
when its file owner, declared active worktree, current Git root and canonical
project relationship all match.

**Tech Stack:** Node.js 22+, TypeScript ESM, Vitest, Git CLI, existing CC-Panes
hook schemas.

---

## Change contract

```text
Intent:
  Stop cross-project task selection and make canonical-project/worktree ownership
  explicit and machine-verifiable.
Authorized Mutation:
  Tracked files inside D:\cc-pane\.worktrees\hooks-phase51-task-binding plus its
  ignored .ccpanes-task/current-task.json.
In Scope:
  task schema semantics, Git topology reader, task factory/resolver, CLI command,
  hook/lifecycle mismatch behavior, tests, smoke and directly governing docs.
Out of Scope:
  PaneForge source, workspace-root product code, donor feature integration,
  user/global configuration, live sync, release and deployment.
No-Touch:
  D:\cc-pane\.worktrees\paneforge-foundation existing changes;
  D:\cc-pane\tool\repos\hooks main worktree tracked files;
  C:\Users\AI001\.codex and C:\Users\AI001\.cc-panes.
Current Evidence:
  Canonical repo is D:\cc-pane\tool\repos\hooks.
  Active linked worktree is D:\cc-pane\.worktrees\hooks-phase51-task-binding.
  git common dir is D:\cc-pane\tool\repos\hooks\.git.
  Baseline is f6846e9156ae4c871e063f996ba4031cf0732383.
Active Hypothesis:
  Unbounded ancestor search caused the cross-project capture; treating
  projectPath and worktreeRoot as identical obscured the linked-worktree topology.
Expected Behavior:
  projectPath identifies the canonical project; worktreeRoot is the active
  checkout and all task-scoped write boundaries; mainRepoRoot identifies the Git
  main worktree when Git topology is available.
Fatal Failures:
  parent task accepted across a Git root; valid linked-worktree task rejected;
  mismatch write allowed; audit written to the wrong task; PaneForge or main
  worktree tracked files changed; tests weakened.
Verification:
  focused RED/GREEN tests, affected suites, full test/typecheck/build/smoke,
  live resolver probe against the linked worktree, diff/status inspection.
Recovery:
  reverse the Phase51 patch and restore the previous ignored task JSON from its
  recorded content/hash; do not restore the broad root binding as a permanent fix.
```

## Path invariants

```text
Canonical project:
  D:\cc-pane\tool\repos\hooks

Active task worktree:
  D:\cc-pane\.worktrees\hooks-phase51-task-binding

Task binding:
  D:\cc-pane\.worktrees\hooks-phase51-task-binding
    \.ccpanes-task\current-task.json

Required current-task values:
  projectPath  = D:\cc-pane\tool\repos\hooks
  mainRepoRoot = D:\cc-pane\tool\repos\hooks
  worktreeRoot = D:\cc-pane\.worktrees\hooks-phase51-task-binding
```

## File map

```text
.gitignore
  Ignore project-local .ccpanes-task runtime state.

src/types.ts
  Own GitTopology, TaskBindingStatus and TaskBindingCheck public types.

src/git-state.ts
  Read worktree root, absolute common dir, main worktree, branch and HEAD.

vitest.config.ts
  Keep temporary non-Git fixtures from inheriting an unrelated parent Git repo.

src/current-task.ts
  Own topology-aware task factory, persistence, discovery and binding inspection.

src/hook-runner.ts
  Produce mismatch decisions that block writes without granting candidate-task
  authority.

src/session-lifecycle.ts
  Render compact mismatch context for SessionStart and Stop.

src/cli.ts
  Add verify-task-binding and route dynamic consumers through one inspector.

src/project-bootstrap.ts
  Reuse the canonical task factory.

tests/current-task.test.ts
  Main-worktree, linked-worktree, non-Git and mismatch contract tests.

tests/git-state.test.ts
  Git topology derivation tests.

tests/hook-runner.test.ts
  Mismatch read/write decision tests.

tests/session-lifecycle.test.ts
  User-visible mismatch context tests.

tests/cli.test.ts
  Command and dynamic-consumer integration tests.

scripts/smoke.mjs
  Cross-root and linked-worktree smoke fixtures.

README.md / HANDOFF.md / PROJECT-DIRECTORY.md
  Update only after implementation behavior is accepted.
```

## Task 1: Ignore worktree-local task state

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Add the root-scoped rule**

```gitignore
/.ccpanes-task/
```

- [ ] **Step 2: Verify the rule**

Run:

```powershell
git check-ignore -v .ccpanes-task/current-task.json
git diff -- .gitignore
```

Expected:

- `git check-ignore` identifies `/.ccpanes-task/`;
- no unrelated ignore rules change.

## Task 2: Define topology and binding contracts with failing tests

**Files:**

- Modify: `src/types.ts`
- Modify: `tests/git-state.test.ts`
- Modify: `tests/current-task.test.ts`

- [ ] **Step 1: Add linked-worktree fixture helpers**

Add to the test support in `tests/current-task.test.ts` and reuse the same shape
in `tests/git-state.test.ts`:

```ts
import { execFileSync } from 'node:child_process';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

async function initGitRepo(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Phase51 Fixture'], root);
  git(['config', 'user.email', 'phase51@example.invalid'], root);
  await fs.writeFile(path.join(root, 'README.md'), '# fixture\n', 'utf8');
  git(['add', 'README.md'], root);
  git(['commit', '-m', 'fixture'], root);
}

async function addLinkedWorktree(mainRoot: string, worktreeRoot: string): Promise<void> {
  git(['worktree', 'add', '-b', 'phase51-linked', worktreeRoot], mainRoot);
}
```

- [ ] **Step 2: Add failing Git topology tests**

```ts
test('derives the main worktree from a linked worktree common dir', async () => {
  const mainRoot = path.join(tempRoot, 'hooks-main');
  const linkedRoot = path.join(tempRoot, 'hooks-linked');
  await initGitRepo(mainRoot);
  await addLinkedWorktree(mainRoot, linkedRoot);

  expect(readGitTopology(linkedRoot)).toEqual({
    worktreeRoot: linkedRoot,
    commonDir: path.join(mainRoot, '.git'),
    mainRepoRoot: mainRoot
  });
});

test('uses the same root for a main worktree and its canonical project', async () => {
  const mainRoot = path.join(tempRoot, 'hooks-main');
  await initGitRepo(mainRoot);

  expect(readGitTopology(mainRoot)).toEqual({
    worktreeRoot: mainRoot,
    commonDir: path.join(mainRoot, '.git'),
    mainRepoRoot: mainRoot
  });
});
```

- [ ] **Step 3: Add failing binding tests**

```ts
test('matches a linked-worktree task whose canonical project is the main worktree', async () => {
  const mainRoot = path.join(tempRoot, 'hooks-main');
  const linkedRoot = path.join(tempRoot, 'hooks-linked');
  await initGitRepo(mainRoot);
  await addLinkedWorktree(mainRoot, linkedRoot);
  await writeCurrentTaskAtomic(linkedRoot, {
    ...validTask(linkedRoot),
    projectPath: mainRoot,
    mainRepoRoot: mainRoot,
    worktreeRoot: linkedRoot
  });

  const check = await inspectCurrentTaskBindingFromCwd(linkedRoot);

  expect(check).toMatchObject({
    status: 'matched',
    gitRoot: linkedRoot,
    canonicalProjectRoot: mainRoot,
    taskFileRoot: linkedRoot,
    declaredProjectPath: mainRoot,
    declaredWorktreeRoot: linkedRoot,
    declaredMainRepoRoot: mainRoot
  });
});

test('reports stale-parent-binding when a task crosses a nested Git root', async () => {
  const projectRoot = path.join(tempRoot, 'project-alpha');
  await writeCurrentTaskAtomic(tempRoot, validTask(tempRoot));
  await initGitRepo(projectRoot);

  const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

  expect(check.status).toBe('stale-parent-binding');
  await expect(resolveCurrentTaskFromCwd(projectRoot)).resolves.toBeNull();
});

test('reports task-root-mismatch when the file owner differs from worktreeRoot', async () => {
  const projectRoot = path.join(tempRoot, 'project-alpha');
  await initGitRepo(projectRoot);
  await writeCurrentTaskAtomic(projectRoot, {
    ...validTask(projectRoot),
    worktreeRoot: path.join(tempRoot, 'other')
  });

  const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

  expect(check.status).toBe('task-root-mismatch');
});

test('reports project-root-mismatch for a linked task with a false canonical project', async () => {
  const mainRoot = path.join(tempRoot, 'hooks-main');
  const linkedRoot = path.join(tempRoot, 'hooks-linked');
  await initGitRepo(mainRoot);
  await addLinkedWorktree(mainRoot, linkedRoot);
  await writeCurrentTaskAtomic(linkedRoot, {
    ...validTask(linkedRoot),
    projectPath: linkedRoot,
    mainRepoRoot: linkedRoot
  });

  const check = await inspectCurrentTaskBindingFromCwd(linkedRoot);

  expect(check.status).toBe('project-root-mismatch');
  expect(check.canonicalProjectRoot).toBe(mainRoot);
});
```

- [ ] **Step 4: Verify RED**

Run:

```powershell
npx vitest run tests/git-state.test.ts tests/current-task.test.ts
```

Expected: FAIL because `readGitTopology`,
`inspectCurrentTaskBindingFromCwd`, the new public types and strict resolution do
not exist.

- [ ] **Step 5: Add public types**

Append to `src/types.ts`:

```ts
export interface GitTopology {
  worktreeRoot: string;
  commonDir: string;
  mainRepoRoot: string | null;
}

export type TaskBindingStatus =
  | 'matched'
  | 'missing'
  | 'stale-parent-binding'
  | 'git-topology-unavailable'
  | 'task-root-mismatch'
  | 'git-root-mismatch'
  | 'project-root-mismatch';

export interface TaskBindingCheck {
  schema: 'ccpanes.task-binding-check.v1';
  status: TaskBindingStatus;
  reason: string;
  cwd: string;
  gitRoot: string | null;
  gitCommonDir: string | null;
  canonicalProjectRoot: string | null;
  taskPath: string | null;
  taskFileRoot: string | null;
  declaredProjectPath: string | null;
  declaredWorktreeRoot: string | null;
  declaredMainRepoRoot: string | null;
  taskId: string | null;
}
```

## Task 3: Implement the Git topology provider

**Files:**

- Modify: `src/git-state.ts`
- Test: `tests/git-state.test.ts`

- [ ] **Step 1: Export the topology reader**

Implement in `src/git-state.ts`:

```ts
import path from 'node:path';
import type { GitState, GitTopology } from './types.js';

export function readGitTopology(cwd: string): GitTopology | null {
  const worktreeRoot = git(['rev-parse', '--show-toplevel'], cwd);
  const commonDir = git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    cwd
  );
  if (!worktreeRoot || !commonDir) return null;

  const resolvedWorktreeRoot = path.resolve(worktreeRoot);
  const resolvedCommonDir = path.resolve(commonDir);
  if (path.basename(resolvedCommonDir).toLowerCase() !== '.git') return null;

  return {
    worktreeRoot: resolvedWorktreeRoot,
    commonDir: resolvedCommonDir,
    mainRepoRoot: path.dirname(resolvedCommonDir)
  };
}
```

Update `readGitState()` to use `readGitTopology(cwd)?.worktreeRoot ?? null` as its
root provider. Do not duplicate the `--show-toplevel` rule.

- [ ] **Step 2: Verify GREEN**

Run:

```powershell
npx vitest run tests/git-state.test.ts
```

Expected: all topology tests pass.

- [ ] **Step 3: Run existing Git-state consumers**

Run:

```powershell
npx vitest run tests/resume-probe.test.ts tests/acceptance.test.ts
```

Expected: existing behavior remains green.

## Task 4: Implement the canonical task factory and strict resolver

**Files:**

- Modify: `src/current-task.ts`
- Test: `tests/current-task.test.ts`

- [ ] **Step 1: Add factory tests and verify RED**

```ts
test('creates linked-worktree metadata with a canonical project root', async () => {
  const mainRoot = path.join(tempRoot, 'hooks-main');
  const linkedRoot = path.join(tempRoot, 'hooks-linked');
  await initGitRepo(mainRoot);
  await addLinkedWorktree(mainRoot, linkedRoot);

  const task = createCurrentTask({
    root: linkedRoot,
    taskId: 'phase51',
    phase: 'shape',
    now: '2026-08-10T00:00:00.000Z'
  });

  expect(task.projectPath).toBe(mainRoot);
  expect(task.mainRepoRoot).toBe(mainRoot);
  expect(task.worktreeRoot).toBe(linkedRoot);
  expect(task.branch).toBe('phase51-linked');
  expect(task.head).toBe(git(['rev-parse', 'HEAD'], linkedRoot));
});

test('creates non-Git metadata without inventing a main repo', () => {
  const task = createCurrentTask({
    root: tempRoot,
    taskId: 'phase51',
    phase: 'shape',
    now: '2026-08-10T00:00:00.000Z'
  });

  expect(task.projectPath).toBe(tempRoot);
  expect(task.worktreeRoot).toBe(tempRoot);
  expect(task.mainRepoRoot).toBeNull();
});
```

Run:

```powershell
npx vitest run tests/current-task.test.ts -t "creates linked-worktree|creates non-Git"
```

Expected: FAIL because `createCurrentTask` does not exist.

- [ ] **Step 2: Add the topology-aware factory**

```ts
export interface CreateCurrentTaskInput {
  root: string;
  taskId: string;
  phase: TaskPhase;
  workspace?: string | null;
  owner?: TaskOwner | null;
  source?: CurrentTask['source'] | null;
  notes?: string | null;
  now?: string | null;
}

export function createCurrentTask(input: CreateCurrentTaskInput): CurrentTask {
  const requestedRoot = path.resolve(input.root);
  const topology = readGitTopology(requestedRoot);
  const gitState = readGitState(requestedRoot);
  const worktreeRoot = topology?.worktreeRoot ?? requestedRoot;
  const projectPath = topology?.mainRepoRoot ?? worktreeRoot;
  const now = input.now ?? new Date().toISOString();

  return validateCurrentTask({
    schema: 'ccpanes.task-selection.v1',
    taskId: input.taskId,
    workspace: input.workspace ?? 'cc-pane',
    projectPath,
    worktreeRoot,
    mainRepoRoot: topology?.mainRepoRoot ?? null,
    branch: gitState.branch,
    head: gitState.head,
    owner: input.owner ?? {
      leaderSessionId: null,
      paneId: null,
      layoutId: null
    },
    phase: input.phase,
    createdAt: now,
    updatedAt: now,
    source: input.source ?? 'manual-import',
    notes: input.notes ?? 'task binding written by CC-Panes hooks'
  });
}
```

- [ ] **Step 3: Add bounded discovery helpers**

Implement one internal candidate type:

```ts
interface TaskCandidate extends ResolvedCurrentTask {}
```

Add:

```ts
async function findTaskAtOrAbove(
  start: string,
  inclusiveStop: string | null
): Promise<TaskCandidate | null> {
  let current = path.resolve(start);
  const stop = inclusiveStop ? normalizeForComparison(inclusiveStop) : null;
  for (;;) {
    const task = await readCurrentTask(current);
    if (task) {
      return {
        task,
        taskPath: currentTaskPath(current),
        projectRoot: current
      };
    }
    if (stop && normalizeForComparison(current) === stop) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
```

For Git cwd:

1. search from cwd through `topology.worktreeRoot`;
2. if absent, search from `dirname(topology.worktreeRoot)` upward only for stale
   parent diagnosis;
3. never return the stale candidate as the resolved task.

For non-Git cwd, use unbounded nearest-ancestor discovery.

- [ ] **Step 4: Validate the candidate in invariant order**

Use this order so each mismatch has one cause:

```ts
taskFileRoot !== declaredWorktreeRoot
  -> task-root-mismatch

gitRoot !== declaredWorktreeRoot
  -> git-root-mismatch

declaredProjectPath !== canonicalProjectRoot
  -> project-root-mismatch

declaredMainRepoRoot !== null &&
declaredMainRepoRoot !== canonicalProjectRoot
  -> project-root-mismatch
```

For non-Git candidates:

```ts
taskFileRoot === declaredWorktreeRoot
declaredProjectPath === declaredWorktreeRoot
declaredMainRepoRoot === null
```

Build every `TaskBindingCheck` from one helper so diagnostics always include the
same fields.

- [ ] **Step 5: Make resolution depend on `matched`**

Use a private detailed inspector returning both check and candidate. Public APIs:

```ts
export async function inspectCurrentTaskBindingFromCwd(
  cwd: string
): Promise<TaskBindingCheck>;

export async function resolveCurrentTaskFromCwd(
  cwd: string
): Promise<ResolvedCurrentTask | null>;
```

`resolveCurrentTaskFromCwd()` returns the candidate only when
`check.status === 'matched'`.

- [ ] **Step 6: Verify GREEN**

Run:

```powershell
npx vitest run tests/current-task.test.ts
```

Expected: all current-task tests pass.

- [ ] **Step 7: Run direct current-task consumers**

Run:

```powershell
npx vitest run `
  tests/workspace-scan.test.ts `
  tests/resume-probe.test.ts `
  tests/project-bootstrap.test.ts
```

Expected: all suites pass or expose a fixture that still encodes the old
`projectPath === worktreeRoot` assumption. Update only fixtures that represent a
linked worktree; main-worktree and non-Git fixtures may remain equal.

## Task 5: Make both task writers use the canonical factory

**Files:**

- Modify: `src/cli.ts`
- Modify: `src/project-bootstrap.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/project-bootstrap.test.ts`

- [ ] **Step 1: Add failing writer tests**

For `write-current`, initialize a main repo plus linked worktree and assert:

```ts
expect(written.projectPath).toBe(mainRoot);
expect(written.mainRepoRoot).toBe(mainRoot);
expect(written.worktreeRoot).toBe(linkedRoot);
expect(written.branch).toBe('phase51-linked');
expect(written.head).toBe(git(['rev-parse', 'HEAD'], linkedRoot));
expect(written.notes).toBe('task binding written by CC-Panes hooks');
expect(written.notes).not.toContain('synthetic fixture');
```

Add equivalent bootstrap assertions.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/cli.test.ts -t "writes current-task"
npx vitest run tests/project-bootstrap.test.ts
```

Expected: linked-worktree metadata assertions fail because both writers still
construct task JSON independently.

- [ ] **Step 3: Remove duplicate factories**

In `src/cli.ts`:

- import `createCurrentTask`;
- delete local `makeTask()`;
- use `createCurrentTask()` for `write-current`;
- keep explicit `notes: 'synthetic dry-run task'` only for `dry-run-hook`;
- do not add `--project-path` or `--main-repo-root` overrides.

Create the task with:

```ts
const task = createCurrentTask({
  root,
  taskId,
  phase,
  workspace: valueAfter(args, '--workspace'),
  owner: {
    leaderSessionId: valueAfter(args, '--leader-session-id'),
    paneId: null,
    layoutId: null
  },
  source: valueAfter(args, '--leader-session-id') ? 'leader' : 'manual-import',
  notes: valueAfter(args, '--notes')
});
```

In `src/project-bootstrap.ts`, delete its private factory and call
`createCurrentTask()` with the existing bootstrap inputs.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/cli.test.ts -t "writes current-task"
npx vitest run tests/project-bootstrap.test.ts
```

Expected: both suites pass.

## Task 6: Add mismatch-safe hook behavior

**Files:**

- Modify: `src/hook-runner.ts`
- Modify: `tests/hook-runner.test.ts`

- [ ] **Step 1: Write failing read/write tests**

```ts
test('blocks writes when task binding scope is mismatched', () => {
  const result = runHookEventWithTaskBindingMismatch(
    task(),
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'D:/TARGET/src/a.ts' }
    },
    'project-root-mismatch'
  );

  expect(result.allowed).toBe(false);
  expect(result.dryRun.decisions[0].reason)
    .toBe('task_binding_scope_mismatch:project-root-mismatch');
});

test('does not grant a mismatched candidate authority over reads', () => {
  const result = runHookEventWithTaskBindingMismatch(
    task(),
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'D:/TARGET/README.md' }
    },
    'stale-parent-binding'
  );

  expect(result.allowed).toBe(true);
  expect(result.dryRun.decisions[0].reason).toBe('non_write_call');
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/hook-runner.test.ts
```

Expected: FAIL because mismatch runner behavior does not exist.

- [ ] **Step 3: Implement one mismatch path**

Add `runHookEventWithTaskBindingMismatch()` using the existing event adapter and
batch/result builders. Force every write call to:

```ts
policyEffect: undefined,
policyReason: `task_binding_scope_mismatch:${status}`
```

Task-binding mismatch is an independent fail-closed sentinel: a mismatch reason
without `policyEffect` is blocked by the hook dry-run owner before project policy
evaluation. It does not impersonate a project-owned block rule.

Do not persist task-scoped audit from this helper.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/hook-runner.test.ts
```

Expected: all hook-runner tests pass.

## Task 7: Expose lifecycle diagnostics

**Files:**

- Modify: `src/session-lifecycle.ts`
- Modify: `tests/session-lifecycle.test.ts`

- [ ] **Step 1: Add failing SessionStart and Stop tests**

```ts
test('shows canonical and active roots for a project-root mismatch', () => {
  const output = createTaskBindingMismatchSessionStartOutput(bindingCheck());
  const context = output.hookSpecificOutput.additionalContext;

  expect(context).toContain('taskBindingStatus: project-root-mismatch');
  expect(context).toContain('canonicalProjectRoot: D:/hooks-main');
  expect(context).toContain('declaredWorktreeRoot: D:/hooks-linked');
});

test('asks Stop to verify the binding before more writes', () => {
  const output = createTaskBindingMismatchStopOutput(bindingCheck());

  expect(output.continue).toBe(true);
  expect(output.systemMessage).toContain('verify-task-binding');
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/session-lifecycle.test.ts
```

Expected: mismatch lifecycle helpers are absent.

- [ ] **Step 3: Implement compact output**

SessionStart context must include:

```text
taskBindingStatus
reason
cwd
gitRoot
canonicalProjectRoot
candidateTaskId
taskPath
declaredProjectPath
declaredWorktreeRoot
declaredMainRepoRoot
```

Stop output must name `verify-task-binding --cwd "<cwd>"`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run tests/session-lifecycle.test.ts
```

Expected: all lifecycle tests pass.

## Task 8: Add `verify-task-binding` and wire dynamic consumers

**Files:**

- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add failing command tests**

Cover:

1. matched main worktree;
2. matched linked worktree with canonical project;
3. stale parent;
4. false linked-worktree `projectPath`;
5. dynamic write denial;
6. no candidate-task audit for mismatch;
7. SessionStart mismatch context.

Matched linked-worktree assertion:

```ts
expect(parsed).toMatchObject({
  schema: 'ccpanes.task-binding-check.v1',
  status: 'matched',
  gitRoot: linkedRoot,
  canonicalProjectRoot: mainRoot,
  taskFileRoot: linkedRoot,
  declaredProjectPath: mainRoot,
  declaredWorktreeRoot: linkedRoot,
  declaredMainRepoRoot: mainRoot
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run tests/cli.test.ts -t "task binding|task-binding|stale parent|linked worktree"
```

Expected: FAIL because command routing and mismatch-aware consumers are absent.

- [ ] **Step 3: Add command routing**

```ts
if (command === 'verify-task-binding') {
  const cwd = valueAfter(args, '--cwd') ?? process.cwd();
  const check = await inspectCurrentTaskBindingFromCwd(cwd);
  return `${JSON.stringify(check, null, 2)}\n`;
}
```

- [ ] **Step 4: Route every dynamic consumer through one check**

| Status | hook/permission | session/stop | post/plan intake |
|---|---|---|---|
| `matched` | existing task flow | existing output | existing audit |
| `missing` | no-op | no-op | no-op |
| mismatch | block writes, reads no-op | mismatch context | no-op |

Do not call `resolveCurrentTaskFromCwd()` independently after inspection. Use one
detailed inspection result per invocation to avoid a time-of-check/time-of-use
double lookup.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npx vitest run tests/cli.test.ts -t "task binding|task-binding|stale parent|linked worktree"
```

Expected: focused CLI tests pass.

- [ ] **Step 6: Run all direct consumers**

Run:

```powershell
npx vitest run `
  tests/current-task.test.ts `
  tests/git-state.test.ts `
  tests/hook-runner.test.ts `
  tests/session-lifecycle.test.ts `
  tests/cli.test.ts `
  tests/plan-intake.test.ts `
  tests/post-tool-audit.test.ts
```

Expected: all affected tests pass.

## Task 9: Add smoke coverage and effective documentation

**Files:**

- Modify: `scripts/smoke.mjs`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `PROJECT-DIRECTORY.md`

- [ ] **Step 1: Add smoke fixtures**

The smoke must:

1. create a temporary workspace-level task;
2. initialize a nested Git main worktree;
3. assert `stale-parent-binding`;
4. add a linked worktree;
5. write a topology-correct linked task;
6. assert `matched`, canonical main root and linked active root;
7. change only `projectPath` to the linked root;
8. assert `project-root-mismatch`.

Reuse the existing smoke process runner and assertion style.

- [ ] **Step 2: Update governing docs after code acceptance**

- README: binding verification runs before project policy.
- HANDOFF: add `verify-task-binding` to capability and gate lists.
- PROJECT-DIRECTORY: document `current-task.ts` as authority and
  `git-state.ts` as topology provider.
- State explicitly:
  `projectPath` is canonical project ownership; `worktreeRoot` is the active
  write boundary.

- [ ] **Step 3: Verify smoke and docs**

Run:

```powershell
npm run build
npm run smoke
git diff --check
```

Expected: build exits `0`, smoke prints `SMOKE_PASS`, diff check exits `0`.

## Task 10: Full verification and scope audit

**Files:**

- Inspect all Phase51 changed files.

- [ ] **Step 1: Run full gates**

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

Expected:

```text
npm test: all test files and tests pass
typecheck: exit 0
build: exit 0
smoke: SMOKE_PASS
git diff --check: exit 0
```

- [ ] **Step 2: Probe the real linked worktree**

```powershell
node dist/src/cli.js verify-task-binding `
  --cwd D:\cc-pane\.worktrees\hooks-phase51-task-binding
```

Expected subset:

```json
{
  "schema": "ccpanes.task-binding-check.v1",
  "status": "matched",
  "gitRoot": "D:\\cc-pane\\.worktrees\\hooks-phase51-task-binding",
  "canonicalProjectRoot": "D:\\cc-pane\\tool\\repos\\hooks",
  "taskFileRoot": "D:\\cc-pane\\.worktrees\\hooks-phase51-task-binding",
  "declaredProjectPath": "D:\\cc-pane\\tool\\repos\\hooks",
  "declaredWorktreeRoot": "D:\\cc-pane\\.worktrees\\hooks-phase51-task-binding",
  "declaredMainRepoRoot": "D:\\cc-pane\\tool\\repos\\hooks",
  "taskId": "hooks-phase51-task-binding-isolation"
}
```

- [ ] **Step 3: Inspect the Hooks task diff**

```powershell
git status --short --branch
git diff --stat
git diff --check
git diff
```

Expected: only Phase51 files inside the linked worktree. The ignored
`.ccpanes-task/current-task.json` is verified separately by hash and live probe.

- [ ] **Step 4: Verify the canonical main worktree remains clean**

```powershell
git -C D:\cc-pane\tool\repos\hooks status --short --branch
```

Expected: `main` remains clean and at the recorded baseline unless the user
separately changed it.

- [ ] **Step 5: Verify PaneForge preservation**

```powershell
git -C D:\cc-pane\.worktrees\paneforge-foundation status --short --branch
```

Expected: existing PaneForge fusion changes remain; no Hooks Phase51 file appears.

## Task 11: Review and integration boundary

- [ ] **Step 1: Present ADR, plan, diff and verification evidence**

No staging occurs before review.

- [ ] **Step 2: Stage only after explicit approval**

Stage only reviewed Phase51 tracked paths. Re-run:

```powershell
git diff --cached --check
git diff --cached --stat
git diff --cached
```

- [ ] **Step 3: Commit only when explicitly authorized**

Suggested message:

```text
Add topology-aware task binding verification
```

- [ ] **Step 4: Keep push and live rollout separate**

Push, live Hooks sync, installed-hook verification and release remain separately
authorized actions.

## Self-review

- Spec coverage: canonical project, active worktree, main worktree, stale parent,
  writer convergence, consumer behavior, diagnostics, smoke and rollout gates are
  covered.
- Placeholder scan: no TBD/TODO or undefined implementation step remains.
- Type consistency: `GitTopology`, `TaskBindingStatus`, `TaskBindingCheck`,
  `readGitTopology`, `createCurrentTask`,
  `inspectCurrentTaskBindingFromCwd` and
  `runHookEventWithTaskBindingMismatch` use one naming scheme.
- Final review closure: unknown Shell commands are write-capable by default;
  Git probe failures use `git-topology-unavailable`; task path fields require
  canonical absolute paths.
- Independent review closure: read-only Shell classification requires a complete
  simple command; workspace resume reuses the binding authority; mismatch uses a
  neutral gate identity; Git common-dir inference is checked against worktree
  inventory; the atomic writer enforces task-file ownership.
- Scope: Phase51 contains one concern—task-binding ownership and isolation.
  PaneForge donor/fusion work remains in its own project and task.
