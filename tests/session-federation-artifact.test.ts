import { expect, test } from 'vitest';
import {
  SessionFederationArtifactError,
  validateSessionFederationArtifact
} from '../src/session-federation-artifact.js';
import { isCodexThreadId } from '../src/codex-session-identity.js';
import {
  buildSessionFederation,
  type FederationEdge,
  type FederationEvidence
} from '../src/session-federation.js';

function validGraph(): Record<string, unknown> {
  return {
    schemaVersion: 'hooks.session-federation/v1',
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\Repo',
    nodes: [{
      id: 'codex-thread:thread-1',
      type: 'codex-thread',
      externalId: 'thread-1',
      attributes: {
        host: 'codex-cli',
        threadSource: 'user',
        storageState: 'active',
        projectRelation: 'owned',
        cwdNorm: 'd:/repo',
        updatedAt: '2026-08-15T08:00:00.000Z'
      }
    }, {
      id: 'ccpanes-launch:launch-1',
      type: 'ccpanes-launch',
      externalId: 'launch-1',
      attributes: {
        projectPathNorm: 'd:/repo',
        workspaceName: 'repo',
        cliTool: 'codex',
        launchedAt: '2026-08-15T08:00:00.000Z'
      }
    }, {
      id: 'ccpanes-session:session-1',
      type: 'ccpanes-session',
      externalId: 'session-1',
      attributes: {
        status: 'active',
        title: 'Session',
        projectPathNorm: 'd:/repo'
      }
    }, {
      id: 'ccpanes-task:task-1',
      type: 'ccpanes-task',
      externalId: 'task-1',
      attributes: {}
    }, {
      id: 'codex-thread:parent-thread',
      type: 'codex-thread',
      externalId: 'parent-thread',
      attributes: { inferred: true }
    }],
    edges: [{
      id: 'resumed-from:ccpanes-launch:launch-1->codex-thread:thread-1',
      type: 'resumed-from',
      from: 'ccpanes-launch:launch-1',
      to: 'codex-thread:thread-1',
      confidence: 1,
      evidence: [{
        kind: 'snapshot-field',
        field: 'launch.resumeSessionId',
        value: 'thread-1'
      }],
      observedAt: '2026-08-15T09:00:00.000Z'
    }],
    diagnostics: [{
      kind: 'ccpanes-snapshot-stale',
      ageMs: 90_000_000,
      maxAgeMs: 86_400_000
    }]
  };
}

function capture(run: () => unknown): SessionFederationArtifactError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionFederationArtifactError);
    return error as SessionFederationArtifactError;
  }
  throw new Error('expected SessionFederationArtifactError');
}

function setCodexNodeIdentity(
  value: Record<string, unknown>,
  nodeIndex: number,
  externalId: string
): void {
  const nodes = value.nodes as Array<Record<string, unknown>>;
  const node = nodes[nodeIndex]!;
  const previousId = node.id;
  node.externalId = externalId;
  node.id = `codex-thread:${encodeURIComponent(externalId)}`;
  for (const edge of value.edges as Array<Record<string, unknown>>) {
    const wasFrom = edge.from === previousId;
    const wasTo = edge.to === previousId;
    if (wasFrom) edge.from = node.id;
    if (wasTo) edge.to = node.id;
    for (
      const evidence of edge.evidence as Array<Record<string, unknown>>
    ) {
      if (
        wasTo &&
        evidence.kind === 'snapshot-field' &&
        (evidence.field === 'launch.resumeSessionId' ||
          evidence.field === 'session.observedCodexThreadId')
      ) {
        evidence.value = externalId;
      }
      if (wasTo && evidence.kind === 'delegation') {
        evidence.sourceThreadId = externalId;
      }
      if (
        wasFrom &&
        edge.type === 'controller-for' &&
        evidence.kind === 'snapshot-field' &&
        evidence.field === 'session.observedCodexThreadId'
      ) {
        evidence.value = externalId;
      }
    }
    const from = String(edge.from)
      .replaceAll('%', '%25')
      .replaceAll('->', '%2D%3E');
    const to = String(edge.to)
      .replaceAll('%', '%25')
      .replaceAll('->', '%2D%3E');
    edge.id = `${edge.type}:${from}->${to}`;
  }
}

function completeGeneratedGraph(
  input: { unrelatedController?: boolean } = {}
): ReturnType<typeof buildSessionFederation> {
  return buildSessionFederation({
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\Repo',
    codexSessions: [{
      threadId: 'child-thread',
      source: 'codex-app',
      threadSource: 'user',
      originator: 'Codex Desktop',
      cwdRaw: 'D:\\Repo',
      cwdNorm: 'd:/repo',
      projectOwner: 'D:\\Repo',
      scopeMatch: 'exact',
      confidence: 1,
      rolloutPath: 'C:\\rollout.jsonl',
      stateDbPresent: true,
      rolloutPresent: true,
      updatedAt: '2026-08-15T08:00:00.000Z',
      firstUserPrompt: 'Work',
      lastSummary: null,
      storageState: 'active',
      runtimeScope: 'exact',
      projectRelation: 'owned',
      relationConfidence: 1,
      relationReasons: ['owned'],
      evidence: [{ kind: 'cwd', relation: 'exact' }],
      appVisibility: 'unknown',
      taskBinding: {
        taskId: 'task-1',
        projectPathRaw: 'D:\\Repo',
        worktreeRootRaw: 'D:\\Repo'
      },
      delegatedFromThreadId: 'parent-thread',
      primaryTargetRaw: null,
      primaryTargetNorm: null
    }],
    ccpanes: {
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: '2026-08-15T08:59:00.000Z',
      launches: [
        {
          launchId: 'launch-1',
          projectPath: 'D:\\Repo',
          projectPathNorm: 'd:/repo',
          workspaceName: 'repo',
          cliTool: 'codex',
          resumeSessionId: 'parent-thread',
          launchedAt: '2026-08-15T08:58:00.000Z'
        },
        ...(input.unrelatedController
          ? [{
              launchId: 'launch-2',
              projectPath: 'D:\\Repo',
              projectPathNorm: 'd:/repo',
              workspaceName: 'repo',
              cliTool: 'codex',
              resumeSessionId: 'other-parent-thread',
              launchedAt: '2026-08-15T08:57:00.000Z'
            }]
          : [])
      ],
      sessions: [
        {
          sessionId: 'session-1',
          launchId: 'launch-1',
          taskId: 'task-1',
          projectPath: 'D:\\Repo',
          projectPathNorm: 'd:/repo',
          status: 'active',
          title: null,
          observedCodexThreadId: 'child-thread'
        },
        ...(input.unrelatedController
          ? [{
              sessionId: 'session-2',
              launchId: 'launch-2',
              taskId: 'task-2',
              projectPath: 'D:\\Repo',
              projectPathNorm: 'd:/repo',
              status: 'active',
              title: null,
              observedCodexThreadId: 'other-controller-thread'
            }]
          : [])
      ]
    }
  });
}

type EdgeSelector = (
  edge: ReturnType<typeof completeGeneratedGraph>['edges'][number]
) => boolean;

const MAIN_CONTROLLER_EDGE: EdgeSelector = (edge) =>
  edge.type === 'controller-for' &&
  edge.from === 'codex-thread:child-thread' &&
  edge.to === 'codex-thread:parent-thread';

type SnapshotFieldEvidence = Extract<
  FederationEvidence,
  { kind: 'snapshot-field' }
>;

function requiredSnapshotFieldEvidence(
  edge: FederationEdge,
  field: string
): SnapshotFieldEvidence {
  const evidence = edge.evidence.find((item): item is SnapshotFieldEvidence =>
    item.kind === 'snapshot-field' && item.field === field
  );
  if (!evidence) throw new Error(`missing fixture evidence: ${field}`);
  return evidence;
}

function requiredRuntimeLinkEvidence(
  edge: FederationEdge
): Extract<FederationEvidence, { kind: 'ccpanes-runtime-link' }> {
  const evidence = edge.evidence.find((item) =>
    item.kind === 'ccpanes-runtime-link'
  );
  if (!evidence || evidence.kind !== 'ccpanes-runtime-link') {
    throw new Error('missing fixture runtime-link evidence');
  }
  return evidence;
}

function requiredTaskBindingEvidence(
  edge: FederationEdge
): Extract<FederationEvidence, { kind: 'task-binding' }> {
  const evidence = edge.evidence.find((item) => item.kind === 'task-binding');
  if (!evidence || evidence.kind !== 'task-binding') {
    throw new Error('missing fixture task-binding evidence');
  }
  return evidence;
}

function requiredDelegationEvidence(
  edge: FederationEdge
): Extract<FederationEvidence, { kind: 'delegation' }> {
  const evidence = edge.evidence.find((item) => item.kind === 'delegation');
  if (!evidence || evidence.kind !== 'delegation') {
    throw new Error('missing fixture delegation evidence');
  }
  return evidence;
}

function refreshEdgeId(edge: FederationEdge): void {
  const from = edge.from
    .replaceAll('%', '%25')
    .replaceAll('->', '%2D%3E');
  const to = edge.to
    .replaceAll('%', '%25')
    .replaceAll('->', '%2D%3E');
  edge.id = `${edge.type}:${from}->${to}`;
}

const GENERATED_EDGE_CASES = [
  ['resumed-from', (edge) => edge.type === 'resumed-from'],
  ['hosts', (edge) => edge.type === 'hosts'],
  ['launched', (edge) => edge.type === 'launched'],
  [
    'belongs-to-task session',
    (edge) => edge.type === 'belongs-to-task' &&
      edge.from.startsWith('ccpanes-session:')
  ],
  [
    'belongs-to-task Codex',
    (edge) => edge.type === 'belongs-to-task' &&
      edge.from.startsWith('codex-thread:')
  ],
  ['delegated-from', (edge) => edge.type === 'delegated-from'],
  ['controller-for', MAIN_CONTROLLER_EDGE]
] satisfies Array<[string, EdgeSelector]>;

test('strictly validates the complete generated federation shape', () => {
  expect(validateSessionFederationArtifact(validGraph())).toEqual(validGraph());
});

test('roundtrips every generated federation edge semantic shape', () => {
  const graph = completeGeneratedGraph();

  expect(graph.edges).toHaveLength(GENERATED_EDGE_CASES.length);
  expect(validateSessionFederationArtifact(graph)).toEqual(graph);
});

test.each(GENERATED_EDGE_CASES)(
  'rejects forged zero confidence for %s',
  (_name, selectEdge) => {
    const graph = completeGeneratedGraph();
    const index = graph.edges.findIndex(selectEdge);
    graph.edges[index]!.confidence = 0;

    expect(capture(() => validateSessionFederationArtifact(graph)))
      .toMatchObject({
        field: `edges[${index}].confidence`,
        reason: 'invalid-confidence'
      });
  }
);

test.each([
  [
    'resumed-from',
    GENERATED_EDGE_CASES[0][1],
    [{ kind: 'ccpanes-runtime-link', sessionId: 'session-1' }]
  ],
  [
    'hosts',
    GENERATED_EDGE_CASES[1][1],
    [{
      kind: 'snapshot-field',
      field: 'launch.resumeSessionId',
      value: 'parent-thread'
    }]
  ],
  [
    'launched',
    GENERATED_EDGE_CASES[2][1],
    [{
      kind: 'snapshot-field',
      field: 'session.taskId',
      value: 'task-1'
    }]
  ],
  [
    'belongs-to-task session',
    GENERATED_EDGE_CASES[3][1],
    [{ kind: 'task-binding', projectPath: 'd:/repo', taskId: 'task-1' }]
  ],
  [
    'belongs-to-task Codex',
    GENERATED_EDGE_CASES[4][1],
    [{
      kind: 'snapshot-field',
      field: 'session.taskId',
      value: 'task-1'
    }]
  ],
  [
    'delegated-from',
    GENERATED_EDGE_CASES[5][1],
    [{
      kind: 'snapshot-field',
      field: 'launch.resumeSessionId',
      value: 'parent-thread'
    }]
  ],
  [
    'controller-for',
    GENERATED_EDGE_CASES[6][1],
    [{ kind: 'task-binding', projectPath: 'd:/repo', taskId: 'task-1' }]
  ]
] satisfies Array<[string, EdgeSelector, Array<Record<string, unknown>>]>)(
  'rejects evidence outside the generated %s contract',
  (_name, selectEdge, evidence) => {
    const graph = completeGeneratedGraph();
    const index = graph.edges.findIndex(selectEdge);
    graph.edges[index]!.evidence =
      evidence as typeof graph.edges[number]['evidence'];

    expect(capture(() => validateSessionFederationArtifact(graph)))
      .toMatchObject({
        field: `edges[${index}].evidence`,
        reason: 'invalid-shape'
      });
  }
);

test('rejects controller evidence missing a generator-required field', () => {
  const graph = completeGeneratedGraph();
  const index = graph.edges.findIndex(GENERATED_EDGE_CASES[6][1]);
  graph.edges[index]!.evidence = graph.edges[index]!.evidence.filter((item) =>
    item.kind !== 'snapshot-field' || item.field !== 'session.launchId'
  );

  expect(capture(() => validateSessionFederationArtifact(graph)))
    .toMatchObject({
      field: `edges[${index}].evidence`,
      reason: 'invalid-shape'
    });
});

test.each([
  [
    'resumed-from to thread',
    GENERATED_EDGE_CASES[0][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-resumed-thread';
      requiredSnapshotFieldEvidence(edge, 'launch.resumeSessionId').value =
        forged;
      return forged;
    }
  ],
  [
    'hosts to thread',
    GENERATED_EDGE_CASES[1][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-hosted-thread';
      requiredSnapshotFieldEvidence(
        edge,
        'session.observedCodexThreadId'
      ).value = forged;
      return forged;
    }
  ],
  [
    'launched to session',
    GENERATED_EDGE_CASES[2][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-launched-session';
      requiredRuntimeLinkEvidence(edge).sessionId = forged;
      return forged;
    }
  ],
  [
    'belongs-to-task session to task',
    GENERATED_EDGE_CASES[3][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-session-task';
      requiredSnapshotFieldEvidence(edge, 'session.taskId').value = forged;
      return forged;
    }
  ],
  [
    'belongs-to-task Codex to task',
    GENERATED_EDGE_CASES[4][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-codex-task';
      requiredTaskBindingEvidence(edge).taskId = forged;
      return forged;
    }
  ],
  [
    'delegated-from to thread',
    GENERATED_EDGE_CASES[5][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-parent-thread';
      requiredDelegationEvidence(edge).sourceThreadId = forged;
      return forged;
    }
  ],
  [
    'controller-for to thread',
    GENERATED_EDGE_CASES[6][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-controller-target';
      requiredSnapshotFieldEvidence(edge, 'launch.resumeSessionId').value =
        forged;
      return forged;
    }
  ],
  [
    'controller-for from thread',
    GENERATED_EDGE_CASES[6][1],
    (edge: FederationEdge) => {
      const forged = 'wrong-controller-source';
      requiredSnapshotFieldEvidence(
        edge,
        'session.observedCodexThreadId'
      ).value = forged;
      return forged;
    }
  ],
  [
    'controller-for runtime session reference',
    GENERATED_EDGE_CASES[6][1],
    (edge: FederationEdge) => {
      const forged = 'missing-runtime-session';
      requiredRuntimeLinkEvidence(edge).sessionId = forged;
      return forged;
    }
  ],
  [
    'controller-for launch reference',
    GENERATED_EDGE_CASES[6][1],
    (edge: FederationEdge) => {
      const forged = 'missing-controller-launch';
      requiredSnapshotFieldEvidence(edge, 'session.launchId').value = forged;
      return forged;
    }
  ]
] satisfies Array<[
  string,
  EdgeSelector,
  (edge: FederationEdge) => string
]>)(`rejects legal evidence carrying a forged %s identity`, (
  _name,
  selectEdge,
  mutate
) => {
  const graph = completeGeneratedGraph();
  const index = graph.edges.findIndex(selectEdge);
  const forged = mutate(graph.edges[index]!);
  const error = capture(() => validateSessionFederationArtifact(graph));

  expect(error).toMatchObject({
    field: `edges[${index}].evidence`,
    reason: 'invalid-shape'
  });
  expect(error.message).not.toContain(forged);
  expect(JSON.stringify(error)).not.toContain(forged);
});

test.each([
  [
    'runtime session',
    (edge: FederationEdge) => {
      requiredRuntimeLinkEvidence(edge).sessionId = 'session-2';
    }
  ],
  [
    'launch',
    (edge: FederationEdge) => {
      requiredSnapshotFieldEvidence(edge, 'session.launchId').value =
        'launch-2';
    }
  ],
  [
    'cross-paired runtime session and launch',
    (edge: FederationEdge) => {
      requiredRuntimeLinkEvidence(edge).sessionId = 'session-2';
      requiredSnapshotFieldEvidence(edge, 'session.launchId').value =
        'launch-2';
    }
  ]
] satisfies Array<[string, (edge: FederationEdge) => void]>)(
  'rejects an unrelated existing controller %s despite valid node references',
  (_name, mutate) => {
    const graph = completeGeneratedGraph({ unrelatedController: true });
    const index = graph.edges.findIndex(MAIN_CONTROLLER_EDGE);
    mutate(graph.edges[index]!);

    expect(capture(() => validateSessionFederationArtifact(graph)))
      .toMatchObject({
        field: `edges[${index}].evidence`,
        reason: 'invalid-shape'
      });
  }
);

test('roundtrips generator node IDs containing delimiters and percent encoding', () => {
  const graph = buildSessionFederation({
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\Repo',
    codexSessions: [],
    ccpanes: {
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: '2026-08-15T08:59:00.000Z',
      launches: [{
        launchId: 'launch:encoded/value',
        projectPath: 'D:\\Repo',
        projectPathNorm: 'd:/repo',
        workspaceName: 'repo',
        cliTool: 'codex',
        resumeSessionId: 'thread:with:colon',
        launchedAt: '2026-08-15T08:58:00.000Z'
      }],
      sessions: [{
        sessionId: 'session:encoded/value',
        launchId: 'launch:encoded/value',
        taskId: 'task:encoded/value',
        projectPath: 'D:\\Repo',
        projectPathNorm: 'd:/repo',
        status: 'active',
        title: null,
        observedCodexThreadId: 'thread:with:colon'
      }]
    }
  });

  expect(graph.nodes.map((node) => node.id)).toEqual([
    'ccpanes-launch:launch%3Aencoded%2Fvalue',
    'ccpanes-session:session%3Aencoded%2Fvalue',
    'ccpanes-task:task%3Aencoded%2Fvalue',
    'codex-thread:thread%3Awith%3Acolon'
  ]);
  expect(validateSessionFederationArtifact(graph)).toEqual(graph);
});

test('rejects an unencoded node ID that does not match generator semantics', () => {
  const value = validGraph();
  setCodexNodeIdentity(value, 0, 'thread:with:colon');
  (value.nodes as Array<Record<string, unknown>>)[0]!.id =
    'codex-thread:thread:with:colon';

  expect(capture(() => validateSessionFederationArtifact(value)))
    .toMatchObject({
      field: 'nodes[0].id',
      reason: 'inconsistent-id'
    });
});

test('accepts owner-valid 512-character concrete and inferred Codex thread IDs', () => {
  const value = validGraph();
  setCodexNodeIdentity(value, 0, 'A'.repeat(512));
  setCodexNodeIdentity(value, 4, 'B'.repeat(512));

  expect(validateSessionFederationArtifact(value)).toEqual(value);
});

test('roundtrips generated 512-character Codex thread IDs from every source', () => {
  const concreteId = `A${'a'.repeat(511)}`;
  const delegatedId = `B${'b'.repeat(511)}`;
  const resumedId = `C${'c'.repeat(511)}`;
  const observedId = `D${'d'.repeat(511)}`;
  const graph = buildSessionFederation({
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\Repo',
    codexSessions: [{
      threadId: concreteId,
      source: 'codex-app',
      threadSource: 'user',
      originator: 'Codex Desktop',
      cwdRaw: 'D:\\Repo',
      cwdNorm: 'd:/repo',
      projectOwner: 'D:\\Repo',
      scopeMatch: 'exact',
      confidence: 1,
      rolloutPath: 'C:\\rollout.jsonl',
      stateDbPresent: true,
      rolloutPresent: true,
      updatedAt: '2026-08-15T08:00:00.000Z',
      firstUserPrompt: 'Work',
      lastSummary: null,
      storageState: 'active',
      runtimeScope: 'exact',
      projectRelation: 'owned',
      relationConfidence: 1,
      relationReasons: ['owned'],
      evidence: [{ kind: 'cwd', relation: 'exact' }],
      appVisibility: 'unknown',
      taskBinding: null,
      delegatedFromThreadId: delegatedId,
      primaryTargetRaw: null,
      primaryTargetNorm: null
    }],
    ccpanes: {
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: '2026-08-15T08:59:00.000Z',
      launches: [{
        launchId: 'launch-owner-limit',
        projectPath: 'D:\\Repo',
        projectPathNorm: 'd:/repo',
        workspaceName: null,
        cliTool: 'codex',
        resumeSessionId: resumedId,
        launchedAt: '2026-08-15T08:58:00.000Z'
      }],
      sessions: [{
        sessionId: 'session-owner-limit',
        launchId: 'launch-owner-limit',
        taskId: null,
        projectPath: 'D:\\Repo',
        projectPathNorm: 'd:/repo',
        status: 'active',
        title: null,
        observedCodexThreadId: observedId
      }]
    }
  });

  expect(validateSessionFederationArtifact(graph)).toEqual(graph);
});

test('roundtrips the owner maximum evidence merged into one controller edge', () => {
  const launches = Array.from({ length: 10_000 }, (_, index) => ({
    launchId: `capacity-launch-${index}`,
    projectPath: 'D:\\Repo',
    projectPathNorm: 'd:/repo',
    workspaceName: null,
    cliTool: 'codex',
    resumeSessionId: 'capacity-original-thread',
    launchedAt: '2026-08-15T08:58:00.000Z'
  }));
  const sessions = Array.from({ length: 10_000 }, (_, index) => ({
    sessionId: `capacity-session-${index}`,
    launchId: `capacity-launch-${index}`,
    taskId: null,
    projectPath: 'D:\\Repo',
    projectPathNorm: 'd:/repo',
    status: 'active',
    title: null,
    observedCodexThreadId: 'capacity-controller-thread'
  }));
  const graph = buildSessionFederation({
    generatedAt: '2026-08-15T09:00:00.000Z',
    project: 'D:\\Repo',
    codexSessions: [],
    ccpanes: {
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: '2026-08-15T08:59:00.000Z',
      launches,
      sessions
    }
  });
  const controller = graph.edges.find((edge) =>
    edge.type === 'controller-for'
  );

  expect(controller?.evidence).toHaveLength(20_002);
  expect(validateSessionFederationArtifact(graph)).toEqual(graph);
});

test('accepts the federation owner evidence capacity at the codec boundary', () => {
  const value = completeGeneratedGraph();
  const edge = value.edges.find(MAIN_CONTROLLER_EDGE)!;
  const evidence: FederationEvidence[] = [
    ...Array.from({ length: 10_000 }, () => ({
      kind: 'ccpanes-runtime-link' as const,
      sessionId: 'session-1'
    })),
    {
      kind: 'snapshot-field',
      field: 'launch.resumeSessionId',
      value: 'parent-thread'
    },
    ...Array.from({ length: 10_000 }, () => ({
      kind: 'snapshot-field' as const,
      field: 'session.launchId',
      value: 'launch-1'
    })),
    {
      kind: 'snapshot-field',
      field: 'session.observedCodexThreadId',
      value: 'child-thread'
    }
  ];
  edge.evidence = evidence;

  expect(validateSessionFederationArtifact(value)).toEqual(value);
});

test.each([
  [0, 'concrete'],
  [4, 'inferred']
] as const)('rejects 513-character %s Codex thread IDs', (nodeIndex, _kind) => {
  const value = validGraph();
  setCodexNodeIdentity(value, nodeIndex, 'A'.repeat(513));

  expect(capture(() => validateSessionFederationArtifact(value)))
    .toMatchObject({
      field: `nodes[${nodeIndex}].externalId`,
      reason: 'unsafe-identity'
    });
});

test('rejects Codex thread IDs containing owner-invalid characters', () => {
  const value = validGraph();
  setCodexNodeIdentity(value, 0, 'thread invalid');

  expect(capture(() => validateSessionFederationArtifact(value)))
    .toMatchObject({
      field: 'nodes[0].externalId',
      reason: 'unsafe-identity'
    });
});

test.each([
  '',
  ' leading',
  'trailing ',
  'thread/with/slash',
  'thread\nwith-control',
  'sk-proj-secret-shaped'
])('rejects core-invalid Codex thread ID without exposing it: %j', (threadId) => {
  expect(isCodexThreadId(threadId)).toBe(false);
  const value = validGraph();
  setCodexNodeIdentity(value, 0, threadId);

  const error = capture(() => validateSessionFederationArtifact(value));
  expect(error).toMatchObject({
    field: 'nodes[0].externalId',
    reason: 'unsafe-identity'
  });
  if (threadId) {
    expect(error.message).not.toContain(threadId);
    expect(JSON.stringify(error)).not.toContain(threadId);
  }
});

test('validates Codex thread identity before checking duplicate node IDs', () => {
  const value = validGraph();
  const nodes = value.nodes as Array<Record<string, unknown>>;
  nodes.push({
    ...structuredClone(nodes[0]!),
    externalId: 'thread invalid'
  });

  expect(capture(() => validateSessionFederationArtifact(value)))
    .toMatchObject({
      field: 'nodes[5].externalId',
      reason: 'unsafe-identity'
    });
});

test.each([
  [1, 'cliTool', null],
  [1, 'cliTool', ''],
  [2, 'status', null],
  [2, 'status', '']
] as const)(
  'rejects nullable or empty concrete attribute nodes[%s].attributes.%s',
  (nodeIndex, attribute, invalidValue) => {
    const value = validGraph();
    const node = (value.nodes as Array<Record<string, unknown>>)[nodeIndex]!;
    (node.attributes as Record<string, unknown>)[attribute] = invalidValue;

    expect(capture(() => validateSessionFederationArtifact(value)))
      .toMatchObject({
        field: `nodes[${nodeIndex}].attributes.${attribute}`,
        reason: 'unsafe-string'
      });
  }
);

test.each([
  [
    'hosts from one session',
    (edge: FederationEdge) =>
      edge.type === 'hosts' &&
      edge.from === 'ccpanes-session:session-1',
    (edge: FederationEdge) => {
      edge.to = 'codex-thread:other-controller-thread';
      requiredSnapshotFieldEvidence(
        edge,
        'session.observedCodexThreadId'
      ).value = 'other-controller-thread';
    }
  ],
  [
    'incoming launched to one session',
    (edge: FederationEdge) =>
      edge.type === 'launched' &&
      edge.to === 'ccpanes-session:session-1',
    (edge: FederationEdge) => {
      edge.from = 'ccpanes-launch:launch-2';
    }
  ],
  [
    'resumed-from from one launch',
    (edge: FederationEdge) =>
      edge.type === 'resumed-from' &&
      edge.from === 'ccpanes-launch:launch-1',
    (edge: FederationEdge) => {
      edge.to = 'codex-thread:other-parent-thread';
      requiredSnapshotFieldEvidence(edge, 'launch.resumeSessionId').value =
        'other-parent-thread';
    }
  ],
  [
    'belongs-to-task from one session',
    (edge: FederationEdge) =>
      edge.type === 'belongs-to-task' &&
      edge.from === 'ccpanes-session:session-1',
    (edge: FederationEdge) => {
      edge.to = 'ccpanes-task:task-2';
      requiredSnapshotFieldEvidence(edge, 'session.taskId').value = 'task-2';
    }
  ],
  [
    'delegated-from from one Codex thread',
    (edge: FederationEdge) =>
      edge.type === 'delegated-from' &&
      edge.from === 'codex-thread:child-thread',
    (edge: FederationEdge) => {
      edge.to = 'codex-thread:other-parent-thread';
      requiredDelegationEvidence(edge).sourceThreadId =
        'other-parent-thread';
    }
  ],
  [
    'belongs-to-task from one Codex thread',
    (edge: FederationEdge) =>
      edge.type === 'belongs-to-task' &&
      edge.from === 'codex-thread:child-thread',
    (edge: FederationEdge) => {
      edge.to = 'ccpanes-task:task-2';
      requiredTaskBindingEvidence(edge).taskId = 'task-2';
    }
  ]
] satisfies Array<[
  string,
  EdgeSelector,
  (edge: FederationEdge) => void
]>)(`rejects a second single-valued %s edge`, (
  _name,
  selectEdge,
  mutate
) => {
  const graph = completeGeneratedGraph({ unrelatedController: true });
  const conflict = structuredClone(graph.edges.find(selectEdge)!);
  mutate(conflict);
  refreshEdgeId(conflict);
  const conflictIndex = graph.edges.push(conflict) - 1;

  expect(capture(() => validateSessionFederationArtifact(graph)))
    .toMatchObject({
      field: `edges[${conflictIndex}]`,
      reason: 'invalid-shape'
    });
});

test.each([
  ['root unknown field', (value: Record<string, unknown>) => {
    value.unexpected = true;
  }, 'root', 'unknown-field'],
  ['node unknown field', (value: Record<string, unknown>) => {
    (value.nodes as Array<Record<string, unknown>>)[0]!.unexpected = true;
  }, 'nodes[0]', 'unknown-field'],
  ['concrete thread attribute', (value: Record<string, unknown>) => {
    delete ((value.nodes as Array<Record<string, unknown>>)[0]!
      .attributes as Record<string, unknown>).host;
  }, 'nodes[0].attributes.host', 'invalid-shape'],
  ['inferred placeholder', (value: Record<string, unknown>) => {
    ((value.nodes as Array<Record<string, unknown>>)[4]!
      .attributes as Record<string, unknown>).extra = true;
  }, 'nodes[4].attributes', 'unknown-field'],
  ['duplicate node ID', (value: Record<string, unknown>) => {
    (value.nodes as Array<Record<string, unknown>>).push(
      structuredClone((value.nodes as Array<Record<string, unknown>>)[0]!)
    );
  }, 'nodes', 'duplicate-id'],
  ['edge reference', (value: Record<string, unknown>) => {
    const edge = (value.edges as Array<Record<string, unknown>>)[0]!;
    edge.to = 'codex-thread:missing';
    edge.id =
      'resumed-from:ccpanes-launch:launch-1->codex-thread:missing';
  }, 'edges[0].to', 'missing-reference'],
  ['confidence', (value: Record<string, unknown>) => {
    (value.edges as Array<Record<string, unknown>>)[0]!.confidence = 1.1;
  }, 'edges[0].confidence', 'invalid-confidence'],
  ['diagnostic field', (value: Record<string, unknown>) => {
    (value.diagnostics as Array<Record<string, unknown>>)[0]!.extra = 1;
  }, 'diagnostics[0]', 'unknown-field']
] as const)('rejects %s with a privacy-safe typed error', (_name, mutate, field, reason) => {
  const value = validGraph();
  mutate(value);
  const secret = 'PRIVATE_FEDERATION_TOKEN';
  value.private = secret;

  const error = capture(() => validateSessionFederationArtifact(
    _name === 'root unknown field' ? value : (() => {
      delete value.private;
      return value;
    })()
  ));
  expect(error).toMatchObject({ field, reason });
  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('enforces federation resource limits', () => {
  const value = validGraph();
  value.nodes = Array.from({ length: 40_001 }, (_, index) => ({
    id: `codex-thread:thread-${index}`,
    type: 'codex-thread',
    externalId: `thread-${index}`,
    attributes: { inferred: true }
  }));

  expect(capture(() => validateSessionFederationArtifact(value)))
    .toMatchObject({ field: 'nodes', reason: 'capacity-exceeded' });
});
