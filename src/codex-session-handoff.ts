import path from 'node:path';
import {
  normalizeCodexPath,
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedPath
} from './codex-session-index.js';
import {
  filterResolvedSessions,
  validateCodexSessionResolutionArtifact,
  type CodexSessionResolution
} from './codex-session-resolver.js';
import {
  CODEX_SESSION_INDEX_ARTIFACT_LIMITS,
  validateCodexSessionIndexArtifact,
  type CodexSessionDiagnostic
} from './codex-session-index-artifact.js';
import {
  CurrentTaskFileReadError,
  readCurrentTaskFile
} from './current-task.js';
import type { CurrentTask } from './types.js';

export type HandoffMode = 'ccpanes-worker' | 'codex-app-visual';

export type CodexSessionRetentionRisk =
  | 'ok'
  | 'rollout-missing'
  | 'state-missing'
  | 'cwd-ambiguous'
  | 'large-transcript';

export interface CodexSessionRetentionEntry {
  threadId: string;
  rolloutPath: string | null;
  rolloutPresent: boolean;
  stateDbPresent: boolean;
  cwdNorm: string | null;
  projectOwner: string | null;
  updatedAt: string | null;
  risk: CodexSessionRetentionRisk;
}

export interface CodexSessionRetentionManifest {
  schemaVersion: 'hooks.codex-session-retention/v2';
  generatedAt: string;
  sessions: CodexSessionRetentionEntry[];
  diagnostics: CodexSessionDiagnostic[];
}

export type CodexSessionRetentionArtifactErrorReason =
  | 'invalid-shape'
  | 'unknown-field'
  | 'unsupported-schema'
  | 'invalid-enum'
  | 'capacity-exceeded';

export class CodexSessionRetentionArtifactError extends Error {
  readonly code = 'CODEX_SESSION_RETENTION_ARTIFACT' as const;

  constructor(
    readonly field: string,
    readonly reason: CodexSessionRetentionArtifactErrorReason
  ) {
    super(`CODEX_SESSION_RETENTION_ARTIFACT: ${field}: ${reason}`);
    this.name = 'CodexSessionRetentionArtifactError';
  }
}

const RETENTION_FIELDS = new Set([
  'schemaVersion',
  'generatedAt',
  'sessions',
  'diagnostics'
]);
const RETENTION_ENTRY_FIELDS = new Set([
  'threadId',
  'rolloutPath',
  'rolloutPresent',
  'stateDbPresent',
  'cwdNorm',
  'projectOwner',
  'updatedAt',
  'risk'
]);
const RETENTION_RISKS = new Set<CodexSessionRetentionRisk>([
  'ok',
  'rollout-missing',
  'state-missing',
  'cwd-ambiguous',
  'large-transcript'
]);
const RETENTION_INDEX_SOURCES = Object.freeze({
  sessionsDir: { path: null, availability: 'missing' as const },
  stateDb: { path: null, availability: 'missing' as const },
  threadHistoryDb: {
    path: null,
    availability: 'missing' as const,
    role: 'availability-only' as const
  },
  taskContext: null
});

function invalidRetention(
  field: string,
  reason: CodexSessionRetentionArtifactErrorReason
): never {
  throw new CodexSessionRetentionArtifactError(field, reason);
}

function retentionRecord(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidRetention(field, 'invalid-shape');
  }
  return value as Record<string, unknown>;
}

function assertRetentionFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      invalidRetention(`${field}.${key}`, 'unknown-field');
    }
  }
}

function retentionBaseSession(
  entry: Record<string, unknown>
): import('./codex-session-index.js').CodexSessionRecord {
  return {
    threadId: entry.threadId as string,
    source: 'unknown',
    threadSource: 'unknown',
    originator: 'unknown',
    cwdRaw: null,
    cwdNorm: entry.cwdNorm as string | null,
    projectOwner: entry.projectOwner as string | null,
    scopeMatch: 'unknown',
    confidence: 0,
    rolloutPath: entry.rolloutPath as string | null,
    stateDbPresent: entry.stateDbPresent as boolean,
    rolloutPresent: entry.rolloutPresent as boolean,
    updatedAt: entry.updatedAt as string | null,
    firstUserPrompt: null,
    lastSummary: null,
    storageState: 'active',
    runtimeScope: 'unrelated',
    projectRelation: 'unknown',
    relationConfidence: 0,
    relationReasons: [],
    evidence: [],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null
  };
}

function derivedRetentionRisk(
  session: Pick<
    CodexSessionRetentionEntry,
    | 'rolloutPath'
    | 'rolloutPresent'
    | 'stateDbPresent'
    | 'cwdNorm'
  >
): CodexSessionRetentionRisk {
  if (!session.rolloutPresent || session.rolloutPath === null) {
    return 'rollout-missing';
  }
  if (!session.stateDbPresent) return 'state-missing';
  if (session.cwdNorm === null) return 'cwd-ambiguous';
  return 'ok';
}

function mapRetentionIndexProjectionFailure(error: unknown): never {
  const details = error !== null && typeof error === 'object'
    ? error as { field?: unknown; reason?: unknown }
    : {};
  if (
    details.reason === 'capacity-exceeded' &&
    (details.field === 'diagnostics' || details.field === 'sessions')
  ) {
    return invalidRetention(details.field, 'capacity-exceeded');
  }
  return invalidRetention('root', 'invalid-shape');
}

export function validateCodexSessionRetentionManifest(
  value: unknown
): CodexSessionRetentionManifest {
  const root = retentionRecord(value, 'root');
  assertRetentionFields(root, RETENTION_FIELDS, 'root');
  if (root.schemaVersion !== 'hooks.codex-session-retention/v2') {
    invalidRetention('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(root.sessions)) {
    invalidRetention('sessions', 'invalid-shape');
  }
  if (
    root.sessions.length > CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
  ) {
    invalidRetention('sessions', 'capacity-exceeded');
  }
  if (!Array.isArray(root.diagnostics)) {
    invalidRetention('diagnostics', 'invalid-shape');
  }
  const entries = root.sessions.map((value, index) => {
    const entry = retentionRecord(value, `sessions[${index}]`);
    assertRetentionFields(
      entry,
      RETENTION_ENTRY_FIELDS,
      `sessions[${index}]`
    );
    if (
      typeof entry.risk !== 'string' ||
      !RETENTION_RISKS.has(entry.risk as CodexSessionRetentionRisk)
    ) {
      invalidRetention(`sessions[${index}].risk`, 'invalid-enum');
    }
    return {
      raw: entry,
      risk: entry.risk as CodexSessionRetentionRisk
    };
  });

  let projected;
  try {
    projected = validateCodexSessionIndexArtifact({
      schemaVersion: 'hooks.codex-session-index/v3',
      generatedAt: root.generatedAt,
      sources: RETENTION_INDEX_SOURCES,
      sessions: entries.map((entry) => retentionBaseSession(entry.raw)),
      diagnostics: root.diagnostics
    });
  } catch (error) {
    return mapRetentionIndexProjectionFailure(error);
  }
  if (projected.sessions.length !== entries.length) {
    invalidRetention('sessions', 'invalid-shape');
  }

  return {
    schemaVersion: 'hooks.codex-session-retention/v2',
    generatedAt: projected.generatedAt,
    sessions: projected.sessions.map((session) => {
      const entry = {
        threadId: session.threadId,
        rolloutPath: session.rolloutPath,
        rolloutPresent: session.rolloutPresent,
        stateDbPresent: session.stateDbPresent,
        cwdNorm: session.cwdNorm,
        projectOwner: session.projectOwner,
        updatedAt: session.updatedAt
      };
      return {
        ...entry,
        risk: derivedRetentionRisk(entry)
      };
    }),
    diagnostics: projected.diagnostics
  };
}

export const CODEX_HANDOFF_TASK_CONTEXT_ERROR_CODE =
  'CODEX_HANDOFF_TASK_CONTEXT_INVALID' as const;

export type CodexHandoffTaskContextErrorReason =
  | 'read-failed'
  | 'oversized'
  | 'malformed-json'
  | 'schema-invalid'
  | 'unsafe-identity'
  | 'unsafe-path'
  | 'project-mismatch';

export class CodexHandoffTaskContextError extends Error {
  readonly code = CODEX_HANDOFF_TASK_CONTEXT_ERROR_CODE;

  constructor(
    readonly field: string,
    readonly reason: CodexHandoffTaskContextErrorReason
  ) {
    super(`${CODEX_HANDOFF_TASK_CONTEXT_ERROR_CODE}: ${field}: ${reason}`);
    this.name = 'CodexHandoffTaskContextError';
  }
}

function requireHandoffPath(value: string, field: string): string {
  const projection = sanitizeCodexSessionPromptDerivedPath(value);
  if (!projection) {
    throw new CodexHandoffTaskContextError(field, 'unsafe-path');
  }
  return projection.raw;
}

function displayHandoffPath(value: string | null): string {
  return sanitizeCodexSessionPromptDerivedPath(value)?.raw ?? 'unknown';
}

function displayHandoffIdentity(value: string | null): string {
  return sanitizeCodexSessionExternalIdentity(value) ?? 'unknown';
}

export async function generateCodexHandoff(input: {
  mode: HandoffMode;
  project: string;
  indexPath: string;
  taskContextPath?: string | null;
  resolution: CodexSessionResolution;
}): Promise<string> {
  const resolution = validateCodexSessionResolutionArtifact(input.resolution);
  const project = requireHandoffPath(input.project, 'project');
  const projectNorm = normalizeCodexPath(project);
  const providedTaskContextPath = input.taskContextPath;
  const hasExplicitTaskContext =
    providedTaskContextPath !== undefined && providedTaskContextPath !== null;
  const taskContextPath = hasExplicitTaskContext
    ? requireHandoffPath(providedTaskContextPath, 'taskContextPath')
    : null;
  let task: CurrentTask | null = null;
  if (taskContextPath !== null) {
    try {
      task = await readCurrentTaskFile(taskContextPath);
    } catch (error) {
      throw new CodexHandoffTaskContextError(
        'taskContextPath',
        error instanceof CurrentTaskFileReadError
          ? error.reason
          : 'read-failed'
      );
    }
  }
  const taskId = task
    ? sanitizeCodexSessionExternalIdentity(task.taskId)
    : null;
  if (task && !taskId) {
    throw new CodexHandoffTaskContextError('taskId', 'unsafe-identity');
  }
  for (const [field, value] of [
    ['task.projectPath', task?.projectPath ?? null],
    ['task.worktreeRoot', task?.worktreeRoot ?? null],
    ['task.mainRepoRoot', task?.mainRepoRoot ?? null]
  ] as const) {
    if (value !== null && !sanitizeCodexSessionPromptDerivedPath(value)) {
      throw new CodexHandoffTaskContextError(field, 'unsafe-path');
    }
  }
  if (
    task &&
    normalizeCodexPath(task.projectPath) !== projectNorm
  ) {
    throw new CodexHandoffTaskContextError(
      'task.projectPath',
      'project-mismatch'
    );
  }
  if (
    task?.mainRepoRoot !== null &&
    task?.mainRepoRoot !== undefined &&
    normalizeCodexPath(task.mainRepoRoot) !== projectNorm
  ) {
    throw new CodexHandoffTaskContextError(
      'task.mainRepoRoot',
      'project-mismatch'
    );
  }
  const focus = input.mode === 'ccpanes-worker'
    ? '终端、测试、批量工程改动；以 task worktree 和现有门禁为准。'
    : '浏览器、截图、前端视觉验证；保持人工可见会话和 cwd 解释。';
  const top = filterResolvedSessions(resolution.sessions).slice(0, 3)
    .map((session) =>
      `${displayHandoffIdentity(session.threadId)} ` +
      `(${session.projectRelation}, cwd=${displayHandoffPath(session.cwdRaw)})`
    )
    .join('; ') || 'none';
  const displayedTaskContextPath = taskContextPath ??
    requireHandoffPath(
      path.join(project, '.ccpanes-task', 'current-task.json'),
      'taskContextPath'
    );
  return [
    `你是 ${input.mode} Agent。`,
    `taskId: ${taskId ?? 'unknown'}`,
    `projectPath: ${project}`,
    `phase: ${task?.phase ?? 'unknown'}`,
    `focus: ${focus}`,
    `必读: ${displayedTaskContextPath}`,
    `sessionIndex: ${displayHandoffPath(input.indexPath)}`,
    'sessionScope: owned/supporting user sessions; broader relations require explicit flags',
    `归因摘要: ${top}`,
    '允许: 只在当前项目授权范围内读写，并运行项目现有验证命令。',
    '禁止: 修改 Codex 原始 sessions/sqlite、用户全局 Codex 配置、CC-Panes/Codex 官方程序。',
    '验证: npm test; npm run typecheck; npm run build; npm run smoke; git diff --check; git status --short',
    '交付: 说明变更文件、命令用法、pass/fail/blocked、风险和下一步。'
  ].join('\n');
}

export function createRetentionManifest(
  sessions: import('./codex-session-index.js').CodexSessionRecord[]
): CodexSessionRetentionManifest {
  return validateCodexSessionRetentionManifest({
    schemaVersion: 'hooks.codex-session-retention/v2',
    generatedAt: new Date().toISOString(),
    sessions: sessions.map((session) => {
      let risk: CodexSessionRetentionRisk = 'ok';
      if (!session.rolloutPresent) risk = 'rollout-missing';
      else if (!session.stateDbPresent) risk = 'state-missing';
      else if (!session.cwdNorm) risk = 'cwd-ambiguous';
      return {
        threadId: session.threadId,
        rolloutPath: session.rolloutPath,
        rolloutPresent: session.rolloutPresent,
        stateDbPresent: session.stateDbPresent,
        cwdNorm: session.cwdNorm,
        projectOwner: session.projectOwner,
        updatedAt: session.updatedAt,
        risk
      };
    }),
    diagnostics: []
  });
}
