import {
  CCPANES_SESSION_SNAPSHOT_LIMITS,
  canonicalizeCcPanesTimezoneTimestamp,
  inspectCcPanesLaunchRelationshipPrivacy,
  inspectCcPanesRuntimeRelationshipPrivacy,
  inspectCcPanesSnapshotFreshness,
  type CcPanesLaunchSnapshot,
  type CcPanesRuntimeSessionSnapshot,
  type CcPanesSessionSnapshot
} from './ccpanes-session-snapshot.js';
import { isCodexThreadId } from './codex-session-identity.js';
import {
  assertCodexSessionProjectOwnerInvariant,
  type SessionEvidence
} from './codex-session-attribution.js';
import {
  sanitizeCodexSessionArtifactExcerpt,
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedPath,
  sanitizeCodexSessionTaskBinding,
  type CodexSessionRecord
} from './codex-session-index.js';
import {
  isCodexPathInside,
  normalizeCodexPath
} from './codex-session-path.js';

export {
  isCodexThreadId as isSessionFederationCodexThreadId
} from './codex-session-identity.js';

export type FederationNodeType =
  | 'codex-thread'
  | 'ccpanes-launch'
  | 'ccpanes-session'
  | 'ccpanes-task';

export type FederationEdgeType =
  | 'resumed-from'
  | 'hosts'
  | 'launched'
  | 'belongs-to-task'
  | 'delegated-from'
  | 'controller-for';

export interface FederationNode {
  id: string;
  type: FederationNodeType;
  externalId: string;
  attributes: Record<string, unknown>;
}

export type FederationEvidence =
  | SessionEvidence
  | { kind: 'ccpanes-runtime-link'; sessionId: string }
  | { kind: 'snapshot-field'; field: string; value: string };

export interface FederationEdge {
  id: string;
  type: FederationEdgeType;
  from: string;
  to: string;
  confidence: number;
  evidence: FederationEvidence[];
  /** Time the source fact was observed, not the underlying event time. */
  observedAt: string;
}

export type FederationDiagnostic =
  | { kind: 'ccpanes-snapshot-missing' }
  | {
      kind: 'ccpanes-snapshot-stale';
      ageMs: number;
      maxAgeMs: number;
    }
  | {
      kind: 'ccpanes-snapshot-future';
      futureByMs: number;
      maxFutureSkewMs: number;
    };

export interface SessionFederation {
  schemaVersion: 'hooks.session-federation/v1';
  generatedAt: string;
  project: string;
  nodes: FederationNode[];
  edges: FederationEdge[];
  diagnostics: FederationDiagnostic[];
}

interface NodeState {
  node: FederationNode;
  concrete: boolean;
}

export const CODEX_SESSION_FEDERATION_INVARIANT_ERROR_CODE =
  'CODEX_SESSION_FEDERATION_INVARIANT' as const;

export type CodexSessionFederationInvariantReason =
  | 'capacity-exceeded'
  | 'unsafe-identity'
  | 'unsafe-path'
  | 'unsafe-project'
  | 'unsafe-timestamp';

export class CodexSessionFederationInvariantError extends Error {
  readonly code = CODEX_SESSION_FEDERATION_INVARIANT_ERROR_CODE;

  constructor(
    readonly field: string,
    readonly reason: CodexSessionFederationInvariantReason
  ) {
    super(`${CODEX_SESSION_FEDERATION_INVARIANT_ERROR_CODE}: ${field}: ${reason}`);
    this.name = 'CodexSessionFederationInvariantError';
  }
}

export const SESSION_FEDERATION_EVIDENCE_PER_EDGE_LIMIT =
  CCPANES_SESSION_SNAPSHOT_LIMITS.sessions * 2 + 2;

const EVIDENCE_KIND_ORDER: Record<FederationEvidence['kind'], number> = {
  'task-binding': 0,
  'ccpanes-launch': 1,
  'ccpanes-session': 2,
  cwd: 3,
  'primary-target': 4,
  'prompt-mention': 5,
  delegation: 6,
  'ccpanes-runtime-link': 7,
  'snapshot-field': 8
};

type TypedProjectPathRelation =
  | 'exact'
  | 'descendant'
  | 'conflict'
  | 'missing';

interface TypedProjectPathFact {
  source: string;
  candidate: string | null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

function stableValueKey(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? String(value);
}

function evidenceKey(evidence: FederationEvidence): string {
  return stableValueKey(evidence);
}

function dedupeSessionEvidence(
  evidence: SessionEvidence[]
): SessionEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = evidenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFederationEvidence(
  evidence: FederationEvidence[]
): FederationEvidence[] {
  const unique = new Map<string, FederationEvidence>();
  for (const item of evidence) unique.set(evidenceKey(item), item);
  return [...unique.values()].sort((left, right) =>
    EVIDENCE_KIND_ORDER[left.kind] - EVIDENCE_KIND_ORDER[right.kind] ||
    compareText(evidenceKey(left), evidenceKey(right))
  );
}

function federationNodeId(type: FederationNodeType, externalId: string): string {
  return `${type}:${encodeURIComponent(externalId)}`;
}

function federationNodeKey(type: FederationNodeType, externalId: string): string {
  return stableValueKey([type, externalId]);
}

function federationEdgeEndpoint(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('->', '%2D%3E');
}

function federationEdgeId(
  type: FederationEdgeType,
  from: string,
  to: string
): string {
  return `${type}:${federationEdgeEndpoint(from)}->${federationEdgeEndpoint(to)}`;
}

function assertFederationIdentity(
  value: string | null,
  field: string,
  optional = false
): string | null {
  if (value === null && optional) return null;
  const identity = sanitizeCodexSessionExternalIdentity(value);
  if (!identity) {
    throw new CodexSessionFederationInvariantError(field, 'unsafe-identity');
  }
  return identity;
}

function assertFederationCodexThreadId(
  value: string | null,
  field: string,
  optional = false
): string | null {
  if (value === null && optional) return null;
  if (!isCodexThreadId(value)) {
    throw new CodexSessionFederationInvariantError(field, 'unsafe-identity');
  }
  return value;
}

function federationObservedAt(
  value: string | null,
  fallback: string
): string {
  const projected = sanitizeCodexSessionArtifactExcerpt(value);
  if (!projected) return fallback;
  const epochMs = Date.parse(projected);
  return Number.isFinite(epochMs)
    ? new Date(epochMs).toISOString()
    : fallback;
}

export function assertCodexSessionFederationProject(project: string): string {
  const projection = sanitizeCodexSessionPromptDerivedPath(project);
  if (!projection) {
    throw new CodexSessionFederationInvariantError(
      'project',
      'unsafe-project'
    );
  }
  return projection.raw;
}

function assertFederationGeneratedAt(
  generatedAt: string | undefined
): string {
  const candidate = generatedAt ?? new Date().toISOString();
  const canonical = canonicalizeCcPanesTimezoneTimestamp(candidate);
  if (!canonical) {
    throw new CodexSessionFederationInvariantError(
      'generatedAt',
      'unsafe-timestamp'
    );
  }
  return canonical;
}

function classifyTypedProjectPath(
  projectNorm: string,
  candidate: string | null
): TypedProjectPathRelation {
  if (!projectNorm || !candidate?.trim()) return 'missing';
  const candidateNorm = normalizeCodexPath(candidate);
  if (!candidateNorm) return 'missing';
  if (candidateNorm === projectNorm) return 'exact';
  if (isCodexPathInside(projectNorm, candidateNorm)) return 'descendant';
  return 'conflict';
}

function addToIndex<T>(
  index: Map<string, T[]>,
  key: string | null,
  value: T
): void {
  if (!key) return;
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function indexSnapshotThreadReferences(
  snapshot: CcPanesSessionSnapshot
): {
  launchesByThreadId: Map<string, CcPanesLaunchSnapshot[]>;
  runtimeByThreadId: Map<string, CcPanesRuntimeSessionSnapshot[]>;
} {
  const launchesByThreadId = new Map<string, CcPanesLaunchSnapshot[]>();
  const runtimeByThreadId = new Map<string, CcPanesRuntimeSessionSnapshot[]>();
  for (const launch of snapshot.launches) {
    if (!inspectCcPanesLaunchRelationshipPrivacy(launch).safe) continue;
    addToIndex(launchesByThreadId, launch.resumeSessionId, launch);
  }
  for (const runtime of snapshot.sessions) {
    if (!inspectCcPanesRuntimeRelationshipPrivacy(runtime).safe) continue;
    addToIndex(
      runtimeByThreadId,
      runtime.observedCodexThreadId,
      runtime
    );
  }
  for (const launches of launchesByThreadId.values()) {
    launches.sort((left, right) => compareText(left.launchId, right.launchId));
  }
  for (const sessions of runtimeByThreadId.values()) {
    sessions.sort((left, right) => compareText(left.sessionId, right.sessionId));
  }
  return { launchesByThreadId, runtimeByThreadId };
}

function sessionTypedPathFacts(
  session: CodexSessionRecord,
  matchedLaunches: CcPanesLaunchSnapshot[],
  matchedRuntimeSessions: CcPanesRuntimeSessionSnapshot[]
): TypedProjectPathFact[] {
  const evidenceFacts = session.evidence.flatMap(
    (item): TypedProjectPathFact[] => {
      if (
        item.kind === 'task-binding' ||
        item.kind === 'ccpanes-launch' ||
        item.kind === 'ccpanes-session'
      ) {
        return [{
          source: `evidence.${item.kind}.projectPath`,
          candidate: item.projectPath
        }];
      }
      return [];
    }
  );
  return [
    {
      source: 'primaryTargetNorm',
      candidate: session.primaryTargetNorm
    },
    {
      source: 'taskBinding.projectPathRaw',
      candidate: session.taskBinding?.projectPathRaw ?? null
    },
    ...evidenceFacts,
    ...matchedLaunches.map((launch): TypedProjectPathFact => ({
      source: 'snapshot.launch.projectPathNorm',
      candidate: launch.projectPathNorm
    })),
    ...matchedRuntimeSessions.map((runtime): TypedProjectPathFact => ({
      source: 'snapshot.session.projectPathNorm',
      candidate: runtime.projectPathNorm
    }))
  ];
}

function typedProjectConflictReasons(
  projectNorm: string,
  session: CodexSessionRecord,
  matchedLaunches: CcPanesLaunchSnapshot[],
  matchedRuntimeSessions: CcPanesRuntimeSessionSnapshot[]
): string[] {
  const reasons = new Set<string>();
  for (const fact of sessionTypedPathFacts(
    session,
    matchedLaunches,
    matchedRuntimeSessions
  )) {
    if (
      classifyTypedProjectPath(projectNorm, fact.candidate) !== 'conflict'
    ) {
      continue;
    }
    const candidateNorm = fact.candidate
      ? normalizeCodexPath(fact.candidate)
      : '';
    if (candidateNorm) {
      reasons.add(
        `typed project conflict: ${fact.source}=${candidateNorm}`
      );
    }
  }
  return [...reasons].sort(compareText);
}

function duplicateIdentity(
  values: string[],
  label: string
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  const duplicate = [...duplicates].sort(compareText)[0];
  if (duplicate !== undefined) throw new Error(`${label}: ${duplicate}`);
}

export function attachCcPanesAttribution(input: {
  project: string;
  sessions: CodexSessionRecord[];
  ccpanes: CcPanesSessionSnapshot | null;
}): CodexSessionRecord[] {
  const project = assertCodexSessionFederationProject(input.project);
  for (const session of input.sessions) {
    assertCodexSessionProjectOwnerInvariant(session, project);
  }
  if (!input.ccpanes) {
    return input.sessions.map((session) => ({ ...session }));
  }

  const projectNorm = normalizeCodexPath(project);
  const {
    launchesByThreadId,
    runtimeByThreadId
  } = indexSnapshotThreadReferences(input.ccpanes);

  return input.sessions.map((session) => {
    const matchedLaunches = launchesByThreadId.get(session.threadId) ?? [];
    const matchedRuntimeSessions =
      runtimeByThreadId.get(session.threadId) ?? [];
    const addedEvidence: SessionEvidence[] = [];
    const addedReasons: string[] = [];
    const matchedRelations: TypedProjectPathRelation[] = [];

    for (const launch of matchedLaunches) {
      const projectPath = normalizeCodexPath(launch.projectPathNorm);
      const relation = classifyTypedProjectPath(projectNorm, projectPath);
      matchedRelations.push(relation);
      if (!projectPath) continue;
      addedEvidence.push({
        kind: 'ccpanes-launch',
        projectPath,
        launchId: launch.launchId
      });
      if (relation === 'exact') {
        addedReasons.push('matched exact-project CC-Panes launch');
      } else if (relation === 'descendant') {
        addedReasons.push('matched compatible-project CC-Panes launch');
      } else if (relation === 'conflict') {
        addedReasons.push('matched foreign-project CC-Panes launch');
      }
    }
    for (const runtime of matchedRuntimeSessions) {
      const projectPath = runtime.projectPathNorm
        ? normalizeCodexPath(runtime.projectPathNorm)
        : '';
      const relation = classifyTypedProjectPath(projectNorm, projectPath);
      matchedRelations.push(relation);
      if (!projectPath) continue;
      addedEvidence.push({
        kind: 'ccpanes-session',
        projectPath,
        sessionId: runtime.sessionId
      });
      if (relation === 'exact') {
        addedReasons.push('matched exact-project CC-Panes Session');
      } else if (relation === 'descendant') {
        addedReasons.push('matched compatible-project CC-Panes Session');
      } else if (relation === 'conflict') {
        addedReasons.push('matched foreign-project CC-Panes Session');
      }
    }

    const conflictReasons = typedProjectConflictReasons(
      projectNorm,
      session,
      matchedLaunches,
      matchedRuntimeSessions
    );
    const relationReasons = [...new Set([
      ...session.relationReasons,
      ...addedReasons,
      ...conflictReasons
    ])];
    const evidence = dedupeSessionEvidence([
      ...session.evidence,
      ...addedEvidence
    ]);
    if (conflictReasons.length > 0) {
      return {
        ...session,
        projectRelation: 'unrelated',
        relationConfidence: 0,
        projectOwner: null,
        relationReasons,
        evidence
      };
    }

    const hasExactSnapshot = matchedRelations.includes('exact');
    const hasDescendantSnapshot = matchedRelations.includes('descendant');
    const hasExistingOwner =
      session.projectRelation === 'owned' ||
      session.projectRelation === 'supporting';
    const promotesDescendantSnapshot =
      hasDescendantSnapshot && !hasExistingOwner;
    if (
      !hasExactSnapshot &&
      !hasDescendantSnapshot &&
      addedEvidence.length === 0
    ) {
      return { ...session };
    }

    const projectRelation = hasExactSnapshot
      ? 'owned'
      : promotesDescendantSnapshot
        ? 'supporting'
        : session.projectRelation;
    const relationConfidence = hasExactSnapshot
      ? 1
      : hasDescendantSnapshot && session.projectRelation === 'supporting'
        ? Math.max(session.relationConfidence, 0.8)
        : promotesDescendantSnapshot
          ? 0.8
          : session.relationConfidence;
    const projectOwner =
      projectRelation === 'owned' || projectRelation === 'supporting'
        ? hasExistingOwner
          ? session.projectOwner
          : project
        : null;

    return {
      ...session,
      projectRelation,
      relationConfidence,
      projectOwner,
      relationReasons,
      evidence
    };
  });
}

export function buildSessionFederation(input: {
  generatedAt?: string;
  project: string;
  codexSessions: CodexSessionRecord[];
  ccpanes?: CcPanesSessionSnapshot | null;
}): SessionFederation {
  const project = assertCodexSessionFederationProject(input.project);
  const generatedAt = assertFederationGeneratedAt(input.generatedAt);
  for (const [index, session] of input.codexSessions.entries()) {
    assertCodexSessionProjectOwnerInvariant(session, project);
    assertFederationCodexThreadId(
      session.threadId,
      `codexSessions[${index}].threadId`
    );
  }
  for (const [index, launch] of (input.ccpanes?.launches ?? []).entries()) {
    const privacy = inspectCcPanesLaunchRelationshipPrivacy(launch);
    if (!privacy.safe) {
      throw new CodexSessionFederationInvariantError(
        `ccpanes.launches[${index}].${privacy.issue.field}`,
        privacy.issue.reason
      );
    }
  }
  for (const [index, runtime] of (input.ccpanes?.sessions ?? []).entries()) {
    const privacy = inspectCcPanesRuntimeRelationshipPrivacy(runtime);
    if (!privacy.safe) {
      throw new CodexSessionFederationInvariantError(
        `ccpanes.sessions[${index}].${privacy.issue.field}`,
        privacy.issue.reason
      );
    }
  }
  duplicateIdentity(
    input.codexSessions.map((session) => session.threadId),
    'duplicate codex threadId'
  );
  duplicateIdentity(
    (input.ccpanes?.launches ?? []).map((launch) => launch.launchId),
    'duplicate CC-Panes launchId'
  );
  duplicateIdentity(
    (input.ccpanes?.sessions ?? []).map((session) => session.sessionId),
    'duplicate CC-Panes sessionId'
  );

  const snapshotObservedAt = federationObservedAt(
    input.ccpanes?.generatedAt ?? null,
    generatedAt
  );
  const nodes = new Map<string, NodeState>();
  const edges = new Map<string, FederationEdge>();
  const evidenceByEdge = new Map<
    string,
    Map<string, FederationEvidence>
  >();
  const diagnostics: FederationDiagnostic[] = [];

  const addNode = (
    type: FederationNodeType,
    externalId: string,
    attributes: Record<string, unknown>,
    concrete: boolean
  ): string => {
    if (
      type === 'codex-thread' &&
      !isCodexThreadId(externalId)
    ) {
      throw new CodexSessionFederationInvariantError(
        'nodes.externalId',
        'unsafe-identity'
      );
    }
    const id = federationNodeId(type, externalId);
    const key = federationNodeKey(type, externalId);
    const candidate: FederationNode = {
      id,
      type,
      externalId,
      attributes: { ...attributes }
    };
    const existing = nodes.get(key);
    if (!existing || (concrete && !existing.concrete)) {
      nodes.set(key, { node: candidate, concrete });
      return id;
    }
    if (existing.concrete && !concrete) return id;
    if (
      stableValueKey(existing.node.attributes) !==
      stableValueKey(candidate.attributes)
    ) {
      throw new Error(`conflicting federation node: ${id}`);
    }
    return id;
  };

  const addEdge = (
    type: FederationEdgeType,
    from: string,
    to: string,
    confidence: number,
    evidence: FederationEvidence[],
    observedAt = generatedAt
  ): void => {
    const id = federationEdgeId(type, from, to);
    const key = stableValueKey([type, from, to]);
    let mergedEvidence = evidenceByEdge.get(key);
    if (!mergedEvidence) {
      mergedEvidence = new Map<string, FederationEvidence>();
      evidenceByEdge.set(key, mergedEvidence);
    }
    for (const item of evidence) {
      mergedEvidence.set(evidenceKey(item), item);
    }
    if (
      mergedEvidence.size > SESSION_FEDERATION_EVIDENCE_PER_EDGE_LIMIT
    ) {
      throw new CodexSessionFederationInvariantError(
        'edges.evidence',
        'capacity-exceeded'
      );
    }
    const existing = edges.get(key);
    if (!existing) {
      edges.set(key, {
        id,
        type,
        from,
        to,
        confidence,
        evidence: [],
        observedAt
      });
      return;
    }
    edges.set(key, {
      ...existing,
      confidence: Math.max(existing.confidence, confidence),
      observedAt: compareText(existing.observedAt, observedAt) >= 0
        ? existing.observedAt
        : observedAt
    });
  };

  for (const session of input.codexSessions) {
    const threadNode = addNode('codex-thread', session.threadId, {
      host: sanitizeCodexSessionArtifactExcerpt(session.source),
      threadSource: sanitizeCodexSessionArtifactExcerpt(session.threadSource),
      storageState: sanitizeCodexSessionArtifactExcerpt(session.storageState),
      projectRelation: sanitizeCodexSessionArtifactExcerpt(
        session.projectRelation
      ),
      cwdNorm: sanitizeCodexSessionPromptDerivedPath(session.cwdNorm)?.norm ??
        null,
      updatedAt: sanitizeCodexSessionArtifactExcerpt(session.updatedAt)
    }, true);
    const delegatedFromThreadId = isCodexThreadId(
      session.delegatedFromThreadId
    )
      ? session.delegatedFromThreadId
      : null;
    if (!delegatedFromThreadId) continue;
    const parentNode = addNode(
      'codex-thread',
      delegatedFromThreadId,
      { inferred: true },
      false
    );
    addEdge(
      'delegated-from',
      threadNode,
      parentNode,
      1,
      [{
        kind: 'delegation',
        sourceThreadId: delegatedFromThreadId
      }],
      federationObservedAt(session.updatedAt, generatedAt)
    );
  }

  for (const launch of input.ccpanes?.launches ?? []) {
    const launchNode = addNode('ccpanes-launch', launch.launchId, {
      projectPathNorm: launch.projectPathNorm,
      workspaceName: sanitizeCodexSessionArtifactExcerpt(launch.workspaceName),
      cliTool: sanitizeCodexSessionArtifactExcerpt(launch.cliTool),
      launchedAt: sanitizeCodexSessionArtifactExcerpt(launch.launchedAt)
    }, true);
    if (!launch.resumeSessionId) continue;
    const threadNode = addNode(
      'codex-thread',
      launch.resumeSessionId,
      { inferred: true },
      false
    );
    addEdge(
      'resumed-from',
      launchNode,
      threadNode,
      1,
      [{
        kind: 'snapshot-field',
        field: 'launch.resumeSessionId',
        value: launch.resumeSessionId
      }],
      snapshotObservedAt
    );
  }

  for (const runtime of input.ccpanes?.sessions ?? []) {
    const runtimeNode = addNode('ccpanes-session', runtime.sessionId, {
      status: sanitizeCodexSessionArtifactExcerpt(runtime.status),
      title: sanitizeCodexSessionArtifactExcerpt(runtime.title),
      projectPathNorm: runtime.projectPathNorm
    }, true);
    if (runtime.launchId) {
      const launchNode = addNode(
        'ccpanes-launch',
        runtime.launchId,
        { inferred: true },
        false
      );
      addEdge(
        'launched',
        launchNode,
        runtimeNode,
        1,
        [{ kind: 'ccpanes-runtime-link', sessionId: runtime.sessionId }],
        snapshotObservedAt
      );
    }
    if (runtime.taskId) {
      const taskNode = addNode('ccpanes-task', runtime.taskId, {}, true);
      addEdge(
        'belongs-to-task',
        runtimeNode,
        taskNode,
        1,
        [{
          kind: 'snapshot-field',
          field: 'session.taskId',
          value: runtime.taskId
        }],
        snapshotObservedAt
      );
    }
    if (runtime.observedCodexThreadId) {
      const threadNode = addNode(
        'codex-thread',
        runtime.observedCodexThreadId,
        { inferred: true },
        false
      );
      addEdge(
        'hosts',
        runtimeNode,
        threadNode,
        1,
        [{
          kind: 'snapshot-field',
          field: 'session.observedCodexThreadId',
          value: runtime.observedCodexThreadId
        }],
        snapshotObservedAt
      );
    }
  }

  for (const session of input.codexSessions) {
    const taskBinding = sanitizeCodexSessionTaskBinding(session.taskBinding);
    if (!taskBinding) continue;
    const taskNode = addNode(
      'ccpanes-task',
      taskBinding.taskId,
      { inferred: true },
      false
    );
    addEdge(
      'belongs-to-task',
      federationNodeId('codex-thread', session.threadId),
      taskNode,
      1,
      [{
        kind: 'task-binding',
        projectPath: normalizeCodexPath(taskBinding.projectPathRaw),
        taskId: taskBinding.taskId
      }],
      federationObservedAt(session.updatedAt, generatedAt)
    );
  }

  const launchById = new Map(
    (input.ccpanes?.launches ?? []).map((launch) => [launch.launchId, launch])
  );
  for (const runtime of input.ccpanes?.sessions ?? []) {
    if (!runtime.launchId || !runtime.observedCodexThreadId) continue;
    const launch = launchById.get(runtime.launchId);
    if (
      !launch?.resumeSessionId ||
      launch.resumeSessionId === runtime.observedCodexThreadId
    ) {
      continue;
    }
    addEdge(
      'controller-for',
      federationNodeId('codex-thread', runtime.observedCodexThreadId),
      federationNodeId('codex-thread', launch.resumeSessionId),
      0.9,
      [
        { kind: 'ccpanes-runtime-link', sessionId: runtime.sessionId },
        {
          kind: 'snapshot-field',
          field: 'launch.resumeSessionId',
          value: launch.resumeSessionId
        },
        {
          kind: 'snapshot-field',
          field: 'session.launchId',
          value: runtime.launchId
        },
        {
          kind: 'snapshot-field',
          field: 'session.observedCodexThreadId',
          value: runtime.observedCodexThreadId
        }
      ],
      snapshotObservedAt
    );
  }

  if (!input.ccpanes) {
    diagnostics.push({ kind: 'ccpanes-snapshot-missing' });
  } else {
    const freshness = inspectCcPanesSnapshotFreshness(
      input.ccpanes.generatedAt,
      generatedAt
    );
    if (freshness.state === 'stale') {
      diagnostics.push({
        kind: 'ccpanes-snapshot-stale',
        ageMs: freshness.ageMs,
        maxAgeMs: freshness.maxAgeMs
      });
    } else if (freshness.state === 'future') {
      diagnostics.push({
        kind: 'ccpanes-snapshot-future',
        futureByMs: freshness.futureByMs,
        maxFutureSkewMs: freshness.maxFutureSkewMs
      });
    }
  }

  return {
    schemaVersion: 'hooks.session-federation/v1',
    generatedAt,
    project,
    nodes: [...nodes.values()]
      .map((state) => state.node)
      .sort((left, right) => compareText(left.id, right.id)),
    edges: [...edges.values()]
      .map((edge) => ({
        ...edge,
        evidence: normalizeFederationEvidence([
          ...(evidenceByEdge.get(
            stableValueKey([edge.type, edge.from, edge.to])
          )?.values() ?? [])
        ])
      }))
      .sort((left, right) => compareText(left.id, right.id)),
    diagnostics
  };
}
