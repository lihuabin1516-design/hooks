import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const codexSessionIoMocks = vi.hoisted(() => ({
  snapshotReadFile: vi.fn<typeof import('node:fs/promises').readFile>(),
  buildCodexSessionIndex: vi.fn<
    typeof import('../src/codex-session-index.js').buildCodexSessionIndex
  >(),
  writeCodexSessionJson: vi.fn<
    typeof import('../src/codex-session-index.js').writeCodexSessionJson
  >()
}));

const sessionFederationMocks = vi.hoisted(() => ({
  attachCcPanesAttribution: vi.fn<
    typeof import('../src/session-federation.js').attachCcPanesAttribution
  >()
}));

const resolverMocks = vi.hoisted(() => ({
  resolveCodexSessions: vi.fn<
    typeof import('../src/codex-session-resolver.js').resolveCodexSessions
  >()
}));

const handoffMocks = vi.hoisted(() => ({
  createRetentionManifest: vi.fn<
    typeof import('../src/codex-session-handoff.js').createRetentionManifest
  >()
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  codexSessionIoMocks.snapshotReadFile.mockImplementation(actual.readFile);
  return {
    ...actual,
    readFile: codexSessionIoMocks.snapshotReadFile
  };
});

vi.mock('../src/codex-session-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex-session-index.js')>();
  codexSessionIoMocks.buildCodexSessionIndex.mockImplementation(actual.buildCodexSessionIndex);
  codexSessionIoMocks.writeCodexSessionJson.mockImplementation(actual.writeCodexSessionJson);
  return {
    ...actual,
    buildCodexSessionIndex: codexSessionIoMocks.buildCodexSessionIndex,
    writeCodexSessionJson: codexSessionIoMocks.writeCodexSessionJson
  };
});

vi.mock('../src/session-federation.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/session-federation.js')
  >();
  sessionFederationMocks.attachCcPanesAttribution
    .mockImplementation(actual.attachCcPanesAttribution);
  return {
    ...actual,
    attachCcPanesAttribution:
      sessionFederationMocks.attachCcPanesAttribution
  };
});

vi.mock('../src/codex-session-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/codex-session-resolver.js')
  >();
  resolverMocks.resolveCodexSessions
    .mockImplementation(actual.resolveCodexSessions);
  return {
    ...actual,
    resolveCodexSessions: resolverMocks.resolveCodexSessions
  };
});

vi.mock('../src/codex-session-handoff.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/codex-session-handoff.js')
  >();
  handoffMocks.createRetentionManifest
    .mockImplementation(actual.createRetentionManifest);
  return {
    ...actual,
    createRetentionManifest: handoffMocks.createRetentionManifest
  };
});

import { runCli } from '../src/cli.js';
import type { AppServerThread } from '../src/codex-app-server-client.js';
import { generateCodexHandoff } from '../src/codex-session-handoff.js';
import { isCodexThreadId } from '../src/codex-session-identity.js';
import type {
  CodexSessionResolution,
  ResolvedCodexSession
} from '../src/codex-session-resolver.js';
import {
  digestSidebarApplyExecution,
  createSidebarPlan,
  type SidebarApplyResult,
  type SidebarHostReceipt
} from '../src/codex-sidebar.js';
import {
  CodexSidebarCliClientError,
  type CodexSidebarCliClientErrorStage
} from '../src/codex-sidebar-cli.js';

let root: string;
let sessionsDir: string;
let stateDb: string;
let historyDb: string;
const project = 'D:\\Repo';

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

async function expectExactErrorMessage(
  promise: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  const error = await rejectedError(promise);
  expect(error.message).toBe(expectedMessage);
}

function clearCodexSessionIoMocks(): void {
  codexSessionIoMocks.snapshotReadFile.mockClear();
  codexSessionIoMocks.buildCodexSessionIndex.mockClear();
  codexSessionIoMocks.writeCodexSessionJson.mockClear();
  sessionFederationMocks.attachCcPanesAttribution.mockClear();
  resolverMocks.resolveCodexSessions.mockClear();
  handoffMocks.createRetentionManifest.mockClear();
}

async function expectCliErrorBeforeIo(
  args: string[],
  expectedMessage: string,
  outPath?: string
): Promise<void> {
  const existsSyncSpy = vi.spyOn(nodeFs, 'existsSync');
  const createCodexAppServerClient = vi.fn(() => {
    throw new Error('client factory must not run');
  });
  clearCodexSessionIoMocks();
  try {
    await expectExactErrorMessage(runCli(args, undefined, {
      createCodexAppServerClient
    }), expectedMessage);
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(createCodexAppServerClient).not.toHaveBeenCalled();
    expect(codexSessionIoMocks.snapshotReadFile).not.toHaveBeenCalled();
    expect(codexSessionIoMocks.buildCodexSessionIndex).not.toHaveBeenCalled();
    expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  } finally {
    existsSyncSpy.mockRestore();
  }
  if (outPath) {
    await expect(fs.stat(outPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

function resolvedSession(input: {
  threadId: string;
  projectRelation: ResolvedCodexSession['projectRelation'];
  cwdRaw?: string;
  runtimeScope?: ResolvedCodexSession['runtimeScope'];
  scopeMatch?: ResolvedCodexSession['scopeMatch'];
  storageState?: ResolvedCodexSession['storageState'];
  threadSource?: ResolvedCodexSession['threadSource'];
}): ResolvedCodexSession {
  const cwdRaw = input.cwdRaw ?? project;
  return {
    threadId: input.threadId,
    source: 'codex-cli',
    threadSource: input.threadSource ?? 'user',
    originator: 'codex-tui',
    cwdRaw,
    cwdNorm: cwdRaw.toLowerCase().replaceAll('\\', '/'),
    projectOwner: project,
    scopeMatch: input.scopeMatch ?? 'exact',
    confidence: 1,
    rolloutPath: null,
    stateDbPresent: true,
    rolloutPresent: true,
    updatedAt: '2026-08-15T00:00:00.000Z',
    firstUserPrompt: null,
    lastSummary: null,
    storageState: input.storageState ?? 'active',
    runtimeScope: input.runtimeScope ?? 'exact',
    projectRelation: input.projectRelation,
    relationConfidence: 1,
    relationReasons: [],
    evidence: [],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null,
    resumeAvailable: true,
    resumeDirectory: project,
    explanation: `project relation: ${input.projectRelation}`
  };
}

function validTaskContext(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: project,
    worktreeRoot: project,
    mainRepoRoot: null,
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: {
      leaderSessionId: 'leader-1',
      paneId: 'pane-1',
      layoutId: 'layout-1'
    },
    phase: 'build',
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:01.000Z',
    source: 'leader',
    notes: 'synthetic task context',
    ...overrides
  };
}

function emptyResolution(): CodexSessionResolution {
  return {
    schemaVersion: 'hooks.codex-session-resolution/v3',
    project,
    projectNorm: 'd:/repo',
    totals: {
      defaultVisible: 0,
      owned: 0,
      supporting: 0,
      mentioned: 0,
      ambient: 0,
      archived: 0,
      subagents: 0
    },
    sessions: []
  };
}

async function writeRollout(input: {
  threadId: string;
  cwd: string;
  threadSource?: 'user' | 'subagent';
  firstUserPrompt?: string;
  relativePath?: string;
}): Promise<string> {
  const rollout = path.join(
    sessionsDir,
    input.relativePath ?? `${input.threadId}.jsonl`
  );
  const lines = [JSON.stringify({
    timestamp: '2026-08-15T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: input.threadId,
      cwd: input.cwd,
      originator: 'codex-tui',
      thread_source: input.threadSource ?? 'user'
    }
  })];
  if (input.firstUserPrompt) {
    lines.push(JSON.stringify({
      timestamp: '2026-08-15T00:00:01.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: input.firstUserPrompt
      }
    }));
  }
  await fs.mkdir(path.dirname(rollout), { recursive: true });
  await fs.writeFile(rollout, `${lines.join('\n')}\n`, 'utf8');
  return rollout;
}

async function writeSnapshot(threadId = 'thread-1'): Promise<string> {
  const snapshotPath = path.join(root, 'ccpanes-snapshot.json');
  await fs.writeFile(snapshotPath, `${JSON.stringify({
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: '2026-08-15T00:10:00.000Z',
    launches: [{
      launchId: 'launch-1',
      projectPath: project,
      workspaceName: 'repo',
      cliTool: 'codex',
      resumeSessionId: threadId,
      launchedAt: '2026-08-15T00:09:00.000Z'
    }],
    sessions: []
  })}\n`, 'utf8');
  return snapshotPath;
}

async function writeThreadBoundarySnapshot(input: {
  resumeSessionId: string | null;
  observedCodexThreadId: string | null;
  filename: string;
}): Promise<string> {
  const snapshotPath = path.join(root, input.filename);
  await fs.writeFile(snapshotPath, `${JSON.stringify({
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: '2026-08-15T00:10:00.000Z',
    launches: [{
      launchId: 'launch-thread-boundary',
      projectPath: project,
      workspaceName: 'repo',
      cliTool: 'codex',
      resumeSessionId: input.resumeSessionId,
      launchedAt: '2026-08-15T00:09:00.000Z'
    }],
    sessions: [{
      sessionId: 'session-thread-boundary',
      launchId: 'launch-thread-boundary',
      taskId: 'task-thread-boundary',
      projectPath: project,
      status: 'active',
      title: null,
      observedCodexThreadId: input.observedCodexThreadId
    }]
  })}\n`, 'utf8');
  return snapshotPath;
}

function appThread(
  id: string,
  overrides: Partial<AppServerThread> = {}
): AppServerThread {
  return {
    id,
    name: null,
    cwd: project,
    source: 'cli',
    preview: `Preview ${id}`,
    updatedAt: 1,
    recencyAt: 1,
    ...overrides
  };
}

function federationGraph(input: {
  secondThread?: boolean;
  inferredThread?: boolean;
  linked?: boolean;
} = {}): Record<string, unknown> {
  const nodes: Array<Record<string, unknown>> = [{
    id: 'codex-thread:thread-1',
    type: 'codex-thread',
    externalId: 'thread-1',
    attributes: {
      host: 'codex-cli',
      threadSource: 'user',
      storageState: 'active',
      projectRelation: 'owned',
      cwdNorm: 'd:/repo',
      updatedAt: '2026-08-15T08:00:00.000Z'
    }
  }, {
    id: 'ccpanes-launch:launch-1',
    type: 'ccpanes-launch',
    externalId: 'launch-1',
    attributes: {
      projectPathNorm: 'd:/repo',
      workspaceName: 'repo',
      cliTool: 'codex',
      launchedAt: '2026-08-15T08:00:00.000Z'
    }
  }];
  if (input.secondThread) {
    nodes.push({
      id: 'codex-thread:thread-2',
      type: 'codex-thread',
      externalId: 'thread-2',
      attributes: input.inferredThread
        ? { inferred: true }
        : {
            host: 'codex-cli',
            threadSource: 'user',
            storageState: 'active',
            projectRelation: 'supporting',
            cwdNorm: 'd:/repo/worktree',
            updatedAt: '2026-08-15T08:01:00.000Z'
          }
    });
  }
  return {
    schemaVersion: 'hooks.session-federation/v1',
    generatedAt: '2026-08-15T09:00:00.000Z',
    project,
    nodes,
    edges: input.linked === false ? [] : [{
      id: 'resumed-from:ccpanes-launch:launch-1->codex-thread:thread-1',
      type: 'resumed-from',
      from: 'ccpanes-launch:launch-1',
      to: 'codex-thread:thread-1',
      confidence: 1,
      evidence: [{
        kind: 'snapshot-field',
        field: 'launch.resumeSessionId',
        value: 'thread-1'
      }],
      observedAt: '2026-08-15T09:00:00.000Z'
    }],
    diagnostics: []
  };
}

function appSidebarSnapshot(threadIds = ['thread-1']): Record<string, unknown> {
  return {
    schemaVersion: 'hooks.codex-app-sidebar-snapshot/v1',
    generatedAt: '2026-08-15T09:01:00.000Z',
    threads: threadIds.map((threadId) => ({
      threadId,
      listed: false,
      readable: true,
      pinned: false
    }))
  };
}

function fakeClient(
  listResults: AppServerThread[][],
  readResults: Array<AppServerThread | null> = []
) {
  return {
    initialize: vi.fn(async () => {}),
    listAllThreads: vi.fn(async () => listResults.shift() ?? []),
    readThread: vi.fn(async () => readResults.shift() ?? null),
    setThreadName: vi.fn(async () => {}),
    close: vi.fn(async () => {})
  };
}

function actionableSidebarPlan() {
  return createSidebarPlan({
    project,
    generatedAt: '2026-08-15T09:00:00.000Z',
    candidates: [{
      threadId: 'thread-1',
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
      originalTitle: 'Preview thread-1'
    }]
  });
}

async function expectPrivacySafeClientFailure(input: {
  run: () => Promise<unknown>;
  outPath: string;
  stage: CodexSidebarCliClientErrorStage;
  secrets: readonly string[];
}): Promise<void> {
  const error = await rejectedError(input.run());
  expect(error).toBeInstanceOf(CodexSidebarCliClientError);
  expect(error).toMatchObject({
    code: 'CODEX_SIDEBAR_CLI_CLIENT',
    field: 'appServerClient',
    stage: input.stage,
    reason: 'client-failure'
  });
  const exposed = `${error.message}\n${JSON.stringify(error)}`;
  for (const secret of input.secrets) {
    expect(exposed).not.toContain(secret);
  }
  expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  await expect(fs.stat(input.outPath))
    .rejects.toMatchObject({ code: 'ENOENT' });
}

function applyResultWithPreviousName(
  previousName: string | null
): SidebarApplyResult {
  const desiredName = '[CC-Panes] Preview thread-1';
  const core = {
    schemaVersion: 'hooks.codex-sidebar-apply/v1' as const,
    generatedAt: '2026-08-15T09:02:00.000Z',
    planDigest: 'a'.repeat(64),
    entries: [{
      threadId: 'thread-1',
      previousName,
      previousPinned: false,
      desiredName,
      finalName: desiredName,
      status: 'name-applied' as const,
      error: null
    }]
  };
  const executionDigest = digestSidebarApplyExecution(core);
  return {
    ...core,
    executionDigest,
    pendingHostActions: [{
      planDigest: core.planDigest,
      executionDigest,
      action: 'set-pinned',
      threadId: 'thread-1',
      pinned: true,
      previousPinned: false
    }]
  };
}

function receiptForApply(apply: SidebarApplyResult): SidebarHostReceipt {
  return {
    schemaVersion: 'hooks.codex-sidebar-host-receipt/v1',
    generatedAt: '2026-08-15T09:03:00.000Z',
    planDigest: apply.planDigest,
    executionDigest: apply.executionDigest,
    entries: [{
      threadId: 'thread-1',
      pinned: true,
      status: 'applied',
      error: null
    }]
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-session-cli-'));
  sessionsDir = path.join(root, 'sessions');
  stateDb = path.join(root, 'state.sqlite');
  historyDb = path.join(root, 'history.sqlite');
  const rollout = await writeRollout({
    threadId: 'thread-1',
    cwd: project,
    relativePath: 'rollout.jsonl'
  });
  const db = new DatabaseSync(stateDb);
  db.exec('create table threads (id text, rollout_path text, updated_at integer, source text, cwd text, first_user_message text, thread_source text, preview text)');
  db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('thread-1', rollout, 1, 'cli', project, 'Implement bridge', 'user', 'summary');
  db.close();
  clearCodexSessionIoMocks();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('scan, resolve, retention, and handoff commands expose the session bridge', async () => {
  const indexPath = path.join(root, 'live', 'index.json');
  const retentionPath = path.join(root, 'live', 'retention.json');
  const common = ['--sessions-dir', sessionsDir, '--state-db', stateDb, '--thread-history-db', historyDb];

  const scan = JSON.parse(await runCli(['codex-sessions', 'scan', ...common, '--project', project, '--out', indexPath]));
  expect(scan.schemaVersion).toBe('hooks.codex-session-index/v3');
  expect(scan).not.toHaveProperty('warnings');
  expect(scan.diagnostics).toContainEqual(expect.objectContaining({
    code: 'source-missing',
    source: 'thread-history-db'
  }));
  await expect(fs.stat(indexPath)).resolves.toBeTruthy();

  const resolve = JSON.parse(await runCli(['codex-sessions', 'resolve', ...common, '--project', project, '--json']));
  expect(resolve.schemaVersion).toBe('hooks.codex-session-resolution/v3');
  expect(resolve.totals.defaultVisible).toBe(1);
  expect(resolve.sessions[0]).toMatchObject({ threadId: 'thread-1', scopeMatch: 'exact', resumeAvailable: true });

  const retention = JSON.parse(await runCli(['codex-sessions', 'retention', ...common, '--project', project, '--out', retentionPath]));
  expect(retention.schemaVersion).toBe('hooks.codex-session-retention/v2');
  expect(retention.diagnostics).toEqual([]);
  await expect(fs.stat(retentionPath)).resolves.toBeTruthy();

  const handoff = await runCli([
    'handoff', 'generate', ...common, '--mode', 'ccpanes-worker',
    '--project', project, '--index', indexPath
  ]);
  expect(handoff).toContain('sessionIndex:');
  expect(handoff).toContain('thread-1 (supporting');
});

const handoffGenerateValueFlags = [
  '--mode',
  '--project',
  '--sessions-dir',
  '--state-db',
  '--thread-history-db',
  '--task-context',
  '--index'
] as const;

function validHandoffGenerateArgs(): string[] {
  return [
    'handoff', 'generate',
    '--mode', 'ccpanes-worker',
    '--project', project,
    '--sessions-dir', path.join(root, 'missing', 'sessions'),
    '--state-db', path.join(root, 'missing', 'state.sqlite'),
    '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
    '--task-context', path.join(root, 'missing', 'current-task.json'),
    '--index', path.join(root, 'missing', 'index.json')
  ];
}

function replaceHandoffOption(
  args: string[],
  flag: typeof handoffGenerateValueFlags[number],
  replacement: string[]
): string[] {
  const index = args.indexOf(flag);
  return [
    ...args.slice(0, index),
    ...replacement,
    ...args.slice(index + 2)
  ];
}

test.each(handoffGenerateValueFlags)(
  'handoff generate rejects terminal %s before any I/O',
  async (flag) => {
    await expectCliErrorBeforeIo(
      replaceHandoffOption(validHandoffGenerateArgs(), flag, [flag]),
      `missing value for ${flag}`
    );
  }
);

test.each(handoffGenerateValueFlags)(
  'handoff generate rejects blank %s before any I/O',
  async (flag) => {
    await expectCliErrorBeforeIo(
      replaceHandoffOption(validHandoffGenerateArgs(), flag, [flag, ' \t ']),
      `missing value for ${flag}`
    );
  }
);

test.each(handoffGenerateValueFlags)(
  'handoff generate rejects duplicate %s before any I/O',
  async (flag) => {
    const args = validHandoffGenerateArgs();
    const value = args[args.indexOf(flag) + 1];
    await expectCliErrorBeforeIo(
      [...args, flag, value],
      `duplicate option: ${flag}`
    );
  }
);

test.each([
  [
    'unknown option',
    ['--unknown', 'value'],
    'unknown option: --unknown'
  ],
  [
    'positional argument',
    ['stray'],
    'unexpected positional argument: stray'
  ]
] as const)(
  'handoff generate rejects %s before any I/O',
  async (_name, extra, expectedError) => {
    await expectCliErrorBeforeIo(
      [...validHandoffGenerateArgs(), ...extra],
      expectedError
    );
  }
);

test.each([
  ['scan', 'hooks.codex-session-index/v3', 'scan-without-project.json'],
  ['retention', 'hooks.codex-session-retention/v2', 'retention-without-project.json']
])('%s succeeds without project or snapshot and writes the explicit output', async (action, schemaVersion, fileName) => {
  const outPath = path.join(root, 'live', fileName);
  const stdout = await runCli([
    'codex-sessions', action,
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--out', outPath
  ]);
  const result = JSON.parse(stdout);

  expect(result.schemaVersion).toBe(schemaVersion);
  await expect(fs.stat(outPath)).resolves.toBeTruthy();
  expect(JSON.parse(await fs.readFile(outPath, 'utf8'))).toEqual(result);
});

test.each([
  [
    'resolve',
    async () => {
      resolverMocks.resolveCodexSessions.mockReturnValueOnce({
        ...emptyResolution(),
        schemaVersion: 'hooks.codex-session-resolution/v2'
      } as never);
      return runCli([
        'codex-sessions', 'resolve',
        '--sessions-dir', sessionsDir,
        '--state-db', stateDb,
        '--thread-history-db', historyDb,
        '--project', project,
        '--json'
      ]);
    }
  ],
  [
    'retention',
    async () => {
      handoffMocks.createRetentionManifest.mockReturnValueOnce({
        schemaVersion: 'hooks.codex-session-retention/v1',
        generatedAt: '2026-08-17T00:00:00.000Z',
        sessions: []
      } as never);
      return runCli([
        'codex-sessions', 'retention',
        '--sessions-dir', sessionsDir,
        '--state-db', stateDb,
        '--thread-history-db', historyDb,
        '--out', path.join(root, 'live', 'old-retention.json')
      ]);
    }
  ]
] as const)(
  '%s rejects an old generated artifact with typed unsupported-schema',
  async (_action, invoke) => {
    const error = await rejectedError(invoke());
    expect(error).toMatchObject({
      field: 'schemaVersion',
      reason: 'unsupported-schema'
    });
  }
);

test('handoff keeps the first three owned or supporting active user sessions from resolution order', async () => {
  const sessions = [
    resolvedSession({ threadId: 'owned-first', projectRelation: 'owned' }),
    resolvedSession({
      threadId: 'ancestor-ambient',
      projectRelation: 'ambient',
      runtimeScope: 'ancestor',
      scopeMatch: 'ancestor',
      cwdRaw: 'D:\\'
    }),
    resolvedSession({ threadId: 'supporting-second', projectRelation: 'supporting' }),
    resolvedSession({
      threadId: 'prompt-mentioned',
      projectRelation: 'mentioned',
      runtimeScope: 'unrelated',
      scopeMatch: 'prompt-mention',
      cwdRaw: 'C:\\Other'
    }),
    resolvedSession({ threadId: 'owned-third', projectRelation: 'owned' }),
    resolvedSession({
      threadId: 'archived-owned',
      projectRelation: 'owned',
      storageState: 'archived'
    }),
    resolvedSession({
      threadId: 'subagent-owned',
      projectRelation: 'owned',
      threadSource: 'subagent'
    }),
    resolvedSession({
      threadId: 'unrelated-user',
      projectRelation: 'unrelated',
      runtimeScope: 'unrelated',
      scopeMatch: 'unknown',
      cwdRaw: 'C:\\Other'
    }),
    resolvedSession({ threadId: 'supporting-fourth', projectRelation: 'supporting' })
  ];
  const resolution: CodexSessionResolution = {
    schemaVersion: 'hooks.codex-session-resolution/v3',
    project,
    projectNorm: 'd:/repo',
    totals: {
      defaultVisible: 4,
      owned: 4,
      supporting: 2,
      mentioned: 1,
      ambient: 1,
      archived: 1,
      subagents: 1
    },
    sessions
  };

  const handoff = await generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: 'D:\\live\\codex-session-index.json',
    resolution
  });

  expect(handoff).toContain(
    'sessionScope: owned/supporting user sessions; broader relations require explicit flags'
  );
  expect(handoff).toContain(
    '归因摘要: owned-first (owned, cwd=D:\\Repo); ' +
    'supporting-second (supporting, cwd=D:\\Repo); ' +
    'owned-third (owned, cwd=D:\\Repo)'
  );
  for (const excludedThreadId of [
    'ancestor-ambient',
    'prompt-mentioned',
    'archived-owned',
    'subagent-owned',
    'unrelated-user',
    'supporting-fourth'
  ]) {
    expect(handoff).not.toContain(excludedThreadId);
  }
  expect(handoff).not.toContain('owned-first (exact');
});

test.each([
  ['read-failed', 'missing-current-task.json', null],
  ['malformed-json', 'malformed-current-task.json', '{not-json'],
  ['oversized', 'oversized-current-task.json', 'x'.repeat(16 * 1024 + 1)],
  [
    'schema-invalid',
    'invalid-current-task.json',
    JSON.stringify({ schema: 'wrong' })
  ],
  [
    'schema-invalid',
    'unknown-field-current-task.json',
    JSON.stringify(validTaskContext({ unexpected: true }))
  ]
] as const)(
  'handoff propagates a typed %s error for an explicit task context',
  async (reason, filename, contents) => {
    const taskContextPath = path.join(root, filename);
    if (contents !== null) {
      await fs.writeFile(taskContextPath, contents, 'utf8');
    }
    const resolution: CodexSessionResolution = {
      schemaVersion: 'hooks.codex-session-resolution/v3',
      project,
      projectNorm: 'd:/repo',
      totals: {
        defaultVisible: 0,
        owned: 0,
        supporting: 0,
        mentioned: 0,
        ambient: 0,
        archived: 0,
        subagents: 0
      },
      sessions: []
    };

    const error = await rejectedError(generateCodexHandoff({
      mode: 'ccpanes-worker',
      project,
      indexPath: path.join(root, 'index.json'),
      taskContextPath,
      resolution
    }));

    expect(error).toMatchObject({
      name: 'CodexHandoffTaskContextError',
      code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
      field: 'taskContextPath',
      reason
    });
    expect(error).not.toHaveProperty('taskContextPath');
    expect(error.message).not.toContain(taskContextPath);
    expect(JSON.stringify(error)).not.toContain(taskContextPath);
  }
);

test.each([
  ['read-failed', 'missing-cli-current-task.json', null],
  ['malformed-json', 'malformed-cli-current-task.json', '{not-json'],
  ['oversized', 'oversized-cli-current-task.json', 'x'.repeat(16 * 1024 + 1)],
  [
    'schema-invalid',
    'invalid-cli-current-task.json',
    JSON.stringify({ schema: 'wrong' })
  ],
  [
    'schema-invalid',
    'unknown-field-cli-current-task.json',
    JSON.stringify(validTaskContext({ unexpected: true }))
  ]
] as const)(
  'handoff generate CLI propagates typed %s for an explicit task context',
  async (reason, filename, contents) => {
    const taskContextPath = path.join(root, filename);
    if (contents !== null) {
      await fs.writeFile(taskContextPath, contents, 'utf8');
    }
    codexSessionIoMocks.buildCodexSessionIndex.mockResolvedValueOnce({
      schemaVersion: 'hooks.codex-session-index/v3',
      generatedAt: '2026-08-16T00:00:00.000Z',
      sources: {
        sessionsDir: { path: sessionsDir, availability: 'present' },
        stateDb: { path: stateDb, availability: 'present' },
        threadHistoryDb: {
          path: historyDb,
          availability: 'missing',
          role: 'availability-only'
        },
        taskContext: {
          path: taskContextPath,
          availability: 'present'
        }
      },
      sessions: [],
      diagnostics: []
    });

    const error = await rejectedError(runCli([
      'handoff', 'generate',
      '--mode', 'ccpanes-worker',
      '--project', project,
      '--sessions-dir', sessionsDir,
      '--state-db', stateDb,
      '--thread-history-db', historyDb,
      '--task-context', taskContextPath,
      '--index', path.join(root, 'index.json')
    ]));

    expect(error).toMatchObject({
      name: 'CodexHandoffTaskContextError',
      code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
      field: 'taskContextPath',
      reason
    });
    expect(error).not.toHaveProperty('taskContextPath');
    expect(error.message).not.toContain(taskContextPath);
    expect(JSON.stringify(error)).not.toContain(taskContextPath);
    expect(codexSessionIoMocks.buildCodexSessionIndex)
      .toHaveBeenCalledWith(expect.objectContaining({
        taskContext: taskContextPath
      }));
  }
);

test('handoff direct API treats an explicit empty task context path as invalid', async () => {
  const error = await rejectedError(generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: path.join(root, 'index.json'),
    taskContextPath: '',
    resolution: {
      schemaVersion: 'hooks.codex-session-resolution/v3',
      project,
      projectNorm: 'd:/repo',
      totals: {
        defaultVisible: 0,
        owned: 0,
        supporting: 0,
        mentioned: 0,
        ambient: 0,
        archived: 0,
        subagents: 0
      },
      sessions: []
    }
  }));

  expect(error).toMatchObject({
    name: 'CodexHandoffTaskContextError',
    code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
    field: 'taskContextPath',
    reason: 'unsafe-path'
  });
});

test.each([
  ['task.projectPath', { projectPath: 'E:\\ForeignProject' }],
  ['task.mainRepoRoot', { mainRepoRoot: 'E:\\ForeignMainRepo' }]
] as const)(
  'handoff direct API rejects foreign %s authority without echoing paths',
  async (field, overrides) => {
    const taskContextPath = path.join(root, `${field}.json`);
    await fs.writeFile(
      taskContextPath,
      JSON.stringify(validTaskContext(overrides)),
      'utf8'
    );

    const error = await rejectedError(generateCodexHandoff({
      mode: 'ccpanes-worker',
      project,
      indexPath: path.join(root, 'index.json'),
      taskContextPath,
      resolution: emptyResolution()
    }));

    expect(error).toMatchObject({
      name: 'CodexHandoffTaskContextError',
      code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
      field,
      reason: 'project-mismatch'
    });
    for (const rawPath of [project, ...Object.values(overrides)]) {
      expect(error.message).not.toContain(rawPath);
      expect(JSON.stringify(error)).not.toContain(rawPath);
    }
  }
);

test.each([
  ['task.projectPath', { projectPath: 'E:\\ForeignProject' }],
  ['task.mainRepoRoot', { mainRepoRoot: 'E:\\ForeignMainRepo' }]
] as const)(
  'handoff generate CLI rejects foreign %s authority without echoing paths',
  async (field, overrides) => {
    const taskContextPath = path.join(root, `cli-${field}.json`);
    await fs.writeFile(
      taskContextPath,
      JSON.stringify(validTaskContext(overrides)),
      'utf8'
    );
    codexSessionIoMocks.buildCodexSessionIndex.mockResolvedValueOnce({
      schemaVersion: 'hooks.codex-session-index/v3',
      generatedAt: '2026-08-16T00:00:00.000Z',
      sources: {
        sessionsDir: { path: sessionsDir, availability: 'present' },
        stateDb: { path: stateDb, availability: 'present' },
        threadHistoryDb: {
          path: historyDb,
          availability: 'missing',
          role: 'availability-only'
        },
        taskContext: {
          path: taskContextPath,
          availability: 'present'
        }
      },
      sessions: [],
      diagnostics: []
    });

    const error = await rejectedError(runCli([
      'handoff', 'generate',
      '--mode', 'ccpanes-worker',
      '--project', project,
      '--sessions-dir', sessionsDir,
      '--state-db', stateDb,
      '--thread-history-db', historyDb,
      '--task-context', taskContextPath,
      '--index', path.join(root, 'index.json')
    ]));

    expect(error).toMatchObject({
      name: 'CodexHandoffTaskContextError',
      code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
      field,
      reason: 'project-mismatch'
    });
    for (const rawPath of [project, ...Object.values(overrides)]) {
      expect(error.message).not.toContain(rawPath);
      expect(JSON.stringify(error)).not.toContain(rawPath);
    }
  }
);

test('handoff accepts a linked worktree outside the canonical main repository', async () => {
  const taskContextPath = path.join(root, 'linked-worktree-current-task.json');
  await fs.writeFile(
    taskContextPath,
    JSON.stringify(validTaskContext({
      projectPath: 'd:\\Repo',
      mainRepoRoot: 'D:\\Repo',
      worktreeRoot: 'E:\\Detached\\Repo-worktree'
    })),
    'utf8'
  );

  const directHandoff = await generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: path.join(root, 'index.json'),
    taskContextPath,
    resolution: emptyResolution()
  });
  expect(directHandoff).toContain('taskId: task-alpha');

  codexSessionIoMocks.buildCodexSessionIndex.mockResolvedValueOnce({
    schemaVersion: 'hooks.codex-session-index/v3',
    generatedAt: '2026-08-16T00:00:00.000Z',
    sources: {
      sessionsDir: { path: sessionsDir, availability: 'present' },
      stateDb: { path: stateDb, availability: 'present' },
      threadHistoryDb: {
        path: historyDb,
        availability: 'missing',
        role: 'availability-only'
      },
      taskContext: {
        path: taskContextPath,
        availability: 'present'
      }
    },
    sessions: [],
    diagnostics: []
  });
  const cliHandoff = await runCli([
    'handoff', 'generate',
    '--mode', 'ccpanes-worker',
    '--project', project,
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--task-context', taskContextPath,
    '--index', path.join(root, 'index.json')
  ]);
  expect(cliHandoff).toContain('taskId: task-alpha');
});

test('handoff fails closed for unsafe task authority without serializing raw paths', async () => {
  const secret = `AKIA${'H'.repeat(16)}`;
  const taskContextPath = path.join(root, `task-${secret}.json`);
  await fs.writeFile(
    taskContextPath,
    JSON.stringify(validTaskContext()),
    'utf8'
  );

  const error = await rejectedError(generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: path.join(root, 'index.json'),
    taskContextPath,
    resolution: {
      schemaVersion: 'hooks.codex-session-resolution/v3',
      project,
      projectNorm: 'd:/repo',
      totals: {
        defaultVisible: 0,
        owned: 0,
        supporting: 0,
        mentioned: 0,
        ambient: 0,
        archived: 0,
        subagents: 0
      },
      sessions: []
    }
  }));

  expect(error).toMatchObject({
    name: 'CodexHandoffTaskContextError',
    code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
    field: 'taskContextPath',
    reason: 'unsafe-path'
  });
  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('handoff rejects an unsafe taskId without echoing it', async () => {
  const secret = `AKIA${'K'.repeat(16)}`;
  const taskContextPath = path.join(root, 'unsafe-task-id.json');
  await fs.writeFile(
    taskContextPath,
    JSON.stringify(validTaskContext({ taskId: `task-${secret}` })),
    'utf8'
  );

  const error = await rejectedError(generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: path.join(root, 'index.json'),
    taskContextPath,
    resolution: {
      schemaVersion: 'hooks.codex-session-resolution/v3',
      project,
      projectNorm: 'd:/repo',
      totals: {
        defaultVisible: 0,
        owned: 0,
        supporting: 0,
        mentioned: 0,
        ambient: 0,
        archived: 0,
        subagents: 0
      },
      sessions: []
    }
  }));

  expect(error).toMatchObject({
    name: 'CodexHandoffTaskContextError',
    code: 'CODEX_HANDOFF_TASK_CONTEXT_INVALID',
    field: 'taskId',
    reason: 'unsafe-identity'
  });
  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('handoff sanitizes display-only index and resolution fields without pseudo identities', async () => {
  const secret = `AKIA${'J'.repeat(16)}`;
  const taskContextPath = path.join(root, 'safe-current-task.json');
  await fs.writeFile(
    taskContextPath,
    JSON.stringify(validTaskContext()),
    'utf8'
  );
  const unsafeSession = resolvedSession({
    threadId: 'thread-display-privacy',
    projectRelation: 'owned',
    cwdRaw: `${project}\\${secret}`
  });
  unsafeSession.cwdNorm = `d:/repo/${secret}`;

  const handoff = await generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: `${root}\\index-${secret}.json`,
    taskContextPath,
    resolution: {
      schemaVersion: 'hooks.codex-session-resolution/v3',
      project,
      projectNorm: 'd:/repo',
      totals: {
        defaultVisible: 1,
        owned: 1,
        supporting: 0,
        mentioned: 0,
        ambient: 0,
        archived: 0,
        subagents: 0
      },
      sessions: [unsafeSession]
    }
  });

  expect(handoff).not.toContain(secret);
  expect(handoff).not.toContain('[REDACTED]');
  expect(handoff).toContain('sessionIndex: unknown');
  expect(handoff).toContain(
    '归因摘要: thread-display-privacy (owned, cwd=unknown)'
  );
});

test('handoff generate CLI passes absent only when the default task context is missing', async () => {
  codexSessionIoMocks.buildCodexSessionIndex.mockResolvedValueOnce({
    schemaVersion: 'hooks.codex-session-index/v3',
    generatedAt: '2026-08-16T00:00:00.000Z',
    sources: {
      sessionsDir: { path: sessionsDir, availability: 'present' },
      stateDb: { path: stateDb, availability: 'present' },
      threadHistoryDb: {
        path: historyDb,
        availability: 'missing',
        role: 'availability-only'
      },
      taskContext: null
    },
    sessions: [],
    diagnostics: []
  });
  const existsSyncSpy = vi.spyOn(nodeFs, 'existsSync').mockReturnValue(false);
  try {
    const handoff = await runCli([
      'handoff', 'generate',
      '--mode', 'ccpanes-worker',
      '--project', project,
      '--sessions-dir', sessionsDir,
      '--state-db', stateDb,
      '--thread-history-db', historyDb,
      '--index', path.join(root, 'index.json')
    ]);

    expect(handoff).toContain('taskId: unknown');
    expect(handoff).toContain('phase: unknown');
    expect(existsSyncSpy).toHaveBeenCalledWith(
      path.join(project, '.ccpanes-task', 'current-task.json')
    );
    expect(codexSessionIoMocks.buildCodexSessionIndex)
      .toHaveBeenCalledWith(expect.objectContaining({
        taskContext: null
      }));
  } finally {
    existsSyncSpy.mockRestore();
  }
});

test('handoff has an explicit safe absent state only when no task context is provided', async () => {
  const handoff = await generateCodexHandoff({
    mode: 'ccpanes-worker',
    project,
    indexPath: path.join(root, 'index.json'),
    taskContextPath: null,
    resolution: {
      schemaVersion: 'hooks.codex-session-resolution/v3',
      project,
      projectNorm: 'd:/repo',
      totals: {
        defaultVisible: 0,
        owned: 0,
        supporting: 0,
        mentioned: 0,
        ambient: 0,
        archived: 0,
        subagents: 0
      },
      sessions: []
    }
  });

  expect(handoff).toContain('taskId: unknown');
  expect(handoff).toContain('phase: unknown');
});

test('resolve wires all four inclusion flags while defaults exclude ambient and archived sessions', async () => {
  await writeRollout({
    threadId: 'mentioned',
    cwd: 'C:\\Other',
    firstUserPrompt: `Review ${project}`
  });
  await writeRollout({
    threadId: 'ambient',
    cwd: 'D:\\'
  });
  await writeRollout({
    threadId: 'archived',
    cwd: project,
    relativePath: path.join('archived_sessions', 'archived.jsonl')
  });
  await writeRollout({
    threadId: 'subagent',
    cwd: project,
    threadSource: 'subagent'
  });
  const common = [
    'codex-sessions', 'resolve',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--json'
  ];
  const threadIds = async (flag?: string): Promise<string[]> => {
    const result = JSON.parse(await runCli(flag ? [...common, flag] : common));
    return result.sessions.map((session: { threadId: string }) => session.threadId).sort();
  };

  const defaults = JSON.parse(await runCli(common));
  expect(defaults.schemaVersion).toBe('hooks.codex-session-resolution/v3');
  expect(defaults.totals.defaultVisible).toBe(1);
  expect(defaults.sessions.map((session: { threadId: string }) => session.threadId))
    .toEqual(['thread-1']);
  expect(await threadIds('--include-related')).toEqual(['mentioned', 'thread-1']);
  expect(await threadIds('--include-ambient')).toEqual(['ambient', 'thread-1']);
  expect(await threadIds('--include-archived')).toEqual(['archived', 'thread-1']);
  expect(await threadIds('--include-subagents')).toEqual(['subagent', 'thread-1']);
});

test('scan validates and applies a CC-Panes snapshot before writing output', async () => {
  const snapshotPath = await writeSnapshot();
  const indexPath = path.join(root, 'live', 'snapshot-index.json');
  const scan = JSON.parse(await runCli([
    'codex-sessions', 'scan',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--ccpanes-snapshot', path.relative(process.cwd(), snapshotPath),
    '--out', indexPath
  ]));

  expect(scan).not.toHaveProperty('warnings');
  expect(scan.sessions[0]).toMatchObject({
    threadId: 'thread-1',
    projectRelation: 'owned',
    relationConfidence: 1
  });
  expect(scan.sessions[0].evidence).toEqual(expect.arrayContaining([{
    kind: 'ccpanes-launch',
    projectPath: 'd:/repo',
    launchId: 'launch-1'
  }]));
  expect(JSON.parse(await fs.readFile(indexPath, 'utf8'))).toEqual(scan);
});

test.each(['resolve', 'retention', 'graph'] as const)(
  '%s consumes sessions reconstructed by the final index projector',
  async (action) => {
    const secret = `AKIA${'P'.repeat(16)}`;
    const unsafeRolloutPath =
      `${project}\\${secret}\\rollout.jsonl`;
    sessionFederationMocks.attachCcPanesAttribution
      .mockImplementationOnce((input) => input.sessions.map((session) => ({
        ...session,
        updatedAt: '2026-08-17T08:00:00+08:00',
        firstUserPrompt: `token=${secret}`,
        rolloutPath: unsafeRolloutPath
      })));
    const outPath = path.join(root, 'live', `${action}-projected.json`);
    const result = JSON.parse(await runCli([
      'codex-sessions',
      action,
      '--sessions-dir', sessionsDir,
      '--state-db', stateDb,
      '--thread-history-db', historyDb,
      '--project', project,
      ...(action === 'resolve' ? ['--json'] : ['--out', outPath])
    ]));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(secret);
    if (action === 'resolve') {
      expect(result.sessions[0]).toMatchObject({
        firstUserPrompt: 'token=[REDACTED]',
        rolloutPath: null,
        updatedAt: '2026-08-17T00:00:00.000Z'
      });
    } else if (action === 'retention') {
      expect(result.sessions[0]).toMatchObject({
        rolloutPath: null,
        updatedAt: '2026-08-17T00:00:00.000Z'
      });
    } else {
      expect(result.nodes.find(
        (node: { id: string }) => node.id === 'codex-thread:thread-1'
      )).toMatchObject({
        attributes: {
          updatedAt: '2026-08-17T00:00:00.000Z'
        }
      });
    }
  }
);

test('scan, resolve, and retention ignore unsafe snapshot relationships without leaking them', async () => {
  const secret = `AKIA${'V'.repeat(16)}`;
  const privacyThreadId = 'snapshot-privacy-thread';
  await writeRollout({
    threadId: privacyThreadId,
    cwd: 'C:\\Other',
    relativePath: 'snapshot-privacy.jsonl'
  });
  const snapshotPath = path.join(root, 'unsafe-relationship-snapshot.json');
  await fs.writeFile(snapshotPath, `${JSON.stringify({
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: '2026-08-15T00:10:00.000Z',
    launches: [{
      launchId: secret,
      projectPath: project,
      workspaceName: 'repo',
      cliTool: 'codex',
      resumeSessionId: privacyThreadId,
      launchedAt: '2026-08-15T00:09:00.000Z'
    }],
    sessions: []
  })}\n`, 'utf8');
  const common = [
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--ccpanes-snapshot', snapshotPath
  ];

  const scan = JSON.parse(await runCli([
    'codex-sessions', 'scan',
    ...common,
    '--out', path.join(root, 'live', 'privacy-index.json')
  ]));
  const scanned = scan.sessions.find(
    (session: { threadId: string }) => session.threadId === privacyThreadId
  );
  expect(scanned).toMatchObject({
    projectRelation: 'unrelated',
    relationConfidence: 0,
    projectOwner: null
  });
  expect(JSON.stringify(scan)).not.toContain(secret);

  const resolution = JSON.parse(await runCli([
    'codex-sessions', 'resolve',
    ...common,
    '--json',
    '--include-related',
    '--include-ambient'
  ]));
  expect(resolution.sessions.some(
    (session: { threadId: string }) => session.threadId === privacyThreadId
  )).toBe(false);
  expect(JSON.stringify(resolution)).not.toContain(secret);

  const retention = JSON.parse(await runCli([
    'codex-sessions', 'retention',
    ...common,
    '--out', path.join(root, 'live', 'privacy-retention.json')
  ]));
  expect(retention.sessions.find(
    (session: { threadId: string }) => session.threadId === privacyThreadId
  )).toMatchObject({ projectOwner: null });
  expect(JSON.stringify(retention)).not.toContain(secret);
});

test('resolve uses snapshot enrichment to include an otherwise unrelated thread', async () => {
  await writeRollout({
    threadId: 'snapshot-only',
    cwd: 'C:\\Other'
  });
  const common = [
    'codex-sessions', 'resolve',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--json'
  ];
  const withoutSnapshot = JSON.parse(await runCli(common));
  expect(withoutSnapshot.sessions.map((session: { threadId: string }) => session.threadId))
    .not.toContain('snapshot-only');

  const snapshotPath = await writeSnapshot('snapshot-only');
  const withSnapshot = JSON.parse(await runCli([
    ...common,
    '--ccpanes-snapshot', snapshotPath
  ]));
  expect(withSnapshot.sessions.find(
    (session: { threadId: string }) => session.threadId === 'snapshot-only'
  )).toMatchObject({
    projectRelation: 'owned',
    relationConfidence: 1,
    evidence: expect.arrayContaining([{
      kind: 'ccpanes-launch',
      projectPath: 'd:/repo',
      launchId: 'launch-1'
    }])
  });
});

test('graph writes and returns the enriched session federation', async () => {
  const snapshotPath = await writeSnapshot();
  const graphPath = path.join(root, 'live', 'graph.json');
  const graph = JSON.parse(await runCli([
    'codex-sessions', 'graph',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--ccpanes-snapshot', snapshotPath,
    '--out', graphPath
  ]));

  expect(graph.schemaVersion).toBe('hooks.session-federation/v1');
  expect(graph.nodes.find((node: { id: string }) => node.id === 'codex-thread:thread-1'))
    .toMatchObject({ attributes: { projectRelation: 'owned' } });
  expect(JSON.parse(await fs.readFile(graphPath, 'utf8'))).toEqual(graph);
});

test('graph accepts trimmed 512-character thread IDs through snapshot validation', async () => {
  const resumedId = `R${'r'.repeat(511)}`;
  const observedId = `O${'o'.repeat(511)}`;
  const snapshotPath = await writeThreadBoundarySnapshot({
    resumeSessionId: `  ${resumedId}  `,
    observedCodexThreadId: `  ${observedId}  `,
    filename: 'thread-boundary-512.json'
  });
  const graphPath = path.join(root, 'live', 'thread-boundary-512.json');

  const graph = JSON.parse(await runCli([
    'codex-sessions', 'graph',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--ccpanes-snapshot', snapshotPath,
    '--out', graphPath
  ]));

  expect(graph.nodes
    .filter((node: { type: string }) => node.type === 'codex-thread')
    .map((node: { externalId: string }) => node.externalId))
    .toEqual(expect.arrayContaining([resumedId, observedId]));
  expect(JSON.parse(await fs.readFile(graphPath, 'utf8'))).toEqual(graph);
});

test.each([
  [
    'launches[0].resumeSessionId',
    (overlong: string) => ({
      resumeSessionId: overlong,
      observedCodexThreadId: null
    })
  ],
  [
    'sessions[0].observedCodexThreadId',
    (overlong: string) => ({
      resumeSessionId: null,
      observedCodexThreadId: overlong
    })
  ]
] as const)(
  'graph rejects a 513-character thread ID at snapshot field %s before indexing',
  async (field, values) => {
    const overlong = `X${'x'.repeat(512)}`;
    const snapshotPath = await writeThreadBoundarySnapshot({
      ...values(overlong),
      filename: `thread-boundary-513-${field.startsWith('launches') ? 'launch' : 'session'}.json`
    });
    const graphPath = path.join(
      root,
      'live',
      `thread-boundary-513-${field.startsWith('launches') ? 'launch' : 'session'}.json`
    );
    clearCodexSessionIoMocks();

    const error = await rejectedError(runCli([
      'codex-sessions', 'graph',
      '--sessions-dir', sessionsDir,
      '--state-db', stateDb,
      '--thread-history-db', historyDb,
      '--project', project,
      '--ccpanes-snapshot', snapshotPath,
      '--out', graphPath
    ]));

    expect(error.message).toBe(`invalid CC-Panes snapshot: ${field}`);
    expect(error.message).not.toContain(overlong);
    expect(JSON.stringify(error)).not.toContain(overlong);
    expect(codexSessionIoMocks.buildCodexSessionIndex).not.toHaveBeenCalled();
    await expect(fs.stat(graphPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }
);

test('graph defaults output to the temporary cwd live directory', async () => {
  const snapshotPath = await writeSnapshot();
  const temporaryCwd = path.join(root, 'graph-cwd');
  const originalCwd = process.cwd();
  await fs.mkdir(temporaryCwd, { recursive: true });
  try {
    process.chdir(temporaryCwd);
    const stdout = await runCli([
      'codex-sessions', 'graph',
      '--sessions-dir', sessionsDir,
      '--state-db', stateDb,
      '--thread-history-db', historyDb,
      '--project', project,
      '--ccpanes-snapshot', snapshotPath
    ]);
    const graphPath = path.join(temporaryCwd, 'live', 'session-federation.json');
    expect(JSON.parse(stdout).schemaVersion).toBe('hooks.session-federation/v1');
    expect(await fs.readFile(graphPath, 'utf8')).toBe(stdout);
  } finally {
    process.chdir(originalCwd);
  }
});

test.each([
  ['invalid JSON', '{not-json'],
  ['invalid schema', JSON.stringify({
    schemaVersion: 'hooks.ccpanes-session-snapshot/v2',
    generatedAt: '2026-08-15T00:10:00.000Z',
    launches: [],
    sessions: []
  })],
  ['unreadable', null]
])('%s snapshot fails before creating the requested output', async (_name, snapshotText) => {
  const snapshotPath = path.join(root, 'invalid-snapshot.json');
  const indexPath = path.join(root, 'live', 'invalid-index.json');
  if (snapshotText !== null) {
    await fs.writeFile(snapshotPath, snapshotText, 'utf8');
  }

  clearCodexSessionIoMocks();
  await rejectedError(runCli([
    'codex-sessions', 'scan',
    '--sessions-dir', path.join(root, 'missing', 'sessions'),
    '--state-db', path.join(root, 'missing', 'state.sqlite'),
    '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
    '--project', project,
    '--task-context', path.join(root, 'missing-task-context.json'),
    '--ccpanes-snapshot', snapshotPath,
    '--out', indexPath
  ]));
  expect(codexSessionIoMocks.snapshotReadFile).toHaveBeenCalledTimes(1);
  expect(codexSessionIoMocks.snapshotReadFile)
    .toHaveBeenCalledWith(path.resolve(snapshotPath), 'utf8');
  expect(codexSessionIoMocks.buildCodexSessionIndex).not.toHaveBeenCalled();
  expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  await expect(fs.stat(indexPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each([
  ['invalid JSON', 'invalid-snapshot.json'],
  ['unreadable', 'missing-snapshot.json']
])('unknown action precedes %s snapshot and missing index inputs', async (kind, snapshotName) => {
  const snapshotPath = path.join(root, snapshotName);
  if (kind === 'invalid JSON') {
    await fs.writeFile(snapshotPath, '{not-json', 'utf8');
  }
  await expectCliErrorBeforeIo([
    'codex-sessions', 'unknown-action',
    '--sessions-dir', path.join(root, 'missing', 'sessions'),
    '--state-db', path.join(root, 'missing', 'state.sqlite'),
    '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
    '--project', project,
    '--ccpanes-snapshot', snapshotPath
  ], 'unknown codex-sessions command: unknown-action');
});

test.each(['resolve', 'graph'])(
  '%s missing project precedes missing index inputs',
  async (action) => {
    const outPath = path.join(root, 'live', `${action}-priority.json`);

    await expectCliErrorBeforeIo([
      'codex-sessions', action,
      '--sessions-dir', path.join(root, 'missing', 'sessions'),
      '--state-db', path.join(root, 'missing', 'state.sqlite'),
      '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
      ...(action === 'graph' ? ['--out', outPath] : [])
    ], 'missing --project', outPath);
  }
);

test.each(['scan', 'resolve', 'retention', 'graph'])(
  '%s snapshot requires a non-empty project before any I/O',
  async (action) => {
    const outPath = path.join(root, 'live', `${action}-snapshot-project.json`);
    await expectCliErrorBeforeIo([
      'codex-sessions', action,
      '--sessions-dir', path.join(root, 'missing', 'sessions'),
      '--state-db', path.join(root, 'missing', 'state.sqlite'),
      '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
      '--task-context', path.join(root, 'missing-task-context.json'),
      '--ccpanes-snapshot', path.join(root, 'missing-snapshot.json'),
      ...(action === 'resolve' ? [] : ['--out', outPath])
    ], '--ccpanes-snapshot requires --project', outPath);
  }
);

test.each(['scan', 'resolve', 'retention', 'graph'] as const)(
  '%s rejects an unsafe snapshot project before any I/O',
  async (action) => {
    const secret = `AKIA${'C'.repeat(16)}`;
    const outPath = path.join(root, 'live', `${action}-unsafe-project.json`);
    await expectCliErrorBeforeIo([
      'codex-sessions', action,
      '--sessions-dir', path.join(root, 'missing', 'sessions'),
      '--state-db', path.join(root, 'missing', 'state.sqlite'),
      '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
      '--project', `${project}\\${secret}`,
      '--ccpanes-snapshot', path.join(root, 'missing-snapshot.json'),
      ...(action === 'resolve' ? [] : ['--out', outPath])
    ], 'CODEX_SESSION_FEDERATION_INVARIANT: project: unsafe-project', outPath);
  }
);

test.each([
  ['empty', '--sessions-dir', ''],
  ['whitespace-only', '--sessions-dir', ' \t '],
  ['empty', '--ccpanes-snapshot', ''],
  ['whitespace-only', '--ccpanes-snapshot', ' \t '],
  ['empty', '--out', ''],
  ['whitespace-only', '--out', ' \t ']
])('%s %s value is rejected before any I/O', async (_kind, flag, value) => {
  const snapshotPath = path.join(root, 'invalid-blank-value-snapshot.json');
  const outPath = path.join(root, 'live', 'blank-value.json');
  await fs.writeFile(snapshotPath, '{not-json', 'utf8');
  const args = [
    'codex-sessions', 'scan',
    '--sessions-dir', sessionsDir,
    '--state-db', stateDb,
    '--thread-history-db', historyDb,
    '--project', project,
    '--task-context', path.join(root, 'missing-task-context.json'),
    '--out', outPath
  ];
  if (flag === '--sessions-dir') {
    args.splice(args.indexOf('--sessions-dir'), 2);
  }
  if (flag === '--ccpanes-snapshot') {
    args.push(flag, value);
  } else if (flag === '--out') {
    args.splice(args.indexOf('--out'), 2, flag, value);
    args.push('--ccpanes-snapshot', snapshotPath);
  } else {
    args.push('--ccpanes-snapshot', snapshotPath, flag, value);
  }

  await expectCliErrorBeforeIo(args, `missing value for ${flag}`, outPath);
});

test.each([
  [
    'a terminal value option without a value',
    (outPath: string, snapshotPath: string) => [
      'codex-sessions', 'scan',
      '--out', outPath,
      '--ccpanes-snapshot', snapshotPath,
      '--sessions-dir'
    ],
    'missing value for --sessions-dir'
  ],
  [
    'a following flag instead of a value',
    (outPath: string, snapshotPath: string) => [
      'codex-sessions', 'scan',
      '--sessions-dir', path.join(root, 'missing', 'sessions'),
      '--state-db', path.join(root, 'missing', 'state.sqlite'),
      '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
      '--ccpanes-snapshot', snapshotPath,
      '--project', '--out', outPath
    ],
    'missing value for --project'
  ]
])('%s is rejected before snapshot, index, or output I/O', async (_name, invocation, expectedError) => {
  const snapshotPath = path.join(root, 'invalid-missing-value-snapshot.json');
  const outPath = path.join(root, 'live', 'missing-value.json');
  await fs.writeFile(snapshotPath, '{not-json', 'utf8');

  await expectCliErrorBeforeIo(
    invocation(outPath, snapshotPath),
    expectedError,
    outPath
  );
});

test.each([
  [
    'value option',
    [
      '--project', project,
      '--project', project
    ],
    'duplicate option: --project'
  ],
  [
    'boolean option',
    [
      '--project', project,
      '--json',
      '--json'
    ],
    'duplicate option: --json'
  ]
])('duplicate %s is rejected before unreadable snapshot and missing index inputs', async (_name, optionArgs, expectedError) => {
  await expectCliErrorBeforeIo([
    'codex-sessions', 'resolve',
    '--sessions-dir', path.join(root, 'missing', 'sessions'),
    '--state-db', path.join(root, 'missing', 'state.sqlite'),
    '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
    '--ccpanes-snapshot', path.join(root, 'missing-snapshot.json'),
    ...optionArgs
  ], expectedError);
});

test.each([
  [
    'unknown flag',
    (outPath: string) => ['codex-sessions', 'scan', '--out', outPath, '--unknown'],
    'unknown option: --unknown'
  ],
  [
    'unexpected positional token',
    (outPath: string) => ['codex-sessions', 'scan', '--out', outPath, 'stray'],
    'unexpected positional argument: stray'
  ],
  [
    'value after a boolean flag with project and implicit task context',
    (_outPath: string) => ['codex-sessions', 'resolve', '--project', project, '--json', 'true'],
    'unexpected positional argument: true'
  ],
  [
    'scan-only unsupported boolean',
    (outPath: string) => ['codex-sessions', 'scan', '--out', outPath, '--json'],
    'unsupported option for scan: --json'
  ],
  [
    'resolve-only unsupported output',
    (outPath: string) => ['codex-sessions', 'resolve', '--project', project, '--out', outPath],
    'unsupported option for resolve: --out'
  ]
])('%s is rejected before invalid snapshot, missing index inputs, or output creation', async (_name, invocation, expectedError) => {
  const snapshotPath = path.join(root, 'invalid-parser-priority-snapshot.json');
  const outPath = path.join(root, 'live', 'parser-priority.json');
  await fs.writeFile(snapshotPath, '{not-json', 'utf8');

  await expectCliErrorBeforeIo([
    ...invocation(outPath),
    '--sessions-dir', path.join(root, 'missing', 'sessions'),
    '--state-db', path.join(root, 'missing', 'state.sqlite'),
    '--thread-history-db', path.join(root, 'missing', 'history.sqlite'),
    '--ccpanes-snapshot', snapshotPath
  ], expectedError, outPath);
});

test('sidebar-plan resolves relative paths, selects linked and explicit concrete threads, and closes the client', async () => {
  const temporaryCwd = path.join(root, 'sidebar-plan-cwd');
  const graphPath = path.join(temporaryCwd, 'inputs', 'graph.json');
  const snapshotPath = path.join(temporaryCwd, 'inputs', 'snapshot.json');
  const outPath = path.join(temporaryCwd, 'out', 'plan.json');
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
  await fs.writeFile(
    graphPath,
    JSON.stringify(federationGraph({ secondThread: true })),
    'utf8'
  );
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(appSidebarSnapshot(['thread-1', 'thread-2'])),
    'utf8'
  );
  const client = fakeClient([[
    appThread('thread-1'),
    appThread('thread-2', { name: 'Custom name' })
  ]]);
  const createCodexAppServerClient = vi.fn(() => client);
  const originalCwd = process.cwd();

  try {
    process.chdir(temporaryCwd);
    const stdout = await runCli([
      'codex-sessions', 'sidebar-plan',
      '--graph', path.relative(temporaryCwd, graphPath),
      '--app-sidebar-snapshot', path.relative(temporaryCwd, snapshotPath),
      '--thread-id', 'thread-2',
      '--rename-thread-id', 'thread-2',
      '--out', path.relative(temporaryCwd, outPath)
    ], undefined, { createCodexAppServerClient });
    const plan = JSON.parse(stdout);

    expect(plan.schemaVersion).toBe('hooks.codex-sidebar-plan/v1');
    expect(plan.actions.map((entry: { threadId: string }) => entry.threadId))
      .toEqual(['thread-1', 'thread-2']);
    expect(plan.actions[1]).toMatchObject({
      threadId: 'thread-2',
      currentName: 'Custom name',
      desiredName: '[CC-Panes] Preview thread-2'
    });
    expect(await fs.readFile(outPath, 'utf8')).toBe(stdout);
    expect(codexSessionIoMocks.writeCodexSessionJson)
      .toHaveBeenCalledWith(path.resolve(outPath), plan);
    expect(codexSessionIoMocks.buildCodexSessionIndex).not.toHaveBeenCalled();
    expect(client.initialize).toHaveBeenCalledTimes(1);
    expect(client.listAllThreads).toHaveBeenCalledWith({
      cwd: project,
      sourceKinds: ['cli', 'vscode'],
      archived: false,
      limit: 512,
      useStateDbOnly: true
    });
    expect(client.close).toHaveBeenCalledTimes(1);
  } finally {
    process.chdir(originalCwd);
  }
});

test('sidebar-plan ignores over-capacity unrelated graph threads before candidate validation', async () => {
  const graphPath = path.join(root, 'large-unrelated-graph.json');
  const snapshotPath = path.join(root, 'large-unrelated-snapshot.json');
  const outPath = path.join(root, 'large-unrelated-plan.json');
  const graph = federationGraph({
    secondThread: true,
    linked: false
  });
  const nodes = graph.nodes as Array<Record<string, unknown>>;
  nodes.push(...Array.from({ length: 512 }, (_value, index) => ({
    id: `codex-thread:unrelated-${index}`,
    type: 'codex-thread',
    externalId: `unrelated-${index}`,
    attributes: {
      host: 'codex-app',
      threadSource: 'user',
      storageState: 'active',
      projectRelation: 'unrelated',
      cwdNorm: 'd:/other',
      updatedAt: '2026-08-15T08:00:00.000Z'
    }
  })));
  await fs.writeFile(graphPath, JSON.stringify(graph), 'utf8');
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(appSidebarSnapshot(['thread-2'])),
    'utf8'
  );
  const client = fakeClient([[appThread('thread-2')]]);

  const stdout = await runCli([
    'codex-sessions', 'sidebar-plan',
    '--graph', graphPath,
    '--app-sidebar-snapshot', snapshotPath,
    '--thread-id', 'thread-2',
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  });

  expect(JSON.parse(stdout).actions).toMatchObject([{
    threadId: 'thread-2'
  }]);
});

test('sidebar-plan reads an explicitly selected hidden thread by ID when list omits it', async () => {
  const graphPath = path.join(root, 'hidden-explicit-graph.json');
  const snapshotPath = path.join(root, 'hidden-explicit-snapshot.json');
  const outPath = path.join(root, 'hidden-explicit-plan.json');
  await fs.writeFile(
    graphPath,
    JSON.stringify(federationGraph({
      secondThread: true,
      linked: false
    })),
    'utf8'
  );
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(appSidebarSnapshot(['thread-2'])),
    'utf8'
  );
  const client = fakeClient(
    [[]],
    [appThread('thread-2', {
      name: null,
      preview: 'Hidden explicit thread'
    })]
  );

  const stdout = await runCli([
    'codex-sessions', 'sidebar-plan',
    '--graph', graphPath,
    '--app-sidebar-snapshot', snapshotPath,
    '--thread-id', 'thread-2',
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  });

  expect(JSON.parse(stdout).actions).toMatchObject([{
    threadId: 'thread-2',
    currentName: null,
    desiredName: '[CC-Panes] Hidden explicit thread'
  }]);
  expect(client.readThread).toHaveBeenCalledWith('thread-2');
});

test('sidebar-plan ignores inferred candidates and rejects explicit IDs absent from concrete graph', async () => {
  const graphPath = path.join(root, 'inferred-graph.json');
  const snapshotPath = path.join(root, 'inferred-snapshot.json');
  const outPath = path.join(root, 'inferred-plan.json');
  await fs.writeFile(
    graphPath,
    JSON.stringify(federationGraph({
      secondThread: true,
      inferredThread: true
    })),
    'utf8'
  );
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(appSidebarSnapshot(['thread-1', 'thread-2'])),
    'utf8'
  );
  const client = fakeClient([[
    appThread('thread-1'),
    appThread('thread-2')
  ]]);

  await expectExactErrorMessage(runCli([
    'codex-sessions', 'sidebar-plan',
    '--graph', graphPath,
    '--app-sidebar-snapshot', snapshotPath,
    '--thread-id', 'thread-2',
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  }), 'explicit thread ID is absent from concrete federation graph');
  expect(client.initialize).not.toHaveBeenCalled();
  expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  await expect(fs.stat(outPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('sidebar-plan rejects a second hosts edge before client or output I/O', async () => {
  const graphPath = path.join(root, 'duplicate-hosts-graph.json');
  const snapshotPath = path.join(root, 'duplicate-hosts-snapshot.json');
  const outPath = path.join(root, 'duplicate-hosts-plan.json');
  const graph = federationGraph({
    secondThread: true,
    linked: false
  });
  (graph.nodes as Array<Record<string, unknown>>).push({
    id: 'ccpanes-session:pty-1',
    type: 'ccpanes-session',
    externalId: 'pty-1',
    attributes: {
      status: 'active',
      title: null,
      projectPathNorm: 'd:/repo'
    }
  });
  graph.edges = [
    {
      id: 'hosts:ccpanes-session:pty-1->codex-thread:thread-1',
      type: 'hosts',
      from: 'ccpanes-session:pty-1',
      to: 'codex-thread:thread-1',
      confidence: 1,
      evidence: [{
        kind: 'snapshot-field',
        field: 'session.observedCodexThreadId',
        value: 'thread-1'
      }],
      observedAt: '2026-08-15T09:00:00.000Z'
    },
    {
      id: 'hosts:ccpanes-session:pty-1->codex-thread:thread-2',
      type: 'hosts',
      from: 'ccpanes-session:pty-1',
      to: 'codex-thread:thread-2',
      confidence: 1,
      evidence: [{
        kind: 'snapshot-field',
        field: 'session.observedCodexThreadId',
        value: 'thread-2'
      }],
      observedAt: '2026-08-15T09:00:00.000Z'
    }
  ];
  await fs.writeFile(graphPath, JSON.stringify(graph), 'utf8');
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(appSidebarSnapshot(['thread-1', 'thread-2'])),
    'utf8'
  );
  const createCodexAppServerClient = vi.fn(() => {
    throw new Error('client factory must not run');
  });
  clearCodexSessionIoMocks();

  const error = await rejectedError(runCli([
    'codex-sessions', 'sidebar-plan',
    '--graph', graphPath,
    '--app-sidebar-snapshot', snapshotPath,
    '--out', outPath
  ], undefined, { createCodexAppServerClient }));

  expect(error).toMatchObject({
    name: 'SessionFederationArtifactError',
    field: 'edges[1]',
    reason: 'invalid-shape'
  });
  expect(codexSessionIoMocks.snapshotReadFile).toHaveBeenCalledTimes(1);
  expect(createCodexAppServerClient).not.toHaveBeenCalled();
  expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  await expect(fs.stat(outPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('sidebar-apply confirms the plan, performs fresh rereads, validates output, and closes the client', async () => {
  const plan = createSidebarPlan({
    project,
    generatedAt: '2026-08-15T09:00:00.000Z',
    candidates: [{
      threadId: 'thread-1',
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
      originalTitle: 'Preview thread-1'
    }]
  });
  const planPath = path.join(root, 'sidebar-plan.json');
  const outPath = path.join(root, 'sidebar-apply.json');
  await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
  const desiredName = plan.actions[0]!.desiredName;
  const client = fakeClient(
    [[appThread('thread-1')]],
    [appThread('thread-1', { name: desiredName })]
  );

  const stdout = await runCli([
    'codex-sessions', 'sidebar-apply',
    '--plan', planPath,
    '--confirm-digest', plan.digest,
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  });
  const result = JSON.parse(stdout);

  expect(result.schemaVersion).toBe('hooks.codex-sidebar-apply/v1');
  expect(result.entries).toMatchObject([{
    threadId: 'thread-1',
    status: 'name-applied'
  }]);
  expect(result.pendingHostActions[0]).toMatchObject({
    planDigest: plan.digest,
    executionDigest: result.executionDigest,
    threadId: 'thread-1'
  });
  expect(client.setThreadName)
    .toHaveBeenCalledWith('thread-1', desiredName);
  expect(client.listAllThreads).toHaveBeenCalledTimes(1);
  expect(client.listAllThreads).toHaveBeenNthCalledWith(1, {
    cwd: project,
    sourceKinds: ['cli', 'vscode'],
    archived: false,
    limit: 512,
    useStateDbOnly: true
  });
  expect(client.readThread).toHaveBeenCalledWith('thread-1');
  expect(client.close).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(outPath, 'utf8')).toBe(stdout);
});

test('sidebar-apply reads a hidden planned thread by ID before and after naming', async () => {
  const plan = actionableSidebarPlan();
  const planPath = path.join(root, 'hidden-sidebar-plan.json');
  const outPath = path.join(root, 'hidden-sidebar-apply.json');
  await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
  const desiredName = plan.actions[0]!.desiredName;
  const client = fakeClient(
    [[]],
    [
      appThread('thread-1'),
      appThread('thread-1', { name: desiredName })
    ]
  );

  const result = JSON.parse(await runCli([
    'codex-sessions', 'sidebar-apply',
    '--plan', planPath,
    '--confirm-digest', plan.digest,
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  }));

  expect(result.entries).toMatchObject([{
    threadId: 'thread-1',
    previousName: null,
    finalName: desiredName,
    status: 'name-applied'
  }]);
  expect(client.readThread).toHaveBeenNthCalledWith(1, 'thread-1');
  expect(client.readThread).toHaveBeenNthCalledWith(2, 'thread-1');
  expect(client.setThreadName)
    .toHaveBeenCalledWith('thread-1', desiredName);
});

test('sidebar-reconcile and sidebar-rollback-plan write validated artifacts without native mutation', async () => {
  const plan = createSidebarPlan({
    project,
    generatedAt: '2026-08-15T09:00:00.000Z',
    candidates: []
  });
  const apply = applyResultWithPreviousName(null);
  const receipt = receiptForApply(apply);
  const planPath = path.join(root, 'reconcile-plan.json');
  const applyPath = path.join(root, 'rollback-apply.json');
  const receiptPath = path.join(root, 'host-receipt.json');
  const snapshotPath = path.join(root, 'after-snapshot.json');
  const reconcilePath = path.join(root, 'reconcile.json');
  const rollbackPath = path.join(root, 'rollback.json');
  await Promise.all([
    fs.writeFile(planPath, JSON.stringify(plan), 'utf8'),
    fs.writeFile(applyPath, JSON.stringify(apply), 'utf8'),
    fs.writeFile(receiptPath, JSON.stringify(receipt), 'utf8'),
    fs.writeFile(
      snapshotPath,
      JSON.stringify({
        ...appSidebarSnapshot(),
        generatedAt: '2026-08-15T09:04:00.000Z',
        threads: [{
          threadId: 'thread-1',
          listed: true,
          readable: true,
          pinned: true
        }]
      }),
      'utf8'
    )
  ]);
  const createCodexAppServerClient = vi.fn(() => fakeClient([]));

  const reconciliation = JSON.parse(await runCli([
    'codex-sessions', 'sidebar-reconcile',
    '--plan', planPath,
    '--host-receipt', receiptPath,
    '--app-sidebar-snapshot', snapshotPath,
    '--out', reconcilePath
  ], undefined, { createCodexAppServerClient }));
  const rollback = JSON.parse(await runCli([
    'codex-sessions', 'sidebar-rollback-plan',
    '--apply', applyPath,
    '--host-receipt', receiptPath,
    '--out', rollbackPath
  ], undefined, { createCodexAppServerClient }));

  expect(reconciliation).toMatchObject({
    schemaVersion: 'hooks.codex-sidebar-reconciliation/v1',
    planDigest: plan.digest
  });
  expect(rollback).toMatchObject({
    schemaVersion: 'hooks.codex-sidebar-rollback-plan/v1',
    executable: false,
    actions: [{
      threadId: 'thread-1',
      restoreName: null,
      nameAdapter: 'unsupported-clear-name-on-codex-0.147.0'
    }]
  });
  expect(createCodexAppServerClient).not.toHaveBeenCalled();
  expect(await fs.readFile(reconcilePath, 'utf8'))
    .toBe(`${JSON.stringify(reconciliation, null, 2)}\n`);
  expect(await fs.readFile(rollbackPath, 'utf8'))
    .toBe(`${JSON.stringify(rollback, null, 2)}\n`);
});

test.each([
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out', 'o', '--unknown', 'x'],
    'unknown option: --unknown'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out', 'o', '--project', project],
    'unsupported option for sidebar-plan: --project'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--graph', 'g2', '--app-sidebar-snapshot', 's', '--out', 'o'],
    'duplicate option: --graph'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out', 'o', '--thread-id', 'thread-1', '--thread-id', 'thread-1'],
    'duplicate value for --thread-id'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out'],
    'missing value for --out'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out', 'o', 'stray'],
    'unexpected positional argument: stray'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's'],
    'missing --out'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out', 'o', '--thread-id', 'bad id'],
    'invalid --thread-id'
  ],
  [
    ['codex-sessions', 'sidebar-plan', '--graph', 'g', '--app-sidebar-snapshot', 's', '--out', 'o', '--rename-thread-id', 'thread-1'],
    '--rename-thread-id requires matching --thread-id'
  ],
  [
    ['codex-sessions', 'sidebar-apply', '--plan', 'p', '--confirm-digest', 'nope', '--out', 'o'],
    'invalid --confirm-digest'
  ],
  [
    ['codex-sessions', 'sidebar-apply', '--plan', 'p', '--confirm-digest', 'a'.repeat(64)],
    'missing --out'
  ],
  [
    ['codex-sessions', 'sidebar-reconcile', '--plan', 'p', '--host-receipt', 'r', '--out', 'o'],
    'missing --app-sidebar-snapshot'
  ],
  [
    ['codex-sessions', 'sidebar-rollback-plan', '--apply', 'a', '--host-receipt', 'r'],
    'missing --out'
  ]
] as const)('sidebar parser rejects invalid invocation before any I/O: %s', async (args, message) => {
  await expectCliErrorBeforeIo([...args], message);
});

test.each([
  '',
  `a${'b'.repeat(512)}`,
  ' leading',
  'trailing ',
  'thread/with/slash',
  'thread\nwith-control',
  'sk-proj-secret-shaped'
])('sidebar parser rejects core-invalid thread IDs without exposing them: %j', async (threadId) => {
  expect(isCodexThreadId(threadId)).toBe(false);
  const threadErrorMessage = threadId === ''
    ? 'missing value for --thread-id'
    : 'invalid --thread-id';
  const renameErrorMessage = threadId === ''
    ? 'missing value for --rename-thread-id'
    : 'invalid --rename-thread-id';
  const threadError = await rejectedError(runCli([
    'codex-sessions',
    'sidebar-plan',
    '--graph', 'g',
    '--app-sidebar-snapshot', 's',
    '--out', 'o',
    '--thread-id', threadId
  ]));
  expect(threadError.message).toBe(threadErrorMessage);
  if (threadId) expect(threadError.message).not.toContain(threadId);

  const renameError = await rejectedError(runCli([
    'codex-sessions',
    'sidebar-plan',
    '--graph', 'g',
    '--app-sidebar-snapshot', 's',
    '--out', 'o',
    '--thread-id', 'thread-1',
    '--rename-thread-id', threadId
  ]));
  expect(renameError.message).toBe(renameErrorMessage);
  if (threadId) expect(renameError.message).not.toContain(threadId);
});

test('sidebar-plan accepts exactly 512 unique values for each repeatable option', async () => {
  const threadIds = Array.from(
    { length: 512 },
    (_, index) => `parser-thread-${index}`
  );
  const graphPath = path.join(root, 'missing-parser-512-graph.json');
  const snapshotPath = path.join(root, 'missing-parser-512-snapshot.json');
  const outPath = path.join(root, 'parser-512-plan.json');
  const createCodexAppServerClient = vi.fn(() => fakeClient([]));
  clearCodexSessionIoMocks();

  const error = await rejectedError(runCli([
    'codex-sessions', 'sidebar-plan',
    '--graph', graphPath,
    '--app-sidebar-snapshot', snapshotPath,
    '--out', outPath,
    ...threadIds.flatMap((threadId) => ['--thread-id', threadId]),
    ...threadIds.flatMap((threadId) => ['--rename-thread-id', threadId])
  ], undefined, { createCodexAppServerClient }));

  expect(error).toMatchObject({ code: 'ENOENT' });
  expect(codexSessionIoMocks.snapshotReadFile).toHaveBeenCalledTimes(1);
  expect(codexSessionIoMocks.snapshotReadFile)
    .toHaveBeenCalledWith(graphPath, 'utf8');
  expect(createCodexAppServerClient).not.toHaveBeenCalled();
  expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  await expect(fs.stat(outPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each([
  [
    '--thread-id',
    () => Array.from(
      { length: 513 },
      (_, index) => ['--thread-id', `parser-thread-${index}`]
    ).flat()
  ],
  [
    '--rename-thread-id',
    () => {
      const threadIds = Array.from(
        { length: 512 },
        (_, index) => `parser-thread-${index}`
      );
      return [
        ...threadIds.flatMap((threadId) => ['--thread-id', threadId]),
        ...Array.from(
          { length: 513 },
          (_, index) => ['--rename-thread-id', `parser-thread-${index}`]
        ).flat()
      ];
    }
  ]
] as const)(
  'sidebar-plan rejects the 513th %s value immediately before later parsing or I/O',
  async (_option, repeatableArgs) => {
    await expectCliErrorBeforeIo([
      'codex-sessions', 'sidebar-plan',
      '--graph', 'g',
      '--app-sidebar-snapshot', 's',
      '--out', 'o',
      ...repeatableArgs(),
      '--unknown', 'x'
    ], 'too many thread IDs');
  }
);

test.each([
  ['graph validation', async (outPath: string) => {
    const graphPath = path.join(root, 'invalid-federation.json');
    const snapshotPath = path.join(root, 'valid-sidebar-snapshot.json');
    await fs.writeFile(
      graphPath,
      JSON.stringify({ ...federationGraph(), unexpected: true }),
      'utf8'
    );
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(appSidebarSnapshot()),
      'utf8'
    );
    await runCli([
      'codex-sessions', 'sidebar-plan',
      '--graph', graphPath,
      '--app-sidebar-snapshot', snapshotPath,
      '--out', outPath
    ], undefined, {
      createCodexAppServerClient: () => fakeClient([])
    });
  }],
  ['client initialization', async (outPath: string) => {
    const graphPath = path.join(root, 'valid-federation.json');
    const snapshotPath = path.join(root, 'valid-sidebar-snapshot.json');
    await fs.writeFile(graphPath, JSON.stringify(federationGraph()), 'utf8');
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(appSidebarSnapshot()),
      'utf8'
    );
    const client = fakeClient([]);
    client.initialize.mockRejectedValueOnce(new Error('PRIVATE CLIENT ERROR'));
    await runCli([
      'codex-sessions', 'sidebar-plan',
      '--graph', graphPath,
      '--app-sidebar-snapshot', snapshotPath,
      '--out', outPath
    ], undefined, {
      createCodexAppServerClient: () => client
    });
  }],
  ['output writer', async (outPath: string) => {
    const graphPath = path.join(root, 'valid-federation.json');
    const snapshotPath = path.join(root, 'valid-sidebar-snapshot.json');
    await fs.writeFile(graphPath, JSON.stringify(federationGraph()), 'utf8');
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(appSidebarSnapshot()),
      'utf8'
    );
    codexSessionIoMocks.writeCodexSessionJson
      .mockRejectedValueOnce(new Error('PRIVATE WRITE ERROR'));
    await runCli([
      'codex-sessions', 'sidebar-plan',
      '--graph', graphPath,
      '--app-sidebar-snapshot', snapshotPath,
      '--out', outPath
    ], undefined, {
      createCodexAppServerClient: () => fakeClient([[appThread('thread-1')]])
    });
  }]
] as const)('sidebar-plan %s failure leaves output absent', async (_case, run) => {
  const outPath = path.join(root, `failure-${_case}.json`);
  await rejectedError(run(outPath));
  await expect(fs.stat(outPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('sidebar-apply initial client list failure closes the client and leaves output absent', async () => {
  const plan = createSidebarPlan({
    project,
    generatedAt: '2026-08-15T09:00:00.000Z',
    candidates: []
  });
  const planPath = path.join(root, 'apply-client-failure-plan.json');
  const outPath = path.join(root, 'apply-client-failure.json');
  await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
  const client = fakeClient([]);
  client.listAllThreads.mockRejectedValueOnce(new Error('PRIVATE LIST ERROR'));

  await rejectedError(runCli([
    'codex-sessions', 'sidebar-apply',
    '--plan', planPath,
    '--confirm-digest', plan.digest,
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  }));

  expect(client.close).toHaveBeenCalledTimes(1);
  expect(codexSessionIoMocks.writeCodexSessionJson).not.toHaveBeenCalled();
  await expect(fs.stat(outPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each([
  ['factory', 'factory'],
  ['initialize', 'initialize'],
  ['plan-list', 'plan-list'],
  ['close', 'close'],
  ['operation and close', 'plan-list']
] as const)(
  'sidebar-plan maps secret-bearing %s client failures to fixed typed errors',
  async (failure, expectedStage) => {
    const secret = `PRIVATE_${failure.replaceAll(' ', '_').toUpperCase()}_SECRET`;
    const closeSecret = 'PRIVATE_CLOSE_OVERRIDE_SECRET';
    const graphPath = path.join(root, `privacy-${failure}-graph.json`);
    const snapshotPath = path.join(root, `privacy-${failure}-snapshot.json`);
    const outPath = path.join(root, `privacy-${failure}-out.json`);
    await fs.writeFile(graphPath, JSON.stringify(federationGraph()), 'utf8');
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(appSidebarSnapshot()),
      'utf8'
    );
    const client = fakeClient([[appThread('thread-1')]]);
    if (failure === 'initialize') {
      client.initialize.mockRejectedValueOnce(new Error(secret));
    } else if (failure === 'plan-list' || failure === 'operation and close') {
      client.listAllThreads.mockRejectedValueOnce(new Error(secret));
    }
    if (failure === 'close' || failure === 'operation and close') {
      client.close.mockRejectedValueOnce(new Error(
        failure === 'close' ? secret : closeSecret
      ));
    }
    const createCodexAppServerClient = vi.fn(() => {
      if (failure === 'factory') throw new Error(secret);
      return client;
    });

    await expectPrivacySafeClientFailure({
      run: () => runCli([
        'codex-sessions', 'sidebar-plan',
        '--graph', graphPath,
        '--app-sidebar-snapshot', snapshotPath,
        '--out', outPath
      ], undefined, { createCodexAppServerClient }),
      outPath,
      stage: expectedStage,
      secrets: failure === 'operation and close'
        ? [secret, closeSecret]
        : [secret]
    });
    if (failure !== 'factory') {
      expect(client.close).toHaveBeenCalledTimes(1);
    }
  }
);

test.each([
  ['initial list', 'apply-list-initial']
] as const)(
  'sidebar-apply maps secret-bearing %s failure and suppresses artifacts',
  async (failure, expectedStage) => {
    const secret = `PRIVATE_APPLY_${failure.replaceAll(' ', '_').toUpperCase()}_SECRET`;
    const plan = actionableSidebarPlan();
    const planPath = path.join(root, `privacy-apply-${failure}-plan.json`);
    const outPath = path.join(root, `privacy-apply-${failure}-out.json`);
    await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
    const desiredName = plan.actions[0]!.desiredName;
    const client = fakeClient([
      [appThread('thread-1')],
      [appThread('thread-1', { name: desiredName })]
    ]);
    client.listAllThreads.mockRejectedValueOnce(new Error(secret));

    await expectPrivacySafeClientFailure({
      run: () => runCli([
        'codex-sessions', 'sidebar-apply',
        '--plan', planPath,
        '--confirm-digest', plan.digest,
        '--out', outPath
      ], undefined, {
        createCodexAppServerClient: () => client
      }),
      outPath,
      stage: expectedStage,
      secrets: [secret]
    });
    expect(client.close).toHaveBeenCalledTimes(1);
  }
);

test.each([
  ['desired reread', 'name-applied', null, true],
  ['previous reread', 'failed', 'name-not-applied', false]
] as const)(
  'sidebar-apply classifies secret-bearing set failure from %s evidence',
  async (_case, expectedStatus, expectedError, rereadDesired) => {
    const secret = `PRIVATE_APPLY_SET_${_case.replaceAll(' ', '_').toUpperCase()}_SECRET`;
    const plan = actionableSidebarPlan();
    const planPath = path.join(root, `apply-set-${_case}-plan.json`);
    const outPath = path.join(root, `apply-set-${_case}-out.json`);
    await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
    const desiredName = plan.actions[0]!.desiredName;
    const client = fakeClient(
      [[appThread('thread-1')]],
      [appThread('thread-1', {
        name: rereadDesired ? desiredName : null
      })]
    );
    client.setThreadName.mockRejectedValueOnce(new Error(secret));

    const stdout = await runCli([
      'codex-sessions', 'sidebar-apply',
      '--plan', planPath,
      '--confirm-digest', plan.digest,
      '--out', outPath
    ], undefined, {
      createCodexAppServerClient: () => client
    });
    const result = JSON.parse(stdout);
    const artifact = await fs.readFile(outPath, 'utf8');

    expect(result.entries[0]).toMatchObject({
      status: expectedStatus,
      error: expectedError
    });
    expect(`${stdout}\n${JSON.stringify(result)}\n${artifact}`)
      .not.toContain(secret);
    expect(artifact).toBe(stdout);
    expect(client.close).toHaveBeenCalledTimes(1);
  }
);

test('sidebar-apply emits privacy-safe unknown when fresh reread fails', async () => {
  const secret = 'PRIVATE_APPLY_READ_SECRET';
  const plan = actionableSidebarPlan();
  const planPath = path.join(root, 'apply-read-error-plan.json');
  const outPath = path.join(root, 'apply-read-error-out.json');
  await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
  const client = fakeClient([[appThread('thread-1')]]);
  client.readThread.mockRejectedValueOnce(new Error(secret));

  const stdout = await runCli([
    'codex-sessions', 'sidebar-apply',
    '--plan', planPath,
    '--confirm-digest', plan.digest,
    '--out', outPath
  ], undefined, {
    createCodexAppServerClient: () => client
  });
  const result = JSON.parse(stdout);
  const artifact = await fs.readFile(outPath, 'utf8');

  expect(result.entries[0]).toMatchObject({
    status: 'unknown',
    error: 'name-outcome-unknown',
    finalName: null
  });
  expect(`${stdout}\n${JSON.stringify(result)}\n${artifact}`)
    .not.toContain(secret);
  expect(artifact).toBe(stdout);
  expect(client.close).toHaveBeenCalledTimes(1);
});
