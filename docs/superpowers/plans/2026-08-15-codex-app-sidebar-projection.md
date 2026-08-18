# Codex App Sidebar Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selected CLI-backed Codex threads discoverable in the native Codex App sidebar using official thread naming plus an explicit Codex App host pin action, with confirmation, audit, reconciliation, and rollback.

**Architecture:** The hooks CLI owns a pure sidebar-plan function and the App Server name adapter. The CLI starts `codex app-server --stdio`, uses JSONL request/response correlation, paginates `thread/list` for `cli` and `vscode` threads, falls back to `thread/read(includeTurns:false)` for explicitly selected or planned hidden threads, and applies `thread/name/set`. Plan creation combines the federation graph, read-only App Server metadata, and a typed Codex App host snapshot so readability, listing, current name, and previous pin state are observed rather than guessed. Pin/unpin remains a Codex App host action because the installed `codex-cli 0.147.0` schema exposes no pin field. A typed host receipt closes the loop and allows reconciliation and exact rollback.

**Tech Stack:** Node.js 22 `child_process`, `readline`, `crypto`, TypeScript, Vitest, official Codex App Server JSONL protocol, Codex App thread tools for host pinning.

**Dependency:** Complete and verify `2026-08-15-codex-ccpanes-session-federation-core.md` first.

**Authorization note:** Current authorization permits official name/pin metadata updates but excludes stage, commit, and push. The checkpoints below do not authorize Git commits.

---

## File Map

- Create `src/codex-app-server-client.ts`
  - own JSONL transport, initialize handshake, request correlation, timeout,
    shutdown, `thread/list`, and `thread/name/set`.
- Create `src/codex-sidebar.ts`
  - own host snapshot validation, explicit/default selection, digest, apply
    result, host receipt, reconciliation, and rollback.
- Modify `src/cli.ts`
  - wire `sidebar-plan`, `sidebar-apply`, `sidebar-reconcile`, and
    `sidebar-rollback-plan`.
- Create `tests/codex-app-server-client.test.ts`
  - use an injected fake transport; no live Codex writes.
- Create `tests/codex-sidebar.test.ts`
  - verify selection, digest, idempotency, receipt, reconciliation, rollback.
- Modify `tests/codex-session-cli.test.ts`
  - verify CLI arguments and atomic artifacts.
- Modify `docs/codex-session-bridge.md`
  - document two-adapter apply flow and rollback.

### Task 1: Freeze the Installed App Server Contract

**Files:**
- Create: `tests/codex-app-server-client.test.ts`
- Create: `src/codex-app-server-client.ts`

- [ ] **Step 1: Record protocol methods as tests**

Create `tests/codex-app-server-client.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  CodexAppServerClient,
  type AppServerTransport
} from '../src/codex-app-server-client.js';

class FakeTransport implements AppServerTransport {
  writes: unknown[] = [];
  private listener: ((value: unknown) => void) | null = null;

  onMessage(listener: (value: unknown) => void): void {
    this.listener = listener;
  }

  write(value: unknown): void {
    this.writes.push(value);
    const request = value as { id?: number; method?: string; params?: unknown };
    if (request.method === 'initialize') {
      this.listener?.({ id: request.id, result: { userAgent: 'fake' } });
    } else if (request.method === 'thread/list') {
      this.listener?.({
        id: request.id,
        result: {
          data: [{
            id: 'thread-cli',
            name: null,
            cwd: 'D:\\Repo',
            source: 'cli',
            preview: 'Run task',
            createdAt: 1,
            updatedAt: 2,
            recencyAt: 2,
            status: { type: 'notLoaded' },
            turns: [],
            sessionId: 'session-tree',
            cliVersion: '0.147.0',
            modelProvider: 'openai',
            ephemeral: false
          }],
          nextCursor: null
        }
      });
    } else if (request.method === 'thread/name/set') {
      this.listener?.({ id: request.id, result: {} });
    }
  }

  async close(): Promise<void> {}
}

test('initializes once and lists CLI plus App threads', async () => {
  const transport = new FakeTransport();
  const client = new CodexAppServerClient(transport, 1_000);

  await client.initialize();
  const threads = await client.listAllThreads({
    cwd: ['D:\\Repo'],
    sourceKinds: ['cli', 'vscode'],
    archived: false,
    limit: 100,
    useStateDbOnly: true
  });

  expect(threads[0]).toMatchObject({
    id: 'thread-cli',
    source: 'cli'
  });
  expect(transport.writes).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'initialize' }),
    { method: 'initialized' },
    expect.objectContaining({
      method: 'thread/list',
      params: expect.objectContaining({
        sourceKinds: ['cli', 'vscode']
      })
    })
  ]));
});

test('sets a thread name through thread/name/set', async () => {
  const transport = new FakeTransport();
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  await client.setThreadName('thread-cli', '[CC-Panes] Run task');

  expect(transport.writes).toContainEqual(expect.objectContaining({
    method: 'thread/name/set',
    params: {
      threadId: 'thread-cli',
      name: '[CC-Panes] Run task'
    }
  }));
});
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
npx vitest run tests/codex-app-server-client.test.ts
```

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the protocol client**

Create `src/codex-app-server-client.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

export interface AppServerTransport {
  onMessage(listener: (value: unknown) => void): void;
  write(value: unknown): void;
  close(): Promise<void>;
}

export interface AppServerThread {
  id: string;
  name: string | null;
  cwd: string;
  source: unknown;
  preview: string;
  updatedAt: number;
  recencyAt: number | null;
}

export interface ThreadListParams {
  cwd?: string[];
  sourceKinds?: Array<'cli' | 'vscode'>;
  archived?: boolean;
  limit?: number;
  useStateDbOnly?: boolean;
  cursor?: string | null;
}

export interface ThreadListPage {
  data: AppServerThread[];
  nextCursor: string | null;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid App Server response: ${label}`);
  }
  return value as Record<string, unknown>;
}

export class CodexAppServerClient {
  private nextId = 1;
  private initialized = false;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  constructor(
    private readonly transport: AppServerTransport,
    private readonly timeoutMs = 10_000
  ) {
    transport.onMessage((value) => this.handleMessage(value));
  }

  private handleMessage(value: unknown): void {
    const message = object(value, 'message');
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(
        `App Server request failed: ${JSON.stringify(message.error)}`
      ));
    } else {
      pending.resolve(message.result);
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App Server timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.write({ id, method, params });
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.request('initialize', {
      clientInfo: {
        name: 'hooks-session-federation',
        title: 'Hooks Session Federation',
        version: '0.1.0'
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.transport.write({ method: 'initialized' });
    this.initialized = true;
  }

  async listThreads(params: ThreadListParams): Promise<ThreadListPage> {
    const result = object(
      await this.request('thread/list', params),
      'thread/list result'
    );
    if (!Array.isArray(result.data)) {
      throw new Error('invalid App Server response: thread/list data');
    }
    const data = result.data.map((entry, index) => {
      const thread = object(entry, `thread/list data[${index}]`);
      if (typeof thread.id !== 'string' ||
          typeof thread.cwd !== 'string' ||
          typeof thread.preview !== 'string' ||
          typeof thread.updatedAt !== 'number') {
        throw new Error(`invalid App Server response: thread ${index}`);
      }
      return {
        id: thread.id,
        name: typeof thread.name === 'string' ? thread.name : null,
        cwd: thread.cwd,
        source: thread.source,
        preview: thread.preview,
        updatedAt: thread.updatedAt,
        recencyAt: typeof thread.recencyAt === 'number'
          ? thread.recencyAt
          : null
      };
    });
    return {
      data,
      nextCursor: typeof result.nextCursor === 'string'
        ? result.nextCursor
        : null
    };
  }

  async listAllThreads(params: ThreadListParams): Promise<AppServerThread[]> {
    const threads: AppServerThread[] = [];
    let cursor: string | null = params.cursor ?? null;
    do {
      const page = await this.listThreads({ ...params, cursor });
      threads.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return threads;
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    if (!threadId.trim()) throw new Error('threadId must be non-empty');
    if (!name.trim()) throw new Error('thread name must be non-empty');
    await this.request('thread/name/set', { threadId, name });
  }

  async close(): Promise<void> {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`App Server closed with pending request ${id}`));
    }
    this.pending.clear();
    await this.transport.close();
  }
}

class ChildTransport implements AppServerTransport {
  private listener: ((value: unknown) => void) | null = null;
  private readonly lines: readline.Interface;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        this.listener?.(JSON.parse(line));
      } catch {
        // stderr and malformed stdout are handled by process-close diagnostics.
      }
    });
  }

  onMessage(listener: (value: unknown) => void): void {
    this.listener = listener;
  }

  write(value: unknown): void {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  async close(): Promise<void> {
    this.lines.close();
    this.child.stdin.end();
    if (this.child.exitCode === null) {
      this.child.kill();
    }
  }
}

export function spawnCodexAppServer(
  codexCommand = 'codex'
): AppServerTransport {
  const child = spawn(
    codexCommand,
    ['app-server', '--stdio'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  );
  return new ChildTransport(child);
}
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npx vitest run tests/codex-app-server-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 2: Build a Confirmable Sidebar Plan

**Files:**
- Create: `src/codex-sidebar.ts`
- Create: `tests/codex-sidebar.test.ts`

- [ ] **Step 1: Write failing plan-selection and digest tests**

Create `tests/codex-sidebar.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  createSidebarPlan,
  digestSidebarPlan
} from '../src/codex-sidebar.js';

test('selects active user CLI threads absent from the App sidebar snapshot', () => {
  const plan = createSidebarPlan({
    project: 'D:\\Repo',
    generatedAt: '2026-08-15T09:00:00.000Z',
    candidates: [{
      threadId: 'cli-hidden',
      source: 'codex-cli',
      threadSource: 'user',
      storageState: 'active',
      projectRelation: 'owned',
      appReadable: true,
      listed: false,
      linkedLiveOrRecentLaunch: true,
      explicitlySelected: false,
      currentName: null,
      currentPinned: false,
      renameCustomized: false,
      originalTitle: 'Run task'
    }, {
      threadId: 'app-listed',
      source: 'codex-app',
      threadSource: 'user',
      storageState: 'active',
      projectRelation: 'owned',
      appReadable: true,
      listed: true,
      linkedLiveOrRecentLaunch: true,
      explicitlySelected: false,
      currentName: 'Visible',
      currentPinned: true,
      renameCustomized: false,
      originalTitle: 'Visible'
    }]
  });

  expect(plan.actions).toEqual([{
    threadId: 'cli-hidden',
    currentName: null,
    desiredName: '[CC-Panes] Run task',
    currentPinned: false,
    desiredPinned: true,
    nameAdapter: 'app-server',
    pinAdapter: 'codex-app-host',
    reason: 'live/recent project CLI thread is readable but hidden'
  }]);
  expect(plan.digest).toBe(digestSidebarPlan({
    ...plan,
    digest: ''
  }));
});
```

- [ ] **Step 2: Run the test**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement stable plan serialization**

Create `src/codex-sidebar.ts`:

```ts
import { createHash } from 'node:crypto';

export interface SidebarCandidate {
  threadId: string;
  source: 'codex-app' | 'codex-cli' | 'unknown';
  threadSource: 'user' | 'subagent' | 'automation' | 'unknown';
  storageState: 'active' | 'archived' | 'missing';
  projectRelation: 'owned' | 'supporting' | 'mentioned' | 'ambient' | 'unrelated' | 'unknown';
  appReadable: boolean;
  listed: boolean;
  linkedLiveOrRecentLaunch: boolean;
  explicitlySelected: boolean;
  currentName: string | null;
  currentPinned: boolean | null;
  renameCustomized: boolean;
  originalTitle: string;
}

export interface SidebarAction {
  threadId: string;
  currentName: string | null;
  desiredName: string;
  currentPinned: boolean | null;
  desiredPinned: true;
  nameAdapter: 'app-server';
  pinAdapter: 'codex-app-host';
  reason: string;
}

export interface SidebarPlan {
  schemaVersion: 'hooks.codex-sidebar-plan/v1';
  generatedAt: string;
  project: string;
  actions: SidebarAction[];
  digest: string;
}

function boundedName(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim() || 'Codex CLI thread';
  return `[CC-Panes] ${normalized}`.slice(0, 120);
}

export function digestSidebarPlan(
  plan: Omit<SidebarPlan, 'digest'> | SidebarPlan
): string {
  const canonical = {
    schemaVersion: plan.schemaVersion,
    generatedAt: plan.generatedAt,
    project: plan.project,
    actions: [...plan.actions].sort((a, b) =>
      a.threadId.localeCompare(b.threadId)
    )
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

export function createSidebarPlan(input: {
  project: string;
  generatedAt?: string;
  candidates: SidebarCandidate[];
}): SidebarPlan {
  const actions = input.candidates
    .filter((candidate) =>
      candidate.source === 'codex-cli' &&
      candidate.threadSource === 'user' &&
      candidate.storageState === 'active' &&
      (candidate.projectRelation === 'owned' ||
        candidate.projectRelation === 'supporting') &&
      candidate.appReadable &&
      !candidate.listed &&
      (candidate.linkedLiveOrRecentLaunch || candidate.explicitlySelected)
    )
    .map((candidate): SidebarAction => ({
      threadId: candidate.threadId,
      currentName: candidate.currentName,
      desiredName: candidate.currentName && !candidate.renameCustomized
        ? candidate.currentName
        : boundedName(candidate.originalTitle),
      currentPinned: candidate.currentPinned,
      desiredPinned: true,
      nameAdapter: 'app-server',
      pinAdapter: 'codex-app-host',
      reason: candidate.explicitlySelected
        ? 'explicitly selected active project CLI thread is readable but hidden'
        : 'live/recent project CLI thread is readable but hidden'
    }))
    .sort((a, b) => a.threadId.localeCompare(b.threadId));

  const withoutDigest = {
    schemaVersion: 'hooks.codex-sidebar-plan/v1' as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    project: input.project,
    actions
  };
  return {
    ...withoutDigest,
    digest: digestSidebarPlan(withoutDigest)
  };
}
```

- [ ] **Step 4: Run the test**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 3: Apply Names Idempotently and Emit Pending Pin Actions

**Files:**
- Modify: `src/codex-sidebar.ts`
- Modify: `tests/codex-sidebar.test.ts`

- [ ] **Step 1: Write failing apply and unknown-outcome tests**

Add to `tests/codex-sidebar.test.ts`:

```ts
import { applySidebarPlan } from '../src/codex-sidebar.js';

test('applies changed names and emits pending host pin actions', async () => {
  const calls: Array<[string, string]> = [];
  const result = await applySidebarPlan({
    plan: {
      schemaVersion: 'hooks.codex-sidebar-plan/v1',
      generatedAt: '2026-08-15T09:00:00.000Z',
      project: 'D:\\Repo',
      actions: [{
        threadId: 'cli-hidden',
        currentName: null,
        desiredName: '[CC-Panes] Run task',
        currentPinned: false,
        desiredPinned: true,
        nameAdapter: 'app-server',
        pinAdapter: 'codex-app-host',
        reason: 'live/recent project CLI thread is readable but hidden'
      }],
      digest: 'digest'
    },
    confirmDigest: 'digest',
    currentNames: new Map([['cli-hidden', null]]),
    setName: async (threadId, name) => {
      calls.push([threadId, name]);
    },
    readName: async () => '[CC-Panes] Run task'
  });

  expect(calls).toEqual([['cli-hidden', '[CC-Panes] Run task']]);
  expect(result.pendingHostActions).toEqual([{
    action: 'set-pinned',
    threadId: 'cli-hidden',
    pinned: true,
    previousPinned: false
  }]);
  expect(result.entries[0]?.status).toBe('name-applied');
});

test('rejects a mismatched confirmation digest before writes', async () => {
  await expect(applySidebarPlan({
    plan: {
      schemaVersion: 'hooks.codex-sidebar-plan/v1',
      generatedAt: '2026-08-15T09:00:00.000Z',
      project: 'D:\\Repo',
      actions: [],
      digest: 'expected'
    },
    confirmDigest: 'wrong',
    currentNames: new Map(),
    setName: async () => {},
    readName: async () => null
  })).rejects.toThrow('confirmation digest mismatch');
});
```

- [ ] **Step 2: Run the test**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: FAIL because `applySidebarPlan` is absent.

- [ ] **Step 3: Implement apply and reconciliation-by-read**

Add to `src/codex-sidebar.ts`:

```ts
export interface SidebarApplyEntry {
  threadId: string;
  previousName: string | null;
  previousPinned: boolean | null;
  desiredName: string;
  finalName: string | null;
  status: 'unchanged' | 'name-applied' | 'thread-missing' | 'conflict' | 'failed';
  error: string | null;
}

export interface SidebarApplyResult {
  schemaVersion: 'hooks.codex-sidebar-apply/v1';
  generatedAt: string;
  planDigest: string;
  entries: SidebarApplyEntry[];
  pendingHostActions: Array<{
    action: 'set-pinned';
    threadId: string;
    pinned: true;
    previousPinned: boolean | null;
  }>;
}

export async function applySidebarPlan(input: {
  plan: SidebarPlan;
  confirmDigest: string;
  currentNames: Map<string, string | null>;
  setName: (threadId: string, name: string) => Promise<void>;
  readName: (threadId: string) => Promise<string | null>;
}): Promise<SidebarApplyResult> {
  const recomputedDigest = digestSidebarPlan({
    ...input.plan,
    digest: ''
  });
  if (recomputedDigest !== input.plan.digest ||
      input.plan.digest !== input.confirmDigest) {
    throw new Error('confirmation digest mismatch');
  }

  const entries: SidebarApplyEntry[] = [];
  for (const action of input.plan.actions) {
    const current = input.currentNames.get(action.threadId);
    if (current === undefined && !input.currentNames.has(action.threadId)) {
      entries.push({
        threadId: action.threadId,
        previousName: null,
        previousPinned: action.currentPinned,
        desiredName: action.desiredName,
        finalName: null,
        status: 'thread-missing',
        error: 'thread absent from App Server list'
      });
      continue;
    }
    if (current !== action.currentName && current !== action.desiredName) {
      entries.push({
        threadId: action.threadId,
        previousName: current ?? null,
        previousPinned: action.currentPinned,
        desiredName: action.desiredName,
        finalName: current ?? null,
        status: 'conflict',
        error: 'thread name changed after plan confirmation'
      });
      continue;
    }
    if (current === action.desiredName) {
      entries.push({
        threadId: action.threadId,
        previousName: current,
        previousPinned: action.currentPinned,
        desiredName: action.desiredName,
        finalName: current,
        status: 'unchanged',
        error: null
      });
      continue;
    }
    try {
      await input.setName(action.threadId, action.desiredName);
      const finalName = await input.readName(action.threadId);
      entries.push({
        threadId: action.threadId,
        previousName: current ?? null,
        previousPinned: action.currentPinned,
        desiredName: action.desiredName,
        finalName,
        status: finalName === action.desiredName ? 'name-applied' : 'conflict',
        error: finalName === action.desiredName
          ? null
          : 'name verification mismatch'
      });
    } catch (error) {
      const finalName = await input.readName(action.threadId).catch(() => null);
      entries.push({
        threadId: action.threadId,
        previousName: current ?? null,
        previousPinned: action.currentPinned,
        desiredName: action.desiredName,
        finalName,
        status: finalName === action.desiredName ? 'name-applied' : 'failed',
        error: finalName === action.desiredName
          ? null
          : error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    schemaVersion: 'hooks.codex-sidebar-apply/v1',
    generatedAt: new Date().toISOString(),
    planDigest: input.plan.digest,
    entries,
    pendingHostActions: entries
      .filter((entry) =>
        entry.status === 'unchanged' || entry.status === 'name-applied'
      )
      .map((entry) => ({
        action: 'set-pinned',
        threadId: entry.threadId,
        pinned: true,
        previousPinned: entry.previousPinned
      }))
  };
}
```

- [ ] **Step 4: Run sidebar tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 4: Validate Host Receipts, Reconcile Visibility, and Build Rollback

**Files:**
- Modify: `src/codex-sidebar.ts`
- Modify: `tests/codex-sidebar.test.ts`

- [ ] **Step 1: Write failing receipt and rollback tests**

Add:

```ts
import {
  createSidebarReconciliation,
  createSidebarRollbackPlan,
  validateSidebarHostReceipt
} from '../src/codex-sidebar.js';

test('reconciles a pinned thread that appears in the App sidebar', () => {
  const receipt = validateSidebarHostReceipt({
    schemaVersion: 'hooks.codex-sidebar-host-receipt/v1',
    generatedAt: '2026-08-15T09:05:00.000Z',
    planDigest: 'digest',
    entries: [{
      threadId: 'cli-hidden',
      pinned: true,
      status: 'applied',
      error: null
    }]
  });

  const result = createSidebarReconciliation({
    planDigest: 'digest',
    receipt,
    listedThreadIds: ['cli-hidden']
  });

  expect(result.entries[0]).toMatchObject({
    threadId: 'cli-hidden',
    status: 'visible'
  });
});

test('creates rollback actions from captured name and pin state', () => {
  expect(createSidebarRollbackPlan({
    planDigest: 'digest',
    entries: [{
      threadId: 'cli-hidden',
      previousName: null,
      previousPinned: false
    }]
  }).actions).toEqual([{
    threadId: 'cli-hidden',
    restoreName: null,
    restorePinned: false
  }]);
});
```

- [ ] **Step 2: Run the test**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: FAIL because receipt/reconciliation/rollback APIs are absent.

- [ ] **Step 3: Implement strict receipt and reconciliation contracts**

Add contracts:

```ts
export interface CodexAppSidebarSnapshot {
  schemaVersion: 'hooks.codex-app-sidebar-snapshot/v1';
  generatedAt: string;
  threads: Array<{
    threadId: string;
    listed: boolean;
    readable: boolean;
    pinned: boolean | null;
  }>;
}

export interface SidebarHostReceipt {
  schemaVersion: 'hooks.codex-sidebar-host-receipt/v1';
  generatedAt: string;
  planDigest: string;
  entries: Array<{
    threadId: string;
    pinned: boolean;
    status: 'applied' | 'failed';
    error: string | null;
  }>;
}

export function validateSidebarHostReceipt(value: unknown): SidebarHostReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid sidebar host receipt: root');
  }
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 'hooks.codex-sidebar-host-receipt/v1') {
    throw new Error('invalid sidebar host receipt: schemaVersion');
  }
  if (typeof root.planDigest !== 'string' || !root.planDigest) {
    throw new Error('invalid sidebar host receipt: planDigest');
  }
  if (!Array.isArray(root.entries)) {
    throw new Error('invalid sidebar host receipt: entries');
  }
  return {
    schemaVersion: 'hooks.codex-sidebar-host-receipt/v1',
    generatedAt: String(root.generatedAt),
    planDigest: root.planDigest,
    entries: root.entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`invalid sidebar host receipt: entries[${index}]`);
      }
      const item = entry as Record<string, unknown>;
      if (typeof item.threadId !== 'string' || !item.threadId) {
        throw new Error(`invalid sidebar host receipt: entries[${index}].threadId`);
      }
      if (typeof item.pinned !== 'boolean') {
        throw new Error(`invalid sidebar host receipt: entries[${index}].pinned`);
      }
      if (item.status !== 'applied' && item.status !== 'failed') {
        throw new Error(`invalid sidebar host receipt: entries[${index}].status`);
      }
      return {
        threadId: item.threadId,
        pinned: item.pinned,
        status: item.status,
        error: typeof item.error === 'string' ? item.error : null
      };
    })
  };
}
```

Implement `validateCodexAppSidebarSnapshot` with the same strict object/array
guards as `validateSidebarHostReceipt`: require a parseable ISO timestamp,
non-empty unique `threadId` values, boolean `listed`/`readable`, and
boolean-or-null `pinned`. Also validate `generatedAt` in
`validateSidebarHostReceipt` rather than coercing it with `String(...)`.

Implement `createSidebarReconciliation` with:

- plan/receipt digest equality check;
- `visible` only when host status is `applied`, pinned is true, and the thread
  exists in the fresh sidebar list;
- `not-visible`, `host-failed`, and `digest-mismatch` typed states.

Implement `createSidebarRollbackPlan` as a pure mapping from the apply result's
captured `previousName` and `previousPinned` values. Name restoration remains
App Server work; pin restoration remains a host action. The rollback CLI reads
the original plan, apply audit, and successful host receipt; it rejects digest
mismatches and never derives previous pin state from whether a thread happened
to be listed.

- [ ] **Step 4: Run sidebar tests**

Run:

```powershell
npx vitest run tests/codex-sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 5: Wire Sidebar CLI Commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/codex-session-cli.test.ts`

- [ ] **Step 1: Add failing CLI artifact tests**

Add tests for:

```ts
await runCli([
  'codex-sessions', 'sidebar-plan',
  '--graph', graphPath,
  '--app-sidebar-snapshot', sidebarSnapshotPath,
  '--out', planPath
]);
```

Assert schema `hooks.codex-sidebar-plan/v1` and a non-empty digest.

Add an apply test with injected client factory through `RunCliOptions`:

```ts
const output = JSON.parse(await runCli([
  'codex-sessions', 'sidebar-apply',
  '--plan', planPath,
  '--confirm-digest', plan.digest,
  '--out', applyPath
], undefined, {
  createCodexAppServerClient: () => fakeClient
}));
expect(output.schemaVersion).toBe('hooks.codex-sidebar-apply/v1');
expect(output.pendingHostActions).toHaveLength(1);
```

Add reconcile and rollback-plan artifact tests.

- [ ] **Step 2: Run CLI tests**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts
```

Expected: FAIL on unknown commands and missing injected factory.

- [ ] **Step 3: Extend CLI options and wire commands**

Extend `RunCliOptions`:

```ts
createCodexAppServerClient?: () => CodexAppServerClient;
```

Wire:

- `sidebar-plan`: require graph and validated App host snapshot; initialize the
  App Server client, call paginated `listAllThreads` for exact project cwd and
  `cli`/`vscode`, close in `finally`, then create the atomic plan from graph
  candidates whose IDs are App-Server-readable. Accept repeatable
  `--thread-id` for explicit selection and repeatable `--rename-thread-id` for
  the narrower permission to replace a non-empty customized name;
- `sidebar-apply`: require plan, digest, and output; initialize client, list
  current threads, apply names, close client in `finally`, write result;
- `sidebar-reconcile`: validate host receipt plus fresh sidebar snapshot;
- `sidebar-rollback-plan`: read apply result and host receipt, emit reverse plan.

Resolve every explicit input/output path with `path.resolve(process.cwd(),
value)` so the documented `live/...` paths remain valid, validate every JSON
artifact before use, and use `writeCodexSessionJson` for atomic output.

- [ ] **Step 4: Run CLI and sidebar tests**

Run:

```powershell
npx vitest run `
  tests/codex-session-cli.test.ts `
  tests/codex-app-server-client.test.ts `
  tests/codex-sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Record the checkpoint**

Run `git diff --check` and `git status --short`; do not stage or commit.

### Task 6: Document the Two-Adapter Apply Flow

**Files:**
- Modify: `docs/codex-session-bridge.md`
- Modify: `README.md`

- [ ] **Step 1: Document exact execution commands**

Add:

```powershell
node dist/src/cli.js codex-sessions sidebar-plan `
  --graph live/session-federation.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.before.json `
  --thread-id THREAD_ID `
  --out live/codex-sidebar-plan.json

node dist/src/cli.js codex-sessions sidebar-apply `
  --plan live/codex-sidebar-plan.json `
  --confirm-digest PLAN_SHA256 `
  --out live/codex-sidebar-apply.json
```

Document that the App Server step sets names and produces
`pendingHostActions`. A Codex App conversation applies each action through
`set_thread_pinned`, then records:

```json
{
  "schemaVersion": "hooks.codex-sidebar-host-receipt/v1",
  "generatedAt": "2026-08-15T09:05:00.000Z",
  "planDigest": "PLAN_SHA256",
  "entries": [
    {
      "threadId": "THREAD_ID",
      "pinned": true,
      "status": "applied",
      "error": null
    }
  ]
}
```

Document reconcile and rollback commands, conflict behavior, and why pinning
is a host operation for `codex-cli 0.147.0`.

- [ ] **Step 2: Run documentation-sensitive tests and diff check**

Run:

```powershell
npx vitest run tests/codex-session-cli.test.ts
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Record the checkpoint**

Run `git status --short`; do not stage or commit.

### Task 7: Full Verification and Controlled Native Sidebar Acceptance

**Files:**
- Generated: `live/codex-app-sidebar-snapshot.before.json`
- Generated: `live/codex-sidebar-plan.json`
- Generated: `live/codex-sidebar-apply.json`
- Generated: `live/codex-sidebar-host-receipt.json`
- Generated: `live/codex-app-sidebar-snapshot.after.json`
- Generated: `live/codex-sidebar-reconcile.json`
- Generated: `live/codex-sidebar-rollback-plan.json`

- [ ] **Step 1: Run the complete repository checks**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

Expected: all pass and smoke prints `SMOKE_PASS`.

- [ ] **Step 2: Capture the App sidebar before state**

From the Codex App host, call `list_threads(limit=50)` and write only:

```json
{
  "schemaVersion": "hooks.codex-app-sidebar-snapshot/v1",
  "generatedAt": "ISO-8601",
  "threads": [
    {
      "threadId": "THREAD_ID",
      "listed": false,
      "readable": true,
      "pinned": false
    }
  ]
}
```

to `live/codex-app-sidebar-snapshot.before.json`.

Confirm that selected CLI thread
`01a00490-90c0-7dc2-9fac-fbdb4d7baa0f` is readable by ID but absent from the
normal list. Include it in the snapshot using `read_thread` evidence even
though `listed` is false.

- [ ] **Step 3: Generate and inspect the plan**

Run:

```powershell
node dist/src/cli.js codex-sessions sidebar-plan `
  --graph live/session-federation.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.before.json `
  --thread-id 01a00490-90c0-7dc2-9fac-fbdb4d7baa0f `
  --out live/codex-sidebar-plan.json
```

Expected: exactly one explicitly selected acceptance action unless the graph
contains another separately approved CLI thread.

- [ ] **Step 4: Apply the App Server name**

Run with the exact plan digest:

```powershell
node dist/src/cli.js codex-sessions sidebar-apply `
  --plan live/codex-sidebar-plan.json `
  --confirm-digest PLAN_SHA256 `
  --out live/codex-sidebar-apply.json
```

Assert:

- name status is `name-applied` or `unchanged`;
- one pending host pin action exists;
- no other thread metadata changed.

- [ ] **Step 5: Apply the host pin**

From the Codex App host, call:

```text
set_thread_pinned(
  threadId="01a00490-90c0-7dc2-9fac-fbdb4d7baa0f",
  pinned=true
)
```

Write a receipt containing the result to
`live/codex-sidebar-host-receipt.json`.

- [ ] **Step 6: Reconcile native visibility**

Capture a fresh `list_threads(limit=50)` snapshot, then run:

```powershell
node dist/src/cli.js codex-sessions sidebar-reconcile `
  --plan live/codex-sidebar-plan.json `
  --host-receipt live/codex-sidebar-host-receipt.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.after.json `
  --out live/codex-sidebar-reconcile.json
```

Expected: selected thread status is `visible`.

- [ ] **Step 7: Rehearse rollback**

Generate:

```powershell
node dist/src/cli.js codex-sessions sidebar-rollback-plan `
  --apply live/codex-sidebar-apply.json `
  --host-receipt live/codex-sidebar-host-receipt.json `
  --out live/codex-sidebar-rollback-plan.json
```

Review the reverse actions. Restore the previous name through App Server and
the previous pin state through `set_thread_pinned`. Reconcile that the original
sidebar state returns.

- [ ] **Step 8: Inspect final diff and status**

Run:

```powershell
git diff --stat
git diff -- `
  src/codex-app-server-client.ts `
  src/codex-sidebar.ts `
  src/cli.ts `
  tests/codex-app-server-client.test.ts `
  tests/codex-sidebar.test.ts `
  tests/codex-session-cli.test.ts `
  docs/codex-session-bridge.md `
  README.md
git status --short
```

Expected: only task-scoped files plus previously recorded no-touch files.
Report checks as `pass/fail/blocked`. Do not stage, commit, or push.
