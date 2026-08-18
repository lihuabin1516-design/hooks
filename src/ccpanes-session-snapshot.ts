import { normalizeCodexPath } from './codex-session-path.js';
import {
  CODEX_THREAD_ID_MAX_LENGTH,
  isCodexThreadId,
  requireCodexThreadId
} from './codex-session-identity.js';
import {
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedPath
} from './codex-session-index.js';

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

export type CcPanesSnapshotRelationshipPrivacyReason =
  | 'unsafe-identity'
  | 'unsafe-path';

export interface CcPanesSnapshotRelationshipPrivacyIssue {
  field:
    | 'launchId'
    | 'resumeSessionId'
    | 'projectPath'
    | 'projectPathNorm'
    | 'sessionId'
    | 'taskId'
    | 'observedCodexThreadId';
  reason: CcPanesSnapshotRelationshipPrivacyReason;
}

export type CcPanesSnapshotRelationshipPrivacyResult =
  | { safe: true }
  | { safe: false; issue: CcPanesSnapshotRelationshipPrivacyIssue };

export type CcPanesSnapshotFreshness =
  | {
      state: 'fresh' | 'stale';
      ageMs: number;
      maxAgeMs: number;
    }
  | {
      state: 'future';
      ageMs: 0;
      maxAgeMs: number;
      futureByMs: number;
      maxFutureSkewMs: number;
    };

export const CCPANES_SESSION_SNAPSHOT_LIMITS = Object.freeze({
  launches: 10_000,
  sessions: 10_000,
  identityReferenceId: 256,
  projectPath: 4096,
  workspaceName: 256,
  cliTool: 64,
  status: 128,
  title: 512,
  rawStringOverhead: 1024,
  timestamp: 35,
  timestampRaw: 99,
  timestampFractionalSeconds: 9
});

const SNAPSHOT_SCHEMA_VERSION = 'hooks.ccpanes-session-snapshot/v1';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const ISO_TIMESTAMP_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/;
const CANONICAL_FOUR_DIGIT_YEAR = /^\d{4}-/;
const ROOT_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'launches',
  'sessions'
]);
const LAUNCH_FIELDS: ReadonlySet<string> = new Set([
  'launchId',
  'projectPath',
  'workspaceName',
  'cliTool',
  'resumeSessionId',
  'launchedAt'
]);
const SESSION_FIELDS: ReadonlySet<string> = new Set([
  'sessionId',
  'launchId',
  'taskId',
  'projectPath',
  'status',
  'title',
  'observedCodexThreadId'
]);

function invalidSnapshot(field: string): never {
  throw new Error(`invalid CC-Panes snapshot: ${field}`);
}

function invalidFreshness(field: string): never {
  throw new Error(`invalid CC-Panes snapshot freshness: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidSnapshot(field);
  }
  return value as Record<string, unknown>;
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  field: string
): void {
  const unknownField = Object.keys(value)
    .filter((key) => !allowedFields.has(key))
    .sort()[0];
  if (unknownField !== undefined) invalidSnapshot(`${field}.${unknownField}`);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== 'string') return invalidSnapshot(field);
  if (
    value.length >
    maxLength + CCPANES_SESSION_SNAPSHOT_LIMITS.rawStringOverhead
  ) {
    return invalidSnapshot(field);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return invalidSnapshot(field);
  return normalized;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field, maxLength);
}

function optionalThreadId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length >
      CODEX_THREAD_ID_MAX_LENGTH +
        CCPANES_SESSION_SNAPSHOT_LIMITS.rawStringOverhead
  ) {
    return invalidSnapshot(field);
  }
  return requireCodexThreadId(
    value.trim(),
    () => invalidSnapshot(field)
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function canonicalIsoTimestamp(
  value: unknown,
  field: string,
  invalid: (field: string) => never
): string {
  if (typeof value !== 'string') return invalid(field);
  if (value.length > CCPANES_SESSION_SNAPSHOT_LIMITS.timestampRaw) {
    return invalid(field);
  }
  const text = value.trim();
  if (!text || text.length > CCPANES_SESSION_SNAPSHOT_LIMITS.timestamp) {
    return invalid(field);
  }
  const match = ISO_TIMESTAMP_WITH_TIMEZONE.exec(text);
  if (!match) return invalid(field);
  if (
    match[7] !== undefined &&
    match[7].length >
      CCPANES_SESSION_SNAPSHOT_LIMITS.timestampFractionalSeconds
  ) {
    return invalid(field);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);

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
    return invalid(field);
  }

  const epochMs = Date.parse(text);
  if (!Number.isFinite(epochMs)) return invalid(field);
  const canonical = new Date(epochMs).toISOString();
  if (!CANONICAL_FOUR_DIGIT_YEAR.test(canonical)) return invalid(field);
  return canonical;
}

function snapshotIsoTimestamp(value: unknown, field: string): string {
  return canonicalIsoTimestamp(value, field, invalidSnapshot);
}

export function canonicalizeCcPanesTimezoneTimestamp(
  value: unknown
): string | null {
  try {
    return canonicalIsoTimestamp(value, 'timestamp', () => {
      throw new Error('invalid timestamp');
    });
  } catch {
    return null;
  }
}

function normalizedRequiredPath(
  value: unknown,
  field: string
): { projectPath: string; projectPathNorm: string } {
  const projectPath = requiredString(
    value,
    field,
    CCPANES_SESSION_SNAPSHOT_LIMITS.projectPath
  );
  const projectPathNorm = normalizeCodexPath(projectPath);
  if (!projectPathNorm) return invalidSnapshot(field);
  return { projectPath, projectPathNorm };
}

function normalizedOptionalPath(
  value: unknown,
  field: string
): { projectPath: string | null; projectPathNorm: string | null } {
  const projectPath = optionalString(
    value,
    field,
    CCPANES_SESSION_SNAPSHOT_LIMITS.projectPath
  );
  if (projectPath === null) {
    return { projectPath: null, projectPathNorm: null };
  }
  const projectPathNorm = normalizeCodexPath(projectPath);
  if (!projectPathNorm) return invalidSnapshot(field);
  return { projectPath, projectPathNorm };
}

function inspectRelationshipIdentity(
  value: string | null,
  field: CcPanesSnapshotRelationshipPrivacyIssue['field'],
  optional = false
): CcPanesSnapshotRelationshipPrivacyResult {
  if (value === null && optional) return { safe: true };
  return sanitizeCodexSessionExternalIdentity(value)
    ? { safe: true }
    : { safe: false, issue: { field, reason: 'unsafe-identity' } };
}

function inspectRelationshipThreadId(
  value: string | null,
  field: 'resumeSessionId' | 'observedCodexThreadId'
): CcPanesSnapshotRelationshipPrivacyResult {
  return value === null || isCodexThreadId(value)
    ? { safe: true }
    : { safe: false, issue: { field, reason: 'unsafe-identity' } };
}

function inspectRelationshipPath(
  raw: string | null,
  norm: string | null,
  optional = false
): CcPanesSnapshotRelationshipPrivacyResult {
  if (raw === null && norm === null && optional) return { safe: true };
  const projection = sanitizeCodexSessionPromptDerivedPath(raw);
  if (!projection) {
    return {
      safe: false,
      issue: { field: 'projectPath', reason: 'unsafe-path' }
    };
  }
  return projection.norm === norm
    ? { safe: true }
    : {
        safe: false,
        issue: { field: 'projectPathNorm', reason: 'unsafe-path' }
      };
}

export function inspectCcPanesLaunchRelationshipPrivacy(
  launch: CcPanesLaunchSnapshot
): CcPanesSnapshotRelationshipPrivacyResult {
  for (const result of [
    inspectRelationshipIdentity(launch.launchId, 'launchId'),
    inspectRelationshipThreadId(
      launch.resumeSessionId,
      'resumeSessionId'
    ),
    inspectRelationshipPath(launch.projectPath, launch.projectPathNorm)
  ]) {
    if (!result.safe) return result;
  }
  return { safe: true };
}

export function inspectCcPanesRuntimeRelationshipPrivacy(
  runtime: CcPanesRuntimeSessionSnapshot
): CcPanesSnapshotRelationshipPrivacyResult {
  for (const result of [
    inspectRelationshipIdentity(runtime.sessionId, 'sessionId'),
    inspectRelationshipIdentity(runtime.launchId, 'launchId', true),
    inspectRelationshipIdentity(runtime.taskId, 'taskId', true),
    inspectRelationshipThreadId(
      runtime.observedCodexThreadId,
      'observedCodexThreadId'
    ),
    inspectRelationshipPath(
      runtime.projectPath,
      runtime.projectPathNorm,
      true
    )
  ]) {
    if (!result.safe) return result;
  }
  return { safe: true };
}

function assertUnique(values: string[], identity: 'launchId' | 'sessionId'): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      invalidSnapshot(`duplicate ${identity}`);
    }
    seen.add(value);
  }
}

export function validateCcPanesSessionSnapshot(
  value: unknown
): CcPanesSessionSnapshot {
  const root = record(value, 'root');
  assertKnownFields(root, ROOT_FIELDS, 'root');
  if (root.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    invalidSnapshot('schemaVersion');
  }
  if (!Array.isArray(root.launches)) invalidSnapshot('launches');
  if (!Array.isArray(root.sessions)) invalidSnapshot('sessions');
  if (root.launches.length > CCPANES_SESSION_SNAPSHOT_LIMITS.launches) {
    invalidSnapshot('launches');
  }
  if (root.sessions.length > CCPANES_SESSION_SNAPSHOT_LIMITS.sessions) {
    invalidSnapshot('sessions');
  }

  const launches = root.launches.map((entry, index): CcPanesLaunchSnapshot => {
    const field = `launches[${index}]`;
    const item = record(entry, field);
    assertKnownFields(item, LAUNCH_FIELDS, field);
    const path = normalizedRequiredPath(item.projectPath, `${field}.projectPath`);
    return {
      launchId: requiredString(
        item.launchId,
        `${field}.launchId`,
        CCPANES_SESSION_SNAPSHOT_LIMITS.identityReferenceId
      ),
      ...path,
      workspaceName: optionalString(
        item.workspaceName,
        `${field}.workspaceName`,
        CCPANES_SESSION_SNAPSHOT_LIMITS.workspaceName
      ),
      cliTool: requiredString(
        item.cliTool,
        `${field}.cliTool`,
        CCPANES_SESSION_SNAPSHOT_LIMITS.cliTool
      ),
      resumeSessionId: optionalThreadId(
        item.resumeSessionId,
        `${field}.resumeSessionId`
      ),
      launchedAt: snapshotIsoTimestamp(item.launchedAt, `${field}.launchedAt`)
    };
  });

  const sessions = root.sessions.map(
    (entry, index): CcPanesRuntimeSessionSnapshot => {
      const field = `sessions[${index}]`;
      const item = record(entry, field);
      assertKnownFields(item, SESSION_FIELDS, field);
      const path = normalizedOptionalPath(item.projectPath, `${field}.projectPath`);
      return {
        sessionId: requiredString(
          item.sessionId,
          `${field}.sessionId`,
          CCPANES_SESSION_SNAPSHOT_LIMITS.identityReferenceId
        ),
        launchId: optionalString(
          item.launchId,
          `${field}.launchId`,
          CCPANES_SESSION_SNAPSHOT_LIMITS.identityReferenceId
        ),
        taskId: optionalString(
          item.taskId,
          `${field}.taskId`,
          CCPANES_SESSION_SNAPSHOT_LIMITS.identityReferenceId
        ),
        ...path,
        status: requiredString(
          item.status,
          `${field}.status`,
          CCPANES_SESSION_SNAPSHOT_LIMITS.status
        ),
        title: optionalString(
          item.title,
          `${field}.title`,
          CCPANES_SESSION_SNAPSHOT_LIMITS.title
        ),
        observedCodexThreadId: optionalThreadId(
          item.observedCodexThreadId,
          `${field}.observedCodexThreadId`
        )
      };
    }
  );

  assertUnique(launches.map((entry) => entry.launchId), 'launchId');
  assertUnique(sessions.map((entry) => entry.sessionId), 'sessionId');

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: snapshotIsoTimestamp(root.generatedAt, 'generatedAt'),
    launches,
    sessions
  };
}

export function inspectCcPanesSnapshotFreshness(
  generatedAt: string,
  now = new Date().toISOString(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS
): CcPanesSnapshotFreshness {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    invalidFreshness('maxAgeMs');
  }
  if (!Number.isFinite(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    invalidFreshness('maxFutureSkewMs');
  }
  const generatedAtIso = canonicalIsoTimestamp(
    generatedAt,
    'generatedAt',
    invalidFreshness
  );
  const nowIso = canonicalIsoTimestamp(now, 'now', invalidFreshness);
  const futureByMs = Date.parse(generatedAtIso) - Date.parse(nowIso);
  if (futureByMs > maxFutureSkewMs) {
    return {
      state: 'future',
      ageMs: 0,
      maxAgeMs,
      futureByMs,
      maxFutureSkewMs
    };
  }
  const ageMs = Math.max(0, -futureByMs);
  return {
    state: ageMs > maxAgeMs ? 'stale' : 'fresh',
    ageMs,
    maxAgeMs
  };
}
