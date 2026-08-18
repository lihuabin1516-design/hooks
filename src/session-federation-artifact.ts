import { canonicalizeCcPanesTimezoneTimestamp } from './ccpanes-session-snapshot.js';
import {
  sanitizeCodexSessionArtifactExcerpt,
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedPath
} from './codex-session-index.js';
import { isCodexThreadId } from './codex-session-identity.js';
import {
  assertCodexSessionFederationProject,
  SESSION_FEDERATION_EVIDENCE_PER_EDGE_LIMIT,
  type FederationDiagnostic,
  type FederationEdge,
  type FederationEdgeType,
  type FederationEvidence,
  type FederationNode,
  type FederationNodeType,
  type SessionFederation
} from './session-federation.js';

export const SESSION_FEDERATION_ARTIFACT_LIMITS = Object.freeze({
  nodes: 40_000,
  edges: 60_000,
  evidencePerEdge: SESSION_FEDERATION_EVIDENCE_PER_EDGE_LIMIT,
  diagnostics: 3,
  identity: 256,
  displayString: 512,
  structuralId: 8_192
});

export type SessionFederationArtifactErrorReason =
  | 'invalid-shape'
  | 'unknown-field'
  | 'unsupported-schema'
  | 'invalid-enum'
  | 'unsafe-identity'
  | 'unsafe-project'
  | 'unsafe-path'
  | 'unsafe-timestamp'
  | 'unsafe-string'
  | 'invalid-confidence'
  | 'invalid-number'
  | 'duplicate-id'
  | 'missing-reference'
  | 'inconsistent-id'
  | 'capacity-exceeded';

export class SessionFederationArtifactError extends Error {
  readonly code = 'SESSION_FEDERATION_ARTIFACT' as const;

  constructor(
    readonly field: string,
    readonly reason: SessionFederationArtifactErrorReason
  ) {
    super(`SESSION_FEDERATION_ARTIFACT: ${field}: ${reason}`);
    this.name = 'SessionFederationArtifactError';
  }
}

const ROOT_FIELDS = fields(
  'schemaVersion',
  'generatedAt',
  'project',
  'nodes',
  'edges',
  'diagnostics'
);
const NODE_FIELDS = fields('id', 'type', 'externalId', 'attributes');
const EDGE_FIELDS = fields(
  'id',
  'type',
  'from',
  'to',
  'confidence',
  'evidence',
  'observedAt'
);
const INFERRED_FIELDS = fields('inferred');
const CODEX_THREAD_FIELDS = fields(
  'host',
  'threadSource',
  'storageState',
  'projectRelation',
  'cwdNorm',
  'updatedAt'
);
const LAUNCH_FIELDS = fields(
  'projectPathNorm',
  'workspaceName',
  'cliTool',
  'launchedAt'
);
const SESSION_FIELDS = fields('status', 'title', 'projectPathNorm');
const TASK_FIELDS = fields();
const NODE_TYPES = values<FederationNodeType>(
  'codex-thread',
  'ccpanes-launch',
  'ccpanes-session',
  'ccpanes-task'
);
const EDGE_TYPES = values<FederationEdgeType>(
  'resumed-from',
  'hosts',
  'launched',
  'belongs-to-task',
  'delegated-from',
  'controller-for'
);
const THREAD_HOSTS = values('codex-app', 'codex-cli', 'ccpanes', 'unknown');
const THREAD_SOURCES = values('user', 'subagent', 'automation', 'unknown');
const STORAGE_STATES = values('active', 'archived', 'missing');
const PROJECT_RELATIONS = values(
  'owned',
  'supporting',
  'mentioned',
  'ambient',
  'unrelated',
  'unknown'
);
const SNAPSHOT_FIELDS = values(
  'launch.resumeSessionId',
  'session.taskId',
  'session.observedCodexThreadId',
  'session.launchId'
);
const DIAGNOSTIC_KINDS = values(
  'ccpanes-snapshot-missing',
  'ccpanes-snapshot-stale',
  'ccpanes-snapshot-future'
);
const EVIDENCE_KINDS = values<FederationEvidence['kind']>(
  'task-binding',
  'ccpanes-launch',
  'ccpanes-session',
  'cwd',
  'primary-target',
  'prompt-mention',
  'delegation',
  'ccpanes-runtime-link',
  'snapshot-field'
);

function fields(...names: string[]): ReadonlySet<string> {
  return new Set(names);
}

function values<T extends string = string>(...items: T[]): ReadonlySet<string> {
  return new Set(items);
}

function invalid(
  field: string,
  reason: SessionFederationArtifactErrorReason
): never {
  throw new SessionFederationArtifactError(field, reason);
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

function safeIdentity(
  value: unknown,
  field: string,
  codexThread = false
): string {
  if (
    typeof value !== 'string' ||
    (codexThread
      ? !isCodexThreadId(value)
      : value.length > SESSION_FEDERATION_ARTIFACT_LIMITS.identity ||
        sanitizeCodexSessionExternalIdentity(value) !== value)
  ) {
    return invalid(field, 'unsafe-identity');
  }
  return value;
}

function safeTimestamp(value: unknown, field: string): string {
  const canonical = canonicalizeCcPanesTimezoneTimestamp(value);
  if (!canonical) return invalid(field, 'unsafe-timestamp');
  return canonical;
}

function safeProject(value: unknown, field: string): string {
  if (typeof value !== 'string') return invalid(field, 'unsafe-project');
  try {
    return assertCodexSessionFederationProject(value);
  } catch {
    return invalid(field, 'unsafe-project');
  }
}

function safeNormalizedPath(
  value: unknown,
  field: string,
  nullable = false
): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return invalid(field, 'unsafe-path');
  const projected = sanitizeCodexSessionPromptDerivedPath(value);
  if (!projected || projected.norm !== value) {
    return invalid(field, 'unsafe-path');
  }
  return value;
}

function safeDisplayString(
  value: unknown,
  field: string,
  nullable = false
): string | null {
  if (value === null && nullable) return null;
  if (
    typeof value !== 'string' ||
    value.length > SESSION_FEDERATION_ARTIFACT_LIMITS.displayString ||
    sanitizeCodexSessionArtifactExcerpt(value) !== value
  ) {
    return invalid(field, 'unsafe-string');
  }
  return value;
}

function safeStructuralId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SESSION_FEDERATION_ARTIFACT_LIMITS.structuralId ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return invalid(field, 'unsafe-string');
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid(field, 'invalid-number');
  }
  return value as number;
}

function expectedNodeId(type: FederationNodeType, externalId: string): string {
  return `${type}:${encodeURIComponent(externalId)}`;
}

function edgeEndpoint(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('->', '%2D%3E');
}

function expectedEdgeId(
  type: FederationEdgeType,
  from: string,
  to: string
): string {
  return `${type}:${edgeEndpoint(from)}->${edgeEndpoint(to)}`;
}

function validateAttributes(
  type: FederationNodeType,
  value: unknown,
  field: string
): Record<string, unknown> {
  const attributes = record(value, field);
  if (attributes.inferred === true) {
    knownFields(attributes, INFERRED_FIELDS, field);
    return { inferred: true };
  }

  if (type === 'codex-thread') {
    knownFields(attributes, CODEX_THREAD_FIELDS, field);
    return {
      host: requiredEnum(attributes.host, THREAD_HOSTS, `${field}.host`),
      threadSource: requiredEnum(
        attributes.threadSource,
        THREAD_SOURCES,
        `${field}.threadSource`
      ),
      storageState: requiredEnum(
        attributes.storageState,
        STORAGE_STATES,
        `${field}.storageState`
      ),
      projectRelation: requiredEnum(
        attributes.projectRelation,
        PROJECT_RELATIONS,
        `${field}.projectRelation`
      ),
      cwdNorm: safeNormalizedPath(attributes.cwdNorm, `${field}.cwdNorm`, true),
      updatedAt: attributes.updatedAt === null
        ? null
        : safeTimestamp(attributes.updatedAt, `${field}.updatedAt`)
    };
  }
  if (type === 'ccpanes-launch') {
    knownFields(attributes, LAUNCH_FIELDS, field);
    return {
      projectPathNorm: safeNormalizedPath(
        attributes.projectPathNorm,
        `${field}.projectPathNorm`
      ),
      workspaceName: safeDisplayString(
        attributes.workspaceName,
        `${field}.workspaceName`,
        true
      ),
      cliTool: safeDisplayString(
        attributes.cliTool,
        `${field}.cliTool`
      ),
      launchedAt: safeTimestamp(attributes.launchedAt, `${field}.launchedAt`)
    };
  }
  if (type === 'ccpanes-session') {
    knownFields(attributes, SESSION_FIELDS, field);
    return {
      status: safeDisplayString(
        attributes.status,
        `${field}.status`
      ),
      title: safeDisplayString(attributes.title, `${field}.title`, true),
      projectPathNorm: safeNormalizedPath(
        attributes.projectPathNorm,
        `${field}.projectPathNorm`,
        true
      )
    };
  }

  knownFields(attributes, TASK_FIELDS, field);
  return {};
}

function validateNode(value: unknown, index: number): FederationNode {
  const field = `nodes[${index}]`;
  const node = record(value, field);
  knownFields(node, NODE_FIELDS, field);
  const type = requiredEnum<FederationNodeType>(
    node.type,
    NODE_TYPES,
    `${field}.type`
  );
  const externalId = safeIdentity(
    node.externalId,
    `${field}.externalId`,
    type === 'codex-thread'
  );
  const id = safeStructuralId(node.id, `${field}.id`);
  if (id !== expectedNodeId(type, externalId)) {
    invalid(`${field}.id`, 'inconsistent-id');
  }
  return {
    id,
    type,
    externalId,
    attributes: validateAttributes(type, node.attributes, `${field}.attributes`)
  };
}

function validateEvidence(
  value: unknown,
  edgeIndex: number,
  evidenceIndex: number
): FederationEvidence {
  const field = `edges[${edgeIndex}].evidence[${evidenceIndex}]`;
  const item = record(value, field);
  const kind = requiredEnum<FederationEvidence['kind']>(
    item.kind,
    EVIDENCE_KINDS,
    `${field}.kind`
  );
  if (kind === 'task-binding') {
    knownFields(item, fields('kind', 'projectPath', 'taskId'), field);
    return {
      kind,
      projectPath: safeNormalizedPath(
        item.projectPath,
        `${field}.projectPath`
      )!,
      taskId: safeIdentity(item.taskId, `${field}.taskId`)
    };
  }
  if (kind === 'ccpanes-launch') {
    knownFields(item, fields('kind', 'projectPath', 'launchId'), field);
    return {
      kind,
      projectPath: safeNormalizedPath(
        item.projectPath,
        `${field}.projectPath`
      )!,
      launchId: safeIdentity(item.launchId, `${field}.launchId`)
    };
  }
  if (kind === 'ccpanes-session') {
    knownFields(item, fields('kind', 'projectPath', 'sessionId'), field);
    return {
      kind,
      projectPath: safeNormalizedPath(
        item.projectPath,
        `${field}.projectPath`
      )!,
      sessionId: safeIdentity(item.sessionId, `${field}.sessionId`)
    };
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
    return {
      kind,
      target: safeNormalizedPath(item.target, `${field}.target`)!
    };
  }
  if (kind === 'delegation') {
    knownFields(item, fields('kind', 'sourceThreadId'), field);
    return {
      kind,
      sourceThreadId: safeIdentity(
        item.sourceThreadId,
        `${field}.sourceThreadId`,
        true
      )
    };
  }
  if (kind === 'ccpanes-runtime-link') {
    knownFields(item, fields('kind', 'sessionId'), field);
    return {
      kind,
      sessionId: safeIdentity(item.sessionId, `${field}.sessionId`)
    };
  }

  knownFields(item, fields('kind', 'field', 'value'), field);
  const snapshotField = requiredEnum(
    item.field,
    SNAPSHOT_FIELDS,
    `${field}.field`
  );
  return {
    kind,
    field: snapshotField,
    value: safeIdentity(
      item.value,
      `${field}.value`,
      snapshotField === 'launch.resumeSessionId' ||
        snapshotField === 'session.observedCodexThreadId'
    )
  };
}

function isSnapshotFieldEvidence(
  evidence: FederationEvidence,
  snapshotField: string,
  expectedValue?: string
): boolean {
  return evidence.kind === 'snapshot-field' &&
    evidence.field === snapshotField &&
    (expectedValue === undefined || evidence.value === expectedValue);
}

interface FederationNodeReference {
  type: FederationNodeType;
  externalId: string;
}

function hasNodeExternalId(
  nodes: ReadonlyMap<string, FederationNodeReference>,
  type: FederationNodeType,
  externalId: string
): boolean {
  const node = nodes.get(expectedNodeId(type, externalId));
  return node?.type === type && node.externalId === externalId;
}

function assertEdgeSemantics(
  edge: FederationEdge,
  nodes: ReadonlyMap<string, FederationNodeReference>,
  field: string
): void {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from) invalid(`${field}.from`, 'missing-reference');
  if (!to) invalid(`${field}.to`, 'missing-reference');
  const valid =
    (edge.type === 'resumed-from' &&
      from.type === 'ccpanes-launch' && to.type === 'codex-thread') ||
    (edge.type === 'hosts' &&
      from.type === 'ccpanes-session' && to.type === 'codex-thread') ||
    (edge.type === 'launched' &&
      from.type === 'ccpanes-launch' && to.type === 'ccpanes-session') ||
    (edge.type === 'belongs-to-task' &&
      (from.type === 'ccpanes-session' || from.type === 'codex-thread') &&
      to.type === 'ccpanes-task') ||
    ((edge.type === 'delegated-from' ||
      edge.type === 'controller-for') &&
      from.type === 'codex-thread' && to.type === 'codex-thread');
  if (!valid) invalid(field, 'invalid-shape');

  const exactEvidence = (
    predicate: (evidence: FederationEvidence) => boolean
  ): boolean => edge.evidence.length === 1 && predicate(edge.evidence[0]!);
  let validEvidence = false;
  if (edge.type === 'resumed-from') {
    validEvidence = exactEvidence((evidence) =>
      isSnapshotFieldEvidence(
        evidence,
        'launch.resumeSessionId',
        to.externalId
      )
    );
  } else if (edge.type === 'hosts') {
    validEvidence = exactEvidence((evidence) =>
      isSnapshotFieldEvidence(
        evidence,
        'session.observedCodexThreadId',
        to.externalId
      )
    );
  } else if (edge.type === 'launched') {
    validEvidence = exactEvidence((evidence) =>
      evidence.kind === 'ccpanes-runtime-link' &&
      evidence.sessionId === to.externalId
    );
  } else if (edge.type === 'belongs-to-task') {
    validEvidence = from.type === 'ccpanes-session'
      ? exactEvidence((evidence) =>
          isSnapshotFieldEvidence(
            evidence,
            'session.taskId',
            to.externalId
          )
        )
      : exactEvidence((evidence) =>
          evidence.kind === 'task-binding' &&
          evidence.taskId === to.externalId
        );
  } else if (edge.type === 'delegated-from') {
    validEvidence = exactEvidence((evidence) =>
      evidence.kind === 'delegation' &&
      evidence.sourceThreadId === to.externalId
    );
  } else {
    const allowed = edge.evidence.every((evidence) =>
      (evidence.kind === 'ccpanes-runtime-link' &&
        hasNodeExternalId(nodes, 'ccpanes-session', evidence.sessionId)) ||
      isSnapshotFieldEvidence(
        evidence,
        'launch.resumeSessionId',
        to.externalId
      ) ||
      (evidence.kind === 'snapshot-field' &&
        evidence.field === 'session.launchId' &&
        hasNodeExternalId(nodes, 'ccpanes-launch', evidence.value)) ||
      isSnapshotFieldEvidence(
        evidence,
        'session.observedCodexThreadId',
        from.externalId
      )
    );
    validEvidence = allowed &&
      edge.evidence.some((evidence) =>
        evidence.kind === 'ccpanes-runtime-link'
      ) &&
      edge.evidence.some((evidence) =>
        isSnapshotFieldEvidence(evidence, 'launch.resumeSessionId')
      ) &&
      edge.evidence.some((evidence) =>
        isSnapshotFieldEvidence(evidence, 'session.launchId')
      ) &&
      edge.evidence.some((evidence) =>
        isSnapshotFieldEvidence(evidence, 'session.observedCodexThreadId')
      );
  }
  if (!validEvidence) invalid(`${field}.evidence`, 'invalid-shape');
}

function validateEdge(
  value: unknown,
  index: number,
  nodes: ReadonlyMap<string, FederationNodeReference>
): FederationEdge {
  const field = `edges[${index}]`;
  const edge = record(value, field);
  knownFields(edge, EDGE_FIELDS, field);
  const type = requiredEnum<FederationEdgeType>(
    edge.type,
    EDGE_TYPES,
    `${field}.type`
  );
  const from = safeStructuralId(edge.from, `${field}.from`);
  const to = safeStructuralId(edge.to, `${field}.to`);
  const id = safeStructuralId(edge.id, `${field}.id`);
  if (id !== expectedEdgeId(type, from, to)) {
    invalid(`${field}.id`, 'inconsistent-id');
  }
  const expectedConfidence = type === 'controller-for' ? 0.9 : 1;
  if (
    typeof edge.confidence !== 'number' ||
    edge.confidence !== expectedConfidence
  ) {
    invalid(`${field}.confidence`, 'invalid-confidence');
  }
  if (!Array.isArray(edge.evidence)) {
    invalid(`${field}.evidence`, 'invalid-shape');
  }
  if (
    edge.evidence.length === 0 ||
    edge.evidence.length >
      SESSION_FEDERATION_ARTIFACT_LIMITS.evidencePerEdge
  ) {
    invalid(`${field}.evidence`, 'capacity-exceeded');
  }
  const normalized: FederationEdge = {
    id,
    type,
    from,
    to,
    confidence: edge.confidence,
    evidence: edge.evidence.map((item, evidenceIndex) =>
      validateEvidence(item, index, evidenceIndex)
    ),
    observedAt: safeTimestamp(edge.observedAt, `${field}.observedAt`)
  };
  assertEdgeSemantics(normalized, nodes, field);
  return normalized;
}

function addRelation(
  index: Map<string, Set<string>>,
  from: string,
  to: string
): void {
  const related = index.get(from);
  if (related) related.add(to);
  else index.set(from, new Set([to]));
}

function hasRelated(
  index: ReadonlyMap<string, ReadonlySet<string>>,
  key: string,
  candidates: ReadonlySet<string>
): boolean {
  const related = index.get(key);
  return related !== undefined &&
    [...related].some((value) => candidates.has(value));
}

function assertControllerClosures(edges: readonly FederationEdge[]): void {
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const launchesBySession = new Map<string, Set<string>>();
  const sessionsByLaunch = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.type !== 'launched') continue;
    addRelation(launchesBySession, edge.to, edge.from);
    addRelation(sessionsByLaunch, edge.from, edge.to);
  }

  for (const [index, edge] of edges.entries()) {
    if (edge.type !== 'controller-for') continue;
    const runtimeSessions = new Set(
      edge.evidence
        .filter((item) => item.kind === 'ccpanes-runtime-link')
        .map((item) =>
          expectedNodeId('ccpanes-session', item.sessionId)
        )
    );
    const launches = new Set(
      edge.evidence
        .filter((item): item is Extract<
          FederationEvidence,
          { kind: 'snapshot-field' }
        > =>
          item.kind === 'snapshot-field' &&
          item.field === 'session.launchId'
        )
        .map((item) => expectedNodeId('ccpanes-launch', item.value))
    );
    const invalidClosure =
      [...runtimeSessions].some((sessionId) =>
        !edgeIds.has(expectedEdgeId('hosts', sessionId, edge.from)) ||
        !hasRelated(launchesBySession, sessionId, launches)
      ) ||
      [...launches].some((launchId) =>
        !edgeIds.has(expectedEdgeId('resumed-from', launchId, edge.to)) ||
        !hasRelated(sessionsByLaunch, launchId, runtimeSessions)
      );
    if (invalidClosure) {
      invalid(`edges[${index}].evidence`, 'invalid-shape');
    }
  }
}

function validateDiagnostic(
  value: unknown,
  index: number
): FederationDiagnostic {
  const field = `diagnostics[${index}]`;
  const diagnostic = record(value, field);
  const kind = requiredEnum<FederationDiagnostic['kind']>(
    diagnostic.kind,
    DIAGNOSTIC_KINDS,
    `${field}.kind`
  );
  if (kind === 'ccpanes-snapshot-missing') {
    knownFields(diagnostic, fields('kind'), field);
    return { kind };
  }
  if (kind === 'ccpanes-snapshot-stale') {
    knownFields(diagnostic, fields('kind', 'ageMs', 'maxAgeMs'), field);
    return {
      kind,
      ageMs: nonNegativeInteger(diagnostic.ageMs, `${field}.ageMs`),
      maxAgeMs: nonNegativeInteger(
        diagnostic.maxAgeMs,
        `${field}.maxAgeMs`
      )
    };
  }
  knownFields(
    diagnostic,
    fields('kind', 'futureByMs', 'maxFutureSkewMs'),
    field
  );
  return {
    kind,
    futureByMs: nonNegativeInteger(
      diagnostic.futureByMs,
      `${field}.futureByMs`
    ),
    maxFutureSkewMs: nonNegativeInteger(
      diagnostic.maxFutureSkewMs,
      `${field}.maxFutureSkewMs`
    )
  };
}

function assertUniqueIds(
  values: readonly string[],
  field: string
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) invalid(field, 'duplicate-id');
    seen.add(value);
  }
}

function assertSingleValuedEdges(edges: readonly FederationEdge[]): void {
  const endpointsByType = new Map<FederationEdgeType, Set<string>>();
  for (const [index, edge] of edges.entries()) {
    const endpoint =
      edge.type === 'launched'
        ? edge.to
        : edge.type === 'hosts' ||
            edge.type === 'resumed-from' ||
            edge.type === 'belongs-to-task' ||
            edge.type === 'delegated-from'
          ? edge.from
          : undefined;
    if (endpoint === undefined) continue;

    const endpoints = endpointsByType.get(edge.type);
    if (endpoints?.has(endpoint)) {
      invalid(`edges[${index}]`, 'invalid-shape');
    }
    if (endpoints) endpoints.add(endpoint);
    else endpointsByType.set(edge.type, new Set([endpoint]));
  }
}

export function validateSessionFederationArtifact(
  value: unknown
): SessionFederation {
  const root = record(value, 'root');
  knownFields(root, ROOT_FIELDS, 'root');
  if (root.schemaVersion !== 'hooks.session-federation/v1') {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(root.nodes)) invalid('nodes', 'invalid-shape');
  if (!Array.isArray(root.edges)) invalid('edges', 'invalid-shape');
  if (!Array.isArray(root.diagnostics)) {
    invalid('diagnostics', 'invalid-shape');
  }
  if (root.nodes.length > SESSION_FEDERATION_ARTIFACT_LIMITS.nodes) {
    invalid('nodes', 'capacity-exceeded');
  }
  if (root.edges.length > SESSION_FEDERATION_ARTIFACT_LIMITS.edges) {
    invalid('edges', 'capacity-exceeded');
  }
  if (
    root.diagnostics.length >
    SESSION_FEDERATION_ARTIFACT_LIMITS.diagnostics
  ) {
    invalid('diagnostics', 'capacity-exceeded');
  }

  const nodes = root.nodes.map(validateNode);
  assertUniqueIds(nodes.map((node) => node.id), 'nodes');
  const nodeReferences = new Map(nodes.map((node) => [
    node.id,
    { type: node.type, externalId: node.externalId }
  ]));
  const edges = root.edges.map((edge, index) =>
    validateEdge(edge, index, nodeReferences)
  );
  assertUniqueIds(edges.map((edge) => edge.id), 'edges');
  assertSingleValuedEdges(edges);
  assertControllerClosures(edges);

  return {
    schemaVersion: 'hooks.session-federation/v1',
    generatedAt: safeTimestamp(root.generatedAt, 'generatedAt'),
    project: safeProject(root.project, 'project'),
    nodes,
    edges,
    diagnostics: root.diagnostics.map(validateDiagnostic)
  };
}
