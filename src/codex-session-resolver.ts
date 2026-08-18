import {
  assertCodexSessionProjectOwnerInvariant,
  summarizeProjectRelations,
  type ProjectRelation,
  type StorageState
} from './codex-session-attribution.js';
import {
  normalizeCodexPath,
  sanitizeCodexSessionArtifactExcerpt,
  sanitizeCodexSessionPromptDerivedPath,
  type CodexScopeMatch,
  type CodexSessionRecord
} from './codex-session-index.js';
import {
  CODEX_SESSION_INDEX_ARTIFACT_LIMITS,
  validateCodexSessionIndexArtifact
} from './codex-session-index-artifact.js';

export interface ResolveOptions {
  includeArchived?: boolean;
  includeSubagents?: boolean;
  includeRelated?: boolean;
  includeAmbient?: boolean;
}

export interface ResolvedCodexSession extends CodexSessionRecord {
  scopeMatch: CodexScopeMatch;
  resumeAvailable: boolean;
  resumeDirectory: string;
  explanation: string;
}

export interface CodexSessionResolution {
  schemaVersion: 'hooks.codex-session-resolution/v3';
  project: string;
  projectNorm: string;
  totals: ReturnType<typeof summarizeProjectRelations>;
  sessions: ResolvedCodexSession[];
}

export type CodexSessionResolutionArtifactErrorReason =
  | 'invalid-shape'
  | 'unknown-field'
  | 'unsupported-schema'
  | 'invalid-boolean'
  | 'unsafe-path'
  | 'unsafe-string'
  | 'capacity-exceeded';

export class CodexSessionResolutionArtifactError extends Error {
  readonly code = 'CODEX_SESSION_RESOLUTION_ARTIFACT' as const;

  constructor(
    readonly field: string,
    readonly reason: CodexSessionResolutionArtifactErrorReason
  ) {
    super(`CODEX_SESSION_RESOLUTION_ARTIFACT: ${field}: ${reason}`);
    this.name = 'CodexSessionResolutionArtifactError';
  }
}

const RESOLUTION_FIELDS = new Set([
  'schemaVersion',
  'project',
  'projectNorm',
  'totals',
  'sessions'
]);
const TOTAL_FIELDS = new Set([
  'defaultVisible',
  'owned',
  'supporting',
  'mentioned',
  'ambient',
  'archived',
  'subagents'
]);
const RESOLVED_SESSION_FIELDS = new Set([
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
  'primaryTargetNorm',
  'resumeAvailable',
  'resumeDirectory',
  'explanation'
]);
const BASE_INDEX_SOURCES = Object.freeze({
  sessionsDir: { path: null, availability: 'missing' as const },
  stateDb: { path: null, availability: 'missing' as const },
  threadHistoryDb: {
    path: null,
    availability: 'missing' as const,
    role: 'availability-only' as const
  },
  taskContext: null
});

function invalidResolution(
  field: string,
  reason: CodexSessionResolutionArtifactErrorReason
): never {
  throw new CodexSessionResolutionArtifactError(field, reason);
}

function resolutionRecord(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidResolution(field, 'invalid-shape');
  }
  return value as Record<string, unknown>;
}

function assertResolutionFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      invalidResolution(`${field}.${key}`, 'unknown-field');
    }
  }
}

function projectResolutionTotals(
  value: unknown
): ReturnType<typeof summarizeProjectRelations> {
  const totals = resolutionRecord(value, 'totals');
  assertResolutionFields(totals, TOTAL_FIELDS, 'totals');
  return Object.fromEntries(Array.from(TOTAL_FIELDS, (field) => {
    const count = totals[field];
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
    ) {
      invalidResolution(`totals.${field}`, 'invalid-shape');
    }
    return [field, count];
  })) as ReturnType<typeof summarizeProjectRelations>;
}

function mapIndexProjectionFailure(error: unknown): never {
  const reason = error !== null && typeof error === 'object'
    ? (error as { reason?: unknown }).reason
    : null;
  if (reason === 'capacity-exceeded') {
    return invalidResolution('sessions', 'capacity-exceeded');
  }
  return invalidResolution('sessions', 'invalid-shape');
}

export function validateCodexSessionResolutionArtifact(
  value: unknown
): CodexSessionResolution {
  const root = resolutionRecord(value, 'root');
  assertResolutionFields(root, RESOLUTION_FIELDS, 'root');
  if (root.schemaVersion !== 'hooks.codex-session-resolution/v3') {
    invalidResolution('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(root.sessions)) {
    invalidResolution('sessions', 'invalid-shape');
  }
  if (
    root.sessions.length > CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions
  ) {
    invalidResolution('sessions', 'capacity-exceeded');
  }
  if (typeof root.project !== 'string') {
    invalidResolution('project', 'invalid-shape');
  }
  const project = sanitizeCodexSessionPromptDerivedPath(root.project);
  if (!project) invalidResolution('project', 'unsafe-path');
  if (root.projectNorm !== project.norm) {
    invalidResolution('projectNorm', 'unsafe-path');
  }

  const extras = root.sessions.map((value, index) => {
    const session = resolutionRecord(value, `sessions[${index}]`);
    assertResolutionFields(
      session,
      RESOLVED_SESSION_FIELDS,
      `sessions[${index}]`
    );
    const {
      resumeAvailable,
      resumeDirectory,
      explanation,
      ...base
    } = session;
    if (typeof resumeAvailable !== 'boolean') {
      invalidResolution(
        `sessions[${index}].resumeAvailable`,
        'invalid-boolean'
      );
    }
    if (typeof resumeDirectory !== 'string') {
      invalidResolution(
        `sessions[${index}].resumeDirectory`,
        'invalid-shape'
      );
    }
    if (typeof explanation !== 'string') {
      invalidResolution(
        `sessions[${index}].explanation`,
        'invalid-shape'
      );
    }
    const projectedExplanation = sanitizeCodexSessionArtifactExcerpt(
      explanation
    );
    if (projectedExplanation === null) {
      invalidResolution(
        `sessions[${index}].explanation`,
        'unsafe-string'
      );
    }
    return {
      base,
      explanation: projectedExplanation
    };
  });

  let projectedSessions: CodexSessionRecord[];
  try {
    projectedSessions = validateCodexSessionIndexArtifact({
      schemaVersion: 'hooks.codex-session-index/v3',
      generatedAt: '2026-01-01T00:00:00.000Z',
      sources: BASE_INDEX_SOURCES,
      sessions: extras.map((entry) => entry.base),
      diagnostics: []
    }).sessions;
  } catch (error) {
    return mapIndexProjectionFailure(error);
  }
  if (projectedSessions.length !== extras.length) {
    invalidResolution('sessions', 'invalid-shape');
  }

  return {
    schemaVersion: 'hooks.codex-session-resolution/v3',
    project: project.raw,
    projectNorm: project.norm,
    totals: projectResolutionTotals(root.totals),
    sessions: projectedSessions.map((session, index) => {
      const resumeAvailable =
        session.stateDbPresent || session.rolloutPresent;
      const resumeDirectory =
        session.runtimeScope === 'descendant' && session.cwdRaw
          ? session.cwdRaw
          : project.raw;
      return {
        ...session,
        resumeAvailable,
        resumeDirectory,
        explanation: extras[index]!.explanation
      };
    })
  };
}

const relationRank: Record<ProjectRelation, number> = {
  owned: 0,
  supporting: 1,
  mentioned: 2,
  ambient: 3,
  unrelated: 4,
  unknown: 5
};

const storageRank: Record<StorageState, number> = {
  active: 0,
  archived: 1,
  missing: 2
};

function scopeMatchFromAttribution(
  session: CodexSessionRecord
): CodexScopeMatch {
  if (
    session.runtimeScope === 'exact' ||
    session.runtimeScope === 'descendant' ||
    session.runtimeScope === 'ancestor'
  ) {
    return session.runtimeScope;
  }
  return session.projectRelation === 'mentioned'
    ? 'prompt-mention'
    : 'unknown';
}

function hasProjectRelation(session: CodexSessionRecord): boolean {
  return session.projectRelation !== 'unrelated' &&
    session.projectRelation !== 'unknown';
}

export function filterResolvedSessions(
  sessions: CodexSessionRecord[],
  options: ResolveOptions = {}
): CodexSessionRecord[] {
  return sessions.filter((session) => {
    if (!hasProjectRelation(session)) return false;
    if (
      session.storageState !== 'active' &&
      !(
        options.includeArchived === true &&
        session.storageState === 'archived'
      )
    ) {
      return false;
    }
    if (
      session.threadSource !== 'user' &&
      !(
        options.includeSubagents === true &&
        session.threadSource === 'subagent'
      )
    ) {
      return false;
    }
    return session.projectRelation === 'owned' ||
      session.projectRelation === 'supporting' ||
      (options.includeRelated === true &&
        session.projectRelation === 'mentioned') ||
      (options.includeAmbient === true &&
        session.projectRelation === 'ambient');
  });
}

function parseUpdatedAt(value: string | null): number | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareResolvedSessions(
  left: ResolvedCodexSession,
  right: ResolvedCodexSession
): number {
  const relationDifference = relationRank[left.projectRelation] -
    relationRank[right.projectRelation];
  if (relationDifference !== 0) return relationDifference;

  const storageDifference = storageRank[left.storageState] -
    storageRank[right.storageState];
  if (storageDifference !== 0) return storageDifference;

  const leftUpdatedAt = parseUpdatedAt(left.updatedAt);
  const rightUpdatedAt = parseUpdatedAt(right.updatedAt);
  if (leftUpdatedAt !== null && rightUpdatedAt !== null) {
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }
  } else if (leftUpdatedAt !== null) {
    return -1;
  } else if (rightUpdatedAt !== null) {
    return 1;
  }

  return left.threadId.localeCompare(right.threadId);
}

export function resolveCodexSessions(
  sessions: CodexSessionRecord[],
  project: string,
  options: ResolveOptions = {}
): CodexSessionResolution {
  const projectNorm = normalizeCodexPath(project);
  for (const session of sessions) {
    assertCodexSessionProjectOwnerInvariant(session, project);
  }
  const resolved = filterResolvedSessions(sessions, options)
    .map((session): ResolvedCodexSession => {
      const scopeMatch = scopeMatchFromAttribution(session);
      return {
        ...session,
        scopeMatch,
        confidence: session.relationConfidence,
        projectOwner: session.projectOwner,
        resumeAvailable: session.stateDbPresent || session.rolloutPresent,
        resumeDirectory:
          session.runtimeScope === 'descendant' && session.cwdRaw
            ? session.cwdRaw
            : project,
        explanation: session.relationReasons.join('; ') ||
          `project relation: ${session.projectRelation}`
      };
    })
    .sort(compareResolvedSessions);
  return validateCodexSessionResolutionArtifact({
    schemaVersion: 'hooks.codex-session-resolution/v3',
    project,
    projectNorm,
    totals: summarizeProjectRelations(sessions),
    sessions: resolved
  });
}

export function renderCodexSessionResolution(
  result: CodexSessionResolution
): string {
  result = validateCodexSessionResolutionArtifact(result);
  const lines = [
    `Codex sessions for ${result.project}`,
    `owned=${result.totals.owned} supporting=${result.totals.supporting} mentioned=${result.totals.mentioned} ambient=${result.totals.ambient} archived=${result.totals.archived} subagents=${result.totals.subagents}`,
    `default-visible=${result.totals.defaultVisible}`,
    ''
  ];
  if (result.sessions.length === 0) {
    lines.push('No visible sessions found.');
    return `${lines.join('\n')}\n`;
  }
  for (const session of result.sessions) {
    lines.push(`[${session.projectRelation}] ${session.threadId}`);
    lines.push(
      `  scope: ${session.runtimeScope}; storage: ${session.storageState}; source: ${session.threadSource}`
    );
    lines.push(`  cwd: ${session.cwdRaw ?? 'unknown'}`);
    lines.push(
      `  resume: ${session.resumeAvailable ? 'yes' : 'no'}; directory: ${session.resumeDirectory}`
    );
    lines.push(`  reason: ${session.explanation}`);
  }
  return `${lines.join('\n')}\n`;
}
