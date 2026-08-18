import { describe, expect, test } from 'vitest';
import {
  validateCcPanesSessionSnapshot,
  type CcPanesSessionSnapshot
} from '../src/ccpanes-session-snapshot.js';
import type { CodexSessionRecord } from '../src/codex-session-index.js';
import {
  attachCcPanesAttribution,
  buildSessionFederation
} from '../src/session-federation.js';

const project = 'D:\\Repo';
const projectNorm = 'd:/repo';
const generatedAt = '2026-08-15T09:00:00.000Z';
const snapshotGeneratedAt = '2026-08-15T08:59:00.000Z';

function codexSession(
  overrides: Partial<CodexSessionRecord> = {}
): CodexSessionRecord {
  return {
    threadId: 'thread-1',
    source: 'codex-app',
    threadSource: 'user',
    originator: 'Codex Desktop',
    cwdRaw: project,
    cwdNorm: projectNorm,
    projectOwner: project,
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
    projectRelation: 'supporting',
    relationConfidence: 0.6,
    relationReasons: ['exact runtime cwd', 'no strong ownership evidence'],
    evidence: [{ kind: 'cwd', relation: 'exact' }],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null,
    ...overrides
  };
}

function snapshot(
  overrides: Partial<CcPanesSessionSnapshot> = {}
): CcPanesSessionSnapshot {
  return {
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: snapshotGeneratedAt,
    launches: [],
    sessions: [],
    ...overrides
  };
}

function controllerCapacitySnapshot(
  sessionCount: number
): CcPanesSessionSnapshot {
  const launches = Array.from({ length: 10_000 }, (_, index) => ({
    launchId: `capacity-launch-${index}`,
    projectPath: project,
    projectPathNorm: projectNorm,
    workspaceName: null,
    cliTool: 'codex',
    resumeSessionId: 'capacity-original-thread',
    launchedAt: snapshotGeneratedAt
  }));
  const sessions = Array.from({ length: sessionCount }, (_, index) => ({
    sessionId: `capacity-session-${index}`,
    launchId: `capacity-launch-${index % launches.length}`,
    taskId: null,
    projectPath: project,
    projectPathNorm: projectNorm,
    status: 'active',
    title: null,
    observedCodexThreadId: 'capacity-controller-thread'
  }));
  return snapshot({ launches, sessions });
}

describe('attachCcPanesAttribution', () => {
  test.each([
    [
      'launch.launchId',
      (secret: string) => ({
        launches: [{
          launchId: secret,
          projectPath: project,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'snapshot-privacy-thread',
          launchedAt: snapshotGeneratedAt
        }],
        sessions: []
      })
    ],
    [
      'launch.projectPath',
      (secret: string) => ({
        launches: [{
          launchId: 'snapshot-privacy-launch',
          projectPath: `${project}\\${secret}`,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'snapshot-privacy-thread',
          launchedAt: snapshotGeneratedAt
        }],
        sessions: []
      })
    ],
    [
      'session.sessionId',
      (secret: string) => ({
        launches: [],
        sessions: [{
          sessionId: secret,
          launchId: null,
          taskId: null,
          projectPath: project,
          status: 'active',
          title: null,
          observedCodexThreadId: 'snapshot-privacy-thread'
        }]
      })
    ],
    [
      'session.launchId',
      (secret: string) => ({
        launches: [],
        sessions: [{
          sessionId: 'snapshot-privacy-session',
          launchId: secret,
          taskId: null,
          projectPath: project,
          status: 'active',
          title: null,
          observedCodexThreadId: 'snapshot-privacy-thread'
        }]
      })
    ],
    [
      'session.taskId',
      (secret: string) => ({
        launches: [],
        sessions: [{
          sessionId: 'snapshot-privacy-session',
          launchId: null,
          taskId: secret,
          projectPath: project,
          status: 'active',
          title: null,
          observedCodexThreadId: 'snapshot-privacy-thread'
        }]
      })
    ],
    [
      'session.projectPath',
      (secret: string) => ({
        launches: [],
        sessions: [{
          sessionId: 'snapshot-privacy-session',
          launchId: null,
          taskId: null,
          projectPath: `${project}\\${secret}`,
          status: 'active',
          title: null,
          observedCodexThreadId: 'snapshot-privacy-thread'
        }]
      })
    ]
  ] as const)(
    'ignores an unsafe validated snapshot relationship at %s',
    (_field, relationship) => {
      const secret = `AKIA${'P'.repeat(16)}`;
      const unsafeSnapshot = validateCcPanesSessionSnapshot({
        schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
        generatedAt: snapshotGeneratedAt,
        ...relationship(secret)
      });
      const attached = attachCcPanesAttribution({
        project,
        sessions: [codexSession({
          threadId: 'snapshot-privacy-thread',
          cwdRaw: 'C:\\Other',
          cwdNorm: 'c:/other',
          projectOwner: null,
          scopeMatch: 'unknown',
          confidence: 0.2,
          runtimeScope: 'unrelated',
          projectRelation: 'unrelated',
          relationConfidence: 0,
          relationReasons: ['no project ownership evidence'],
          evidence: []
        })],
        ccpanes: unsafeSnapshot
      });

      expect(attached[0]).toMatchObject({
        projectRelation: 'unrelated',
        relationConfidence: 0,
        projectOwner: null,
        relationReasons: ['no project ownership evidence'],
        evidence: []
      });
      expect(JSON.stringify(attached)).not.toContain(secret);
    }
  );

  test.each([
    [
      'primaryTargetNorm',
      { primaryTargetNorm: 'd:/other/project' },
      'typed project conflict: primaryTargetNorm=d:/other/project'
    ],
    [
      'taskBinding.projectPathRaw',
      {
        taskBinding: {
          taskId: 'foreign-task',
          projectPathRaw: 'D:\\Other\\Project',
          worktreeRootRaw: project
        }
      },
      'typed project conflict: taskBinding.projectPathRaw=d:/other/project'
    ],
    [
      'task-binding evidence',
      {
        evidence: [{
          kind: 'task-binding',
          projectPath: 'd:/other/project',
          taskId: 'foreign-task'
        }]
      },
      'typed project conflict: evidence.task-binding.projectPath=d:/other/project'
    ],
    [
      'ccpanes-launch evidence',
      {
        evidence: [{
          kind: 'ccpanes-launch',
          projectPath: 'd:/other/project',
          launchId: 'foreign-launch'
        }]
      },
      'typed project conflict: evidence.ccpanes-launch.projectPath=d:/other/project'
    ],
    [
      'ccpanes-session evidence',
      {
        evidence: [{
          kind: 'ccpanes-session',
          projectPath: 'd:/other/project',
          sessionId: 'foreign-session'
        }]
      },
      'typed project conflict: evidence.ccpanes-session.projectPath=d:/other/project'
    ]
  ] satisfies Array<[string, Partial<CodexSessionRecord>, string]>)(
    'forces unrelated/0 when typed conflict comes from %s',
    (_source, overrides, conflictReason) => {
      const base = codexSession({
        threadId: 'conflicted-thread',
        relationReasons: ['wording is not a conflict authority'],
        ...overrides
      });
      const attached = attachCcPanesAttribution({
        project,
        sessions: [base],
        ccpanes: snapshot({
          launches: [{
            launchId: 'launch-conflict',
            projectPath: project,
            projectPathNorm: projectNorm,
            workspaceName: 'repo',
            cliTool: 'codex',
            resumeSessionId: 'conflicted-thread',
            launchedAt: '2026-08-15T08:36:14.400Z'
          }],
          sessions: [{
            sessionId: 'pty-conflict',
            launchId: 'launch-conflict',
            taskId: null,
            projectPath: project,
            projectPathNorm: projectNorm,
            status: 'active',
            title: null,
            observedCodexThreadId: 'conflicted-thread'
          }]
        })
      });

      expect(attached[0]).toMatchObject({
        projectRelation: 'unrelated',
        relationConfidence: 0,
        projectOwner: null,
        relationReasons: expect.arrayContaining([
          'wording is not a conflict authority',
          conflictReason
        ]),
        evidence: expect.arrayContaining([
          {
            kind: 'ccpanes-launch',
            projectPath: projectNorm,
            launchId: 'launch-conflict'
          },
          {
            kind: 'ccpanes-session',
            projectPath: projectNorm,
            sessionId: 'pty-conflict'
          }
        ])
      });
    }
  );

  test('does not treat legacy conflict reason text as a typed conflict', () => {
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'reason-only-thread',
        projectOwner: null,
        projectRelation: 'unrelated',
        relationConfidence: 0,
        relationReasons: ['primary target conflicts with project'],
        evidence: []
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-reason-only',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'reason-only-thread',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      projectOwner: project
    });
  });

  test('allows ownership uplift for an exact snapshot candidate path', () => {
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'exact-snapshot-thread',
        projectOwner: null,
        projectRelation: 'unrelated',
        relationConfidence: 0
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-exact-candidate',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'exact-snapshot-thread',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      projectOwner: project
    });
  });

  test('keeps an initially owned session when snapshot evidence is only descendant', () => {
    const descendantProject = `${project}\\packages\\tool`;
    const descendantProjectNorm = `${projectNorm}/packages/tool`;
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'descendant-snapshot-thread',
        projectOwner: project,
        projectRelation: 'owned',
        relationConfidence: 1,
        relationReasons: ['existing exact ownership'],
        evidence: []
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-descendant-candidate',
          projectPath: descendantProject,
          projectPathNorm: descendantProjectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'descendant-snapshot-thread',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      projectOwner: project,
      relationReasons: [
        'existing exact ownership',
        'matched compatible-project CC-Panes launch'
      ]
    });
  });

  test('keeps supporting confidence monotonic for descendant snapshot evidence', () => {
    const descendantProject = `${project}\\packages\\tool`;
    const descendantProjectNorm = `${projectNorm}/packages/tool`;
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'supporting-confidence-thread',
        projectOwner: 'd:/repo',
        projectRelation: 'supporting',
        relationConfidence: 0.95,
        relationReasons: ['existing high-confidence support'],
        evidence: []
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-supporting-confidence',
          projectPath: descendantProject,
          projectPathNorm: descendantProjectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'supporting-confidence-thread',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'supporting',
      relationConfidence: 0.95,
      projectOwner: 'd:/repo'
    });
  });

  test('promotes an unrelated session with descendant snapshot evidence to supporting', () => {
    const descendantProject = `${project}\\packages\\tool`;
    const descendantProjectNorm = `${projectNorm}/packages/tool`;
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'unrelated-descendant-snapshot-thread',
        projectOwner: null,
        projectRelation: 'unrelated',
        relationConfidence: 0,
        relationReasons: ['no project ownership evidence'],
        evidence: []
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-unrelated-descendant',
          projectPath: descendantProject,
          projectPathNorm: descendantProjectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'unrelated-descendant-snapshot-thread',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'supporting',
      relationConfidence: 0.8,
      projectOwner: project,
      relationReasons: [
        'no project ownership evidence',
        'matched compatible-project CC-Panes launch'
      ]
    });
  });

  test('forces supporting sessions with exact and foreign snapshot evidence to unrelated/0', () => {
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({ threadId: 'mixed-project-thread' })],
      ccpanes: snapshot({
        launches: [
          {
            launchId: 'launch-exact',
            projectPath: project,
            projectPathNorm: projectNorm,
            workspaceName: null,
            cliTool: 'codex',
            resumeSessionId: 'mixed-project-thread',
            launchedAt: '2026-08-15T08:36:14.400Z'
          },
          {
            launchId: 'launch-foreign',
            projectPath: 'D:\\Other',
            projectPathNorm: 'd:/other',
            workspaceName: null,
            cliTool: 'codex',
            resumeSessionId: 'mixed-project-thread',
            launchedAt: '2026-08-15T08:37:14.400Z'
          }
        ],
        sessions: [
          {
            sessionId: 'pty-exact',
            launchId: 'launch-exact',
            taskId: null,
            projectPath: project,
            projectPathNorm: projectNorm,
            status: 'active',
            title: null,
            observedCodexThreadId: 'mixed-project-thread'
          },
          {
            sessionId: 'pty-foreign',
            launchId: 'launch-foreign',
            taskId: null,
            projectPath: 'D:\\Other',
            projectPathNorm: 'd:/other',
            status: 'active',
            title: null,
            observedCodexThreadId: 'mixed-project-thread'
          }
        ]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      projectOwner: null,
      relationReasons: expect.arrayContaining([
        'matched exact-project CC-Panes launch',
        'matched foreign-project CC-Panes launch',
        'matched exact-project CC-Panes Session',
        'matched foreign-project CC-Panes Session',
        'typed project conflict: snapshot.launch.projectPathNorm=d:/other',
        'typed project conflict: snapshot.session.projectPathNorm=d:/other'
      ]),
      evidence: expect.arrayContaining([
        {
          kind: 'ccpanes-launch',
          projectPath: projectNorm,
          launchId: 'launch-exact'
        },
        {
          kind: 'ccpanes-launch',
          projectPath: 'd:/other',
          launchId: 'launch-foreign'
        },
        {
          kind: 'ccpanes-session',
          projectPath: projectNorm,
          sessionId: 'pty-exact'
        },
        {
          kind: 'ccpanes-session',
          projectPath: 'd:/other',
          sessionId: 'pty-foreign'
        }
      ])
    });
  });

  test('forces foreign-only snapshot references to unrelated/0', () => {
    const base = codexSession({ threadId: 'foreign-only-thread' });
    const attached = attachCcPanesAttribution({
      project,
      sessions: [base],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-foreign-only',
          projectPath: 'D:\\Other',
          projectPathNorm: 'd:/other',
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'foreign-only-thread',
          launchedAt: '2026-08-15T08:37:14.400Z'
        }],
        sessions: [{
          sessionId: 'pty-foreign-only',
          launchId: 'launch-foreign-only',
          taskId: null,
          projectPath: 'D:\\Other',
          projectPathNorm: 'd:/other',
          status: 'active',
          title: null,
          observedCodexThreadId: 'foreign-only-thread'
        }]
      })
    });

    expect(attached[0]).not.toBe(base);
    expect(attached[0]).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      projectOwner: null,
      relationReasons: expect.arrayContaining([
        'exact runtime cwd',
        'no strong ownership evidence',
        'matched foreign-project CC-Panes launch',
        'matched foreign-project CC-Panes Session',
        'typed project conflict: snapshot.launch.projectPathNorm=d:/other',
        'typed project conflict: snapshot.session.projectPathNorm=d:/other'
      ]),
      evidence: expect.arrayContaining([
        {
          kind: 'ccpanes-launch',
          projectPath: 'd:/other',
          launchId: 'launch-foreign-only'
        },
        {
          kind: 'ccpanes-session',
          projectPath: 'd:/other',
          sessionId: 'pty-foreign-only'
        }
      ])
    });
  });

  test('forces an owned session with a foreign snapshot reference to unrelated/0', () => {
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'owned-foreign-thread',
        projectRelation: 'owned',
        relationConfidence: 1,
        relationReasons: ['existing ownership']
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-owned-foreign',
          projectPath: 'D:\\Other',
          projectPathNorm: 'd:/other',
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'owned-foreign-thread',
          launchedAt: '2026-08-15T08:37:14.400Z'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      projectOwner: null,
      relationReasons: [
        'existing ownership',
        'matched foreign-project CC-Panes launch',
        'typed project conflict: snapshot.launch.projectPathNorm=d:/other'
      ],
      evidence: expect.arrayContaining([{
        kind: 'ccpanes-launch',
        projectPath: 'd:/other',
        launchId: 'launch-owned-foreign'
      }])
    });
  });

  test('promotes cwd-only unrelated sessions when exact thread-ID evidence exists', () => {
    const base = codexSession({
      threadId: 'cwd-unrelated-thread',
      cwdRaw: 'D:\\Other',
      cwdNorm: 'd:/other',
      projectOwner: null,
      scopeMatch: 'unknown',
      confidence: 0.2,
      runtimeScope: 'unrelated',
      projectRelation: 'unrelated',
      relationConfidence: 0,
      relationReasons: ['no project ownership evidence'],
      evidence: []
    });
    const attached = attachCcPanesAttribution({
      project,
      sessions: [base],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-cwd-unrelated',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: 'repo',
          cliTool: 'codex',
          resumeSessionId: 'cwd-unrelated-thread',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }],
        sessions: [{
          sessionId: 'pty-cwd-unrelated',
          launchId: 'launch-cwd-unrelated',
          taskId: null,
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: null,
          observedCodexThreadId: 'cwd-unrelated-thread'
        }]
      })
    });

    expect(attached[0]).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      projectOwner: project,
      relationReasons: [
        'no project ownership evidence',
        'matched exact-project CC-Panes launch',
        'matched exact-project CC-Panes Session'
      ]
    });
  });

  test('keeps exact-project launch and runtime evidence', () => {
    const base = codexSession({ threadId: 'controller-thread' });
    const exact = snapshot({
      launches: [{
        launchId: 'launch-1',
        projectPath: project,
        projectPathNorm: projectNorm,
        workspaceName: 'repo',
        cliTool: 'codex',
        resumeSessionId: 'controller-thread',
        launchedAt: '2026-08-15T08:36:14.400Z'
      }],
      sessions: [{
        sessionId: 'pty-1',
        launchId: 'launch-1',
        taskId: null,
        projectPath: project,
        projectPathNorm: projectNorm,
        status: 'active',
        title: 'repo resume',
        observedCodexThreadId: 'controller-thread'
      }]
    });

    const exactInput = [base];
    const attached = attachCcPanesAttribution({
      project,
      sessions: exactInput,
      ccpanes: exact
    });

    expect(attached).not.toBe(exactInput);
    expect(attached[0]).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      projectOwner: project,
      relationReasons: [
        'exact runtime cwd',
        'no strong ownership evidence',
        'matched exact-project CC-Panes launch',
        'matched exact-project CC-Panes Session'
      ],
      evidence: [
        { kind: 'cwd', relation: 'exact' },
        {
          kind: 'ccpanes-launch',
          projectPath: projectNorm,
          launchId: 'launch-1'
        },
        {
          kind: 'ccpanes-session',
          projectPath: projectNorm,
          sessionId: 'pty-1'
        }
      ]
    });

  });

  test('does not mutate inputs and deduplicates reasons and evidence', () => {
    const base = codexSession({
      threadId: 'thread-1',
      relationReasons: ['exact runtime cwd', 'exact runtime cwd'],
      evidence: [
        { kind: 'cwd', relation: 'exact' },
        { kind: 'cwd', relation: 'exact' },
        {
          kind: 'ccpanes-launch',
          projectPath: projectNorm,
          launchId: 'launch-1'
        }
      ]
    });
    const exact = snapshot({
      launches: [{
        launchId: 'launch-1',
        projectPath: project,
        projectPathNorm: projectNorm,
        workspaceName: null,
        cliTool: 'codex',
        resumeSessionId: 'thread-1',
        launchedAt: '2026-08-15T08:36:14.400Z'
      }],
      sessions: [{
        sessionId: 'pty-1',
        launchId: 'launch-1',
        taskId: null,
        projectPath: project,
        projectPathNorm: projectNorm,
        status: 'active',
        title: null,
        observedCodexThreadId: 'thread-1'
      }]
    });
    const beforeSession = structuredClone(base);
    const beforeSnapshot = structuredClone(exact);

    const exactInput = [base];
    const attached = attachCcPanesAttribution({
      project,
      sessions: exactInput,
      ccpanes: exact
    });

    expect(base).toEqual(beforeSession);
    expect(exact).toEqual(beforeSnapshot);
    expect(attached).not.toBe(exactInput);
    expect(attached[0]).not.toBe(base);
    expect(attached[0].relationReasons).toEqual([
      'exact runtime cwd',
      'matched exact-project CC-Panes launch',
      'matched exact-project CC-Panes Session'
    ]);
    expect(attached[0].evidence).toEqual([
      { kind: 'cwd', relation: 'exact' },
      {
        kind: 'ccpanes-launch',
        projectPath: projectNorm,
        launchId: 'launch-1'
      },
      {
        kind: 'ccpanes-session',
        projectPath: projectNorm,
        sessionId: 'pty-1'
      }
    ]);

    const withoutSnapshotInput = [base];
    const withoutSnapshot = attachCcPanesAttribution({
      project,
      sessions: withoutSnapshotInput,
      ccpanes: null
    });
    expect(withoutSnapshot).not.toBe(withoutSnapshotInput);
    expect(withoutSnapshot[0]).toMatchObject({
      projectRelation: 'supporting',
      projectOwner: project
    });
  });

  test('preserves a normalized-equivalent projectOwner without a snapshot', () => {
    const attached = attachCcPanesAttribution({
      project,
      sessions: [codexSession({
        threadId: 'preserved-owner-thread',
        projectRelation: 'supporting',
        projectOwner: 'd:/repo'
      })],
      ccpanes: null
    });

    expect(attached[0]).toMatchObject({
      threadId: 'preserved-owner-thread',
      projectRelation: 'supporting',
      projectOwner: 'd:/repo'
    });
  });

  test('rejects a Project A owner when attaching without a Project B snapshot', () => {
    let caught: unknown;
    try {
      attachCcPanesAttribution({
        project: 'D:\\Project B',
        sessions: [codexSession({
          threadId: 'attach-owner-mismatch',
          projectRelation: 'supporting',
          projectOwner: 'D:\\Project A'
        })],
        ccpanes: null
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionProjectOwnerInvariantError',
      code: 'CODEX_SESSION_PROJECT_OWNER_INVARIANT',
      threadId: 'attach-owner-mismatch',
      reason: 'owner-project-mismatch'
    });
  });

  test.each([
    [
      'missing-owner',
      {
        projectRelation: 'supporting',
        projectOwner: null
      }
    ],
    [
      'unexpected-owner',
      {
        projectRelation: 'unrelated',
        projectOwner: project
      }
    ]
  ] satisfies Array<[
    'missing-owner' | 'unexpected-owner',
    Partial<CodexSessionRecord>
  ]>)('rejects %s before attaching without a snapshot', (reason, overrides) => {
    let caught: unknown;
    try {
      attachCcPanesAttribution({
        project,
        sessions: [codexSession({
          threadId: `attach-${reason}`,
          ...overrides
        })],
        ccpanes: null
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionProjectOwnerInvariantError',
      code: 'CODEX_SESSION_PROJECT_OWNER_INVARIANT',
      threadId: `attach-${reason}`,
      reason
    });
  });
});

describe('buildSessionFederation', () => {
  test.each([
    [
      'project',
      'unsafe-project',
      (secret: string) => ({
        project: `${project}\\${secret}`,
        generatedAt
      })
    ],
    [
      'generatedAt',
      'unsafe-timestamp',
      (secret: string) => ({
        project,
        generatedAt: `2026-08-15T09:00:00.000Z-${secret}`
      })
    ]
  ] as const)(
    'rejects unsafe top-level federation %s without echoing it',
    (field, reason, invalidInput) => {
      const secret = `AKIA${'T'.repeat(16)}`;
      let caught: unknown;
      let graph: ReturnType<typeof buildSessionFederation> | undefined;
      try {
        graph = buildSessionFederation({
          ...invalidInput(secret),
          codexSessions: [],
          ccpanes: null
        });
      } catch (error) {
        caught = error;
      }

      expect(graph).toBeUndefined();
      expect(caught).toMatchObject({
        name: 'CodexSessionFederationInvariantError',
        code: 'CODEX_SESSION_FEDERATION_INVARIANT',
        field,
        reason
      });
      expect(String((caught as Error | undefined)?.message))
        .not.toContain(secret);
      expect(JSON.stringify(caught)).not.toContain(secret);
    }
  );

  test('canonicalizes a valid timezone federation timestamp before using it', () => {
    const graph = buildSessionFederation({
      generatedAt: '2026-08-15T17:00:00+08:00',
      project,
      codexSessions: [],
      ccpanes: null
    });

    expect(graph.generatedAt).toBe(generatedAt);
  });

  test('accepts owner-valid 512-character Codex thread IDs from every node source', () => {
    const concreteId = `A${'a'.repeat(511)}`;
    const delegatedId = `B${'b'.repeat(511)}`;
    const resumedId = `C${'c'.repeat(511)}`;
    const observedId = `D${'d'.repeat(511)}`;
    const validatedSnapshot = validateCcPanesSessionSnapshot({
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: snapshotGeneratedAt,
      launches: [{
        launchId: 'launch-owner-limit',
        projectPath: project,
        workspaceName: null,
        cliTool: 'codex',
        resumeSessionId: `  ${resumedId}  `,
        launchedAt: snapshotGeneratedAt
      }],
      sessions: [{
        sessionId: 'session-owner-limit',
        launchId: 'launch-owner-limit',
        taskId: null,
        projectPath: project,
        status: 'active',
        title: null,
        observedCodexThreadId: `  ${observedId}  `
      }]
    });
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [codexSession({
        threadId: concreteId,
        delegatedFromThreadId: delegatedId
      })],
      ccpanes: validatedSnapshot
    });

    expect(graph.nodes
      .filter((node) => node.type === 'codex-thread')
      .map((node) => node.externalId))
      .toEqual([concreteId, delegatedId, observedId, resumedId].sort());
  });

  test.each([
    [
      'codexSessions[0].threadId',
      () => buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [codexSession({ threadId: 'thread invalid' })],
        ccpanes: null
      })
    ],
    [
      'ccpanes.launches[0].resumeSessionId',
      () => buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [],
        ccpanes: snapshot({
          launches: [{
            launchId: 'launch-invalid-thread',
            projectPath: project,
            projectPathNorm: projectNorm,
            workspaceName: null,
            cliTool: 'codex',
            resumeSessionId: 'thread invalid',
            launchedAt: snapshotGeneratedAt
          }]
        })
      })
    ],
    [
      'ccpanes.sessions[0].observedCodexThreadId',
      () => buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [],
        ccpanes: snapshot({
          sessions: [{
            sessionId: 'session-invalid-thread',
            launchId: null,
            taskId: null,
            projectPath: project,
            projectPathNorm: projectNorm,
            status: 'active',
            title: null,
            observedCodexThreadId: 'thread invalid'
          }]
        })
      })
    ]
  ] as const)(
    'rejects owner-invalid Codex thread IDs at %s without echoing the value',
    (field, build) => {
      let caught: unknown;
      try {
        build();
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        name: 'CodexSessionFederationInvariantError',
        code: 'CODEX_SESSION_FEDERATION_INVARIANT',
        field,
        reason: 'unsafe-identity'
      });
      expect(String((caught as Error | undefined)?.message))
        .not.toContain('thread invalid');
      expect(JSON.stringify(caught)).not.toContain('thread invalid');
    }
  );

  test('rejects a Project A owner when building a Project B federation directly', () => {
    let caught: unknown;
    try {
      buildSessionFederation({
        generatedAt,
        project: 'D:\\Project B',
        codexSessions: [codexSession({
          threadId: 'builder-owner-mismatch',
          projectRelation: 'owned',
          projectOwner: 'D:\\Project A'
        })],
        ccpanes: null
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionProjectOwnerInvariantError',
      code: 'CODEX_SESSION_PROJECT_OWNER_INVARIANT',
      threadId: 'builder-owner-mismatch',
      reason: 'owner-project-mismatch'
    });
  });

  test.each([
    [
      'missing-owner',
      {
        projectRelation: 'owned',
        projectOwner: null
      }
    ],
    [
      'unexpected-owner',
      {
        projectRelation: 'ambient',
        projectOwner: project
      }
    ]
  ] satisfies Array<[
    'missing-owner' | 'unexpected-owner',
    Partial<CodexSessionRecord>
  ]>)('rejects %s before building the graph', (reason, overrides) => {
    let caught: unknown;
    try {
      buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [codexSession({
          threadId: `builder-${reason}`,
          ...overrides
        })],
        ccpanes: null
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionProjectOwnerInvariantError',
      code: 'CODEX_SESSION_PROJECT_OWNER_INVARIANT',
      threadId: `builder-${reason}`,
      reason
    });
  });

  test.each([
    [
      'ccpanes.launches[0].launchId',
      'unsafe-identity',
      (secret: string) => snapshot({
        launches: [{
          launchId: secret,
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: null,
          launchedAt: snapshotGeneratedAt
        }]
      })
    ],
    [
      'ccpanes.launches[0].resumeSessionId',
      'unsafe-identity',
      (secret: string) => snapshot({
        launches: [{
          launchId: 'launch-safe',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: secret,
          launchedAt: snapshotGeneratedAt
        }]
      })
    ],
    [
      'ccpanes.launches[0].projectPathNorm',
      'unsafe-path',
      (secret: string) => snapshot({
        launches: [{
          launchId: 'launch-safe',
          projectPath: project,
          projectPathNorm: secret,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: null,
          launchedAt: snapshotGeneratedAt
        }]
      })
    ],
    [
      'ccpanes.sessions[0].sessionId',
      'unsafe-identity',
      (secret: string) => snapshot({
        sessions: [{
          sessionId: secret,
          launchId: null,
          taskId: null,
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: null,
          observedCodexThreadId: null
        }]
      })
    ],
    [
      'ccpanes.sessions[0].launchId',
      'unsafe-identity',
      (secret: string) => snapshot({
        sessions: [{
          sessionId: 'session-safe',
          launchId: secret,
          taskId: null,
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: null,
          observedCodexThreadId: null
        }]
      })
    ],
    [
      'ccpanes.sessions[0].taskId',
      'unsafe-identity',
      (secret: string) => snapshot({
        sessions: [{
          sessionId: 'session-safe',
          launchId: null,
          taskId: secret,
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: null,
          observedCodexThreadId: null
        }]
      })
    ],
    [
      'ccpanes.sessions[0].observedCodexThreadId',
      'unsafe-identity',
      (secret: string) => snapshot({
        sessions: [{
          sessionId: 'session-safe',
          launchId: null,
          taskId: null,
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: null,
          observedCodexThreadId: secret
        }]
      })
    ],
    [
      'ccpanes.sessions[0].projectPathNorm',
      'unsafe-path',
      (secret: string) => snapshot({
        sessions: [{
          sessionId: 'session-safe',
          launchId: null,
          taskId: null,
          projectPath: project,
          projectPathNorm: secret,
          status: 'active',
          title: null,
          observedCodexThreadId: null
        }]
      })
    ]
  ] satisfies Array<[
    string,
    'unsafe-identity' | 'unsafe-path',
    (secret: string) => CcPanesSessionSnapshot
  ]>)('rejects unsafe snapshot graph field %s', (field, reason, unsafeSnapshot) => {
    const secret = `AKIA${'S'.repeat(16)}`;
    let caught: unknown;
    let graph: ReturnType<typeof buildSessionFederation> | undefined;
    try {
      graph = buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [],
        ccpanes: unsafeSnapshot(secret)
      });
    } catch (error) {
      caught = error;
    }

    expect(graph).toBeUndefined();
    expect(caught).toMatchObject({
      name: 'CodexSessionFederationInvariantError',
      code: 'CODEX_SESSION_FEDERATION_INVARIANT',
      field,
      reason
    });
    expect(String((caught as Error | undefined)?.message))
      .not.toContain(secret);
  });

  test.each([
    [
      'ccpanes.launches[0].projectPath',
      (secret: string) => ({
        schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
        generatedAt: snapshotGeneratedAt,
        launches: [{
          launchId: 'validated-launch',
          projectPath: `${project}\\${secret}`,
          workspaceName: 'repo',
          cliTool: 'codex',
          resumeSessionId: null,
          launchedAt: snapshotGeneratedAt
        }],
        sessions: []
      })
    ],
    [
      'ccpanes.sessions[0].projectPath',
      (secret: string) => ({
        schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
        generatedAt: snapshotGeneratedAt,
        launches: [],
        sessions: [{
          sessionId: 'validated-session',
          launchId: null,
          taskId: null,
          projectPath: `${project}\\${secret}`,
          status: 'active',
          title: null,
          observedCodexThreadId: null
        }]
      })
    ]
  ] as const)(
    'rejects validated raw snapshot secret at %s',
    (field, rawSnapshot) => {
      const secret = `AKIA${'R'.repeat(16)}`;
      const validated = validateCcPanesSessionSnapshot(rawSnapshot(secret));
      let caught: unknown;
      let graph: ReturnType<typeof buildSessionFederation> | undefined;
      try {
        graph = buildSessionFederation({
          generatedAt,
          project,
          codexSessions: [],
          ccpanes: validated
        });
      } catch (error) {
        caught = error;
      }

      expect(graph).toBeUndefined();
      expect(caught).toMatchObject({
        name: 'CodexSessionFederationInvariantError',
        code: 'CODEX_SESSION_FEDERATION_INVARIANT',
        field,
        reason: 'unsafe-path'
      });
      expect(String((caught as Error | undefined)?.message))
        .not.toContain(secret);
      expect(JSON.stringify(caught)).not.toContain(secret);
    }
  );

  test('sanitizes external Codex and snapshot display attributes before graph projection', () => {
    const secret = `AKIA${'D'.repeat(16)}`;
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [codexSession({
        threadId: 'display-thread',
        cwdRaw: `${project}\\${secret}`,
        cwdNorm: `${projectNorm}/${secret}`,
        updatedAt: `note ${secret}`,
        delegatedFromThreadId: 'display-parent'
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'display-launch',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: `workspace ${secret}`,
          cliTool: `codex ${secret}`,
          resumeSessionId: null,
          launchedAt: snapshotGeneratedAt
        }],
        sessions: [{
          sessionId: 'display-session',
          launchId: null,
          taskId: null,
          projectPath: project,
          projectPathNorm: projectNorm,
          status: `status ${secret}`,
          title: `title ${secret}`,
          observedCodexThreadId: null
        }]
      })
    });

    expect(JSON.stringify(graph)).not.toContain(secret);
    const thread = graph.nodes.find((node) =>
      node.type === 'codex-thread' && node.externalId === 'display-thread'
    );
    const launch = graph.nodes.find((node) =>
      node.type === 'ccpanes-launch' && node.externalId === 'display-launch'
    );
    const runtime = graph.nodes.find((node) =>
      node.type === 'ccpanes-session' && node.externalId === 'display-session'
    );
    expect(thread?.attributes.cwdNorm).toBeNull();
    expect(launch?.attributes.workspaceName).toBe('workspace [REDACTED]');
    expect(launch?.attributes.cliTool).toBe('codex [REDACTED]');
    expect(runtime?.attributes.status).toBe('status [REDACTED]');
    expect(runtime?.attributes.title).toBe('title [REDACTED]');
  });

  test('keeps legal delimiter identities collision-free and fully deterministic', () => {
    const sessions = [
      {
        sessionId: 'a',
        launchId: null,
        taskId: null,
        projectPath: project,
        projectPathNorm: projectNorm,
        status: 'active',
        title: null,
        observedCodexThreadId: 'b:codex-thread:c'
      },
      {
        sessionId: 'a->codex-thread:b',
        launchId: null,
        taskId: null,
        projectPath: project,
        projectPathNorm: projectNorm,
        status: 'active',
        title: null,
        observedCodexThreadId: 'c'
      }
    ] satisfies CcPanesSessionSnapshot['sessions'];
    const forward = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({ sessions })
    });
    const reversed = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({ sessions: [...sessions].reverse() })
    });

    expect(forward.edges.filter((edge) => edge.type === 'hosts')).toHaveLength(2);
    expect(new Set(forward.nodes.map((node) => node.id)).size)
      .toBe(forward.nodes.length);
    expect(new Set(forward.edges.map((edge) => edge.id)).size)
      .toBe(forward.edges.length);
    expect(forward.nodes.map((node) => node.id)).toEqual([
      'ccpanes-session:a',
      'ccpanes-session:a-%3Ecodex-thread%3Ab',
      'codex-thread:b%3Acodex-thread%3Ac',
      'codex-thread:c'
    ]);
    expect(forward.edges.map((edge) => edge.id)).toEqual([
      'hosts:ccpanes-session:a-%253Ecodex-thread%253Ab->codex-thread:c',
      'hosts:ccpanes-session:a->codex-thread:b%253Acodex-thread%253Ac'
    ]);
    expect(reversed).toEqual(forward);
  });

  test('links the Codex, launch, PTY Session, and Task main chain', () => {
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [codexSession({
        threadId: 'thread-old',
        projectRelation: 'owned',
        relationConfidence: 1,
        relationReasons: ['matched task binding']
      })],
      ccpanes: snapshot({
        launches: [{
          launchId: 'launch-1',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: 'repo',
          cliTool: 'codex',
          resumeSessionId: 'thread-old',
          launchedAt: '2026-08-15T08:36:14.400Z'
        }],
        sessions: [{
          sessionId: 'pty-1',
          launchId: 'launch-1',
          taskId: 'task-1',
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: 'repo resume',
          observedCodexThreadId: 'thread-old'
        }]
      })
    });

    expect(graph).toMatchObject({
      schemaVersion: 'hooks.session-federation/v1',
      generatedAt,
      project,
      diagnostics: []
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'ccpanes-launch:launch-1',
      'ccpanes-session:pty-1',
      'ccpanes-task:task-1',
      'codex-thread:thread-old'
    ]);
    expect(graph.nodes.find((node) => node.id === 'codex-thread:thread-old'))
      .toMatchObject({
        attributes: {
          host: 'codex-app',
          threadSource: 'user',
          storageState: 'active',
          projectRelation: 'owned',
          cwdNorm: projectNorm,
          updatedAt: '2026-08-15T08:00:00.000Z'
        }
      });
    expect(graph.edges).toEqual([
      {
        id: 'belongs-to-task:ccpanes-session:pty-1->ccpanes-task:task-1',
        type: 'belongs-to-task',
        from: 'ccpanes-session:pty-1',
        to: 'ccpanes-task:task-1',
        confidence: 1,
        evidence: [{
          kind: 'snapshot-field',
          field: 'session.taskId',
          value: 'task-1'
        }],
        observedAt: snapshotGeneratedAt
      },
      {
        id: 'hosts:ccpanes-session:pty-1->codex-thread:thread-old',
        type: 'hosts',
        from: 'ccpanes-session:pty-1',
        to: 'codex-thread:thread-old',
        confidence: 1,
        evidence: [{
          kind: 'snapshot-field',
          field: 'session.observedCodexThreadId',
          value: 'thread-old'
        }],
        observedAt: snapshotGeneratedAt
      },
      {
        id: 'launched:ccpanes-launch:launch-1->ccpanes-session:pty-1',
        type: 'launched',
        from: 'ccpanes-launch:launch-1',
        to: 'ccpanes-session:pty-1',
        confidence: 1,
        evidence: [{
          kind: 'ccpanes-runtime-link',
          sessionId: 'pty-1'
        }],
        observedAt: snapshotGeneratedAt
      },
      {
        id: 'resumed-from:ccpanes-launch:launch-1->codex-thread:thread-old',
        type: 'resumed-from',
        from: 'ccpanes-launch:launch-1',
        to: 'codex-thread:thread-old',
        confidence: 1,
        evidence: [{
          kind: 'snapshot-field',
          field: 'launch.resumeSessionId',
          value: 'thread-old'
        }],
        observedAt: snapshotGeneratedAt
      }
    ]);
  });

  test('creates controller-for only for an explicit differing launch/thread join', () => {
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({
        launches: [
          {
            launchId: 'launch-controller',
            projectPath: project,
            projectPathNorm: projectNorm,
            workspaceName: null,
            cliTool: 'codex',
            resumeSessionId: 'original-thread',
            launchedAt: '2026-08-15T08:30:00.000Z'
          },
          {
            launchId: 'launch-same',
            projectPath: project,
            projectPathNorm: projectNorm,
            workspaceName: null,
            cliTool: 'codex',
            resumeSessionId: 'same-thread',
            launchedAt: '2026-08-15T08:31:00.000Z'
          }
        ],
        sessions: [
          {
            sessionId: 'pty-controller',
            launchId: 'launch-controller',
            taskId: null,
            projectPath: project,
            projectPathNorm: projectNorm,
            status: 'active',
            title: null,
            observedCodexThreadId: 'controller-thread'
          },
          {
            sessionId: 'pty-same',
            launchId: 'launch-same',
            taskId: null,
            projectPath: project,
            projectPathNorm: projectNorm,
            status: 'active',
            title: null,
            observedCodexThreadId: 'same-thread'
          },
          {
            sessionId: 'pty-dangling',
            launchId: 'launch-missing',
            taskId: null,
            projectPath: project,
            projectPathNorm: projectNorm,
            status: 'active',
            title: null,
            observedCodexThreadId: 'dangling-controller'
          }
        ]
      })
    });

    expect(graph.edges.filter((edge) => edge.type === 'controller-for')).toEqual([{
      id: 'controller-for:codex-thread:controller-thread->codex-thread:original-thread',
      type: 'controller-for',
      from: 'codex-thread:controller-thread',
      to: 'codex-thread:original-thread',
      confidence: 0.9,
      evidence: [
        { kind: 'ccpanes-runtime-link', sessionId: 'pty-controller' },
        {
          kind: 'snapshot-field',
          field: 'launch.resumeSessionId',
          value: 'original-thread'
        },
        {
          kind: 'snapshot-field',
          field: 'session.launchId',
          value: 'launch-controller'
        },
        {
          kind: 'snapshot-field',
          field: 'session.observedCodexThreadId',
          value: 'controller-thread'
        }
      ],
      observedAt: snapshotGeneratedAt
    }]);
  });

  test('rejects controller evidence beyond the federation owner capacity', () => {
    let caught: unknown;
    try {
      buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [],
        ccpanes: controllerCapacitySnapshot(10_001)
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionFederationInvariantError',
      code: 'CODEX_SESSION_FEDERATION_INVARIANT',
      field: 'edges.evidence',
      reason: 'capacity-exceeded'
    });
    expect(String((caught as Error | undefined)?.message))
      .not.toContain('capacity-session-10000');
  });

  test('adds delegation and Codex task-binding edges', () => {
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [codexSession({
        threadId: 'child-thread',
        delegatedFromThreadId: 'parent-thread',
        taskBinding: {
          taskId: 'task-1',
          projectPathRaw: project,
          worktreeRootRaw: project
        }
      })],
      ccpanes: snapshot()
    });

    expect(graph.nodes.find((node) => node.id === 'codex-thread:parent-thread'))
      .toEqual({
        id: 'codex-thread:parent-thread',
        type: 'codex-thread',
        externalId: 'parent-thread',
        attributes: { inferred: true }
      });
    expect(graph.edges).toEqual(expect.arrayContaining([
      {
        id: 'delegated-from:codex-thread:child-thread->codex-thread:parent-thread',
        type: 'delegated-from',
        from: 'codex-thread:child-thread',
        to: 'codex-thread:parent-thread',
        confidence: 1,
        evidence: [{
          kind: 'delegation',
          sourceThreadId: 'parent-thread'
        }],
        observedAt: '2026-08-15T08:00:00.000Z'
      },
      {
        id: 'belongs-to-task:codex-thread:child-thread->ccpanes-task:task-1',
        type: 'belongs-to-task',
        from: 'codex-thread:child-thread',
        to: 'ccpanes-task:task-1',
        confidence: 1,
        evidence: [{
          kind: 'task-binding',
          projectPath: projectNorm,
          taskId: 'task-1'
        }],
        observedAt: '2026-08-15T08:00:00.000Z'
      }
    ]));
  });

  test('does not leak unsafe external delegation or task-binding projections', () => {
    const secret = `AKIA${'Q'.repeat(16)}`;
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [codexSession({
        threadId: 'unsafe-external-record',
        delegatedFromThreadId: `parent-${secret}`,
        taskBinding: {
          taskId: `task-${secret}`,
          projectPathRaw: `${project}\\${secret}`,
          worktreeRootRaw: `${project}\\worktrees\\${secret}`
        },
        evidence: [
          { kind: 'cwd', relation: 'exact' },
          {
            kind: 'delegation',
            sourceThreadId: `parent-${secret}`
          },
          {
            kind: 'task-binding',
            projectPath: `${projectNorm}/${secret}`,
            taskId: `task-${secret}`
          }
        ]
      })],
      ccpanes: snapshot()
    });

    expect(JSON.stringify(graph)).not.toContain(secret);
    expect(graph.nodes.some((node) =>
      node.id.includes('parent-') || node.type === 'ccpanes-task'
    )).toBe(false);
    expect(graph.edges.some((edge) =>
      edge.type === 'delegated-from' || edge.type === 'belongs-to-task'
    )).toBe(false);
  });

  test('reports missing and stale snapshots but not fresh snapshots', () => {
    expect(buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: null
    }).diagnostics).toEqual([{ kind: 'ccpanes-snapshot-missing' }]);

    expect(buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({
        generatedAt: '2026-08-13T08:00:00.000Z'
      })
    }).diagnostics).toEqual([{
      kind: 'ccpanes-snapshot-stale',
      ageMs: 176_400_000,
      maxAgeMs: 86_400_000
    }]);

    expect(buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot()
    }).diagnostics).toEqual([]);
  });

  test('reports snapshots beyond future clock skew', () => {
    expect(buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({
        generatedAt: '2026-08-15T09:05:00.001Z'
      })
    }).diagnostics).toEqual([{
      kind: 'ccpanes-snapshot-future',
      futureByMs: 300_001,
      maxFutureSkewMs: 300_000
    }]);
  });

  test('uses stale snapshot observation time for every snapshot-derived edge', () => {
    const staleObservedAt = '2026-08-13T08:00:00.000Z';
    const graph = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({
        generatedAt: staleObservedAt,
        launches: [{
          launchId: 'launch-stale',
          projectPath: project,
          projectPathNorm: projectNorm,
          workspaceName: null,
          cliTool: 'codex',
          resumeSessionId: 'original-thread',
          launchedAt: '2026-08-12T08:00:00.000Z'
        }],
        sessions: [{
          sessionId: 'pty-stale',
          launchId: 'launch-stale',
          taskId: 'task-stale',
          projectPath: project,
          projectPathNorm: projectNorm,
          status: 'active',
          title: null,
          observedCodexThreadId: 'controller-thread'
        }]
      })
    });

    const snapshotEdges = graph.edges.filter((edge) => [
      'resumed-from',
      'hosts',
      'launched',
      'belongs-to-task',
      'controller-for'
    ].includes(edge.type));
    expect(snapshotEdges).toHaveLength(5);
    expect(snapshotEdges.map((edge) => edge.observedAt))
      .toEqual(Array(5).fill(staleObservedAt));
    expect(snapshotEdges.every((edge) => edge.observedAt !== generatedAt))
      .toBe(true);
  });

  test('is input-order independent, lets concrete nodes beat inferred nodes, and merges edge evidence', () => {
    const parent = codexSession({
      threadId: 'parent-thread',
      source: 'codex-cli',
      cwdRaw: 'D:\\Repo\\parent',
      cwdNorm: 'd:/repo/parent'
    });
    const child = codexSession({
      threadId: 'child-thread',
      delegatedFromThreadId: 'parent-thread',
      taskBinding: {
        taskId: 'task-1',
        projectPathRaw: project,
        worktreeRootRaw: project
      }
    });
    const launches = [
      {
        launchId: 'launch-1',
        projectPath: project,
        projectPathNorm: projectNorm,
        workspaceName: 'repo',
        cliTool: 'codex',
        resumeSessionId: 'parent-thread',
        launchedAt: '2026-08-15T08:30:00.000Z'
      },
      {
        launchId: 'launch-2',
        projectPath: project,
        projectPathNorm: projectNorm,
        workspaceName: 'repo',
        cliTool: 'codex',
        resumeSessionId: null,
        launchedAt: '2026-08-15T08:31:00.000Z'
      }
    ] satisfies CcPanesSessionSnapshot['launches'];
    const runtimeSessions = [
      {
        sessionId: 'pty-1',
        launchId: 'launch-1',
        taskId: 'task-1',
        projectPath: project,
        projectPathNorm: projectNorm,
        status: 'active',
        title: 'controller',
        observedCodexThreadId: 'child-thread'
      },
      {
        sessionId: 'pty-2',
        launchId: 'launch-1',
        taskId: null,
        projectPath: project,
        projectPathNorm: projectNorm,
        status: 'active',
        title: null,
        observedCodexThreadId: 'child-thread'
      }
    ] satisfies CcPanesSessionSnapshot['sessions'];

    const forward = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [child, parent],
      ccpanes: snapshot({ launches, sessions: runtimeSessions })
    });
    const reversed = buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [parent, child],
      ccpanes: snapshot({
        launches: [...launches].reverse(),
        sessions: [...runtimeSessions].reverse()
      })
    });

    expect(reversed).toEqual(forward);
    expect(forward.nodes.find((node) => node.id === 'codex-thread:parent-thread'))
      .toMatchObject({
        attributes: {
          host: 'codex-cli',
          cwdNorm: 'd:/repo/parent'
        }
      });
    expect(forward.nodes.find((node) => node.id === 'codex-thread:parent-thread')
      ?.attributes).not.toHaveProperty('inferred');
    expect(forward.nodes.find((node) => node.id === 'ccpanes-task:task-1')
      ?.attributes).not.toHaveProperty('inferred');

    const taskEdge = forward.edges.find((edge) =>
      edge.id ===
        'belongs-to-task:codex-thread:child-thread->ccpanes-task:task-1'
    );
    expect(taskEdge).toMatchObject({
      confidence: 1,
      observedAt: '2026-08-15T08:00:00.000Z',
      evidence: [{
        kind: 'task-binding',
        projectPath: projectNorm,
        taskId: 'task-1'
      }]
    });

    const controllerEdge = forward.edges.find((edge) =>
      edge.id ===
        'controller-for:codex-thread:child-thread->codex-thread:parent-thread'
    );
    expect(controllerEdge).toMatchObject({
      confidence: 0.9,
      observedAt: snapshotGeneratedAt,
      evidence: [
        { kind: 'ccpanes-runtime-link', sessionId: 'pty-1' },
        { kind: 'ccpanes-runtime-link', sessionId: 'pty-2' },
        {
          kind: 'snapshot-field',
          field: 'launch.resumeSessionId',
          value: 'parent-thread'
        },
        {
          kind: 'snapshot-field',
          field: 'session.launchId',
          value: 'launch-1'
        },
        {
          kind: 'snapshot-field',
          field: 'session.observedCodexThreadId',
          value: 'child-thread'
        }
      ]
    });
  });

  test('rejects duplicate Codex thread identities before graph construction', () => {
    expect(() => buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [
        codexSession({ threadId: 'duplicate-thread' }),
        codexSession({
          threadId: 'duplicate-thread',
          source: 'codex-cli',
          cwdRaw: 'D:\\Other',
          cwdNorm: 'd:/other'
        })
      ],
      ccpanes: snapshot()
    })).toThrowError('duplicate codex threadId: duplicate-thread');
  });

  test('rejects duplicate CC-Panes launch identities independent of input order', () => {
    const duplicateLaunches = [
      {
        launchId: 'duplicate-launch',
        projectPath: project,
        projectPathNorm: projectNorm,
        workspaceName: 'repo',
        cliTool: 'codex',
        resumeSessionId: 'thread-1',
        launchedAt: '2026-08-15T08:30:00.000Z'
      },
      {
        launchId: 'duplicate-launch',
        projectPath: 'D:\\Other',
        projectPathNorm: 'd:/other',
        workspaceName: 'other',
        cliTool: 'codex',
        resumeSessionId: 'thread-2',
        launchedAt: '2026-08-15T08:31:00.000Z'
      }
    ] satisfies CcPanesSessionSnapshot['launches'];

    for (const launches of [
      duplicateLaunches,
      [...duplicateLaunches].reverse()
    ]) {
      expect(() => buildSessionFederation({
        generatedAt,
        project,
        codexSessions: [],
        ccpanes: snapshot({ launches })
      })).toThrowError('duplicate CC-Panes launchId: duplicate-launch');
    }
  });

  test('rejects duplicate CC-Panes runtime Session identities', () => {
    const duplicateRuntime = {
      sessionId: 'duplicate-session',
      launchId: null,
      taskId: null,
      projectPath: project,
      projectPathNorm: projectNorm,
      status: 'active',
      title: null,
      observedCodexThreadId: null
    } satisfies CcPanesSessionSnapshot['sessions'][number];

    expect(() => buildSessionFederation({
      generatedAt,
      project,
      codexSessions: [],
      ccpanes: snapshot({
        sessions: [
          duplicateRuntime,
          { ...duplicateRuntime, status: 'idle' }
        ]
      })
    })).toThrowError('duplicate CC-Panes sessionId: duplicate-session');
  });
});
