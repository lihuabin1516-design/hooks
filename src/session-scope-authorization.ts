import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { withFileLock } from './atomic-file.js';
import { isPathInside, normalizeForComparison } from './paths.js';
import { decideHookDryRun } from './hook-dry-run.js';
import type { CurrentTask, HookCall } from './types.js';

export const SESSION_SCOPE_AUTHORIZATION_SCHEMA = 'paneforge.task-scope-authorizations.v1' as const;
export const DEFAULT_SESSION_SCOPE_TTL_MINUTES = 15;
export const MAX_SESSION_SCOPE_TTL_MINUTES = 60;

const AUTHORIZATION_FILE = 'session-authorizations.json';
const MAX_AUTHORIZATION_FILE_BYTES = 256 * 1024;
const MAX_GRANTS = 200;
const editableTools: HookCall['tool'][] = ['edit', 'write', 'apply_patch'];
const grantFields = new Set([
  'id',
  'taskId',
  'worktreeRoot',
  'sessionId',
  'paths',
  'tools',
  'authorizedAt',
  'expiresAt',
  'revokedAt',
  'reason',
  'instruction'
]);
const intentFields = new Set(['id', 'taskId', 'worktreeRoot', 'sessionId', 'authorizedAt', 'expiresAt', 'instruction']);

export interface SessionScopePath {
  path: string;
  recursive: boolean;
}

export interface SessionScopeGrant {
  id: string;
  taskId: string;
  worktreeRoot: string;
  sessionId: string | null;
  paths: SessionScopePath[];
  tools: Array<'edit' | 'write' | 'apply_patch'>;
  authorizedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  reason: string;
  instruction: string;
}

export interface SessionScopeIntent {
  id: string;
  taskId: string;
  worktreeRoot: string;
  sessionId: string;
  authorizedAt: string;
  expiresAt: string;
  instruction: string;
}

export interface SessionScopeAuthorizations {
  schema: typeof SESSION_SCOPE_AUTHORIZATION_SCHEMA;
  grants: SessionScopeGrant[];
  intents: SessionScopeIntent[];
}

export interface NewSessionScopeGrant {
  paths: Array<{ path: string; recursive?: boolean }>;
  tools: Array<'edit' | 'write' | 'apply_patch'>;
  ttlMinutes?: number;
  reason: string;
  instruction: string;
  now?: Date;
}

export class SessionScopeAuthorizationError extends Error {
  readonly code = 'session_scope_authorization_invalid';
}

function authorizationStart(prompt: string): number {
  const matches = [
    /我\s*(?:(?:明确|正式|清楚地|再次)\s*)?(?:授权|允许|批准|同意)(?:你|Codex|助手)?/iu,
    /\b(?:I\s+(?:explicitly\s+)?(?:authorize|allow|approve)|you\s+have\s+my\s+permission)\b/iu,
    /\b(?:I\s+explicitly\s+authorize)\b/iu
  ];
  const indexes = matches.map((pattern) => prompt.search(pattern)).filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

export function isExplicitAuthorizationPrompt(prompt: string): boolean {
  const start = authorizationStart(prompt);
  if (start < 0) return false;
  if (isQuotedAt(prompt, start)) return false;
  if (/(?:不授权|未授权|没有授权|不会授权|不能授权|不允许|禁止授权|未经授权|do not authorize|don't authorize|not authorized|without authorization)/iu.test(prompt)) {
    return false;
  }
  const nearby = prompt.slice(Math.max(0, start - 32), Math.min(prompt.length, start + 128));
  const hypothetical = /(?:如果|假如|例如|比如|示例|举例|if\s+I\s+say|for\s+example|suppose|hypothetical)/iu.test(nearby);
  if (hypothetical) return false;
  const metaDiscussion = /(?:格式|形式|短语|措辞|表述|说法|表达|这句话|要求|必须|需要|我说|触发|识别|规则|机制|工作流|如何|怎样|是否|怎么|希望|想要|应该|format|wording|phrase|trigger|recogniz|workflow|how\s+should|whether)/iu.test(nearby);
  const directOperation = /(?:修改|编辑|写入|改动|更新|修复|处理|执行|继续|完成|做|改|\b(?:edit|modify|write|change|update|fix|perform|continue|complete|do)\b)/iu.test(nearby);
  const explicitPath = /(?:[A-Za-z]:[\\/]|(?:\.\.?[\\/])|\/)(?:[^\s"'<>|]+[\\/])*[^\s"'<>|,，。；;!?]+/u.test(nearby);
  const question = /(?:吗|么|是否|[?？]|\b(?:whether|should|can|could)\b)/iu.test(nearby);
  return !metaDiscussion && !question || directOperation || explicitPath;
}

function isQuotedAt(text: string, index: number): boolean {
  for (const [open, close] of [['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』']] as const) {
    if (text.lastIndexOf(open, index) > text.lastIndexOf(close, index)) return true;
  }
  for (const quote of ['"', "'", '`']) {
    const quoteCount = [...text.slice(0, index)].filter((character) => character === quote).length;
    if (quoteCount % 2 === 1) return true;
  }
  return false;
}

function authorizationExcerpt(prompt: string): string {
  const start = authorizationStart(prompt);
  const end = prompt.slice(start).search(/[\r\n。！？!?；;]/u);
  const excerpt = end >= 0 ? prompt.slice(start, start + end + 1) : prompt.slice(start);
  return excerpt.trim().slice(0, 4096);
}

export function sessionScopeAuthorizationPath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.paneforge-task', AUTHORIZATION_FILE);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionScopeAuthorizationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKnownFields(record: Record<string, unknown>, fields: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(record).find((field) => !fields.has(field));
  if (unknown) throw new SessionScopeAuthorizationError(`${label} has unknown field ${unknown}`);
}

function assertString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new SessionScopeAuthorizationError(`${label} must be a non-empty string up to ${maxLength} characters`);
  }
}

function isCanonicalAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value) && path.resolve(value) === value;
}

function validateTimestamp(value: unknown, label: string): string {
  assertString(value, label, 64);
  if (!Number.isFinite(Date.parse(value))) throw new SessionScopeAuthorizationError(`${label} must be an ISO timestamp`);
  return value;
}

function validateGrant(value: unknown, index: number): SessionScopeGrant {
  const grant = asRecord(value, `grants[${index}]`);
  assertKnownFields(grant, grantFields, `grants[${index}]`);
  assertString(grant.id, `grants[${index}].id`, 128);
  assertString(grant.taskId, `grants[${index}].taskId`, 256);
  if (!isCanonicalAbsolutePath(grant.worktreeRoot)) {
    throw new SessionScopeAuthorizationError(`grants[${index}].worktreeRoot must be a canonical absolute path`);
  }
  const sessionId = grant.sessionId ?? null;
  if (!(sessionId === null || typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256)) {
    throw new SessionScopeAuthorizationError(`grants[${index}].sessionId must be null or a non-empty session id`);
  }
  if (!Array.isArray(grant.paths) || grant.paths.length === 0 || grant.paths.length > 64) {
    throw new SessionScopeAuthorizationError(`grants[${index}].paths must contain 1 to 64 entries`);
  }
  const paths = grant.paths.map((item, pathIndex) => {
    const entry = asRecord(item, `grants[${index}].paths[${pathIndex}]`);
    assertKnownFields(entry, new Set(['path', 'recursive']), `grants[${index}].paths[${pathIndex}]`);
    if (!isCanonicalAbsolutePath(entry.path)) {
      throw new SessionScopeAuthorizationError(`grants[${index}].paths[${pathIndex}].path must be a canonical absolute path`);
    }
    if (typeof entry.recursive !== 'boolean') {
      throw new SessionScopeAuthorizationError(`grants[${index}].paths[${pathIndex}].recursive must be boolean`);
    }
    return { path: entry.path, recursive: entry.recursive };
  });
  if (!Array.isArray(grant.tools) || grant.tools.length === 0 || !grant.tools.every((tool) => editableTools.includes(tool as HookCall['tool']))) {
    throw new SessionScopeAuthorizationError(`grants[${index}].tools contains an unsupported write tool`);
  }
  const tools = [...new Set(grant.tools as SessionScopeGrant['tools'])];
  const authorizedAt = validateTimestamp(grant.authorizedAt, `grants[${index}].authorizedAt`);
  const expiresAt = validateTimestamp(grant.expiresAt, `grants[${index}].expiresAt`);
  const authorizedMs = Date.parse(authorizedAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= authorizedMs || expiresMs - authorizedMs > MAX_SESSION_SCOPE_TTL_MINUTES * 60_000) {
    throw new SessionScopeAuthorizationError(`grants[${index}] has an invalid expiry window`);
  }
  if (!(grant.revokedAt === null || typeof grant.revokedAt === 'string' && Number.isFinite(Date.parse(grant.revokedAt)))) {
    throw new SessionScopeAuthorizationError(`grants[${index}].revokedAt must be null or a timestamp`);
  }
  assertString(grant.reason, `grants[${index}].reason`, 1000);
  assertString(grant.instruction, `grants[${index}].instruction`, 4096);
  return {
    id: grant.id,
    taskId: grant.taskId,
    worktreeRoot: grant.worktreeRoot,
    sessionId,
    paths,
    tools,
    authorizedAt,
    expiresAt,
    revokedAt: grant.revokedAt as string | null,
    reason: grant.reason,
    instruction: grant.instruction
  };
}

function validateIntent(value: unknown, index: number): SessionScopeIntent {
  const intent = asRecord(value, `intents[${index}]`);
  assertKnownFields(intent, intentFields, `intents[${index}]`);
  assertString(intent.id, `intents[${index}].id`, 128);
  assertString(intent.taskId, `intents[${index}].taskId`, 256);
  if (!isCanonicalAbsolutePath(intent.worktreeRoot)) {
    throw new SessionScopeAuthorizationError(`intents[${index}].worktreeRoot must be a canonical absolute path`);
  }
  assertString(intent.sessionId, `intents[${index}].sessionId`, 256);
  const authorizedAt = validateTimestamp(intent.authorizedAt, `intents[${index}].authorizedAt`);
  const expiresAt = validateTimestamp(intent.expiresAt, `intents[${index}].expiresAt`);
  const authorizedMs = Date.parse(authorizedAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= authorizedMs || expiresMs - authorizedMs > MAX_SESSION_SCOPE_TTL_MINUTES * 60_000) {
    throw new SessionScopeAuthorizationError(`intents[${index}] has an invalid expiry window`);
  }
  assertString(intent.instruction, `intents[${index}].instruction`, 4096);
  return {
    id: intent.id,
    taskId: intent.taskId,
    worktreeRoot: intent.worktreeRoot,
    sessionId: intent.sessionId,
    authorizedAt,
    expiresAt,
    instruction: intent.instruction
  };
}

export function validateSessionScopeAuthorizations(value: unknown): SessionScopeAuthorizations {
  const record = asRecord(value, 'session scope authorizations');
  assertKnownFields(record, new Set(['schema', 'grants', 'intents']), 'session scope authorizations');
  if (record.schema !== SESSION_SCOPE_AUTHORIZATION_SCHEMA) {
    throw new SessionScopeAuthorizationError(`schema must be ${SESSION_SCOPE_AUTHORIZATION_SCHEMA}`);
  }
  if (!Array.isArray(record.grants) || record.grants.length > MAX_GRANTS) {
    throw new SessionScopeAuthorizationError(`grants must contain no more than ${MAX_GRANTS} entries`);
  }
  const intents = record.intents ?? [];
  if (!Array.isArray(intents) || intents.length > 64) {
    throw new SessionScopeAuthorizationError('intents must contain no more than 64 entries');
  }
  return {
    schema: SESSION_SCOPE_AUTHORIZATION_SCHEMA,
    grants: record.grants.map(validateGrant),
    intents: intents.map(validateIntent)
  };
}

interface TaskDirectoryBoundary {
  dir: string;
  realRoot: string;
  realDir: string;
  stat: Stats;
}

async function lstatIfExists(file: string): Promise<Stats | null> {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function inspectDirectory(worktreeRoot: string, create: boolean): Promise<TaskDirectoryBoundary | null> {
  const resolvedRoot = path.resolve(worktreeRoot);
  const dir = path.join(resolvedRoot, '.paneforge-task');
  if (create) await fs.mkdir(dir, { recursive: true });
  const stat = await lstatIfExists(dir);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SessionScopeAuthorizationError('current task directory must be a regular directory');
  }
  const [realRoot, realDir] = await Promise.all([fs.realpath(resolvedRoot), fs.realpath(dir)]);
  if (!isPathInside(realRoot, realDir)) {
    throw new SessionScopeAuthorizationError('current task directory must stay inside the worktree');
  }
  return { dir, realRoot, realDir, stat };
}

async function assertSafeFile(file: string, boundary: TaskDirectoryBoundary): Promise<void> {
  const stat = await lstatIfExists(file);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SessionScopeAuthorizationError('session authorization file must be a regular file');
  }
  const realFile = await fs.realpath(file);
  if (!isPathInside(boundary.realDir, realFile) || !isPathInside(boundary.realRoot, realFile)) {
    throw new SessionScopeAuthorizationError('session authorization file must stay inside the worktree');
  }
}

export async function readSessionScopeAuthorizations(worktreeRoot: string): Promise<SessionScopeAuthorizations> {
  const boundary = await inspectDirectory(worktreeRoot, false);
  if (!boundary) return { schema: SESSION_SCOPE_AUTHORIZATION_SCHEMA, grants: [], intents: [] };
  const file = sessionScopeAuthorizationPath(worktreeRoot);
  await assertSafeFile(file, boundary);
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: SESSION_SCOPE_AUTHORIZATION_SCHEMA, grants: [], intents: [] };
    throw error;
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_AUTHORIZATION_FILE_BYTES) {
    throw new SessionScopeAuthorizationError('session authorization file exceeds 262144 bytes');
  }
  try {
    return validateSessionScopeAuthorizations(JSON.parse(text));
  } catch (error) {
    if (error instanceof SessionScopeAuthorizationError) throw error;
    throw new SessionScopeAuthorizationError(error instanceof Error ? error.message : String(error));
  }
}

async function writeSessionScopeAuthorizations(worktreeRoot: string, value: SessionScopeAuthorizations): Promise<void> {
  const validated = validateSessionScopeAuthorizations(value);
  const boundary = await inspectDirectory(worktreeRoot, true);
  if (!boundary) throw new SessionScopeAuthorizationError('current task directory is unavailable');
  const finalPath = sessionScopeAuthorizationPath(worktreeRoot);
  await assertSafeFile(finalPath, boundary);
  const tempPath = path.join(boundary.dir, `session-authorizations.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const currentBoundary = await inspectDirectory(worktreeRoot, false);
    if (!currentBoundary || normalizeForComparison(currentBoundary.realDir) !== normalizeForComparison(boundary.realDir) || currentBoundary.stat.dev !== boundary.stat.dev || currentBoundary.stat.ino !== boundary.stat.ino) {
      throw new SessionScopeAuthorizationError('current task directory changed during atomic write');
    }
    await assertSafeFile(finalPath, boundary);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

async function withAuthorizationStoreLock<T>(worktreeRoot: string, action: () => Promise<T>): Promise<T> {
  const boundary = await inspectDirectory(worktreeRoot, true);
  if (!boundary) throw new SessionScopeAuthorizationError('current task directory is unavailable');
  const lockPath = `${sessionScopeAuthorizationPath(worktreeRoot)}.lock`;
  const lockStat = await lstatIfExists(lockPath);
  if (lockStat && (lockStat.isSymbolicLink() || !lockStat.isDirectory())) {
    throw new SessionScopeAuthorizationError('session authorization lock must be a regular directory');
  }
  return withFileLock(lockPath, async () => {
    const currentBoundary = await inspectDirectory(worktreeRoot, false);
    if (!currentBoundary || normalizeForComparison(currentBoundary.realDir) !== normalizeForComparison(boundary.realDir) || currentBoundary.stat.dev !== boundary.stat.dev || currentBoundary.stat.ino !== boundary.stat.ino) {
      throw new SessionScopeAuthorizationError('current task directory changed before authorization update');
    }
    return action();
  });
}

export async function captureExplicitSessionScopeIntent(
  task: CurrentTask,
  input: { sessionId: string; prompt: string; now?: Date }
): Promise<SessionScopeIntent | null> {
  if (!input.sessionId || input.sessionId.length > 256) return null;
  const now = input.now ?? new Date();
  return withAuthorizationStoreLock(task.worktreeRoot, async () => {
    const authorizations = await readSessionScopeAuthorizations(task.worktreeRoot);
    const retainedIntents = authorizations.intents.filter((intent) =>
      intent.sessionId !== input.sessionId && Date.parse(intent.expiresAt) > now.getTime()
    );
    if (!isExplicitAuthorizationPrompt(input.prompt)) {
      if (retainedIntents.length !== authorizations.intents.length) {
        await writeSessionScopeAuthorizations(task.worktreeRoot, { ...authorizations, intents: retainedIntents });
      }
      return null;
    }
    const intent = validateIntent({
      id: randomUUID(),
      taskId: task.taskId,
      worktreeRoot: path.resolve(task.worktreeRoot),
      sessionId: input.sessionId,
      authorizedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + DEFAULT_SESSION_SCOPE_TTL_MINUTES * 60_000).toISOString(),
      instruction: authorizationExcerpt(input.prompt)
    }, retainedIntents.length);
    const intents = [...retainedIntents, intent].slice(-64);
    await writeSessionScopeAuthorizations(task.worktreeRoot, { ...authorizations, intents });
    return intent;
  });
}

export async function grantSessionScopeAuthorization(
  task: CurrentTask,
  input: NewSessionScopeGrant
): Promise<SessionScopeGrant> {
  const ttlMinutes = input.ttlMinutes ?? DEFAULT_SESSION_SCOPE_TTL_MINUTES;
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_SESSION_SCOPE_TTL_MINUTES) {
    throw new SessionScopeAuthorizationError(`ttlMinutes must be between 1 and ${MAX_SESSION_SCOPE_TTL_MINUTES}`);
  }
  if (input.paths.length === 0 || input.paths.length > 64) throw new SessionScopeAuthorizationError('one to 64 --path values are required');
  if (input.tools.length === 0 || !input.tools.every((tool) => editableTools.includes(tool))) {
    throw new SessionScopeAuthorizationError('one or more supported --tool values are required: edit, write, apply_patch');
  }
  const now = input.now ?? new Date();
  const instruction = input.instruction.trim();
  const reason = input.reason.trim();
  assertString(instruction, 'instruction', 4096);
  assertString(reason, 'reason', 1000);
  const paths = input.paths.map(({ path: candidate, recursive }) => {
    const resolved = path.resolve(candidate);
    return { path: resolved, recursive: recursive === true };
  });
  return withAuthorizationStoreLock(task.worktreeRoot, async () => {
    const authorizations = await readSessionScopeAuthorizations(task.worktreeRoot);
    if (authorizations.grants.length >= MAX_GRANTS) throw new SessionScopeAuthorizationError(`maximum of ${MAX_GRANTS} grants reached`);
    const grant = validateGrant({
      id: randomUUID(),
      taskId: task.taskId,
      worktreeRoot: path.resolve(task.worktreeRoot),
      sessionId: null,
      paths,
      tools: [...new Set(input.tools)],
      authorizedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      revokedAt: null,
      reason,
      instruction
    }, authorizations.grants.length);
    await writeSessionScopeAuthorizations(task.worktreeRoot, { ...authorizations, grants: [...authorizations.grants, grant] });
    return grant;
  });
}

export interface SessionScopeGrantStatus extends SessionScopeGrant {
  status: 'active' | 'expired' | 'revoked' | 'other_task';
}

export async function listSessionScopeAuthorizations(task: CurrentTask, now = new Date()): Promise<SessionScopeGrantStatus[]> {
  const { grants } = await readSessionScopeAuthorizations(task.worktreeRoot);
  return grants.map((grant) => ({
    ...grant,
    status: grant.revokedAt
      ? 'revoked'
      : Date.parse(grant.expiresAt) <= now.getTime()
        ? 'expired'
        : grant.taskId !== task.taskId || normalizeForComparison(grant.worktreeRoot) !== normalizeForComparison(task.worktreeRoot)
          ? 'other_task'
          : 'active'
  }));
}

export async function revokeSessionScopeAuthorization(
  task: CurrentTask,
  id: string,
  now = new Date()
): Promise<SessionScopeGrant> {
  return withAuthorizationStoreLock(task.worktreeRoot, async () => {
    const authorizations = await readSessionScopeAuthorizations(task.worktreeRoot);
    const index = authorizations.grants.findIndex((grant) => grant.id === id);
    if (index < 0) throw new SessionScopeAuthorizationError(`grant not found: ${id}`);
    const grant = authorizations.grants[index]!;
    if (!grant.revokedAt) authorizations.grants[index] = { ...grant, revokedAt: now.toISOString() };
    await writeSessionScopeAuthorizations(task.worktreeRoot, authorizations);
    return authorizations.grants[index]!;
  });
}

export function matchingSessionScopeAuthorization(
  task: CurrentTask,
  call: HookCall,
  authorizations: SessionScopeAuthorizations,
  now = new Date(),
  sessionId: string | null = null
): SessionScopeGrant | null {
  if (!call.writes || !call.targetPath || !editableTools.includes(call.tool)) return null;
  if (call.destructiveAnalysis && call.destructiveAnalysis.verdict !== 'allow') return null;
  const target = normalizeForComparison(call.targetPath);
  return authorizations.grants.find((grant) => {
    if (grant.taskId !== task.taskId || grant.revokedAt || Date.parse(grant.expiresAt) <= now.getTime()) return false;
    if (grant.sessionId !== null && grant.sessionId !== sessionId) return false;
    if (Date.parse(grant.authorizedAt) > now.getTime() + 60_000) return false;
    if (normalizeForComparison(grant.worktreeRoot) !== normalizeForComparison(task.worktreeRoot)) return false;
    if (!grant.tools.includes(call.tool as SessionScopeGrant['tools'][number])) return false;
    return grant.paths.some((scope) => scope.recursive
      ? isPathInside(scope.path, target)
      : normalizeForComparison(scope.path) === target);
  }) ?? null;
}

export function matchingExplicitSessionScopeIntent(
  task: CurrentTask,
  call: HookCall,
  authorizations: SessionScopeAuthorizations,
  sessionId: string | null,
  now = new Date()
): SessionScopeIntent | null {
  if (!sessionId || !call.writes || !call.targetPath || !editableTools.includes(call.tool)) return null;
  if (call.destructiveAnalysis && call.destructiveAnalysis.verdict !== 'allow') return null;
  const decision = decideHookDryRun(task, call);
  const overridableReason = decision.reason === 'target_outside_task_worktree' ||
    decision.reason.startsWith('phase_') ||
    decision.reason === 'project_policy_block' ||
    decision.reason.startsWith('project_policy_block:');
  if (!overridableReason) return null;
  return authorizations.intents.find((intent) =>
    intent.taskId === task.taskId &&
    intent.sessionId === sessionId &&
    normalizeForComparison(intent.worktreeRoot) === normalizeForComparison(task.worktreeRoot) &&
    Date.parse(intent.authorizedAt) <= now.getTime() + 60_000 &&
    Date.parse(intent.expiresAt) > now.getTime()
  ) ?? null;
}

export function applySessionScopeAuthorizations(
  task: CurrentTask,
  calls: HookCall[],
  authorizations: SessionScopeAuthorizations,
  sessionId: string | null = null,
  now = new Date()
): HookCall[] {
  return calls.map((call) => {
    const grant = matchingSessionScopeAuthorization(task, call, authorizations, now, sessionId);
    const intent = grant ? null : matchingExplicitSessionScopeIntent(task, call, authorizations, sessionId, now);
    if (!grant && !intent) return call;
    return {
      ...call,
      policyEffect: 'allow',
      policyReason: `session_scope_authorization:${grant?.id ?? intent?.id}`
    };
  });
}
