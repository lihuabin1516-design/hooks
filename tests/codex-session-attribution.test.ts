import { describe, expect, test } from 'vitest';
import {
  classifyProjectRelation,
  classifyRuntimeScope,
  promptMentionsProjectPath,
  summarizeProjectRelations,
  type AppVisibility,
  type AttributionInput,
  type SessionEvidence,
  type StorageState
} from '../src/codex-session-attribution.js';
import type { CodexSessionRecord } from '../src/codex-session-index.js';
import {
  filterResolvedSessions,
  type ResolveOptions
} from '../src/codex-session-resolver.js';

const project = 'D:\\cc-pane\\tool\\repos\\hooks';
const projectNorm = 'd:/cc-pane/tool/repos/hooks';

const evidenceFixture = [
  { kind: 'task-binding', projectPath: projectNorm, taskId: 'task-1' },
  { kind: 'ccpanes-launch', projectPath: projectNorm, launchId: 'launch-1' },
  { kind: 'ccpanes-session', projectPath: projectNorm, sessionId: 'session-1' },
  { kind: 'cwd', relation: 'descendant' },
  { kind: 'primary-target', target: projectNorm },
  { kind: 'prompt-mention', target: projectNorm },
  { kind: 'delegation', sourceThreadId: 'thread-parent' }
] as const satisfies readonly SessionEvidence[];
const storageStateFixture = [
  'active',
  'archived',
  'missing'
] as const satisfies readonly StorageState[];
const appVisibilityFixture = [
  'listed',
  'readable-hidden',
  'unknown'
] as const satisfies readonly AppVisibility[];
void [evidenceFixture, storageStateFixture, appVisibilityFixture];

function input(overrides: Partial<AttributionInput>): AttributionInput {
  return {
    project,
    cwdNorm: null,
    storageState: 'active',
    threadSource: 'user',
    primaryTargetNorm: null,
    promptMentionsProject: false,
    taskBinding: null,
    ccpanesLaunch: null,
    ...overrides
  };
}

describe('classifyRuntimeScope', () => {
  test.each([
    ['d:/cc-pane/tool/repos/hooks', 'exact'],
    ['d:/cc-pane/tool/repos/hooks/src', 'descendant'],
    ['d:/cc-pane', 'ancestor'],
    ['c:/other', 'unrelated'],
    [null, 'unknown']
  ] as const)('classifies %s as %s', (cwdNorm, expected) => {
    expect(classifyRuntimeScope(cwdNorm, project)).toBe(expected);
  });

  test.each([null, '', '   '])(
    'returns unknown when the project is %j',
    (missingProject) => {
      expect(classifyRuntimeScope(projectNorm, missingProject)).toBe('unknown');
    }
  );
});

describe('promptMentionsProjectPath', () => {
  test.each([
    ['Work in d:\\repo\\src today', 'D:\\Repo', true],
    ['Work in /mnt/D/REPO/src today', 'D:\\Repo', true],
    ['Work in \\\\SERVER\\SHARE\\repo\\src today', '\\\\server\\share\\Repo', true],
    ['Work in /home/User/Repo/src today', '/home/User/Repo', true],
    ['Work in /home/user/repo today', '/home/User/Repo', false],
    ['Work in D:\\Repo-tools today', 'D:\\Repo', false],
    ['Work in /mnt/d/Repository today', 'D:\\Repo', false]
  ] as const)(
    'matches prompt %j against project %j as %s',
    (prompt, promptProject, expected) => {
      expect(promptMentionsProjectPath(prompt, promptProject)).toBe(expected);
    }
  );

  test('ignores a multibyte project mention after the 64 KiB UTF-8 boundary', () => {
    const prefix = '界'.repeat(Math.ceil((64 * 1024) / 3));
    expect(promptMentionsProjectPath(
      `${prefix} D:\\Repo`,
      'D:\\Repo'
    )).toBe(false);
  });
});

describe('classifyProjectRelation', () => {
  test('keeps an ancestor cwd ambient instead of project-owned', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'd:/cc-pane'
    }))).toMatchObject({
      runtimeScope: 'ancestor',
      projectRelation: 'ambient',
      relationConfidence: 0.2,
      reasons: ['runtime cwd is only a project ancestor'],
      evidence: [{ kind: 'cwd', relation: 'ancestor' }]
    });
  });

  test('keeps prompt-only evidence mentioned instead of project-owned', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'c:/other',
      promptMentionsProject: true
    }))).toMatchObject({
      runtimeScope: 'unrelated',
      projectRelation: 'mentioned',
      relationConfidence: 0.35,
      reasons: ['prompt mentions project'],
      evidence: [{ kind: 'prompt-mention', target: projectNorm }]
    });
  });

  test('treats an exact cwd with a conflicting primary target as unrelated', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: projectNorm,
      primaryTargetNorm: `${projectNorm}-tools`
    }))).toMatchObject({
      runtimeScope: 'exact',
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: ['primary target conflicts with project'],
      evidence: [
        { kind: 'cwd', relation: 'exact' },
        { kind: 'primary-target', target: `${projectNorm}-tools` }
      ]
    });
  });

  test.each([
    projectNorm,
    `${projectNorm}/packages/tool`
  ])('raises supporting confidence for compatible primary target %s', (target) => {
    expect(classifyProjectRelation(input({
      cwdNorm: `${projectNorm}/src`,
      primaryTargetNorm: target
    }))).toMatchObject({
      runtimeScope: 'descendant',
      projectRelation: 'supporting',
      relationConfidence: 0.8,
      reasons: ['descendant runtime cwd', 'explicit target is compatible with project']
    });
  });

  test('uses an exact matched task binding as ownership evidence', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: projectNorm,
      taskBinding: {
        taskId: 'hooks-task',
        projectPathNorm: projectNorm
      }
    }))).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      reasons: ['matched task binding'],
      evidence: expect.arrayContaining([{
        kind: 'task-binding',
        projectPath: projectNorm,
        taskId: 'hooks-task'
      }])
    });
  });

  test('uses an exact matched CC-Panes launch as ownership evidence', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: 'c:/other',
      ccpanesLaunch: {
        launchId: 'launch-1',
        projectPathNorm: projectNorm
      }
    }))).toMatchObject({
      runtimeScope: 'unrelated',
      projectRelation: 'owned',
      relationConfidence: 1,
      reasons: ['matched CC-Panes launch'],
      evidence: [{
        kind: 'ccpanes-launch',
        projectPath: projectNorm,
        launchId: 'launch-1'
      }]
    });
  });

  test('accumulates reasons and evidence when task binding and launch both match', () => {
    expect(classifyProjectRelation(input({
      taskBinding: {
        taskId: 'hooks-task',
        projectPathNorm: projectNorm
      },
      ccpanesLaunch: {
        launchId: 'launch-1',
        projectPathNorm: projectNorm
      }
    }))).toMatchObject({
      projectRelation: 'owned',
      relationConfidence: 1,
      reasons: ['matched task binding', 'matched CC-Panes launch'],
      evidence: [
        {
          kind: 'task-binding',
          projectPath: projectNorm,
          taskId: 'hooks-task'
        },
        {
          kind: 'ccpanes-launch',
          projectPath: projectNorm,
          launchId: 'launch-1'
        }
      ]
    });
  });

  test('lets a conflicting primary target override an exact task binding', () => {
    expect(classifyProjectRelation(input({
      primaryTargetNorm: 'd:/other/project',
      taskBinding: {
        taskId: 'hooks-task',
        projectPathNorm: projectNorm
      }
    }))).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: expect.arrayContaining([
        'matched task binding',
        'primary target conflicts with project'
      ]),
      evidence: [
        { kind: 'primary-target', target: 'd:/other/project' },
        {
          kind: 'task-binding',
          projectPath: projectNorm,
          taskId: 'hooks-task'
        }
      ]
    });
  });

  test('lets a conflicting task binding override an exact CC-Panes launch', () => {
    expect(classifyProjectRelation(input({
      taskBinding: {
        taskId: 'other-task',
        projectPathNorm: 'd:/other/project'
      },
      ccpanesLaunch: {
        launchId: 'hooks-launch',
        projectPathNorm: projectNorm
      }
    }))).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: expect.arrayContaining([
        'matched CC-Panes launch',
        'task binding conflicts with project'
      ]),
      evidence: [
        {
          kind: 'task-binding',
          projectPath: 'd:/other/project',
          taskId: 'other-task'
        },
        {
          kind: 'ccpanes-launch',
          projectPath: projectNorm,
          launchId: 'hooks-launch'
        }
      ]
    });
  });

  test('keeps conflicting task and launch evidence and classifies unrelated', () => {
    expect(classifyProjectRelation(input({
      cwdNorm: projectNorm,
      taskBinding: {
        taskId: 'other-task',
        projectPathNorm: 'd:/other/task-project'
      },
      ccpanesLaunch: {
        launchId: 'other-launch',
        projectPathNorm: 'd:/other/launch-project'
      }
    }))).toMatchObject({
      runtimeScope: 'exact',
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: [
        'task binding conflicts with project',
        'CC-Panes launch conflicts with project'
      ],
      evidence: [
        { kind: 'cwd', relation: 'exact' },
        {
          kind: 'task-binding',
          projectPath: 'd:/other/task-project',
          taskId: 'other-task'
        },
        {
          kind: 'ccpanes-launch',
          projectPath: 'd:/other/launch-project',
          launchId: 'other-launch'
        }
      ]
    });
  });

  test.each([null, '', '   '])(
    'returns unknown for a missing project without pseudo-path comparison',
    (missingProject) => {
      expect(classifyProjectRelation(input({
        project: missingProject,
        cwdNorm: projectNorm
      }))).toEqual({
        runtimeScope: 'unknown',
        projectRelation: 'unknown',
        relationConfidence: 0.1,
        reasons: ['project path is missing'],
        evidence: []
      });
    }
  );

  test('returns unrelated for unrelated cwd and unknown when evidence is missing', () => {
    expect(classifyProjectRelation(input({ cwdNorm: 'c:/other' }))).toMatchObject({
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: ['no project ownership evidence']
    });
    expect(classifyProjectRelation(input({}))).toMatchObject({
      projectRelation: 'unknown',
      relationConfidence: 0.1,
      reasons: ['no project ownership evidence']
    });
  });
});

test('default totals exclude ambient, mentioned, archived, and subagent records', () => {
  const totals = summarizeProjectRelations([
    { projectRelation: 'owned', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'supporting', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'unrelated', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'ambient', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'mentioned', storageState: 'active', threadSource: 'user' },
    { projectRelation: 'owned', storageState: 'archived', threadSource: 'user' },
    { projectRelation: 'owned', storageState: 'active', threadSource: 'subagent' }
  ]);

  expect(totals).toEqual({
    defaultVisible: 2,
    owned: 3,
    supporting: 1,
    mentioned: 1,
    ambient: 1,
    archived: 1,
    subagents: 1
  });
});

const filterRawRecords: (
  sessions: CodexSessionRecord[],
  options?: ResolveOptions
) => CodexSessionRecord[] = filterResolvedSessions;

function sessionRecord(
  threadId: string,
  overrides: Partial<CodexSessionRecord>
): CodexSessionRecord {
  return {
    threadId,
    source: 'unknown',
    threadSource: 'user',
    originator: 'unknown',
    cwdRaw: project,
    cwdNorm: projectNorm,
    projectOwner: project,
    scopeMatch: 'exact',
    confidence: 1,
    rolloutPath: null,
    stateDbPresent: true,
    rolloutPresent: true,
    updatedAt: '2026-08-15T00:00:00.000Z',
    firstUserPrompt: null,
    lastSummary: null,
    storageState: 'active',
    runtimeScope: 'exact',
    projectRelation: 'owned',
    relationConfidence: 1,
    relationReasons: ['fixture'],
    evidence: [],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null,
    ...overrides
  };
}

describe('filterResolvedSessions', () => {
  const records = [
    sessionRecord('owned', {}),
    sessionRecord('supporting', {
      projectRelation: 'supporting',
      relationConfidence: 0.6
    }),
    sessionRecord('ambient', {
      runtimeScope: 'ancestor',
      projectRelation: 'ambient',
      relationConfidence: 0.2
    }),
    sessionRecord('mentioned', {
      runtimeScope: 'unrelated',
      projectRelation: 'mentioned',
      relationConfidence: 0.35
    }),
    sessionRecord('archived', {
      storageState: 'archived'
    }),
    sessionRecord('subagent', {
      threadSource: 'subagent'
    }),
    sessionRecord('automation', {
      threadSource: 'automation'
    }),
    sessionRecord('unknown-source', {
      threadSource: 'unknown'
    }),
    sessionRecord('missing', {
      storageState: 'missing'
    }),
    sessionRecord('unrelated', {
      runtimeScope: 'unrelated',
      projectRelation: 'unrelated',
      relationConfidence: 0
    })
  ] satisfies CodexSessionRecord[];

  test('defaults to active user-owned and supporting sessions', () => {
    expect(filterRawRecords(records).map((session) => session.threadId))
      .toEqual(['owned', 'supporting']);
  });

  test('preserves explicit broad views but always excludes unrelated sessions', () => {
    expect(filterRawRecords(records, {
      includeArchived: true,
      includeSubagents: true,
      includeRelated: true,
      includeAmbient: true
    }).map((session) => session.threadId)).toEqual([
      'owned',
      'supporting',
      'ambient',
      'mentioned',
      'archived',
      'subagent'
    ]);
  });

  test('includeSubagents permits only user and subagent thread sources', () => {
    expect(filterRawRecords(records, {
      includeSubagents: true
    }).map((session) => session.threadId)).toEqual([
      'owned',
      'supporting',
      'subagent'
    ]);
  });

  test('includeArchived permits only active and archived storage states', () => {
    expect(filterRawRecords(records, {
      includeArchived: true
    }).map((session) => session.threadId)).toEqual([
      'owned',
      'supporting',
      'archived'
    ]);
  });
});
