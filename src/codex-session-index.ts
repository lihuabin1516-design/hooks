import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  isCodexPathInside,
  normalizeCodexPath
} from './codex-session-path.js';
import {
  classifyProjectRelation,
  projectOwnerForRelation,
  promptMentionsProjectPath,
  type AppVisibility,
  type ProjectRelation,
  type RuntimeScope,
  type SessionEvidence,
  type StorageState
} from './codex-session-attribution.js';
import {
  boundCodexSessionPrivacyInput
} from './codex-session-privacy.js';
import {
  redactCodexSessionArtifactValue,
  sanitizeCodexSessionArtifactExcerpt
} from './codex-session-artifact-privacy.js';
import { isCodexThreadId } from './codex-session-identity.js';
import {
  CODEX_SESSION_INDEX_ARTIFACT_LIMITS,
  digestDiagnosticSubject,
  projectCodexSessionRecord,
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedIdentifier,
  sanitizeCodexSessionPromptDerivedPath,
  sanitizeCodexSessionTaskBinding,
  validateCodexSessionIndexArtifact,
  type CodexSessionDiagnostic,
  type CodexSessionIndexV3,
  type CodexSessionPromptDerivedPathProjection,
  type CodexSessionSourceState
} from './codex-session-index-artifact.js';

export { normalizeCodexPath } from './codex-session-path.js';
export { projectOwnerForRelation } from './codex-session-attribution.js';
export {
  redactCodexSessionArtifactValue,
  sanitizeCodexSessionArtifactExcerpt,
  type RedactedCodexSessionArtifactValue
} from './codex-session-artifact-privacy.js';
export {
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedIdentifier,
  sanitizeCodexSessionPromptDerivedPath,
  sanitizeCodexSessionTaskBinding,
  type CodexSessionPromptDerivedPathProjection
} from './codex-session-index-artifact.js';

export type CodexSessionSource = 'codex-app' | 'codex-cli' | 'ccpanes' | 'unknown';
export type CodexThreadSource = 'user' | 'subagent' | 'automation' | 'unknown';
export type CodexScopeMatch = 'exact' | 'descendant' | 'ancestor' | 'launch-history' | 'prompt-mention' | 'unknown';

export interface ParsedTaskBindingEvidence {
  taskId: string;
  projectPathRaw: string;
  worktreeRootRaw: string;
}

export interface CodexSessionRecord {
  threadId: string;
  source: CodexSessionSource;
  threadSource: CodexThreadSource;
  originator: string;
  cwdRaw: string | null;
  cwdNorm: string | null;
  projectOwner: string | null;
  scopeMatch: CodexScopeMatch;
  confidence: number;
  rolloutPath: string | null;
  stateDbPresent: boolean;
  rolloutPresent: boolean;
  updatedAt: string | null;
  firstUserPrompt: string | null;
  lastSummary: string | null;
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

export type CodexSessionIndex = CodexSessionIndexV3;

interface ParsedCodexRollout {
  threadId: string | null;
  cwdRaw: string | null;
  originator: string | null;
  source: string | null;
  threadSource: string | null;
  updatedAt: string | null;
  updatedAtEpochMs: number;
  sawTimestamp: boolean;
  firstUserPrompt: string | null;
  lastSummary: string | null;
  taskBinding: ParsedTaskBindingEvidence | null;
  delegatedFromThreadId: string | null;
  primaryTargetRaw: string | null;
}

export function classifyCodexScope(cwdNorm: string | null, project: string | null, prompt: string | null): CodexScopeMatch {
  if (!project) return 'unknown';
  const projectNorm = normalizeCodexPath(project);
  if (cwdNorm === projectNorm) return 'exact';
  if (cwdNorm && isCodexPathInside(projectNorm, cwdNorm)) return 'descendant';
  if (cwdNorm && isCodexPathInside(cwdNorm, projectNorm)) return 'ancestor';
  if (promptMentionsProjectPath(prompt, project)) return 'prompt-mention';
  return 'unknown';
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.input_text === 'string') return record.input_text;
  }
  return null;
}

const TASK_BINDING_MARKER = 'ccpanes-task-probe lifecycle context';
const MAX_LIFECYCLE_BLOCK_LENGTH = 8 * 1024;
const LIFECYCLE_KEYS = new Set([
  'taskId',
  'workspace',
  'phase',
  'worktreeRoot',
  'projectPath',
  'branch',
  'head',
  'currentTaskPath',
  'auditDir',
  'preToolUseAudit',
  'permissionAudit',
  'postToolUseAudit',
  'productionGates'
]);

function sanitizePromptDerivedPrimaryTarget(
  value: string | null
): {
  raw: string | null;
  norm: string | null;
} {
  const projection = sanitizeCodexSessionPromptDerivedPath(value);
  return projection
    ? projection
    : { raw: null, norm: null };
}

function parseTaskBinding(text: string): ParsedTaskBindingEvidence | null {
  const lines = boundCodexSessionPrivacyInput(text).value.split(/\r?\n/);
  for (const [markerIndex, markerLine] of lines.entries()) {
    if (markerLine.trim() !== TASK_BINDING_MARKER) continue;
    const values = new Map<string, string>();
    let blockBytes = Buffer.byteLength(markerLine, 'utf8') + 1;
    for (let index = markerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed || trimmed === TASK_BINDING_MARKER) break;
      blockBytes += Buffer.byteLength(line, 'utf8') + 1;
      if (blockBytes > MAX_LIFECYCLE_BLOCK_LENGTH) break;
      const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(trimmed);
      if (!field || !LIFECYCLE_KEYS.has(field[1])) break;
      if (!values.has(field[1])) values.set(field[1], field[2].trim());
    }
    const taskId = values.get('taskId') ?? '';
    const projectPathRaw = values.get('projectPath') ?? '';
    const worktreeRootRaw = values.get('worktreeRoot') ?? '';
    if (taskId && projectPathRaw && worktreeRootRaw) {
      return { taskId, projectPathRaw, worktreeRootRaw };
    }
  }
  return null;
}

function parseDelegatedFrom(
  text: string,
  rolloutPath: string,
  diagnostics: CodexSessionDiagnosticCollector
): string | null {
  const block = boundCodexSessionPrivacyInput(text).value;
  const candidate =
    /<source_thread_id>\s*([^<\r\n]+?)\s*<\/source_thread_id>/
    .exec(block)?.[1]?.trim() ?? null;
  if (candidate === null || isCodexThreadId(candidate)) return candidate;
  pushCodexSessionDiagnostic(diagnostics, {
    code: 'privacy-projection-dropped',
    source: 'rollout',
    field: 'delegatedFromThreadId',
    reason: 'unsafe-identity',
    subjectDigest: digestDiagnosticSubject(candidate || rolloutPath)
  });
  return null;
}

function isPrimaryTargetNamespace(candidate: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(candidate) ||
    /^\\\\[^\\/\s]+[\\/][^\\/\s]+/.test(candidate) ||
    candidate.startsWith('/');
}

function parsePrimaryTarget(text: string): string | null {
  const block = boundCodexSessionPrivacyInput(text).value;
  const prefix =
    /(?:^|[\s>])(?:audit|inspect|review|target|审计|检查|工作目录|目录|工作树|仓库)\s*(?:target|path)?\s*[:：]?\s*/gi;
  for (const match of block.matchAll(prefix)) {
    const remainder = block.slice((match.index ?? 0) + match[0].length);
    const delimiter = remainder[0];
    let candidate = '';
    if (delimiter === '`' || delimiter === '"' || delimiter === "'") {
      const closingIndex = remainder.indexOf(delimiter, 1);
      if (closingIndex < 0) continue;
      candidate = remainder.slice(1, closingIndex).trim();
    } else {
      candidate = (/^[^\s<>`"',;!?，；。！？、（(\[【［]+/u.exec(remainder)?.[0] ?? '')
        .replace(/[.,;:!?，。；：！？、)\]}）】》」』]+$/u, '');
    }
    if (
      candidate &&
      isPrimaryTargetNamespace(candidate) &&
      normalizeCodexPath(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

const CAPACITY_DIAGNOSTIC: CodexSessionDiagnostic = Object.freeze({
  code: 'record-skipped',
  source: 'state-row',
  field: null,
  reason: 'capacity-exceeded',
  subjectDigest: null
});

function diagnosticKey(value: CodexSessionDiagnostic): string {
  return JSON.stringify([
    value.code,
    value.source,
    value.field,
    value.reason,
    value.subjectDigest
  ]);
}

class CodexSessionDiagnosticCollector {
  readonly values: CodexSessionDiagnostic[] = [];
  readonly #keys = new Set<string>();
  #saturated = false;

  push(value: CodexSessionDiagnostic): void {
    if (this.#saturated) return;
    const key = diagnosticKey(value);
    if (this.#keys.has(key)) return;
    const limit = Number(
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnostics
    );
    if (this.values.length < limit) {
      this.values.push(value);
      this.#keys.add(key);
      return;
    }
    this.#saturated = true;
    if (limit === 0) return;
    const capacityKey = diagnosticKey(CAPACITY_DIAGNOSTIC);
    const existingCapacity = this.#keys.has(capacityKey);
    if (!existingCapacity) {
      const removed = this.values[limit - 1];
      if (removed) this.#keys.delete(diagnosticKey(removed));
      this.values[limit - 1] = CAPACITY_DIAGNOSTIC;
      this.#keys.add(capacityKey);
    }
  }

  pushAll(values: Iterable<CodexSessionDiagnostic>): void {
    for (const value of values) this.push(value);
  }
}

function pushCodexSessionDiagnostic(
  diagnostics: CodexSessionDiagnosticCollector,
  value: CodexSessionDiagnostic
): void {
  diagnostics.push(value);
}

const ROLLOUT_TIMESTAMP_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function parseRolloutTimestamp(value: unknown): {
  canonical: string;
  epochMs: number;
} | null {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = ROLLOUT_TIMESTAMP_WITH_TIMEZONE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return null;
  return {
    canonical: new Date(epochMs).toISOString(),
    epochMs
  };
}

function parseJsonlText(
  text: string,
  state: ParsedCodexRollout,
  rolloutPath: string,
  diagnostics: CodexSessionDiagnosticCollector
): void {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      pushCodexSessionDiagnostic(diagnostics, {
        code: 'rollout-jsonl-invalid',
        source: 'rollout',
        field: null,
        reason: 'invalid-json',
        subjectDigest: digestDiagnosticSubject(rolloutPath)
      });
      continue;
    }
    if (Object.hasOwn(value, 'timestamp')) {
      state.sawTimestamp = true;
      const timestamp = parseRolloutTimestamp(value.timestamp);
      if (timestamp === null) {
        pushCodexSessionDiagnostic(diagnostics, {
          code: 'privacy-projection-dropped',
          source: 'rollout',
          field: 'updatedAt',
          reason: 'invalid-record',
          subjectDigest: digestDiagnosticSubject(rolloutPath)
        });
      } else if (timestamp.epochMs > state.updatedAtEpochMs) {
        state.updatedAt = timestamp.canonical;
        state.updatedAtEpochMs = timestamp.epochMs;
      }
    }
    const payload = value.payload && typeof value.payload === 'object'
      ? value.payload as Record<string, unknown>
      : {};
    if (value.type === 'session_meta') {
      state.threadId = typeof payload.id === 'string' ? payload.id :
        typeof payload.session_id === 'string' ? payload.session_id : state.threadId;
      state.cwdRaw = typeof payload.cwd === 'string' ? payload.cwd : state.cwdRaw;
      state.originator = typeof payload.originator === 'string' ? payload.originator : state.originator;
      state.source = typeof payload.source === 'string' ? payload.source : state.source;
      state.threadSource = typeof payload.thread_source === 'string' ? payload.thread_source : state.threadSource;
    }
    if (value.type === 'turn_context') {
      state.cwdRaw = typeof payload.cwd === 'string' ? payload.cwd : state.cwdRaw;
      if (typeof payload.summary === 'string' && payload.summary.trim()) state.lastSummary = payload.summary.trim();
    }
    if (
      !state.taskBinding &&
      value.type === 'response_item' &&
      payload.type === 'message' &&
      payload.role === 'developer'
    ) {
      const developerText = textFromContent(payload.content);
      if (developerText) state.taskBinding = parseTaskBinding(developerText);
    }
    const userText =
      value.type === 'event_msg' &&
      payload.type === 'user_message' &&
      typeof payload.message === 'string'
        ? payload.message
        : value.type === 'response_item' &&
          payload.type === 'message' &&
          payload.role === 'user'
          ? textFromContent(payload.content)
          : null;
    if (userText !== null) {
      if (!state.firstUserPrompt) state.firstUserPrompt = userText;
      if (!state.delegatedFromThreadId) {
        state.delegatedFromThreadId = parseDelegatedFrom(
          userText,
          rolloutPath,
          diagnostics
        );
      }
      if (!state.primaryTargetRaw) {
        state.primaryTargetRaw = parsePrimaryTarget(userText);
      }
    }
    if (value.type === 'response_item' && payload.type === 'reasoning') {
      const summary = textFromContent(payload.summary);
      if (summary) state.lastSummary = summary;
    }
  }
}

async function readBounded(filePath: string, start: number, length: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function parseCodexRolloutFile(
  rolloutPath: string,
  diagnostics: CodexSessionDiagnosticCollector,
  options: { maxHeadBytes?: number; maxTailBytes?: number } = {}
): Promise<ParsedCodexRollout> {
  const maxHeadBytes = options.maxHeadBytes ?? 512 * 1024;
  const maxTailBytes = options.maxTailBytes ?? 256 * 1024;
  const stat = await fs.stat(rolloutPath);
  const mtimeEpochMs = stat.mtime.getTime();
  const state: ParsedCodexRollout = {
    threadId: null, cwdRaw: null, originator: null, source: null, threadSource: null,
    updatedAt: null, updatedAtEpochMs: Number.NEGATIVE_INFINITY,
    sawTimestamp: false,
    firstUserPrompt: null, lastSummary: null,
    taskBinding: null, delegatedFromThreadId: null, primaryTargetRaw: null,
  };
  if (stat.size <= maxHeadBytes || stat.size <= maxHeadBytes + maxTailBytes) {
    parseJsonlText(
      await readBounded(rolloutPath, 0, stat.size),
      state,
      rolloutPath,
      diagnostics
    );
    if (state.updatedAt === null && !state.sawTimestamp) {
      state.updatedAt = stat.mtime.toISOString();
      state.updatedAtEpochMs = mtimeEpochMs;
    }
    return state;
  }
  const head = await readBounded(rolloutPath, 0, maxHeadBytes);
  const lastHeadNewline = head.lastIndexOf('\n');
  parseJsonlText(
    lastHeadNewline >= 0 ? head.slice(0, lastHeadNewline) : '',
    state,
    rolloutPath,
    diagnostics
  );

  const tailStart = stat.size - maxTailBytes;
  const byteBeforeTail = await readBounded(rolloutPath, tailStart - 1, 1);
  const tail = await readBounded(rolloutPath, tailStart, maxTailBytes);
  const firstTailNewline = tail.indexOf('\n');
  parseJsonlText(
    byteBeforeTail === '\n'
      ? tail
      : firstTailNewline >= 0
        ? tail.slice(firstTailNewline + 1)
        : '',
    state,
    rolloutPath,
    diagnostics
  );
  if (state.updatedAt === null && !state.sawTimestamp) {
    state.updatedAt = stat.mtime.toISOString();
    state.updatedAtEpochMs = mtimeEpochMs;
  }
  return state;
}

async function pathExists(candidate: string): Promise<boolean> {
  try { await fs.stat(candidate); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function listRollouts(
  root: string,
  limit: number
): Promise<{ values: string[]; overflowed: boolean }> {
  if (!await pathExists(root)) {
    return { values: [], overflowed: false };
  }
  const found: string[] = [];
  const sentinelLimit = limit + 1;
  async function visit(dir: string): Promise<boolean> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await visit(candidate)) return true;
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        found.push(candidate);
        if (found.length >= sentinelLimit) return true;
      }
    }
    return false;
  }
  await visit(root);
  return {
    values: found.slice(0, limit),
    overflowed: found.length > limit
  };
}

function isoFromDb(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'bigint') return null;
  const numeric = Number(value);
  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sourceFrom(originator: string | null, source: string | null): CodexSessionSource {
  const joined = `${originator ?? ''} ${source ?? ''}`.toLowerCase();
  if (joined.includes('ccpanes') || joined.includes('cc-panes')) return 'ccpanes';
  if (joined.includes('codex desktop') || joined.includes('vscode')) return 'codex-app';
  if (joined.includes('codex-tui') || joined.includes('cli')) return 'codex-cli';
  return 'unknown';
}

function threadSourceFrom(value: string | null): CodexThreadSource {
  return value === 'user' || value === 'subagent' || value === 'automation' ? value : 'unknown';
}

function storageStateFor(
  rolloutPath: string | null,
  rolloutPresent: boolean
): StorageState {
  if (!rolloutPath || !rolloutPresent) return 'missing';
  const normalized = normalizeCodexPath(rolloutPath);
  if (!normalized) return 'missing';
  return normalized.split('/').includes('archived_sessions')
    ? 'archived'
    : 'active';
}

function deriveSessionProjection(input: {
  project: string | null;
  cwdNorm: string | null;
  threadSource: CodexThreadSource;
  rolloutPath: string | null;
  rolloutPresent: boolean;
  firstUserPrompt: string | null;
  parsed: ParsedCodexRollout | null;
}): Pick<
  CodexSessionRecord,
  | 'storageState'
  | 'runtimeScope'
  | 'projectRelation'
  | 'relationConfidence'
  | 'relationReasons'
  | 'evidence'
  | 'appVisibility'
  | 'taskBinding'
  | 'delegatedFromThreadId'
  | 'primaryTargetRaw'
  | 'primaryTargetNorm'
> {
  const rawPrimaryTarget = input.parsed?.primaryTargetRaw ?? null;
  const normalizedRawPrimaryTarget = rawPrimaryTarget
    ? normalizeCodexPath(rawPrimaryTarget)
    : '';
  const rawPrimaryTargetNorm = normalizedRawPrimaryTarget || null;
  const rawTaskBinding = input.parsed?.taskBinding ?? null;
  const rawTaskProjectPathNorm = rawTaskBinding
    ? normalizeCodexPath(rawTaskBinding.projectPathRaw)
    : '';
  const storageState = storageStateFor(
    input.rolloutPath,
    input.rolloutPresent
  );
  const attribution = classifyProjectRelation({
    project: input.project,
    cwdNorm: input.cwdNorm,
    storageState,
    threadSource: input.threadSource,
    primaryTargetNorm: rawPrimaryTargetNorm,
    promptMentionsProject: promptMentionsProjectPath(
      input.firstUserPrompt,
      input.project
    ),
    taskBinding: rawTaskBinding && rawTaskProjectPathNorm
      ? {
          taskId: rawTaskBinding.taskId,
          projectPathNorm: rawTaskProjectPathNorm
        }
      : null,
    ccpanesLaunch: null
  });
  const primaryTarget = sanitizePromptDerivedPrimaryTarget(rawPrimaryTarget);
  const taskBinding = sanitizeCodexSessionTaskBinding(rawTaskBinding);
  const taskProjectPathNorm = taskBinding
    ? normalizeCodexPath(taskBinding.projectPathRaw)
    : '';
  const rawDelegatedFromThreadId =
    input.parsed?.delegatedFromThreadId ?? null;
  const delegatedFromThreadId = isCodexThreadId(rawDelegatedFromThreadId)
    ? rawDelegatedFromThreadId
    : null;
  const displayEvidence = attribution.evidence.flatMap(
    (item): SessionEvidence[] => {
      if (item.kind === 'primary-target') {
        return primaryTarget.norm
          ? [{ kind: 'primary-target', target: primaryTarget.norm }]
          : [];
      }
      if (item.kind === 'task-binding') {
        return taskBinding && taskProjectPathNorm
          ? [{
              kind: 'task-binding',
              projectPath: taskProjectPathNorm,
              taskId: taskBinding.taskId
            }]
          : [];
      }
      return [item];
    }
  );
  const evidence: SessionEvidence[] = delegatedFromThreadId
    ? [
        ...displayEvidence,
        { kind: 'delegation', sourceThreadId: delegatedFromThreadId }
      ]
    : displayEvidence;
  return {
    storageState,
    runtimeScope: attribution.runtimeScope,
    projectRelation: attribution.projectRelation,
    relationConfidence: attribution.relationConfidence,
    relationReasons: attribution.reasons,
    evidence,
    appVisibility: 'unknown',
    taskBinding: rawTaskBinding,
    delegatedFromThreadId: rawDelegatedFromThreadId,
    primaryTargetRaw: rawPrimaryTarget,
    primaryTargetNorm: rawPrimaryTargetNorm
  };
}

type SqliteRow = Record<string, unknown>;

function addSourceDiagnostic(
  diagnostics: CodexSessionDiagnosticCollector,
  code: 'source-missing' | 'source-unreadable',
  source: 'sessions-dir' | 'state-db' | 'thread-history-db' | 'task-context',
  reason: 'missing' | 'unreadable',
  subject: string
): void {
  pushCodexSessionDiagnostic(diagnostics, {
    code,
    source,
    field: 'path',
    reason,
    subjectDigest: digestDiagnosticSubject(subject)
  });
}

async function inspectSource(
  sourcePath: string,
  source: 'sessions-dir' | 'state-db' | 'thread-history-db' | 'task-context',
  expectedKind: 'directory' | 'file',
  diagnostics: CodexSessionDiagnosticCollector
): Promise<CodexSessionSourceState> {
  try {
    const stat = await fs.stat(sourcePath);
    const expected = expectedKind === 'directory'
      ? stat.isDirectory()
      : stat.isFile();
    if (!expected) {
      addSourceDiagnostic(
        diagnostics,
        'source-unreadable',
        source,
        'unreadable',
        sourcePath
      );
      return { path: sourcePath, availability: 'unreadable' };
    }
    return { path: sourcePath, availability: 'present' };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    addSourceDiagnostic(
      diagnostics,
      missing ? 'source-missing' : 'source-unreadable',
      source,
      missing ? 'missing' : 'unreadable',
      sourcePath
    );
    return {
      path: sourcePath,
      availability: missing ? 'missing' : 'unreadable'
    };
  }
}

async function inspectAvailabilityOnlyFile(
  sourcePath: string,
  diagnostics: CodexSessionDiagnosticCollector
): Promise<CodexSessionSourceState> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(sourcePath, 'r');
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    addSourceDiagnostic(
      diagnostics,
      missing ? 'source-missing' : 'source-unreadable',
      'thread-history-db',
      missing ? 'missing' : 'unreadable',
      sourcePath
    );
    return {
      path: sourcePath,
      availability: missing ? 'missing' : 'unreadable'
    };
  }
  try {
    await handle.close();
    return { path: sourcePath, availability: 'present' };
  } catch {
    addSourceDiagnostic(
      diagnostics,
      'source-unreadable',
      'thread-history-db',
      'unreadable',
      sourcePath
    );
    return { path: sourcePath, availability: 'unreadable' };
  }
}

function readThreadRows(
  dbPath: string,
  diagnostics: CodexSessionDiagnosticCollector,
  limit: number
): {
  rows: SqliteRow[];
  availability: 'present' | 'unreadable';
  overflowed: boolean;
} {
  if (!path.isAbsolute(dbPath)) {
    addSourceDiagnostic(
      diagnostics,
      'source-unreadable',
      'state-db',
      'unreadable',
      dbPath
    );
    return {
      rows: [],
      availability: 'unreadable',
      overflowed: false
    };
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare(
        'select * from threads order by id limit ?'
      ).all(limit + 1) as SqliteRow[];
      return {
        rows: rows.slice(0, limit),
        availability: 'present',
        overflowed: rows.length > limit
      };
    } finally {
      db.close();
    }
  } catch {
    addSourceDiagnostic(
      diagnostics,
      'source-unreadable',
      'state-db',
      'unreadable',
      dbPath
    );
    return {
      rows: [],
      availability: 'unreadable',
      overflowed: false
    };
  }
}

function recordTimestampEpoch(record: CodexSessionRecord): number {
  if (record.updatedAt === null) return Number.NEGATIVE_INFINITY;
  const epochMs = Date.parse(record.updatedAt);
  return Number.isFinite(epochMs) ? epochMs : Number.NEGATIVE_INFINITY;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sessionRecordTotalOrderKey(record: CodexSessionRecord): string {
  return JSON.stringify([
    record.rolloutPath,
    record.source,
    record.threadSource,
    record.originator,
    record.cwdRaw,
    record.cwdNorm,
    record.projectOwner,
    record.scopeMatch,
    record.confidence,
    record.stateDbPresent,
    record.rolloutPresent,
    record.updatedAt,
    record.firstUserPrompt,
    record.lastSummary,
    record.storageState,
    record.runtimeScope,
    record.projectRelation,
    record.relationConfidence,
    record.relationReasons,
    record.evidence,
    record.appVisibility,
    record.taskBinding,
    record.delegatedFromThreadId,
    record.primaryTargetRaw,
    record.primaryTargetNorm
  ]);
}

function compareSessionRecordPriority(
  left: CodexSessionRecord,
  right: CodexSessionRecord
): number {
  if (left.stateDbPresent !== right.stateDbPresent) {
    return left.stateDbPresent ? -1 : 1;
  }
  const leftEpoch = recordTimestampEpoch(left);
  const rightEpoch = recordTimestampEpoch(right);
  if (leftEpoch !== rightEpoch) {
    return leftEpoch > rightEpoch ? -1 : 1;
  }
  return compareText(
    sessionRecordTotalOrderKey(left),
    sessionRecordTotalOrderKey(right)
  );
}

function preferredSessionRecord(
  left: CodexSessionRecord,
  right: CodexSessionRecord
): CodexSessionRecord {
  return compareSessionRecordPriority(left, right) <= 0 ? left : right;
}

interface SessionMergeAccumulator {
  metadata: CodexSessionRecord;
  rolloutEvidence: CodexSessionRecord | null;
  stateDbPresent: boolean;
}

function hasValidRolloutEvidence(record: CodexSessionRecord): boolean {
  return record.rolloutPresent && record.rolloutPath !== null;
}

function createSessionMergeAccumulator(
  record: CodexSessionRecord
): SessionMergeAccumulator {
  return {
    metadata: record,
    rolloutEvidence: hasValidRolloutEvidence(record) ? record : null,
    stateDbPresent: record.stateDbPresent
  };
}

function mergeSessionRecord(
  accumulator: SessionMergeAccumulator,
  record: CodexSessionRecord
): void {
  accumulator.metadata = preferredSessionRecord(
    accumulator.metadata,
    record
  );
  accumulator.stateDbPresent ||= record.stateDbPresent;
  if (!hasValidRolloutEvidence(record)) return;
  accumulator.rolloutEvidence = accumulator.rolloutEvidence === null
    ? record
    : preferredSessionRecord(accumulator.rolloutEvidence, record);
}

function finalizeSessionMerge(
  accumulator: SessionMergeAccumulator
): CodexSessionRecord {
  const rolloutPath = accumulator.rolloutEvidence?.rolloutPath ?? null;
  const storageState = rolloutPath === null
    ? 'missing'
    : storageStateFor(rolloutPath, true);
  return {
    ...accumulator.metadata,
    stateDbPresent: accumulator.stateDbPresent,
    rolloutPath: storageState === 'missing' ? null : rolloutPath,
    rolloutPresent: storageState !== 'missing',
    storageState
  };
}

export async function buildCodexSessionIndex(input: {
  sessionsDir: string;
  stateDb: string;
  threadHistoryDb: string;
  taskContext?: string | null;
  project?: string | null;
}): Promise<CodexSessionIndex> {
  const boundaryRoot = process.cwd();
  const sessionsDir = path.resolve(boundaryRoot, input.sessionsDir);
  const stateDb = path.resolve(boundaryRoot, input.stateDb);
  const threadHistoryDb = path.resolve(boundaryRoot, input.threadHistoryDb);
  const taskContext = input.taskContext?.trim()
    ? path.resolve(boundaryRoot, input.taskContext)
    : null;
  const diagnostics = new CodexSessionDiagnosticCollector();
  let sessionsDirState = await inspectSource(
    sessionsDir,
    'sessions-dir',
    'directory',
    diagnostics
  );
  let stateDbState = await inspectSource(
    stateDb,
    'state-db',
    'file',
    diagnostics
  );
  const historyState = await inspectAvailabilityOnlyFile(
    threadHistoryDb,
    diagnostics
  );
  const taskContextState = taskContext
    ? await inspectSource(
        taskContext,
        'task-context',
        'file',
        diagnostics
      )
    : null;
  let rows: SqliteRow[] = [];
  if (stateDbState.availability === 'present') {
    const stateRows = readThreadRows(
      stateDb,
      diagnostics,
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
    );
    rows = stateRows.rows;
    if (stateRows.overflowed) diagnostics.push(CAPACITY_DIAGNOSTIC);
    if (stateRows.availability === 'unreadable') {
      stateDbState = { path: stateDb, availability: 'unreadable' };
    }
  }
  let rollouts: string[] = [];
  if (sessionsDirState.availability === 'present') {
    try {
      const rolloutCandidates = await listRollouts(
        sessionsDir,
        CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
      );
      rollouts = rolloutCandidates.values;
      if (rolloutCandidates.overflowed) {
        diagnostics.push(CAPACITY_DIAGNOSTIC);
      }
    } catch {
      addSourceDiagnostic(
        diagnostics,
        'source-unreadable',
        'sessions-dir',
        'unreadable',
        sessionsDir
      );
      sessionsDirState = {
        path: sessionsDir,
        availability: 'unreadable'
      };
    }
  }
  const rolloutByNorm = new Map(rollouts.map((file) => [normalizeCodexPath(file), file]));
  const consumed = new Set<string>();
  const sessionsByThreadId = new Map<string, SessionMergeAccumulator>();
  const addCandidate = (candidate: CodexSessionRecord): void => {
    const projectionDiagnostics: CodexSessionDiagnostic[] = [];
    const projected = projectCodexSessionRecord(
      candidate,
      projectionDiagnostics
    );
    diagnostics.pushAll(projectionDiagnostics);
    if (!projected) return;
    const existing = sessionsByThreadId.get(projected.threadId);
    if (existing) {
      mergeSessionRecord(existing, projected);
      return;
    }
    if (
      sessionsByThreadId.size >=
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
    ) {
      diagnostics.push(CAPACITY_DIAGNOSTIC);
      return;
    }
    sessionsByThreadId.set(
      projected.threadId,
      createSessionMergeAccumulator(projected)
    );
  };

  for (const row of rows) {
    const threadId = typeof row.id === 'string' ? row.id : null;
    if (threadId === null) {
      pushCodexSessionDiagnostic(diagnostics, {
        code: 'record-skipped',
        source: 'state-row',
        field: 'threadId',
        reason: 'unsafe-identity',
        subjectDigest: null
      });
      continue;
    }
    const configuredRollout = typeof row.rollout_path === 'string' ? row.rollout_path : null;
    const configuredRolloutPath = configuredRollout
      ? path.resolve(boundaryRoot, configuredRollout)
      : null;
    const rolloutPath = configuredRolloutPath
      ? rolloutByNorm.get(normalizeCodexPath(configuredRolloutPath)) ?? configuredRolloutPath
      : null;
    let rolloutPresent = false;
    if (rolloutPath) {
      try {
        rolloutPresent = await pathExists(rolloutPath);
      } catch {
        pushCodexSessionDiagnostic(diagnostics, {
          code: 'rollout-unreadable',
          source: 'rollout',
          field: 'rolloutPath',
          reason: 'unreadable',
          subjectDigest: digestDiagnosticSubject(rolloutPath)
        });
      }
      if (!rolloutPresent) {
        pushCodexSessionDiagnostic(diagnostics, {
          code: 'source-missing',
          source: 'rollout',
          field: 'rolloutPath',
          reason: 'missing',
          subjectDigest: digestDiagnosticSubject(rolloutPath)
        });
      }
    }
    let parsed: ParsedCodexRollout | null = null;
    if (rolloutPath && rolloutPresent) {
      consumed.add(normalizeCodexPath(rolloutPath));
      try {
        parsed = await parseCodexRolloutFile(rolloutPath, diagnostics);
      }
      catch {
        pushCodexSessionDiagnostic(diagnostics, {
          code: 'rollout-unreadable',
          source: 'rollout',
          field: 'rolloutPath',
          reason: 'unreadable',
          subjectDigest: digestDiagnosticSubject(rolloutPath)
        });
      }
    }
    const cwdRaw = typeof row.cwd === 'string' ? row.cwd : parsed?.cwdRaw ?? null;
    const cwdNorm = cwdRaw ? normalizeCodexPath(cwdRaw) || null : null;
    const firstUserPrompt = typeof row.first_user_message === 'string' ? row.first_user_message : parsed?.firstUserPrompt ?? null;
    const lastSummary = typeof row.preview === 'string'
      ? row.preview
      : parsed?.lastSummary ?? null;
    const scopeMatch = classifyCodexScope(cwdNorm, input.project ?? null, firstUserPrompt);
    const originator = parsed?.originator ?? 'unknown';
    const threadSource = threadSourceFrom(
      typeof row.thread_source === 'string'
        ? row.thread_source
        : parsed?.threadSource ?? null
    );
    const projection = deriveSessionProjection({
      project: input.project ?? null,
      cwdNorm,
      threadSource,
      rolloutPath,
      rolloutPresent,
      firstUserPrompt,
      parsed
    });
    const candidate: CodexSessionRecord = {
      threadId,
      source: sourceFrom(originator, typeof row.source === 'string' ? row.source : parsed?.source ?? null),
      threadSource,
      originator,
      cwdRaw,
      cwdNorm,
      projectOwner: projectOwnerForRelation(
        input.project ?? null,
        projection.projectRelation
      ),
      scopeMatch,
      confidence: scopeMatch === 'exact' ? 1 : scopeMatch === 'descendant' ? 0.9 : scopeMatch === 'ancestor' ? 0.75 : scopeMatch === 'prompt-mention' ? 0.5 : 0.2,
      rolloutPath,
      stateDbPresent: true,
      rolloutPresent,
      updatedAt: isoFromDb(row.updated_at_ms ?? row.updated_at) ?? parsed?.updatedAt ?? null,
      firstUserPrompt,
      lastSummary,
      ...projection
    };
    addCandidate(candidate);
  }

  for (const rolloutPath of rollouts) {
    if (consumed.has(normalizeCodexPath(rolloutPath))) continue;
    try {
      const parsed = await parseCodexRolloutFile(
        rolloutPath,
        diagnostics
      );
      const threadId = parsed.threadId ?? path.basename(rolloutPath, '.jsonl');
      const cwdNorm = parsed.cwdRaw
        ? normalizeCodexPath(parsed.cwdRaw) || null
        : null;
      const scopeMatch = classifyCodexScope(cwdNorm, input.project ?? null, parsed.firstUserPrompt);
      const threadSource = threadSourceFrom(parsed.threadSource);
      const projection = deriveSessionProjection({
        project: input.project ?? null,
        cwdNorm,
        threadSource,
        rolloutPath,
        rolloutPresent: true,
        firstUserPrompt: parsed.firstUserPrompt,
        parsed
      });
      const candidate: CodexSessionRecord = {
        threadId,
        source: sourceFrom(parsed.originator, parsed.source),
        threadSource,
        originator: parsed.originator ?? 'unknown',
        cwdRaw: parsed.cwdRaw,
        cwdNorm,
        projectOwner: projectOwnerForRelation(
          input.project ?? null,
          projection.projectRelation
        ),
        scopeMatch,
        confidence: scopeMatch === 'exact' ? 0.9 : scopeMatch === 'unknown' ? 0.15 : 0.6,
        rolloutPath,
        stateDbPresent: false,
        rolloutPresent: true,
        updatedAt: parsed.updatedAt,
        firstUserPrompt: parsed.firstUserPrompt,
        lastSummary: parsed.lastSummary,
        ...projection
      };
      addCandidate(candidate);
    } catch {
      pushCodexSessionDiagnostic(diagnostics, {
        code: 'rollout-unreadable',
        source: 'rollout',
        field: 'rolloutPath',
        reason: 'unreadable',
        subjectDigest: digestDiagnosticSubject(rolloutPath)
      });
    }
  }

  const sessions = [...sessionsByThreadId.values()].map(finalizeSessionMerge);
  sessions.sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
    a.threadId.localeCompare(b.threadId)
  );
  return validateCodexSessionIndexArtifact({
    schemaVersion: 'hooks.codex-session-index/v3',
    generatedAt: new Date().toISOString(),
    sources: {
      sessionsDir: sessionsDirState,
      stateDb: stateDbState,
      threadHistoryDb: {
        ...historyState,
        role: 'availability-only'
      },
      taskContext: taskContextState
    },
    sessions,
    diagnostics: diagnostics.values
  });
}

export async function writeCodexSessionJson(outPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}
