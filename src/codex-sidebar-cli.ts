import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CodexAppServerClient,
  spawnCodexAppServer,
  type AppServerThread,
  type ThreadListParams
} from './codex-app-server-client.js';
import { isCodexThreadId } from './codex-session-identity.js';
import { writeCodexSessionJson } from './codex-session-index.js';
import {
  applySidebarPlan,
  createSidebarPlan,
  createSidebarReconciliation,
  createSidebarRollbackPlan,
  validateCodexAppSidebarSnapshot,
  validateSidebarApplyResult,
  validateSidebarHostReceipt,
  validateSidebarPlan,
  validateSidebarReconciliation,
  validateSidebarRollbackPlan,
  type SidebarCandidate
} from './codex-sidebar.js';
import {
  validateSessionFederationArtifact
} from './session-federation-artifact.js';
import type {
  FederationNode,
  SessionFederation
} from './session-federation.js';

export type CodexSidebarCliAction =
  | 'sidebar-plan'
  | 'sidebar-apply'
  | 'sidebar-reconcile'
  | 'sidebar-rollback-plan';

export interface CodexAppServerClientLike {
  initialize(): Promise<void>;
  listAllThreads(params: ThreadListParams): Promise<AppServerThread[]>;
  readThread(threadId: string): Promise<AppServerThread | null>;
  setThreadName(threadId: string, name: string): Promise<void>;
  close(): Promise<void>;
}

export type CreateCodexAppServerClient =
  () => CodexAppServerClientLike;

export type CodexSidebarCliClientErrorStage =
  | 'factory'
  | 'initialize'
  | 'plan-list'
  | 'plan-read-explicit'
  | 'apply-list-initial'
  | 'apply-read-initial'
  | 'close';

export class CodexSidebarCliClientError extends Error {
  readonly code = 'CODEX_SIDEBAR_CLI_CLIENT' as const;
  readonly field = 'appServerClient' as const;
  readonly reason = 'client-failure' as const;

  constructor(readonly stage: CodexSidebarCliClientErrorStage) {
    super(
      `CODEX_SIDEBAR_CLI_CLIENT: appServerClient: ${stage}: client-failure`
    );
    this.name = 'CodexSidebarCliClientError';
  }
}

interface SidebarPlanCliOptions {
  action: 'sidebar-plan';
  graphPath: string;
  snapshotPath: string;
  outPath: string;
  threadIds: ReadonlySet<string>;
  renameThreadIds: ReadonlySet<string>;
}

interface SidebarApplyCliOptions {
  action: 'sidebar-apply';
  planPath: string;
  confirmDigest: string;
  outPath: string;
}

interface SidebarReconcileCliOptions {
  action: 'sidebar-reconcile';
  planPath: string;
  receiptPath: string;
  snapshotPath: string;
  outPath: string;
}

interface SidebarRollbackCliOptions {
  action: 'sidebar-rollback-plan';
  applyPath: string;
  receiptPath: string;
  outPath: string;
}

type SidebarCliOptions =
  | SidebarPlanCliOptions
  | SidebarApplyCliOptions
  | SidebarReconcileCliOptions
  | SidebarRollbackCliOptions;

const ACTION_OPTIONS: Record<
  CodexSidebarCliAction,
  ReadonlySet<string>
> = {
  'sidebar-plan': new Set([
    '--graph',
    '--app-sidebar-snapshot',
    '--out',
    '--thread-id',
    '--rename-thread-id'
  ]),
  'sidebar-apply': new Set([
    '--plan',
    '--confirm-digest',
    '--out'
  ]),
  'sidebar-reconcile': new Set([
    '--plan',
    '--host-receipt',
    '--app-sidebar-snapshot',
    '--out'
  ]),
  'sidebar-rollback-plan': new Set([
    '--apply',
    '--host-receipt',
    '--out'
  ])
};

const REPEATABLE_OPTIONS = new Set([
  '--thread-id',
  '--rename-thread-id'
]);

const KNOWN_CODEX_SESSION_OPTIONS = new Set([
  ...Object.values(ACTION_OPTIONS).flatMap((options) => [...options]),
  '--sessions-dir',
  '--state-db',
  '--thread-history-db',
  '--project',
  '--task-context',
  '--ccpanes-snapshot',
  '--json',
  '--include-archived',
  '--include-subagents',
  '--include-related',
  '--include-ambient'
]);

const LIST_PARAMS = (project: string): ThreadListParams => ({
  cwd: project,
  sourceKinds: ['cli', 'vscode'],
  archived: false,
  limit: 512,
  useStateDbOnly: true
});

export function isCodexSidebarCliAction(
  value: string | undefined
): value is CodexSidebarCliAction {
  return value === 'sidebar-plan' ||
    value === 'sidebar-apply' ||
    value === 'sidebar-reconcile' ||
    value === 'sidebar-rollback-plan';
}

function required(
  values: ReadonlyMap<string, string>,
  option: string
): string {
  const value = values.get(option);
  if (!value) throw new Error(`missing ${option}`);
  return value;
}

function resolvedPath(value: string): string {
  return path.resolve(process.cwd(), value);
}

function parseSidebarCliOptions(
  action: CodexSidebarCliAction,
  args: string[]
): SidebarCliOptions {
  const allowed = ACTION_OPTIONS[action];
  const values = new Map<string, string>();
  const repeated = new Map<string, Set<string>>();
  const seen = new Set<string>();

  for (let index = 0; index < args.length;) {
    const option = args[index]!;
    if (!option.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${option}`);
    }
    if (!KNOWN_CODEX_SESSION_OPTIONS.has(option)) {
      throw new Error(`unknown option: ${option}`);
    }
    if (!allowed.has(option)) {
      throw new Error(`unsupported option for ${action}: ${option}`);
    }
    if (!REPEATABLE_OPTIONS.has(option) && seen.has(option)) {
      throw new Error(`duplicate option: ${option}`);
    }
    seen.add(option);

    const value = args[index + 1];
    if (
      value === undefined ||
      value.startsWith('--') ||
      value.trim().length === 0
    ) {
      throw new Error(`missing value for ${option}`);
    }
    if (REPEATABLE_OPTIONS.has(option)) {
      const optionValues = repeated.get(option) ?? new Set<string>();
      if (optionValues.has(value)) {
        throw new Error(`duplicate value for ${option}`);
      }
      if (optionValues.size >= 512) {
        throw new Error('too many thread IDs');
      }
      optionValues.add(value);
      repeated.set(option, optionValues);
    } else {
      values.set(option, value);
    }
    index += 2;
  }

  if (action === 'sidebar-plan') {
    const threadIds = repeated.get('--thread-id') ?? new Set<string>();
    const renameThreadIds =
      repeated.get('--rename-thread-id') ?? new Set<string>();
    for (const threadId of threadIds) {
      if (!isCodexThreadId(threadId)) {
        throw new Error('invalid --thread-id');
      }
    }
    for (const threadId of renameThreadIds) {
      if (!isCodexThreadId(threadId)) {
        throw new Error('invalid --rename-thread-id');
      }
      if (!threadIds.has(threadId)) {
        throw new Error(
          '--rename-thread-id requires matching --thread-id'
        );
      }
    }
    return {
      action,
      graphPath: resolvedPath(required(values, '--graph')),
      snapshotPath: resolvedPath(
        required(values, '--app-sidebar-snapshot')
      ),
      outPath: resolvedPath(required(values, '--out')),
      threadIds,
      renameThreadIds
    };
  }
  if (action === 'sidebar-apply') {
    const confirmDigest = required(values, '--confirm-digest');
    if (!/^[a-f0-9]{64}$/u.test(confirmDigest)) {
      throw new Error('invalid --confirm-digest');
    }
    return {
      action,
      planPath: resolvedPath(required(values, '--plan')),
      confirmDigest,
      outPath: resolvedPath(required(values, '--out'))
    };
  }
  if (action === 'sidebar-reconcile') {
    return {
      action,
      planPath: resolvedPath(required(values, '--plan')),
      receiptPath: resolvedPath(required(values, '--host-receipt')),
      snapshotPath: resolvedPath(
        required(values, '--app-sidebar-snapshot')
      ),
      outPath: resolvedPath(required(values, '--out'))
    };
  }
  return {
    action,
    applyPath: resolvedPath(required(values, '--apply')),
    receiptPath: resolvedPath(required(values, '--host-receipt')),
    outPath: resolvedPath(required(values, '--out'))
  };
}

async function readValidated<T>(
  filePath: string,
  validator: (value: unknown) => T
): Promise<T> {
  return validator(JSON.parse(await readFile(filePath, 'utf8')));
}

async function withClient<T>(
  factory: CreateCodexAppServerClient,
  operation: (client: CodexAppServerClientLike) => Promise<T>
): Promise<T> {
  let client: CodexAppServerClientLike;
  try {
    client = factory();
  } catch {
    throw new CodexSidebarCliClientError('factory');
  }
  let primaryFailed = false;
  try {
    await clientCall('initialize', () => client.initialize());
    return await operation(client);
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    try {
      await client.close();
    } catch {
      if (!primaryFailed) {
        throw new CodexSidebarCliClientError('close');
      }
    }
  }
}

async function clientCall<T>(
  stage: CodexSidebarCliClientErrorStage,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new CodexSidebarCliClientError(stage);
  }
}

function defaultClientFactory(): CodexAppServerClientLike {
  return new CodexAppServerClient(spawnCodexAppServer());
}

function isInferred(node: FederationNode): boolean {
  return node.attributes.inferred === true;
}

function concreteThreadNodes(
  graph: SessionFederation
): FederationNode[] {
  return graph.nodes.filter((node) =>
    node.type === 'codex-thread' && !isInferred(node)
  );
}

function linkedThreadIds(graph: SessionFederation): ReadonlySet<string> {
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'resumed-from' || edge.type === 'hosts') {
      if (edge.to.startsWith('codex-thread:')) linked.add(edge.to);
    } else if (edge.type === 'controller-for') {
      linked.add(edge.from);
      linked.add(edge.to);
    }
  }
  return linked;
}

function candidateSource(value: unknown): SidebarCandidate['source'] {
  return value === 'codex-app' || value === 'codex-cli'
    ? value
    : 'unknown';
}

function candidatesFrom(
  graph: SessionFederation,
  appThreads: readonly AppServerThread[],
  snapshot: ReturnType<typeof validateCodexAppSidebarSnapshot>,
  threadIds: ReadonlySet<string>,
  renameThreadIds: ReadonlySet<string>
): SidebarCandidate[] {
  const appById = new Map(appThreads.map((thread) => [thread.id, thread]));
  const snapshotById = new Map(
    snapshot.threads.map((thread) => [thread.threadId, thread])
  );
  const linked = linkedThreadIds(graph);
  return concreteThreadNodes(graph)
    .filter((node) =>
      threadIds.has(node.externalId) || linked.has(node.id)
    )
    .map((node) => {
    const attributes = node.attributes;
    const appThread = appById.get(node.externalId);
    const hostThread = snapshotById.get(node.externalId);
    return {
      threadId: node.externalId,
      source: candidateSource(attributes.host),
      threadSource: attributes.threadSource as SidebarCandidate['threadSource'],
      storageState: attributes.storageState as SidebarCandidate['storageState'],
      projectRelation:
        attributes.projectRelation as SidebarCandidate['projectRelation'],
      appReadable: appThread !== undefined && hostThread?.readable === true,
      listed: hostThread?.listed ?? false,
      linkedLiveOrRecentLaunch: linked.has(node.id),
      explicitlySelected: threadIds.has(node.externalId),
      currentName: appThread?.name ?? null,
      currentPinned: hostThread?.pinned ?? null,
      renameCustomized: renameThreadIds.has(node.externalId),
      originalTitle: appThread?.preview ?? 'Codex CLI thread'
    };
    });
}

function namesByThreadId(
  threads: readonly AppServerThread[]
): ReadonlyMap<string, string | null> {
  return new Map(threads.map((thread) => [thread.id, thread.name]));
}

async function writeResult(
  outPath: string,
  value: unknown
): Promise<string> {
  await writeCodexSessionJson(outPath, value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function runCodexSidebarCli(
  action: CodexSidebarCliAction,
  args: string[],
  createCodexAppServerClient: CreateCodexAppServerClient =
    defaultClientFactory
): Promise<string> {
  const options = parseSidebarCliOptions(action, args);

  if (options.action === 'sidebar-plan') {
    const graph = await readValidated(
      options.graphPath,
      validateSessionFederationArtifact
    );
    const snapshot = await readValidated(
      options.snapshotPath,
      validateCodexAppSidebarSnapshot
    );
    const concreteIds = new Set(
      concreteThreadNodes(graph).map((node) => node.externalId)
    );
    if ([...options.threadIds].some((threadId) => !concreteIds.has(threadId))) {
      throw new Error(
        'explicit thread ID is absent from concrete federation graph'
      );
    }
    const appThreads = await withClient(
      createCodexAppServerClient,
      async (client) => {
        const threads = await clientCall(
          'plan-list',
          () => client.listAllThreads(LIST_PARAMS(graph.project))
        );
        const present = new Set(threads.map((thread) => thread.id));
        for (const threadId of options.threadIds) {
          if (present.has(threadId)) continue;
          const thread = await clientCall(
            'plan-read-explicit',
            () => client.readThread(threadId)
          );
          if (thread) {
            threads.push(thread);
            present.add(thread.id);
          }
        }
        return threads;
      }
    );
    const plan = createSidebarPlan({
      project: graph.project,
      generatedAt: new Date().toISOString(),
      candidates: candidatesFrom(
        graph,
        appThreads,
        snapshot,
        options.threadIds,
        options.renameThreadIds
      )
    });
    return writeResult(options.outPath, validateSidebarPlan(plan));
  }

  if (options.action === 'sidebar-apply') {
    const plan = await readValidated(options.planPath, validateSidebarPlan);
    if (plan.digest !== options.confirmDigest) {
      throw new Error('confirmation digest mismatch');
    }
    const result = await withClient(
      createCodexAppServerClient,
      async (client) => {
        const params = LIST_PARAMS(plan.project);
        const currentThreads = await clientCall(
          'apply-list-initial',
          () => client.listAllThreads(params)
        );
        const present = new Set(
          currentThreads.map((thread) => thread.id)
        );
        for (const action of plan.actions) {
          if (present.has(action.threadId)) continue;
          const thread = await clientCall(
            'apply-read-initial',
            () => client.readThread(action.threadId)
          );
          if (thread) {
            currentThreads.push(thread);
            present.add(thread.id);
          }
        }
        return applySidebarPlan({
          plan,
          confirmDigest: options.confirmDigest,
          currentNames: namesByThreadId(currentThreads),
          setName: (threadId, name) =>
            client.setThreadName(threadId, name),
          readName: async (threadId) =>
            (await client.readThread(threadId))?.name
        });
      }
    );
    return writeResult(
      options.outPath,
      validateSidebarApplyResult(result)
    );
  }

  if (options.action === 'sidebar-reconcile') {
    const plan = await readValidated(options.planPath, validateSidebarPlan);
    const receipt = await readValidated(
      options.receiptPath,
      validateSidebarHostReceipt
    );
    const snapshot = await readValidated(
      options.snapshotPath,
      validateCodexAppSidebarSnapshot
    );
    const result = createSidebarReconciliation({
      planDigest: plan.digest,
      receipt,
      snapshot
    });
    return writeResult(
      options.outPath,
      validateSidebarReconciliation(result)
    );
  }

  const apply = await readValidated(
    options.applyPath,
    validateSidebarApplyResult
  );
  const receipt = await readValidated(
    options.receiptPath,
    validateSidebarHostReceipt
  );
  const result = createSidebarRollbackPlan({
    applyResult: apply,
    receipt
  });
  return writeResult(
    options.outPath,
    validateSidebarRollbackPlan(result)
  );
}
