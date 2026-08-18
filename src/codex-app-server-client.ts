import {
  spawn,
  type ChildProcessWithoutNullStreams
} from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { sanitizeCodexSessionArtifactExcerpt } from
  './codex-session-artifact-privacy.js';
import { requireCodexThreadId } from './codex-session-identity.js';
import {
  boundCodexSessionPrivacyInput,
  CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES,
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
} from './codex-session-privacy.js';

export {
  isCodexThreadId as isCodexAppServerThreadId
} from './codex-session-identity.js';

const MAX_THREADS = 512;
const MAX_PAGES = 64;
const MAX_THREAD_NAME_CODE_POINTS = 120;
const PROCESS_CLOSE_WAIT_MS = 250;
const BOUNDED_JSON_MAX_DEPTH = 16;
const BOUNDED_JSON_MAX_NODES = 4096;
const BOUNDED_JSON_MAX_COLLECTION_LENGTH = 512;
const CODEX_0147_THREAD_NOT_LOADED_PATTERN =
  /^thread not loaded: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
const CODEX_APP_SERVER_VERSION_PATTERN =
  /(?:^|[^\p{L}\p{N}._+-])0\.147\.0(?=$|[^\p{L}\p{N}._+-])/u;
const THREAD_FIELDS = [
  'id',
  'extra',
  'sessionId',
  'forkedFromId',
  'parentThreadId',
  'preview',
  'ephemeral',
  'section',
  'sectionEnteredAt',
  'historyMode',
  'modelProvider',
  'createdAt',
  'updatedAt',
  'recencyAt',
  'status',
  'path',
  'cwd',
  'cliVersion',
  'source',
  'canAcceptDirectInput',
  'threadSource',
  'agentNickname',
  'agentRole',
  'gitInfo',
  'name',
  'turns'
] as const;
const THREAD_REQUIRED_FIELDS = [
  'id',
  'sessionId',
  'preview',
  'ephemeral',
  'modelProvider',
  'createdAt',
  'updatedAt',
  'status',
  'cwd',
  'cliVersion',
  'source',
  'turns'
] as const;
const APP_SERVER_ERROR_CATEGORIES: ReadonlySet<string> = new Set([
  'transient',
  'permanent',
  'conflict',
  'not-found',
  'permission-denied'
] as const);

export type AppServerTransportErrorReason =
  | 'malformed-json'
  | 'invalid-utf8'
  | 'line-too-long'
  | 'stderr'
  | 'process-error'
  | 'process-exit'
  | 'stdout-error'
  | 'write-failed'
  | 'closed'
  | 'close-timeout';

export class AppServerTransportError extends Error {
  readonly code = 'CODEX_APP_SERVER_TRANSPORT' as const;

  constructor(readonly reason: AppServerTransportErrorReason) {
    super(`CODEX_APP_SERVER_TRANSPORT: ${reason}`);
    this.name = 'AppServerTransportError';
  }
}

export type CodexAppServerClientErrorReason =
  | 'not-initialized'
  | 'closed'
  | 'timeout'
  | 'invalid-response'
  | 'unsupported-version'
  | 'app-server-error'
  | 'invalid-argument'
  | 'duplicate-cursor'
  | 'page-limit'
  | 'thread-limit'
  | 'duplicate-thread-id';

export type AppServerSafeMachineCode = number | null;

export class CodexAppServerClientError extends Error {
  readonly code = 'CODEX_APP_SERVER_CLIENT' as const;

  constructor(
    readonly reason: CodexAppServerClientErrorReason,
    readonly serverCode: AppServerSafeMachineCode = null,
    readonly category: string | null = null
  ) {
    super(`CODEX_APP_SERVER_CLIENT: ${reason}`);
    this.name = 'CodexAppServerClientError';
  }
}

export interface AppServerTransport {
  onMessage(listener: (value: unknown) => void): void;
  onError(listener: (error: AppServerTransportError) => void): void;
  write(value: unknown): void;
  close(): Promise<void>;
}

export type AppServerThreadSource =
  | 'cli'
  | 'vscode'
  | 'exec'
  | 'appServer'
  | 'unknown'
  | { custom: string }
  | { subAgent: AppServerSubAgentSource };

export type AppServerSubAgentSource =
  | 'review'
  | 'compact'
  | 'memory_consolidation'
  | {
    thread_spawn: {
      parent_thread_id: string;
      depth: number;
      agent_path?: string | null;
      agent_nickname?: string | null;
      agent_role?: string | null;
    };
  }
  | { other: string };

export type AppServerThreadSourceKind = 'cli' | 'vscode';

export interface AppServerThread {
  id: string;
  name: string | null;
  cwd: string;
  source: AppServerThreadSource;
  preview: string;
  updatedAt: number;
  recencyAt: number | null;
}

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number;
  sourceKinds?: AppServerThreadSourceKind[];
  archived?: boolean;
  cwd?: string | string[] | null;
  useStateDbOnly?: boolean;
}

export interface ThreadListPage {
  data: AppServerThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
  params: unknown;
}

type SpawnAppServerProcess = (
  command: string,
  args: string[],
  options: {
    stdio: ['pipe', 'pipe', 'pipe'];
    windowsHide: boolean;
  }
) => ChildProcessWithoutNullStreams;

export interface AppServerExecutableResolverOptions {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  pathValue?: string;
  exists?: (candidate: string) => boolean;
}

function clientError(
  reason: CodexAppServerClientErrorReason
): CodexAppServerClientError {
  return new CodexAppServerClientError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function requireResponseRecord(
  value: unknown,
  allowed: readonly string[] | null = null
): Record<string, unknown> {
  if (!isRecord(value) || (allowed && !hasOnlyKeys(value, allowed))) {
    throw clientError('invalid-response');
  }
  return value;
}

function requireExactResponseRecord(
  value: unknown,
  fields: readonly string[]
): Record<string, unknown> {
  const record = requireResponseRecord(value, fields);
  if (fields.some((field) => !Object.hasOwn(record, field))) {
    throw clientError('invalid-response');
  }
  return record;
}

function requireKnownResponseRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[]
): Record<string, unknown> {
  const record = requireResponseRecord(value, allowed);
  if (required.some((field) => !Object.hasOwn(record, field))) {
    throw clientError('invalid-response');
  }
  return record;
}

function requireBoundedResponseString(
  value: unknown,
  options: {
    allowEmpty?: boolean;
    allowControls?: boolean;
  } = {}
): string {
  if (
    typeof value !== 'string' ||
    value.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    boundCodexSessionPrivacyInput(value).changed ||
    (!options.allowEmpty && value.length === 0) ||
    (!options.allowControls && /[\u0000-\u001f\u007f-\u009f]/u.test(value))
  ) {
    throw clientError('invalid-response');
  }
  return value;
}

function requireNullableBoundedResponseString(
  value: unknown,
  options: {
    allowEmpty?: boolean;
    allowControls?: boolean;
  } = {}
): string | null {
  return value === null
    ? null
    : requireBoundedResponseString(value, options);
}

function requireFiniteTimestamp(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw clientError('invalid-response');
  }
  return value;
}

function requireNullableTimestamp(value: unknown): number | null {
  return value === null ? null : requireFiniteTimestamp(value);
}

function requireCursor(value: unknown): string | null {
  if (value === null) return null;
  return requireBoundedResponseString(value);
}

function requireBoundedJsonValue(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw clientError('invalid-response');
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, 'utf8') >
      CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES
  ) {
    throw clientError('invalid-response');
  }

  let nodeCount = 0;
  const visit = (current: unknown, depth: number): void => {
    nodeCount += 1;
    if (
      nodeCount > BOUNDED_JSON_MAX_NODES ||
      depth > BOUNDED_JSON_MAX_DEPTH
    ) {
      throw clientError('invalid-response');
    }
    if (
      current === null ||
      typeof current === 'boolean'
    ) {
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw clientError('invalid-response');
      return;
    }
    if (typeof current === 'string') {
      requireBoundedResponseString(current, {
        allowEmpty: true,
        allowControls: true
      });
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > BOUNDED_JSON_MAX_COLLECTION_LENGTH) {
        throw clientError('invalid-response');
      }
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (!isRecord(current)) throw clientError('invalid-response');
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw clientError('invalid-response');
    }
    const entries = Object.entries(current);
    if (entries.length > BOUNDED_JSON_MAX_COLLECTION_LENGTH) {
      throw clientError('invalid-response');
    }
    for (const [key, item] of entries) {
      requireBoundedResponseString(key, {
        allowEmpty: true,
        allowControls: true
      });
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
}

function encodeOutboundJsonl(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new AppServerTransportError('write-failed');
  }
  if (json === undefined) {
    throw new AppServerTransportError('write-failed');
  }
  if (
    Buffer.byteLength(json, 'utf8') >
    CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES
  ) {
    throw new AppServerTransportError('line-too-long');
  }
  return `${json}\n`;
}

function requireListRequestWithinOutboundBudget(
  params: ThreadListParams
): void {
  try {
    encodeOutboundJsonl({
      id: Number.MAX_SAFE_INTEGER,
      method: 'thread/list',
      params
    });
  } catch {
    throw clientError('invalid-argument');
  }
}

function safeMachineCode(value: unknown): AppServerSafeMachineCode {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}

function safeCategory(value: unknown): string | null {
  return typeof value === 'string' &&
    APP_SERVER_ERROR_CATEGORIES.has(value)
    ? value
    : null;
}

function appServerError(
  value: unknown,
  requestMethod: string,
  requestParams: unknown
): CodexAppServerClientError {
  const error = requireResponseRecord(value, ['code', 'message', 'data']);
  if (
    !Object.hasOwn(error, 'code') ||
    !Object.hasOwn(error, 'message')
  ) {
    throw clientError('invalid-response');
  }
  const message = requireBoundedResponseString(error.message, {
    allowEmpty: true,
    allowControls: true
  });
  if (Object.hasOwn(error, 'data')) requireBoundedJsonValue(error.data);
  const data = isRecord(error.data) ? error.data : null;
  const serverCode = safeMachineCode(error.code);
  const structuredCategory = data
    ? safeCategory(data.category) ?? safeCategory(data.type)
    : null;
  const threadNotLoaded = serverCode === -32600
    ? CODEX_0147_THREAD_NOT_LOADED_PATTERN.exec(message)
    : null;
  if (threadNotLoaded) {
    if (
      requestMethod !== 'thread/read' ||
      !isRecord(requestParams) ||
      requestParams.threadId !== threadNotLoaded[1]
    ) {
      throw clientError('invalid-response');
    }
  }
  const category = structuredCategory ??
    (threadNotLoaded ? 'not-found' : null);
  return new CodexAppServerClientError(
    'app-server-error',
    serverCode,
    category
  );
}

function requireInputThreadId(value: unknown): string {
  return requireCodexThreadId(value, () => {
    throw clientError('invalid-argument');
  });
}

function requireResponseThreadId(value: unknown): string {
  return requireCodexThreadId(value, () => {
    throw clientError('invalid-response');
  });
}

function requireNullableResponseThreadId(value: unknown): string | null {
  return value === null ? null : requireResponseThreadId(value);
}

function requireSafeThreadNameInput(value: string): void {
  if (
    value.length === 0 ||
    value.trim().length === 0 ||
    value.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    boundCodexSessionPrivacyInput(value).changed ||
    Array.from(value).length > MAX_THREAD_NAME_CODE_POINTS ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw clientError('invalid-argument');
  }
}

function requireInputString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    boundCodexSessionPrivacyInput(value).changed ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw clientError('invalid-argument');
  }
  return value;
}

function normalizeThreadListParams(
  value: ThreadListParams
): ThreadListParams {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'cursor',
    'limit',
    'sourceKinds',
    'archived',
    'cwd',
    'useStateDbOnly'
  ])) {
    throw clientError('invalid-argument');
  }

  const normalized: ThreadListParams = {};
  if (Object.hasOwn(value, 'cursor')) {
    if (value.cursor === null) {
      normalized.cursor = null;
    } else {
      normalized.cursor = requireInputString(value.cursor);
    }
  }
  if (Object.hasOwn(value, 'limit')) {
    const limit = value.limit;
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_THREADS
    ) {
      throw clientError('invalid-argument');
    }
    normalized.limit = limit;
  }
  if (Object.hasOwn(value, 'sourceKinds')) {
    if (
      !Array.isArray(value.sourceKinds) ||
      value.sourceKinds.length === 0 ||
      value.sourceKinds.length > 2
    ) {
      throw clientError('invalid-argument');
    }
    const sourceKinds = value.sourceKinds.map((source) => {
      if (source !== 'cli' && source !== 'vscode') {
        throw clientError('invalid-argument');
      }
      return source;
    });
    if (new Set(sourceKinds).size !== sourceKinds.length) {
      throw clientError('invalid-argument');
    }
    normalized.sourceKinds = sourceKinds;
  }
  if (Object.hasOwn(value, 'archived')) {
    if (typeof value.archived !== 'boolean') {
      throw clientError('invalid-argument');
    }
    normalized.archived = value.archived;
  }
  if (Object.hasOwn(value, 'cwd')) {
    if (value.cwd === null) {
      normalized.cwd = null;
    } else if (typeof value.cwd === 'string') {
      normalized.cwd = requireInputString(value.cwd);
    } else if (Array.isArray(value.cwd) && value.cwd.length <= MAX_THREADS) {
      normalized.cwd = value.cwd.map(requireInputString);
    } else {
      throw clientError('invalid-argument');
    }
  }
  if (Object.hasOwn(value, 'useStateDbOnly')) {
    if (typeof value.useStateDbOnly !== 'boolean') {
      throw clientError('invalid-argument');
    }
    normalized.useStateDbOnly = value.useStateDbOnly;
  }
  requireListRequestWithinOutboundBudget(normalized);
  return normalized;
}

function validateThreadExtra(value: unknown): void {
  if (value === null) return;
  if (!isRecord(value)) throw clientError('invalid-response');
  requireBoundedJsonValue(value);
}

function validateThreadSection(value: unknown): void {
  if (value === null) return;
  const section = requireExactResponseRecord(value, ['id', 'name']);
  requireResponseThreadId(section.id);
  requireBoundedResponseString(section.name, { allowEmpty: true });
}

function validateThreadStatus(value: unknown): void {
  const status = requireResponseRecord(value);
  const type = requireBoundedResponseString(status.type);
  if (
    type === 'notLoaded' ||
    type === 'idle' ||
    type === 'systemError'
  ) {
    requireExactResponseRecord(status, ['type']);
    return;
  }
  if (type !== 'active') throw clientError('invalid-response');
  const active = requireExactResponseRecord(
    status,
    ['type', 'activeFlags']
  );
  if (
    !Array.isArray(active.activeFlags) ||
    active.activeFlags.length > MAX_THREADS
  ) {
    throw clientError('invalid-response');
  }
  for (const flag of active.activeFlags) {
    if (flag !== 'waitingOnApproval' && flag !== 'waitingOnUserInput') {
      throw clientError('invalid-response');
    }
  }
}

function validateGitInfo(value: unknown): void {
  if (value === null) return;
  const gitInfo = requireResponseRecord(
    value,
    ['sha', 'branch', 'originUrl']
  );
  if (Object.hasOwn(gitInfo, 'sha')) {
    requireNullableBoundedResponseString(gitInfo.sha, { allowEmpty: true });
  }
  if (Object.hasOwn(gitInfo, 'branch')) {
    requireNullableBoundedResponseString(gitInfo.branch, { allowEmpty: true });
  }
  if (Object.hasOwn(gitInfo, 'originUrl')) {
    requireNullableBoundedResponseString(gitInfo.originUrl, { allowEmpty: true });
  }
}

function projectSubAgentSource(value: unknown): AppServerSubAgentSource {
  if (
    value === 'review' ||
    value === 'compact' ||
    value === 'memory_consolidation'
  ) {
    return value;
  }
  const source = requireResponseRecord(value);
  if (Object.hasOwn(source, 'other')) {
    const other = requireExactResponseRecord(source, ['other']);
    return {
      other: requireBoundedResponseString(
        other.other,
        { allowEmpty: true }
      )
    };
  }
  const spawnSource = requireExactResponseRecord(source, ['thread_spawn']);
  const details = requireKnownResponseRecord(
    spawnSource.thread_spawn,
    [
      'parent_thread_id',
      'depth',
      'agent_path',
      'agent_nickname',
      'agent_role'
    ],
    ['parent_thread_id', 'depth']
  );
  const parentThreadId = requireResponseThreadId(details.parent_thread_id);
  if (
    typeof details.depth !== 'number' ||
    !Number.isSafeInteger(details.depth) ||
    details.depth < 0 ||
    details.depth > MAX_THREADS
  ) {
    throw clientError('invalid-response');
  }
  const threadSpawn: Extract<
    AppServerSubAgentSource,
    { thread_spawn: unknown }
  >['thread_spawn'] = {
    parent_thread_id: parentThreadId,
    depth: details.depth
  };
  if (Object.hasOwn(details, 'agent_path')) {
    threadSpawn.agent_path = requireNullableBoundedResponseString(
        details.agent_path,
        { allowEmpty: true }
      );
  }
  if (Object.hasOwn(details, 'agent_nickname')) {
    threadSpawn.agent_nickname = requireNullableBoundedResponseString(
        details.agent_nickname,
        { allowEmpty: true }
      );
  }
  if (Object.hasOwn(details, 'agent_role')) {
    threadSpawn.agent_role = requireNullableBoundedResponseString(
        details.agent_role,
        { allowEmpty: true }
      );
  }
  return { thread_spawn: threadSpawn };
}

function projectThreadSource(value: unknown): AppServerThreadSource {
  if (
    value === 'cli' ||
    value === 'vscode' ||
    value === 'exec' ||
    value === 'appServer' ||
    value === 'unknown'
  ) {
    return value;
  }
  const source = requireResponseRecord(value);
  if (Object.hasOwn(source, 'custom')) {
    const custom = requireExactResponseRecord(source, ['custom']);
    return {
      custom: requireBoundedResponseString(
        custom.custom,
        { allowEmpty: true }
      )
    };
  }
  const subAgent = requireExactResponseRecord(source, ['subAgent']);
  return { subAgent: projectSubAgentSource(subAgent.subAgent) };
}

function projectThread(value: unknown): AppServerThread {
  const thread = requireKnownResponseRecord(
    value,
    THREAD_FIELDS,
    THREAD_REQUIRED_FIELDS
  );
  const id = requireResponseThreadId(thread.id);
  if (Object.hasOwn(thread, 'extra')) validateThreadExtra(thread.extra);
  requireBoundedResponseString(thread.sessionId);
  if (Object.hasOwn(thread, 'forkedFromId')) {
    requireNullableResponseThreadId(thread.forkedFromId);
  }
  if (Object.hasOwn(thread, 'parentThreadId')) {
    requireNullableResponseThreadId(thread.parentThreadId);
  }
  if (typeof thread.preview !== 'string') {
    throw clientError('invalid-response');
  }
  const preview = sanitizeCodexSessionArtifactExcerpt(thread.preview) ?? '';
  if (typeof thread.ephemeral !== 'boolean') {
    throw clientError('invalid-response');
  }
  if (Object.hasOwn(thread, 'section')) validateThreadSection(thread.section);
  if (Object.hasOwn(thread, 'sectionEnteredAt')) {
    requireNullableTimestamp(thread.sectionEnteredAt);
  }
  if (
    Object.hasOwn(thread, 'historyMode') &&
    thread.historyMode !== 'legacy' &&
    thread.historyMode !== 'paginated'
  ) {
    throw clientError('invalid-response');
  }
  requireBoundedResponseString(thread.modelProvider);
  requireFiniteTimestamp(thread.createdAt);
  const updatedAt = requireFiniteTimestamp(thread.updatedAt);
  const recencyAt = Object.hasOwn(thread, 'recencyAt')
    ? requireNullableTimestamp(thread.recencyAt)
    : null;
  validateThreadStatus(thread.status);
  if (Object.hasOwn(thread, 'path')) {
    requireNullableBoundedResponseString(
      thread.path,
      { allowEmpty: true }
    );
  }
  const cwd = requireBoundedResponseString(thread.cwd);
  requireBoundedResponseString(thread.cliVersion);
  const source = projectThreadSource(thread.source);
  if (
    Object.hasOwn(thread, 'canAcceptDirectInput') &&
    thread.canAcceptDirectInput !== null &&
    typeof thread.canAcceptDirectInput !== 'boolean'
  ) {
    throw clientError('invalid-response');
  }
  if (Object.hasOwn(thread, 'threadSource')) {
    requireNullableBoundedResponseString(
      thread.threadSource,
      { allowEmpty: true }
    );
  }
  if (Object.hasOwn(thread, 'agentNickname')) {
    requireNullableBoundedResponseString(
      thread.agentNickname,
      { allowEmpty: true }
    );
  }
  if (Object.hasOwn(thread, 'agentRole')) {
    requireNullableBoundedResponseString(
      thread.agentRole,
      { allowEmpty: true }
    );
  }
  if (Object.hasOwn(thread, 'gitInfo')) validateGitInfo(thread.gitInfo);
  const name = !Object.hasOwn(thread, 'name') || thread.name === null
    ? null
    : requireBoundedResponseString(thread.name, { allowEmpty: true });
  if (!Array.isArray(thread.turns) || thread.turns.length !== 0) {
    throw clientError('invalid-response');
  }

  return {
    id,
    name,
    cwd,
    source,
    preview,
    updatedAt,
    recencyAt
  };
}

function validateThreadListPage(
  value: unknown,
  requestedLimit: number | undefined
): ThreadListPage {
  const result = requireResponseRecord(
    value,
    ['data', 'nextCursor', 'backwardsCursor']
  );
  if (
    !Array.isArray(result.data) ||
    result.data.length > MAX_THREADS ||
    (requestedLimit !== undefined && result.data.length > requestedLimit)
  ) {
    throw clientError(
      Array.isArray(result.data) && result.data.length > MAX_THREADS
        ? 'thread-limit'
        : Array.isArray(result.data) &&
            requestedLimit !== undefined &&
            result.data.length > requestedLimit
        ? 'thread-limit'
        : 'invalid-response'
    );
  }

  const seenIds = new Set<string>();
  const data = result.data.map((value) => {
    const thread = projectThread(value);
    if (seenIds.has(thread.id)) {
      throw clientError('duplicate-thread-id');
    }
    seenIds.add(thread.id);
    return thread;
  });
  return {
    data,
    nextCursor: Object.hasOwn(result, 'nextCursor')
      ? requireCursor(result.nextCursor)
      : null,
    backwardsCursor: Object.hasOwn(result, 'backwardsCursor')
      ? requireCursor(result.backwardsCursor)
      : null
  };
}

function validateThreadReadResponse(
  value: unknown,
  requestedThreadId: string
): AppServerThread {
  const result = requireExactResponseRecord(value, ['thread']);
  const thread = projectThread(result.thread);
  if (thread.id !== requestedThreadId) {
    throw clientError('invalid-response');
  }
  return thread;
}

export class CodexAppServerClient {
  private nextId = 1;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private terminalError: Error | null = null;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly transport: AppServerTransport,
    private readonly timeoutMs = 10_000
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw clientError('invalid-argument');
    }
    transport.onMessage((value) => this.handleMessage(value));
    transport.onError((error) => this.handleTransportError(error));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private terminateWith(error: Error): void {
    if (!this.terminalError) this.terminalError = error;
    this.rejectPending(this.terminalError);
  }

  private handleTransportError(error: AppServerTransportError): void {
    if (this.closed) return;
    this.terminateWith(error);
  }

  private handleMessage(value: unknown): void {
    if (!isRecord(value)) {
      this.terminateWith(clientError('invalid-response'));
      return;
    }
    if (!Object.hasOwn(value, 'id')) return;
    if (!Number.isSafeInteger(value.id) || (value.id as number) < 1) {
      this.terminateWith(clientError('invalid-response'));
      return;
    }
    const id = value.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;
    const hasResult = Object.hasOwn(value, 'result');
    const hasError = Object.hasOwn(value, 'error');
    const allowedKeys = hasError ? ['id', 'error'] : ['id', 'result'];
    if (
      hasResult === hasError ||
      !hasOnlyKeys(value, allowedKeys)
    ) {
      this.terminateWith(clientError('invalid-response'));
      return;
    }

    if (hasError) {
      let responseError: CodexAppServerClientError;
      try {
        responseError = appServerError(
          value.error,
          pending.method,
          pending.params
        );
      } catch {
        this.terminateWith(clientError('invalid-response'));
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(responseError);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(value.result);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(clientError('closed'));
    if (this.terminalError) return Promise.reject(this.terminalError);

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(clientError('timeout'));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method, params });
      try {
        this.transport.write({ id, method, params });
      } catch (caught) {
        clearTimeout(timer);
        this.pending.delete(id);
        const error = caught instanceof AppServerTransportError
          ? caught
          : new AppServerTransportError('write-failed');
        this.terminateWith(error);
        reject(error);
      }
    });
  }

  private requireInitialized(): void {
    if (this.closed) throw clientError('closed');
    if (this.terminalError) throw this.terminalError;
    if (!this.initialized) throw clientError('not-initialized');
  }

  async initialize(): Promise<void> {
    if (this.closed) throw clientError('closed');
    if (this.terminalError) throw this.terminalError;
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = (async () => {
      const result = requireExactResponseRecord(
        await this.request('initialize', {
          clientInfo: {
            name: 'hooks-session-federation',
            title: 'Hooks Session Federation',
            version: '0.1.0'
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false
          }
        }),
        ['userAgent', 'codexHome', 'platformFamily', 'platformOs']
      );
      const userAgent = requireBoundedResponseString(result.userAgent);
      if (!CODEX_APP_SERVER_VERSION_PATTERN.test(userAgent)) {
        throw clientError('unsupported-version');
      }
      requireBoundedResponseString(result.codexHome);
      requireBoundedResponseString(result.platformFamily);
      requireBoundedResponseString(result.platformOs);
      try {
        this.transport.write({ method: 'initialized' });
      } catch (caught) {
        const error = caught instanceof AppServerTransportError
          ? caught
          : new AppServerTransportError('write-failed');
        this.terminateWith(error);
        throw error;
      }
      this.initialized = true;
    })();
    return this.initializePromise;
  }

  async listThreads(params: ThreadListParams): Promise<ThreadListPage> {
    this.requireInitialized();
    const normalized = normalizeThreadListParams(params);
    return validateThreadListPage(
      await this.request('thread/list', normalized),
      normalized.limit
    );
  }

  async listAllThreads(
    params: ThreadListParams
  ): Promise<AppServerThread[]> {
    this.requireInitialized();
    const normalized = normalizeThreadListParams(params);
    const threads: AppServerThread[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor = normalized.cursor ?? null;
    if (cursor !== null) seenCursors.add(cursor);

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const page = await this.listThreads({
        ...normalized,
        cursor
      });
      if (threads.length + page.data.length > MAX_THREADS) {
        throw clientError('thread-limit');
      }
      for (const thread of page.data) {
        if (seenIds.has(thread.id)) {
          throw clientError('duplicate-thread-id');
        }
        seenIds.add(thread.id);
        threads.push(thread);
      }
      if (page.nextCursor === null) return threads;
      if (seenCursors.has(page.nextCursor)) {
        throw clientError('duplicate-cursor');
      }
      if (pageNumber === MAX_PAGES) {
        throw clientError('page-limit');
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    throw clientError('page-limit');
  }

  async readThread(threadId: string): Promise<AppServerThread | null> {
    this.requireInitialized();
    requireInputThreadId(threadId);
    try {
      return validateThreadReadResponse(
        await this.request('thread/read', {
          threadId,
          includeTurns: false
        }),
        threadId
      );
    } catch (error) {
      if (
        error instanceof CodexAppServerClientError &&
        error.reason === 'app-server-error' &&
        error.category === 'not-found'
      ) {
        return null;
      }
      throw error;
    }
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    this.requireInitialized();
    requireInputThreadId(threadId);
    requireSafeThreadNameInput(name);
    const result = requireResponseRecord(
      await this.request('thread/name/set', { threadId, name })
    );
    requireBoundedJsonValue(result);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.rejectPending(clientError('closed'));
    this.closePromise = this.transport.close().catch(() => {
      throw new AppServerTransportError('close-timeout');
    });
    return this.closePromise;
  }
}

class ChildTransport implements AppServerTransport {
  private messageListener: ((value: unknown) => void) | null = null;
  private errorListener: ((error: AppServerTransportError) => void) | null = null;
  private terminalError: AppServerTransportError | null = null;
  private lineChunks: Buffer[] = [];
  private lineByteLength = 0;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdin.on('error', () => this.fail('write-failed'));
    child.stdout.on('data', (chunk: Buffer | string) => {
      this.consumeStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stdout.on('error', () => this.fail('stdout-error'));
    child.stderr.on('data', () => this.fail('stderr'));
    child.stderr.on('error', () => this.fail('stderr'));
    child.on('error', () => this.fail('process-error'));
    child.on('exit', () => {
      if (!this.closing) this.fail('process-exit');
    });
  }

  onMessage(listener: (value: unknown) => void): void {
    this.messageListener = listener;
  }

  onError(listener: (error: AppServerTransportError) => void): void {
    this.errorListener = listener;
    if (this.terminalError) listener(this.terminalError);
  }

  private fail(reason: AppServerTransportErrorReason): void {
    if (this.terminalError || this.closing) return;
    this.terminalError = new AppServerTransportError(reason);
    this.lineChunks = [];
    this.lineByteLength = 0;
    this.errorListener?.(this.terminalError);
  }

  private appendLineBytes(bytes: Buffer): boolean {
    if (bytes.length === 0) return true;
    const nextByteLength = this.lineByteLength + bytes.length;
    const isPotentialCrLfBoundary =
      nextByteLength === CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES + 1 &&
      bytes.at(-1) === 0x0d;
    if (
      nextByteLength > CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES &&
      !isPotentialCrLfBoundary
    ) {
      this.fail('line-too-long');
      return false;
    }
    this.lineChunks.push(Buffer.from(bytes));
    this.lineByteLength += bytes.length;
    return true;
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.terminalError || this.closing) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      if (newline === -1) {
        this.appendLineBytes(chunk.subarray(offset));
        return;
      }
      if (!this.appendLineBytes(chunk.subarray(offset, newline))) return;
      this.consumeLine();
      if (this.terminalError) return;
      offset = newline + 1;
    }
  }

  private consumeLine(): void {
    let bytes = this.lineByteLength === 0
      ? Buffer.alloc(0)
      : Buffer.concat(this.lineChunks, this.lineByteLength);
    this.lineChunks = [];
    this.lineByteLength = 0;
    if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, bytes.length - 1);
    if (bytes.length === 0) return;

    let line: string;
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      this.fail('invalid-utf8');
      return;
    }
    if (line.trim().length === 0) return;
    try {
      this.messageListener?.(JSON.parse(line));
    } catch {
      this.fail('malformed-json');
    }
  }

  write(value: unknown): void {
    if (this.terminalError) throw this.terminalError;
    if (this.closing) throw new AppServerTransportError('closed');
    let line: string;
    try {
      line = encodeOutboundJsonl(value);
    } catch (caught) {
      const error = caught instanceof AppServerTransportError
        ? caught
        : new AppServerTransportError('write-failed');
      this.fail(error.reason);
      throw error;
    }
    try {
      this.child.stdin.write(line, (error) => {
        if (error) this.fail('write-failed');
      });
    } catch {
      this.fail('write-failed');
      throw new AppServerTransportError('write-failed');
    }
  }

  private processExited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.processExited()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child.off('exit', onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      this.child.once('exit', onExit);
      if (this.processExited()) finish(true);
    });
  }

  private async closeChild(): Promise<void> {
    this.closing = true;
    this.lineChunks = [];
    this.lineByteLength = 0;
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    if (await this.waitForExit(PROCESS_CLOSE_WAIT_MS)) return;

    this.child.kill();
    if (await this.waitForExit(PROCESS_CLOSE_WAIT_MS)) return;

    this.child.kill('SIGKILL');
    if (await this.waitForExit(PROCESS_CLOSE_WAIT_MS)) return;
    throw new AppServerTransportError('close-timeout');
  }

  close(): Promise<void> {
    if (!this.closePromise) this.closePromise = this.closeChild();
    return this.closePromise;
  }
}

export function resolveCodexAppServerExecutable(
  codexCommand = 'codex',
  options: AppServerExecutableResolverOptions = {}
): string {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return codexCommand;
  }
  if (codexCommand !== 'codex') {
    if (/\.(?:cmd|bat|ps1)$/iu.test(codexCommand)) {
      throw new AppServerTransportError('process-error');
    }
    return codexCommand;
  }

  const arch = options.arch ?? process.arch;
  const nativePackage = arch === 'x64'
    ? {
        name: 'codex-win32-x64',
        target: 'x86_64-pc-windows-msvc'
      }
    : arch === 'arm64'
    ? {
        name: 'codex-win32-arm64',
        target: 'aarch64-pc-windows-msvc'
      }
    : null;
  if (!nativePackage) throw new AppServerTransportError('process-error');

  const fileExists = options.exists ?? existsSync;
  const pathEntries = (options.pathValue ?? process.env.PATH ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (
      entry.length >= 2 && entry.startsWith('"') && entry.endsWith('"')
        ? entry.slice(1, -1)
        : entry
    ));

  try {
    for (const pathEntry of pathEntries) {
      const packageSegments = [
        '@openai',
        nativePackage.name,
        'vendor',
        nativePackage.target,
        'bin',
        'codex.exe'
      ];
      const candidates = [
        win32.join(pathEntry, 'codex.exe'),
        win32.join(
          pathEntry,
          'node_modules',
          '@openai',
          'codex',
          'node_modules',
          ...packageSegments
        ),
        win32.join(pathEntry, 'node_modules', ...packageSegments),
        win32.join(
          pathEntry,
          'node_modules',
          '@openai',
          'codex',
          'vendor',
          nativePackage.target,
          'bin',
          'codex.exe'
        )
      ];
      for (const candidate of candidates) {
        if (fileExists(candidate)) return candidate;
      }
    }
  } catch {
    throw new AppServerTransportError('process-error');
  }
  throw new AppServerTransportError('process-error');
}

export function spawnCodexAppServer(
  codexCommand = 'codex',
  spawnProcess: SpawnAppServerProcess = spawn,
  platform: NodeJS.Platform = process.platform,
  resolverOptions: AppServerExecutableResolverOptions = {}
): AppServerTransport {
  try {
    const executable = resolveCodexAppServerExecutable(codexCommand, {
      ...resolverOptions,
      platform
    });
    const child = spawnProcess(
      executable,
      ['app-server', '--stdio'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    return new ChildTransport(child);
  } catch (caught) {
    if (caught instanceof AppServerTransportError) throw caught;
    throw new AppServerTransportError('process-error');
  }
}
