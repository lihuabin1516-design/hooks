import { createHash } from 'node:crypto';
import type {
  CodexSessionRecord,
  ParsedTaskBindingEvidence
} from './codex-session-index.js';
import type { SessionEvidence } from './codex-session-attribution.js';
import {
  containsEmbeddedBareSecret,
  redactCodexSessionArtifactValue,
  sanitizeCodexSessionArtifactExcerpt
} from './codex-session-artifact-privacy.js';
import { isCodexThreadId } from './codex-session-identity.js';
import { normalizeCodexPath } from './codex-session-path.js';
import {
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
} from './codex-session-privacy.js';

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

export const CODEX_SESSION_INDEX_ARTIFACT_LIMITS = Object.freeze({
  sessions: 40_000,
  diagnostics: 10_000,
  relationReasons: 64,
  evidencePerRecord: 64,
  identity: 256,
  diagnosticField: 128
});

type ArtifactErrorReason =
  | 'invalid-shape'
  | 'unknown-field'
  | 'unsupported-schema'
  | 'invalid-enum'
  | 'invalid-boolean'
  | 'unsafe-timestamp'
  | 'invalid-confidence'
  | 'capacity-exceeded';

class CodexSessionIndexArtifactError extends Error {
  readonly code = 'CODEX_SESSION_INDEX_ARTIFACT' as const;

  constructor(
    readonly field: string,
    readonly reason: ArtifactErrorReason
  ) {
    super(`CODEX_SESSION_INDEX_ARTIFACT: ${field}: ${reason}`);
    this.name = 'CodexSessionIndexArtifactError';
  }
}

const ROOT_FIELDS = fields(
  'schemaVersion',
  'generatedAt',
  'sources',
  'sessions',
  'diagnostics'
);
const SOURCES_FIELDS = fields(
  'sessionsDir',
  'stateDb',
  'threadHistoryDb',
  'taskContext'
);
const SOURCE_STATE_FIELDS = fields('path', 'availability');
const HISTORY_SOURCE_STATE_FIELDS = fields('path', 'availability', 'role');
const DIAGNOSTIC_FIELDS = fields(
  'code',
  'source',
  'field',
  'reason',
  'subjectDigest'
);
const RECORD_FIELDS = fields(
  'threadId',
  'source',
  'threadSource',
  'originator',
  'cwdRaw',
  'cwdNorm',
  'projectOwner',
  'scopeMatch',
  'confidence',
  'rolloutPath',
  'stateDbPresent',
  'rolloutPresent',
  'updatedAt',
  'firstUserPrompt',
  'lastSummary',
  'storageState',
  'runtimeScope',
  'projectRelation',
  'relationConfidence',
  'relationReasons',
  'evidence',
  'appVisibility',
  'taskBinding',
  'delegatedFromThreadId',
  'primaryTargetRaw',
  'primaryTargetNorm'
);
const TASK_BINDING_FIELDS = fields(
  'taskId',
  'projectPathRaw',
  'worktreeRootRaw'
);
const DIAGNOSTIC_CODES = values<CodexSessionDiagnosticCode>(
  'source-missing',
  'source-unreadable',
  'record-skipped',
  'rollout-unreadable',
  'rollout-jsonl-invalid',
  'privacy-projection-dropped'
);
const DIAGNOSTIC_SOURCES = values<CodexSessionDiagnosticSource>(
  'sessions-dir',
  'state-db',
  'thread-history-db',
  'task-context',
  'rollout',
  'state-row'
);
const DIAGNOSTIC_REASONS = values<CodexSessionDiagnostic['reason']>(
  'missing',
  'unreadable',
  'invalid-json',
  'unsafe-identity',
  'unsafe-path',
  'unsafe-string',
  'invalid-record',
  'capacity-exceeded'
);
const SOURCE_AVAILABILITY = values('present', 'missing', 'unreadable');
const SESSION_SOURCES = values('codex-app', 'codex-cli', 'ccpanes', 'unknown');
const THREAD_SOURCES = values('user', 'subagent', 'automation', 'unknown');
const SCOPE_MATCHES = values(
  'exact',
  'descendant',
  'ancestor',
  'launch-history',
  'prompt-mention',
  'unknown'
);
const STORAGE_STATES = values('active', 'archived', 'missing');
const RUNTIME_SCOPES = values(
  'exact',
  'descendant',
  'ancestor',
  'unrelated',
  'unknown'
);
const PROJECT_RELATIONS = values(
  'owned',
  'supporting',
  'mentioned',
  'ambient',
  'unrelated',
  'unknown'
);
const APP_VISIBILITIES = values('listed', 'readable-hidden', 'unknown');
const EVIDENCE_KINDS = values<SessionEvidence['kind']>(
  'task-binding',
  'ccpanes-launch',
  'ccpanes-session',
  'cwd',
  'primary-target',
  'prompt-mention',
  'delegation'
);
const TIMESTAMP_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function fields(...names: string[]): ReadonlySet<string> {
  return new Set(names);
}

function values<T extends string = string>(...items: T[]): ReadonlySet<string> {
  return new Set(items);
}

function invalid(field: string, reason: ArtifactErrorReason): never {
  throw new CodexSessionIndexArtifactError(field, reason);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(field, 'invalid-shape');
  }
  return value as Record<string, unknown>;
}

function knownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid(field, 'unknown-field');
  }
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string
): T {
  if (typeof value !== 'string') return invalid(field, 'invalid-shape');
  if (!allowed.has(value)) return invalid(field, 'invalid-enum');
  return value as T;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field, 'invalid-boolean');
  return value;
}

function boundedConfidence(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return invalid(field, 'invalid-confidence');
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function canonicalTimestamp(
  value: unknown,
  field: string,
  nullable = false
): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.length > 128) {
    return invalid(field, 'unsafe-timestamp');
  }
  const match = TIMESTAMP_WITH_TIMEZONE.exec(value);
  if (!match) return invalid(field, 'unsafe-timestamp');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return invalid(field, 'unsafe-timestamp');
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return invalid(field, 'unsafe-timestamp');
  const canonical = new Date(epochMs).toISOString();
  return /^\d{4}-/u.test(canonical)
    ? canonical
    : invalid(field, 'unsafe-timestamp');
}

export function digestDiagnosticSubject(value: string): string {
  return createHash('sha256')
    .update(value.slice(0, 4096), 'utf8')
    .digest('hex');
}

function diagnosticKey(diagnostic: CodexSessionDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.source,
    diagnostic.field,
    diagnostic.reason,
    diagnostic.subjectDigest
  ]);
}

interface DiagnosticAccumulator {
  values: CodexSessionDiagnostic[];
  keys: Set<string>;
}

function createDiagnosticAccumulator(
  values: CodexSessionDiagnostic[] = []
): DiagnosticAccumulator {
  return {
    values,
    keys: new Set(values.map(diagnosticKey))
  };
}

function appendDiagnostic(
  diagnostics: DiagnosticAccumulator,
  diagnostic: CodexSessionDiagnostic
): void {
  const key = diagnosticKey(diagnostic);
  if (diagnostics.keys.has(key)) return;
  if (
    diagnostics.values.length >=
    CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnostics
  ) {
    invalid('diagnostics', 'capacity-exceeded');
  }
  diagnostics.keys.add(key);
  diagnostics.values.push(diagnostic);
}

function diagnostic(
  diagnostics: DiagnosticAccumulator,
  code: CodexSessionDiagnosticCode,
  source: CodexSessionDiagnosticSource,
  field: string | null,
  reason: CodexSessionDiagnostic['reason'],
  subject: unknown
): void {
  appendDiagnostic(diagnostics, {
    code,
    source,
    field,
    reason,
    subjectDigest: typeof subject === 'string'
      ? digestDiagnosticSubject(subject)
      : null
  });
}

export function sanitizeCodexSessionExternalIdentity(
  value: string | null
): string | null {
  if (
    value !== null &&
    value.length > CODEX_SESSION_INDEX_ARTIFACT_LIMITS.identity
  ) {
    return null;
  }
  const redacted = redactCodexSessionArtifactValue(value);
  if (redacted.value === null || redacted.changed) return null;
  if (
    redacted.value.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    redacted.value.trim() !== redacted.value ||
    /[\u0000-\u001f\u007f]/u.test(redacted.value) ||
    containsEmbeddedBareSecret(redacted.value)
  ) {
    return null;
  }
  return redacted.value;
}

export function sanitizeCodexSessionPromptDerivedIdentifier(
  value: string | null
): string | null {
  if (
    value !== null &&
    value.length > CODEX_SESSION_INDEX_ARTIFACT_LIMITS.identity
  ) {
    return null;
  }
  const redacted = redactCodexSessionArtifactValue(value);
  if (redacted.value === null || redacted.changed) return null;
  const candidate = redacted.value.trim();
  if (
    candidate !== redacted.value ||
    containsEmbeddedBareSecret(candidate)
  ) {
    return null;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(candidate)
    ? candidate
    : null;
}

export interface CodexSessionPromptDerivedPathProjection {
  raw: string;
  norm: string;
}

export function sanitizeCodexSessionPromptDerivedPath(
  value: string | null
): CodexSessionPromptDerivedPathProjection | null {
  const redacted = redactCodexSessionArtifactValue(value);
  if (redacted.value === null || redacted.changed) return null;
  const candidate = redacted.value.trim();
  if (
    !candidate ||
    candidate !== redacted.value ||
    candidate.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(candidate) ||
    containsEmbeddedBareSecret(candidate)
  ) {
    return null;
  }
  const normalized = normalizeCodexPath(candidate);
  return normalized &&
    normalized.length <= CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
    ? { raw: candidate, norm: normalized }
    : null;
}

export function sanitizeCodexSessionTaskBinding(
  value: ParsedTaskBindingEvidence | null
): ParsedTaskBindingEvidence | null {
  if (!value) return null;
  const taskId = sanitizeCodexSessionPromptDerivedIdentifier(value.taskId);
  const projectPath = sanitizeCodexSessionPromptDerivedPath(
    value.projectPathRaw
  );
  const worktreeRoot = sanitizeCodexSessionPromptDerivedPath(
    value.worktreeRootRaw
  );
  if (!taskId || !projectPath || !worktreeRoot) return null;
  return {
    taskId,
    projectPathRaw: projectPath.raw,
    worktreeRootRaw: worktreeRoot.raw
  };
}

function projectPath(
  value: unknown,
  field: string,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator,
  normalized: boolean
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid(field, 'invalid-shape');
  const projected = sanitizeCodexSessionPromptDerivedPath(value);
  if (!projected || (normalized && projected.norm !== value)) {
    diagnostic(
      diagnostics,
      'privacy-projection-dropped',
      source,
      field,
      'unsafe-path',
      value
    );
    return null;
  }
  return normalized ? projected.norm : projected.raw;
}

function projectDisplay(
  value: unknown,
  field: string,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator,
  nullable: boolean
): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return invalid(field, 'invalid-shape');
  const projected = sanitizeCodexSessionArtifactExcerpt(value);
  if (projected !== value) {
    diagnostic(
      diagnostics,
      'privacy-projection-dropped',
      source,
      field,
      'unsafe-string',
      value
    );
  }
  if (projected !== null) return projected;
  return nullable ? null : 'unknown';
}

function projectExternalIdentity(
  value: unknown,
  field: string,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid(field, 'invalid-shape');
  const projected = sanitizeCodexSessionExternalIdentity(value);
  if (projected !== value) {
    diagnostic(
      diagnostics,
      'privacy-projection-dropped',
      source,
      field,
      'unsafe-identity',
      value
    );
    return null;
  }
  return projected;
}

function projectTimestamp(
  value: unknown,
  field: string,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator,
  strictArtifact: boolean
): string | null {
  try {
    return canonicalTimestamp(value, field, true);
  } catch (error) {
    if (strictArtifact) throw error;
    diagnostic(
      diagnostics,
      'privacy-projection-dropped',
      source,
      field,
      'invalid-record',
      value
    );
    return null;
  }
}

function projectTaskBinding(
  value: unknown,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator
): ParsedTaskBindingEvidence | null {
  if (value === null) return null;
  const taskBinding = record(value, 'taskBinding');
  knownFields(taskBinding, TASK_BINDING_FIELDS, 'taskBinding');
  const taskId = projectExternalIdentity(
    taskBinding.taskId,
    'taskBinding.taskId',
    source,
    diagnostics
  );
  const projectPathRaw = projectPath(
    taskBinding.projectPathRaw,
    'taskBinding.projectPathRaw',
    source,
    diagnostics,
    false
  );
  const worktreeRootRaw = projectPath(
    taskBinding.worktreeRootRaw,
    'taskBinding.worktreeRootRaw',
    source,
    diagnostics,
    false
  );
  return taskId && projectPathRaw && worktreeRootRaw
    ? { taskId, projectPathRaw, worktreeRootRaw }
    : null;
}

function projectEvidence(
  value: unknown,
  index: number,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator
): SessionEvidence | null {
  const field = `evidence[${index}]`;
  const item = record(value, field);
  const kind = requiredEnum<SessionEvidence['kind']>(
    item.kind,
    EVIDENCE_KINDS,
    `${field}.kind`
  );
  if (kind === 'task-binding') {
    knownFields(item, fields('kind', 'projectPath', 'taskId'), field);
    const projectPath = projectPathValue(
      item.projectPath,
      `${field}.projectPath`,
      source,
      diagnostics
    );
    const taskId = projectExternalIdentity(
      item.taskId,
      `${field}.taskId`,
      source,
      diagnostics
    );
    return projectPath && taskId ? { kind, projectPath, taskId } : null;
  }
  if (kind === 'ccpanes-launch') {
    knownFields(item, fields('kind', 'projectPath', 'launchId'), field);
    const projectPath = projectPathValue(
      item.projectPath,
      `${field}.projectPath`,
      source,
      diagnostics
    );
    const launchId = projectExternalIdentity(
      item.launchId,
      `${field}.launchId`,
      source,
      diagnostics
    );
    return projectPath && launchId ? { kind, projectPath, launchId } : null;
  }
  if (kind === 'ccpanes-session') {
    knownFields(item, fields('kind', 'projectPath', 'sessionId'), field);
    const projectPath = projectPathValue(
      item.projectPath,
      `${field}.projectPath`,
      source,
      diagnostics
    );
    const sessionId = projectExternalIdentity(
      item.sessionId,
      `${field}.sessionId`,
      source,
      diagnostics
    );
    return projectPath && sessionId ? { kind, projectPath, sessionId } : null;
  }
  if (kind === 'cwd') {
    knownFields(item, fields('kind', 'relation'), field);
    return {
      kind,
      relation: requiredEnum(
        item.relation,
        values('exact', 'descendant', 'ancestor'),
        `${field}.relation`
      )
    };
  }
  if (kind === 'primary-target' || kind === 'prompt-mention') {
    knownFields(item, fields('kind', 'target'), field);
    const target = projectPathValue(
      item.target,
      `${field}.target`,
      source,
      diagnostics
    );
    return target ? { kind, target } : null;
  }
  knownFields(item, fields('kind', 'sourceThreadId'), field);
  if (typeof item.sourceThreadId !== 'string') {
    return invalid(`${field}.sourceThreadId`, 'invalid-shape');
  }
  if (!isCodexThreadId(item.sourceThreadId)) {
    diagnostic(
      diagnostics,
      'privacy-projection-dropped',
      source,
      `${field}.sourceThreadId`,
      'unsafe-identity',
      item.sourceThreadId
    );
    return null;
  }
  return { kind, sourceThreadId: item.sourceThreadId };
}

function projectPathValue(
  value: unknown,
  field: string,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator
): string | null {
  return projectPath(value, field, source, diagnostics, true);
}

function projectCompleteSessionRecord(
  value: CodexSessionRecord,
  diagnostics: DiagnosticAccumulator,
  strictArtifact = false
): CodexSessionRecord | null {
  const candidate = record(value, 'session');
  knownFields(candidate, RECORD_FIELDS, 'session');
  const stateDbPresent = requiredBoolean(
    candidate.stateDbPresent,
    'stateDbPresent'
  );
  const rolloutPresent = requiredBoolean(
    candidate.rolloutPresent,
    'rolloutPresent'
  );
  const source = stateDbPresent ? 'state-row' : 'rollout';
  if (
    typeof candidate.threadId !== 'string' ||
    !isCodexThreadId(candidate.threadId)
  ) {
    diagnostic(
      diagnostics,
      'record-skipped',
      source,
      'threadId',
      'unsafe-identity',
      candidate.threadId
    );
    return null;
  }
  if (!Array.isArray(candidate.relationReasons)) {
    return invalid('relationReasons', 'invalid-shape');
  }
  if (
    candidate.relationReasons.length >
    CODEX_SESSION_INDEX_ARTIFACT_LIMITS.relationReasons
  ) {
    return invalid('relationReasons', 'capacity-exceeded');
  }
  if (!Array.isArray(candidate.evidence)) {
    return invalid('evidence', 'invalid-shape');
  }
  if (
    candidate.evidence.length >
    CODEX_SESSION_INDEX_ARTIFACT_LIMITS.evidencePerRecord
  ) {
    return invalid('evidence', 'capacity-exceeded');
  }
  const relationReasons = candidate.relationReasons.flatMap(
    (reason, index): string[] => {
      const projected = projectDisplay(
        reason,
        `relationReasons[${index}]`,
        source,
        diagnostics,
        true
      );
      return projected === null ? [] : [projected];
    }
  );
  const evidence = candidate.evidence.flatMap(
    (item, index): SessionEvidence[] => {
      const projected = projectEvidence(item, index, source, diagnostics);
      return projected === null ? [] : [projected];
    }
  );
  const delegatedFromThreadId = candidate.delegatedFromThreadId === null
    ? null
    : typeof candidate.delegatedFromThreadId === 'string' &&
        isCodexThreadId(candidate.delegatedFromThreadId)
      ? candidate.delegatedFromThreadId
      : (
          diagnostic(
            diagnostics,
            'privacy-projection-dropped',
            source,
            'delegatedFromThreadId',
            'unsafe-identity',
            candidate.delegatedFromThreadId
          ),
          null
        );
  return {
    threadId: candidate.threadId,
    source: requiredEnum(
      candidate.source,
      SESSION_SOURCES,
      'source'
    ),
    threadSource: requiredEnum(
      candidate.threadSource,
      THREAD_SOURCES,
      'threadSource'
    ),
    originator: projectDisplay(
      candidate.originator,
      'originator',
      source,
      diagnostics,
      false
    )!,
    cwdRaw: projectPath(
      candidate.cwdRaw,
      'cwdRaw',
      source,
      diagnostics,
      false
    ),
    cwdNorm: projectPathValue(
      candidate.cwdNorm,
      'cwdNorm',
      source,
      diagnostics
    ),
    projectOwner: projectPath(
      candidate.projectOwner,
      'projectOwner',
      source,
      diagnostics,
      false
    ),
    scopeMatch: requiredEnum(
      candidate.scopeMatch,
      SCOPE_MATCHES,
      'scopeMatch'
    ),
    confidence: boundedConfidence(candidate.confidence, 'confidence'),
    rolloutPath: projectPath(
      candidate.rolloutPath,
      'rolloutPath',
      source,
      diagnostics,
      false
    ),
    stateDbPresent,
    rolloutPresent,
    updatedAt: projectTimestamp(
      candidate.updatedAt,
      'updatedAt',
      source,
      diagnostics,
      strictArtifact
    ),
    firstUserPrompt: projectDisplay(
      candidate.firstUserPrompt,
      'firstUserPrompt',
      source,
      diagnostics,
      true
    ),
    lastSummary: projectDisplay(
      candidate.lastSummary,
      'lastSummary',
      source,
      diagnostics,
      true
    ),
    storageState: requiredEnum(
      candidate.storageState,
      STORAGE_STATES,
      'storageState'
    ),
    runtimeScope: requiredEnum(
      candidate.runtimeScope,
      RUNTIME_SCOPES,
      'runtimeScope'
    ),
    projectRelation: requiredEnum(
      candidate.projectRelation,
      PROJECT_RELATIONS,
      'projectRelation'
    ),
    relationConfidence: boundedConfidence(
      candidate.relationConfidence,
      'relationConfidence'
    ),
    relationReasons,
    evidence,
    appVisibility: requiredEnum(
      candidate.appVisibility,
      APP_VISIBILITIES,
      'appVisibility'
    ),
    taskBinding: projectTaskBinding(
      candidate.taskBinding,
      source,
      diagnostics
    ),
    delegatedFromThreadId,
    primaryTargetRaw: projectPath(
      candidate.primaryTargetRaw,
      'primaryTargetRaw',
      source,
      diagnostics,
      false
    ),
    primaryTargetNorm: projectPathValue(
      candidate.primaryTargetNorm,
      'primaryTargetNorm',
      source,
      diagnostics
    )
  };
}

export function projectCodexSessionRecord(
  value: CodexSessionRecord,
  diagnostics: CodexSessionDiagnostic[]
): CodexSessionRecord | null {
  return projectCompleteSessionRecord(
    value,
    createDiagnosticAccumulator(diagnostics),
    false
  );
}

function validateDiagnostic(
  value: unknown,
  index: number
): CodexSessionDiagnostic {
  const field = `diagnostics[${index}]`;
  const item = record(value, field);
  knownFields(item, DIAGNOSTIC_FIELDS, field);
  const diagnosticField = item.field;
  if (
    diagnosticField !== null &&
    (
      typeof diagnosticField !== 'string' ||
      diagnosticField.length === 0 ||
      diagnosticField.length >
        CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnosticField ||
      !/^[A-Za-z][A-Za-z0-9.[\]_-]*$/u.test(diagnosticField)
    )
  ) {
    return invalid(`${field}.field`, 'invalid-shape');
  }
  const subjectDigest = item.subjectDigest;
  if (
    subjectDigest !== null &&
    (
      typeof subjectDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(subjectDigest)
    )
  ) {
    return invalid(`${field}.subjectDigest`, 'invalid-shape');
  }
  return {
    code: requiredEnum(
      item.code,
      DIAGNOSTIC_CODES,
      `${field}.code`
    ),
    source: requiredEnum(
      item.source,
      DIAGNOSTIC_SOURCES,
      `${field}.source`
    ),
    field: diagnosticField,
    reason: requiredEnum(
      item.reason,
      DIAGNOSTIC_REASONS,
      `${field}.reason`
    ),
    subjectDigest
  };
}

function projectSourceState(
  value: unknown,
  field: string,
  source: CodexSessionDiagnosticSource,
  diagnostics: DiagnosticAccumulator,
  history: boolean
): CodexSessionSourceState | CodexThreadHistorySourceState {
  const item = record(value, field);
  knownFields(
    item,
    history ? HISTORY_SOURCE_STATE_FIELDS : SOURCE_STATE_FIELDS,
    field
  );
  if (history && item.role !== 'availability-only') {
    invalid(`${field}.role`, 'invalid-enum');
  }
  const base = {
    path: projectPath(item.path, 'path', source, diagnostics, false),
    availability: requiredEnum<CodexSessionSourceState['availability']>(
      item.availability,
      SOURCE_AVAILABILITY,
      `${field}.availability`
    )
  };
  return history
    ? { ...base, role: 'availability-only' }
    : base;
}

function validateAndReconstructIndexV3(
  value: unknown
): CodexSessionIndexV3 {
  const root = record(value, 'root');
  knownFields(root, ROOT_FIELDS, 'root');
  if (root.schemaVersion !== 'hooks.codex-session-index/v3') {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(root.sessions)) {
    invalid('sessions', 'invalid-shape');
  }
  if (!Array.isArray(root.diagnostics)) {
    invalid('diagnostics', 'invalid-shape');
  }
  if (
    root.sessions.length > CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
  ) {
    invalid('sessions', 'capacity-exceeded');
  }
  if (
    root.diagnostics.length >
    CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnostics
  ) {
    invalid('diagnostics', 'capacity-exceeded');
  }
  const diagnostics = createDiagnosticAccumulator();
  for (const [index, rawDiagnostic] of root.diagnostics.entries()) {
    appendDiagnostic(
      diagnostics,
      validateDiagnostic(rawDiagnostic, index)
    );
  }
  const sources = record(root.sources, 'sources');
  knownFields(sources, SOURCES_FIELDS, 'sources');
  const sessionsDir = projectSourceState(
    sources.sessionsDir,
    'sources.sessionsDir',
    'sessions-dir',
    diagnostics,
    false
  ) as CodexSessionSourceState;
  const stateDb = projectSourceState(
    sources.stateDb,
    'sources.stateDb',
    'state-db',
    diagnostics,
    false
  ) as CodexSessionSourceState;
  const threadHistoryDb = projectSourceState(
    sources.threadHistoryDb,
    'sources.threadHistoryDb',
    'thread-history-db',
    diagnostics,
    true
  ) as CodexThreadHistorySourceState;
  const taskContext = sources.taskContext === null
    ? null
    : projectSourceState(
        sources.taskContext,
        'sources.taskContext',
        'task-context',
        diagnostics,
        false
      ) as CodexSessionSourceState;
  const sessions: CodexSessionRecord[] = [];
  const threadIds = new Set<string>();
  for (const item of root.sessions) {
    const projected = projectCompleteSessionRecord(
      item as CodexSessionRecord,
      diagnostics,
      true
    );
    if (projected === null) continue;
    if (threadIds.has(projected.threadId)) {
      invalid('sessions', 'invalid-shape');
    }
    threadIds.add(projected.threadId);
    sessions.push(projected);
  }
  return {
    schemaVersion: 'hooks.codex-session-index/v3',
    generatedAt: canonicalTimestamp(root.generatedAt, 'generatedAt')!,
    sources: {
      sessionsDir,
      stateDb,
      threadHistoryDb,
      taskContext
    },
    sessions,
    diagnostics: diagnostics.values
  };
}

export function validateCodexSessionIndexArtifact(
  value: unknown
): CodexSessionIndexV3 {
  return validateAndReconstructIndexV3(value);
}
