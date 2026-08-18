import { describe, expect, test } from 'vitest';
import {
  applySidebarPlan,
  CodexSidebarError,
  createSidebarReconciliation,
  createSidebarRollbackPlan,
  createSidebarPlan,
  digestSidebarApplyExecution,
  digestSidebarPlan,
  digestSidebarRollbackPlan,
  validateCodexAppSidebarSnapshot,
  validateSidebarHostReceipt,
  validateSidebarReconciliation,
  validateSidebarRollbackPlan,
  validateSidebarApplyResult,
  validateSidebarPlan,
  type CodexAppSidebarSnapshot,
  type SidebarHostReceipt,
  type SidebarApplyResult,
  type SidebarCandidate,
  type SidebarPlan,
  type SidebarRollbackPlan,
  type SidebarRollbackPlanDigestInput
} from '../src/codex-sidebar.js';
import { isCodexThreadId } from '../src/codex-session-identity.js';

const project = 'D:\\Repo';
const generatedAt = '2026-08-15T09:00:00.000Z';

function candidate(
  overrides: Partial<SidebarCandidate> = {}
): SidebarCandidate {
  return {
    threadId: 'thread-1',
    source: 'codex-cli',
    threadSource: 'user',
    storageState: 'active',
    projectRelation: 'owned',
    appReadable: true,
    listed: false,
    linkedLiveOrRecentLaunch: true,
    explicitlySelected: false,
    currentName: null,
    currentPinned: false,
    renameCustomized: false,
    originalTitle: 'Run task',
    ...overrides
  };
}

function captureSidebarError(run: () => unknown): CodexSidebarError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CodexSidebarError);
    return error as CodexSidebarError;
  }
  throw new Error('expected CodexSidebarError');
}

function clonePlan(plan: SidebarPlan): Record<string, unknown> {
  return structuredClone(plan) as unknown as Record<string, unknown>;
}

function refreshApplyExecutionBinding(
  result: SidebarApplyResult
): SidebarApplyResult {
  const executionDigest = digestSidebarApplyExecution(result);
  result.executionDigest = executionDigest;
  for (const pending of result.pendingHostActions) {
    pending.executionDigest = executionDigest;
  }
  return result;
}

function validApplyResult(): SidebarApplyResult {
  const planDigest = 'a'.repeat(64);
  return refreshApplyExecutionBinding({
    schemaVersion: 'hooks.codex-sidebar-apply/v1',
    generatedAt,
    planDigest,
    executionDigest: '0'.repeat(64),
    entries: [{
      threadId: 'thread-1',
      previousName: 'Preserved name',
      previousPinned: false,
      desiredName: 'Preserved name',
      finalName: 'Preserved name',
      status: 'unchanged',
      error: null
    }],
    pendingHostActions: [{
      planDigest,
      executionDigest: '0'.repeat(64),
      action: 'set-pinned',
      threadId: 'thread-1',
      pinned: true,
      previousPinned: false
    }]
  });
}

function validMultiApplyResult(): SidebarApplyResult {
  const planDigest = 'c'.repeat(64);
  return refreshApplyExecutionBinding({
    schemaVersion: 'hooks.codex-sidebar-apply/v1',
    generatedAt,
    planDigest,
    executionDigest: '0'.repeat(64),
    entries: [
      {
        threadId: 'thread-a',
        previousName: 'Alpha',
        previousPinned: false,
        desiredName: 'Alpha',
        finalName: 'Alpha',
        status: 'unchanged',
        error: null
      },
      {
        threadId: 'thread-b',
        previousName: 'Concurrent beta',
        previousPinned: true,
        desiredName: 'Planned beta',
        finalName: 'Concurrent beta',
        status: 'conflict',
        error: 'before-state-conflict'
      },
      {
        threadId: 'thread-c',
        previousName: 'Old charlie',
        previousPinned: null,
        desiredName: 'New charlie',
        finalName: 'New charlie',
        status: 'name-applied',
        error: null
      }
    ],
    pendingHostActions: [
      {
        planDigest,
        executionDigest: '0'.repeat(64),
        action: 'set-pinned',
        threadId: 'thread-a',
        pinned: true,
        previousPinned: false
      },
      {
        planDigest,
        executionDigest: '0'.repeat(64),
        action: 'set-pinned',
        threadId: 'thread-c',
        pinned: true,
        previousPinned: null
      }
    ]
  });
}

function cloneApplyResult(
  result: SidebarApplyResult
): Record<string, unknown> {
  return structuredClone(result) as unknown as Record<string, unknown>;
}

function validSidebarSnapshot(): CodexAppSidebarSnapshot {
  return {
    schemaVersion: 'hooks.codex-app-sidebar-snapshot/v1',
    generatedAt: '2026-08-15T09:01:00.000Z',
    threads: [{
      threadId: 'thread-1',
      listed: true,
      readable: true,
      pinned: true
    }]
  };
}

function validHostReceipt(): SidebarHostReceipt {
  return {
    schemaVersion: 'hooks.codex-sidebar-host-receipt/v1',
    generatedAt: '2026-08-15T09:00:30.000Z',
    planDigest: 'a'.repeat(64),
    executionDigest: 'b'.repeat(64),
    entries: [{
      threadId: 'thread-1',
      pinned: true,
      status: 'applied',
      error: null
    }]
  };
}

function executionBoundApplyResult(): SidebarApplyResult {
  const planDigest = '9'.repeat(64);
  const core = {
    schemaVersion: 'hooks.codex-sidebar-apply/v1' as const,
    generatedAt: '2026-08-15T09:00:00.000Z',
    planDigest,
    entries: [{
      threadId: 'thread-1',
      previousName: 'Before',
      previousPinned: false,
      desiredName: 'After',
      finalName: 'After',
      status: 'name-applied' as const,
      error: null
    }]
  };
  const executionDigest = digestSidebarApplyExecution(core);
  return {
    ...core,
    executionDigest,
    pendingHostActions: [{
      planDigest,
      executionDigest,
      action: 'set-pinned',
      threadId: 'thread-1',
      pinned: true,
      previousPinned: false
    }]
  } as unknown as SidebarApplyResult;
}

function executionBoundReceipt(
  applyResult: SidebarApplyResult = executionBoundApplyResult()
): SidebarHostReceipt {
  return {
    schemaVersion: 'hooks.codex-sidebar-host-receipt/v1',
    generatedAt: '2026-08-15T09:00:00.001Z',
    planDigest: applyResult.planDigest,
    executionDigest: (applyResult as unknown as {
      executionDigest: string;
    }).executionDigest,
    entries: applyResult.pendingHostActions.map((pending) => ({
      threadId: pending.threadId,
      pinned: true,
      status: 'applied',
      error: null
    }))
  } as unknown as SidebarHostReceipt;
}

describe('createSidebarPlan selection', () => {
  test('selects an active readable-hidden owned user CLI thread and excludes listed threads', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: 'cli-hidden' }),
        candidate({ threadId: 'cli-listed', listed: true }),
        candidate({
          threadId: 'app-listed',
          source: 'codex-app',
          listed: true,
          currentName: 'Visible',
          currentPinned: true,
          originalTitle: 'Visible'
        })
      ]
    });

    expect(plan).toEqual({
      schemaVersion: 'hooks.codex-sidebar-plan/v1',
      generatedAt,
      project,
      actions: [{
        threadId: 'cli-hidden',
        currentName: null,
        desiredName: '[CC-Panes] Run task',
        currentPinned: false,
        desiredPinned: true,
        nameAdapter: 'app-server',
        pinAdapter: 'codex-app-host',
        reason: 'live/recent project CLI thread is readable but hidden'
      }],
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(plan.digest).toBe(digestSidebarPlan(plan));
  });

  test('selects supporting linked threads and lets explicit selection replace only the link gate', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({
          threadId: 'supporting-linked',
          projectRelation: 'supporting'
        }),
        candidate({
          threadId: 'supporting-explicit',
          projectRelation: 'supporting',
          linkedLiveOrRecentLaunch: false,
          explicitlySelected: true
        }),
        candidate({
          threadId: 'owned-unlinked',
          linkedLiveOrRecentLaunch: false
        })
      ]
    });

    expect(plan.actions.map((action) => action.threadId)).toEqual([
      'supporting-explicit',
      'supporting-linked'
    ]);
    expect(plan.actions[0]?.reason).toBe(
      'explicitly selected active project CLI thread is readable but hidden'
    );
  });

  test.each([
    ['source', { source: 'codex-app' }],
    ['threadSource', { threadSource: 'subagent' }],
    ['storageState', { storageState: 'archived' }],
    ['mentioned relation', { projectRelation: 'mentioned' }],
    ['ambient relation', { projectRelation: 'ambient' }],
    ['unrelated relation', { projectRelation: 'unrelated' }],
    ['unknown relation', { projectRelation: 'unknown' }],
    ['readability', { appReadable: false }],
    ['listed state', { listed: true }]
  ] as const)(
    'does not let explicit selection bypass the %s gate',
    (_gate, override) => {
      const plan = createSidebarPlan({
        project,
        generatedAt,
        candidates: [candidate({
          linkedLiveOrRecentLaunch: false,
          explicitlySelected: true,
          ...override
        })]
      });

      expect(plan.actions).toEqual([]);
    }
  );

  test.each([
    ['archived', { storageState: 'archived' }],
    ['missing', { storageState: 'missing' }],
    ['subagent', { threadSource: 'subagent' }],
    ['automation', { threadSource: 'automation' }],
    ['mentioned', { projectRelation: 'mentioned' }],
    ['ambient', { projectRelation: 'ambient' }],
    ['unrelated', { projectRelation: 'unrelated' }]
  ] as const)('excludes %s candidates', (_case, override) => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate(override)]
    });

    expect(plan.actions).toEqual([]);
  });
});

describe('createSidebarPlan names and digest', () => {
  test('preserves a customized current name unless rename permission is explicit', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({
          threadId: 'preserved',
          currentName: 'My custom thread',
          renameCustomized: false,
          originalTitle: 'Generated title'
        }),
        candidate({
          threadId: 'renamed',
          currentName: 'My old custom thread',
          renameCustomized: true,
          originalTitle: 'Generated title'
        })
      ]
    });

    expect(plan.actions).toMatchObject([
      {
        threadId: 'preserved',
        currentName: 'My custom thread',
        desiredName: 'My custom thread',
        desiredPinned: true
      },
      {
        threadId: 'renamed',
        currentName: 'My old custom thread',
        desiredName: '[CC-Panes] Generated title',
        desiredPinned: true
      }
    ]);
  });

  test('normalizes empty observed names and preserves bounded names up to 512 characters', () => {
    const name121 = 'n'.repeat(121);
    const name512 = 'n'.repeat(512);
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({
          threadId: 'empty-name',
          currentName: '',
          originalTitle: 'Generated title'
        }),
        candidate({
          threadId: 'name-121',
          currentName: name121,
          originalTitle: 'Ignored title'
        }),
        candidate({
          threadId: 'name-512',
          currentName: name512,
          originalTitle: 'Ignored title'
        })
      ]
    });

    expect(plan.actions).toMatchObject([
      {
        threadId: 'empty-name',
        currentName: null,
        desiredName: '[CC-Panes] Generated title'
      },
      {
        threadId: 'name-121',
        currentName: name121,
        desiredName: name121
      },
      {
        threadId: 'name-512',
        currentName: name512,
        desiredName: name512
      }
    ]);
    expect(validateSidebarPlan(plan)).toEqual(plan);
  });

  test('sorts actions by threadId and keeps the digest independent of candidate order', () => {
    const first = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: 'thread-z', originalTitle: 'Zulu' }),
        candidate({ threadId: 'thread-a', originalTitle: 'Alpha' })
      ]
    });
    const second = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: 'thread-a', originalTitle: 'Alpha' }),
        candidate({ threadId: 'thread-z', originalTitle: 'Zulu' })
      ]
    });

    expect(first.actions.map((action) => action.threadId)).toEqual([
      'thread-a',
      'thread-z'
    ]);
    expect(second.actions).toEqual(first.actions);
    expect(second.digest).toBe(first.digest);

    const reorderedActionKeys = {
      actions: first.actions.map((action) => ({
        reason: action.reason,
        pinAdapter: action.pinAdapter,
        nameAdapter: action.nameAdapter,
        desiredPinned: action.desiredPinned,
        currentPinned: action.currentPinned,
        desiredName: action.desiredName,
        currentName: action.currentName,
        threadId: action.threadId
      })).reverse(),
      project: first.project,
      generatedAt: first.generatedAt,
      schemaVersion: first.schemaVersion
    };
    expect(digestSidebarPlan(reorderedActionKeys)).toBe(first.digest);
  });

  test('limits desired names to 120 Unicode code points without splitting a surrogate pair', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate({ originalTitle: '😀'.repeat(200) })]
    });
    const desiredName = plan.actions[0]?.desiredName ?? '';

    expect(Array.from(desiredName)).toHaveLength(120);
    expect(desiredName).toBe(`[CC-Panes] ${'😀'.repeat(109)}`);
    expect(desiredName).not.toContain('\uFFFD');
  });

  test('falls back for a secret-shaped original title without exposing the secret', () => {
    const secret = `AKIA${'P'.repeat(16)}`;
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate({ originalTitle: `Investigate ${secret}` })]
    });

    expect(plan.actions[0]?.desiredName)
      .toBe('[CC-Panes] Codex CLI thread');
    expect(JSON.stringify(plan)).not.toContain(secret);
  });

  test.each([
    ...Array.from({ length: 0x20 }, (_value, codePoint) => codePoint),
    ...Array.from(
      { length: 0x21 },
      (_value, offset) => 0x7f + offset
    )
  ])(
    'falls back for originalTitle containing C0/C1 control U+%s without leaking it',
    (codePoint) => {
      const marker = `CONTROL_SECRET_${codePoint.toString(16)}`;
      const originalTitle = `${marker}${String.fromCodePoint(codePoint)}suffix`;
      const plan = createSidebarPlan({
        project,
        generatedAt,
        candidates: [candidate({ originalTitle })]
      });

      expect(plan.actions[0]?.desiredName)
        .toBe('[CC-Panes] Codex CLI thread');
      expect(JSON.stringify(plan)).not.toContain(marker);
      expect(validateSidebarPlan(plan)).toEqual(plan);
    }
  );
});

describe('createSidebarPlan validation', () => {
  test('fails closed with typed privacy-safe errors for duplicate IDs and capacity', () => {
    const duplicate = 'thread-duplicate';
    const duplicateError = captureSidebarError(() => createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: duplicate }),
        candidate({ threadId: duplicate })
      ]
    }));

    expect(duplicateError).toMatchObject({
      code: 'CODEX_SIDEBAR',
      reason: 'duplicate-thread-id'
    });
    expect(duplicateError.message).not.toContain(duplicate);
    expect(JSON.stringify(duplicateError)).not.toContain(duplicate);

    const capacityError = captureSidebarError(() => createSidebarPlan({
      project,
      generatedAt,
      candidates: Array.from({ length: 513 }, (_value, index) =>
        candidate({ threadId: `thread-${index}` })
      )
    }));
    expect(capacityError).toMatchObject({
      code: 'CODEX_SIDEBAR',
      reason: 'capacity-exceeded',
      field: 'candidates'
    });
  });

  test('validates candidate identities before checking uniqueness', () => {
    const invalidId = 'thread id';
    const error = captureSidebarError(() => createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: invalidId }),
        candidate({ threadId: invalidId })
      ]
    }));

    expect(error).toMatchObject({
      field: 'candidates[0].threadId',
      reason: 'unsafe-identity'
    });
    expect(error.message).not.toContain(invalidId);
    expect(JSON.stringify(error)).not.toContain(invalidId);
  });

  test.each([
    '',
    ' leading',
    'trailing ',
    'thread id',
    '线程-1',
    'thread/id',
    'thread\nwith-control',
    `t${'a'.repeat(512)}`,
    'sk-proj-secret-shaped'
  ])('rejects adapter-invalid candidate thread ID %s', (threadId) => {
    expect(isCodexThreadId(threadId)).toBe(false);
    const error = captureSidebarError(() => createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate({ threadId })]
    }));

    expect(error).toMatchObject({
      field: 'candidates[0].threadId',
      reason: 'unsafe-identity'
    });
    if (threadId) {
      expect(error.message).not.toContain(threadId);
      expect(JSON.stringify(error)).not.toContain(threadId);
    }
  });

  test('accepts exactly 512 candidates and a 512-character thread ID', () => {
    const longestId = `t${'a'.repeat(511)}`;
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: longestId }),
        ...Array.from({ length: 511 }, (_value, index) =>
          candidate({ threadId: `thread-${index}` })
        )
      ]
    });

    expect(plan.actions).toHaveLength(512);
    expect(plan.actions.some((action) => action.threadId === longestId)).toBe(true);
    expect(validateSidebarPlan(plan)).toEqual(plan);
  });

  test('strictly rejects unknown create input and candidate fields', () => {
    const inputError = captureSidebarError(() => createSidebarPlan({
      project,
      generatedAt,
      candidates: [],
      unexpected: true
    } as never));
    expect(inputError).toMatchObject({
      field: 'input',
      reason: 'unknown-field'
    });

    const candidateError = captureSidebarError(() => createSidebarPlan({
      project,
      generatedAt,
      candidates: [{
        ...candidate(),
        unexpected: true
      }]
    } as never));
    expect(candidateError).toMatchObject({
      field: 'candidates[0]',
      reason: 'unknown-field'
    });
  });

  test.each([
    ['project', 'unsafe-project'],
    ['generatedAt', 'unsafe-timestamp'],
    ['candidates', 'invalid-shape']
  ] as const)(
    'rejects create input with required %s deleted',
    (deletedField, reason) => {
      const input: Record<string, unknown> = {
        project,
        generatedAt,
        candidates: []
      };
      delete input[deletedField];

      const error = captureSidebarError(() => createSidebarPlan(input as never));
      expect(error).toMatchObject({
        field: deletedField,
        reason
      });
    }
  );

  test.each([
    ['threadId', 'unsafe-identity'],
    ['source', 'invalid-enum'],
    ['threadSource', 'invalid-enum'],
    ['storageState', 'invalid-enum'],
    ['projectRelation', 'invalid-enum'],
    ['appReadable', 'invalid-shape'],
    ['listed', 'invalid-shape'],
    ['linkedLiveOrRecentLaunch', 'invalid-shape'],
    ['explicitlySelected', 'invalid-shape'],
    ['currentName', 'unsafe-name'],
    ['currentPinned', 'invalid-shape'],
    ['renameCustomized', 'invalid-shape'],
    ['originalTitle', 'invalid-shape']
  ] as const)(
    'rejects a candidate with required %s deleted',
    (deletedField, reason) => {
      const value = candidate() as unknown as Record<string, unknown>;
      delete value[deletedField];

      const error = captureSidebarError(() => createSidebarPlan({
        project,
        generatedAt,
        candidates: [value]
      } as never));
      expect(error).toMatchObject({
        field: `candidates[0].${deletedField}`,
        reason
      });
    }
  );

  test.each([
    [
      'timestamp',
      `TOKEN-${'s'.repeat(40)}`,
      (secret: string) => ({
        project,
        generatedAt: `2026-08-15T09:00:00.000Z-${secret}`,
        candidates: []
      }),
      'unsafe-timestamp'
    ],
    [
      'project',
      `AKIA${'R'.repeat(16)}`,
      (secret: string) => ({
        project: `D:\\${secret}`,
        generatedAt,
        candidates: []
      }),
      'unsafe-project'
    ],
    [
      'current name',
      `ghp_${'S'.repeat(20)}`,
      (secret: string) => ({
        project,
        generatedAt,
        candidates: [candidate({ currentName: `Name ${secret}` })]
      }),
      'unsafe-name'
    ],
    [
      'thread ID',
      'thread/id',
      (unsafeId: string) => ({
        project,
        generatedAt,
        candidates: [candidate({ threadId: unsafeId })]
      }),
      'unsafe-identity'
    ]
  ] as const)(
    'rejects an unsafe %s without exposing its raw value',
    (_case, secret, input, reason) => {
      const error = captureSidebarError(() => createSidebarPlan(input(secret)));
      expect(error.reason).toBe(reason);
      expect(error.message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  );
});

describe('validateSidebarPlan', () => {
  test('accepts a valid current-version plan', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt: '2026-08-15T17:00:00+08:00',
      candidates: [candidate()]
    });

    expect(plan.generatedAt).toBe(generatedAt);
    expect(validateSidebarPlan(structuredClone(plan))).toEqual(plan);
  });

  test('normalizes an empty observed action name to null', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const value = clonePlan(plan);
    value.actions = [{
      ...plan.actions[0],
      currentName: ''
    }];
    value.digest = digestSidebarPlan(value as never);

    expect(validateSidebarPlan(value)).toMatchObject({
      actions: [{
        currentName: null,
        desiredName: '[CC-Panes] Run task'
      }]
    });
  });

  test.each([
    ['schemaVersion', 'schemaVersion', 'unsupported-schema'],
    ['generatedAt', 'generatedAt', 'unsafe-timestamp'],
    ['project', 'project', 'unsafe-project'],
    ['actions', 'actions', 'invalid-shape'],
    ['digest', 'digest', 'invalid-digest']
  ] as const)(
    'rejects a plan with required %s deleted',
    (deletedField, field, reason) => {
      const plan = createSidebarPlan({
        project,
        generatedAt,
        candidates: [candidate()]
      });
      const value = clonePlan(plan);
      delete value[deletedField];

      const error = captureSidebarError(() => validateSidebarPlan(value));
      expect(error).toMatchObject({ field, reason });
    }
  );

  test.each([
    ['threadId', 'unsafe-identity'],
    ['currentName', 'unsafe-name'],
    ['desiredName', 'unsafe-name'],
    ['currentPinned', 'invalid-shape'],
    ['desiredPinned', 'invalid-enum'],
    ['nameAdapter', 'invalid-enum'],
    ['pinAdapter', 'invalid-enum'],
    ['reason', 'invalid-enum']
  ] as const)(
    'rejects an action with required %s deleted',
    (deletedField, reason) => {
      const plan = createSidebarPlan({
        project,
        generatedAt,
        candidates: [candidate()]
      });
      const value = clonePlan(plan);
      const action = {
        ...plan.actions[0]
      } as unknown as Record<string, unknown>;
      delete action[deletedField];
      value.actions = [action];

      const error = captureSidebarError(() => validateSidebarPlan(value));
      expect(error).toMatchObject({
        field: `actions[0].${deletedField}`,
        reason
      });
    }
  );

  test.each([
    'thread id',
    '线程-1',
    'thread/id',
    `t${'a'.repeat(512)}`
  ])('rejects adapter-invalid action thread ID %s', (threadId) => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const value = clonePlan(plan);
    value.actions = [{
      ...plan.actions[0],
      threadId
    }];

    const error = captureSidebarError(() => validateSidebarPlan(value));
    expect(error).toMatchObject({
      field: 'actions[0].threadId',
      reason: 'unsafe-identity'
    });
    expect(error.message).not.toContain(threadId);
    expect(JSON.stringify(error)).not.toContain(threadId);
  });

  test('validates action identities before checking uniqueness', () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const invalidId = '线程-1';
    const invalidAction = {
      ...plan.actions[0],
      threadId: invalidId
    };
    const value = clonePlan(plan);
    value.actions = [invalidAction, invalidAction];

    const error = captureSidebarError(() => validateSidebarPlan(value));
    expect(error).toMatchObject({
      field: 'actions[0].threadId',
      reason: 'unsafe-identity'
    });
    expect(error.message).not.toContain(invalidId);
    expect(JSON.stringify(error)).not.toContain(invalidId);
  });

  test.each([
    [
      'unknown root key',
      (plan: SidebarPlan) => ({ ...plan, unexpected: true }),
      'unknown-field'
    ],
    [
      'unknown action key',
      (plan: SidebarPlan) => ({
        ...plan,
        actions: [{ ...plan.actions[0], unexpected: true }]
      }),
      'unknown-field'
    ],
    [
      'digest mismatch',
      (plan: SidebarPlan) => ({ ...plan, digest: '0'.repeat(64) }),
      'digest-mismatch'
    ],
    [
      'duplicate thread ID',
      (plan: SidebarPlan) => ({
        ...plan,
        actions: [plan.actions[0], plan.actions[0]]
      }),
      'duplicate-thread-id'
    ],
    [
      'bad source adapter enum',
      (plan: SidebarPlan) => ({
        ...plan,
        actions: [{ ...plan.actions[0], nameAdapter: 'direct-db' }]
      }),
      'invalid-enum'
    ],
    [
      'bad reason enum',
      (plan: SidebarPlan) => ({
        ...plan,
        actions: [{ ...plan.actions[0], reason: 'raw candidate title' }]
      }),
      'invalid-enum'
    ]
  ] as const)('rejects %s', (_case, mutate, reason) => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const error = captureSidebarError(() =>
      validateSidebarPlan(mutate(plan) as unknown)
    );
    expect(error.reason).toBe(reason);
  });

  test('rejects more than 512 actions before digest acceptance', () => {
    const base = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const value = clonePlan(base);
    value.actions = Array.from({ length: 513 }, (_entry, index) => ({
      ...base.actions[0],
      threadId: `thread-${index}`
    }));

    const error = captureSidebarError(() => validateSidebarPlan(value));
    expect(error).toMatchObject({
      reason: 'capacity-exceeded',
      field: 'actions'
    });
  });

  test.each([
    [
      'source adapter',
      { nameAdapter: 'direct-db' },
      'actions[0].nameAdapter',
      'invalid-enum'
    ],
    [
      'pin adapter',
      { pinAdapter: 'app-server' },
      'actions[0].pinAdapter',
      'invalid-enum'
    ],
    [
      'desired pin',
      { desiredPinned: false },
      'actions[0].desiredPinned',
      'invalid-enum'
    ],
    [
      'current pin',
      { currentPinned: 'false' },
      'actions[0].currentPinned',
      'invalid-shape'
    ],
    [
      'current name',
      { currentName: `Name ${`AKIA${'U'.repeat(16)}`}` },
      'actions[0].currentName',
      'unsafe-name'
    ],
    [
      'secret desired name',
      { desiredName: `Name ${`AKIA${'V'.repeat(16)}`}` },
      'actions[0].desiredName',
      'unsafe-name'
    ],
    [
      '121-code-point changed desired name',
      { desiredName: 'n'.repeat(121) },
      'actions[0].desiredName',
      'unsafe-name'
    ]
  ] as const)(
    'rejects invalid action %s values',
    (_case, actionOverride, field, reason) => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const value = clonePlan(plan);
    value.actions = [{
      ...plan.actions[0],
      ...actionOverride
    }];

      const error = captureSidebarError(() => validateSidebarPlan(value));
      expect(error).toMatchObject({ field, reason });
    }
  );
});

describe('applySidebarPlan', () => {
  test('applies names sequentially, verifies each write, and emits digest-bound pin actions', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: 'thread-z', originalTitle: 'Zulu' }),
        candidate({ threadId: 'thread-a', originalTitle: 'Alpha' })
      ]
    });
    const currentNames = new Map<string, string | null>(
      plan.actions.map((action) => [action.threadId, action.currentName])
    );
    const observedNames = new Map(currentNames);
    const calls: string[] = [];

    const result = await applySidebarPlan({
      plan,
      confirmDigest: plan.digest,
      currentNames,
      setName: async (threadId, name) => {
        calls.push(`set:${threadId}:${name}`);
        observedNames.set(threadId, name);
      },
      readName: async (threadId) => {
        calls.push(`read:${threadId}`);
        return observedNames.get(threadId) ?? null;
      }
    });

    expect(calls).toEqual([
      'set:thread-a:[CC-Panes] Alpha',
      'read:thread-a',
      'set:thread-z:[CC-Panes] Zulu',
      'read:thread-z'
    ]);
    expect(result).toMatchObject({
      schemaVersion: 'hooks.codex-sidebar-apply/v1',
      planDigest: plan.digest,
      entries: [
        {
          threadId: 'thread-a',
          previousName: null,
          previousPinned: false,
          desiredName: '[CC-Panes] Alpha',
          finalName: '[CC-Panes] Alpha',
          status: 'name-applied',
          error: null
        },
        {
          threadId: 'thread-z',
          previousName: null,
          previousPinned: false,
          desiredName: '[CC-Panes] Zulu',
          finalName: '[CC-Panes] Zulu',
          status: 'name-applied',
          error: null
        }
      ],
      pendingHostActions: [
        {
          planDigest: plan.digest,
          action: 'set-pinned',
          threadId: 'thread-a',
          pinned: true,
          previousPinned: false
        },
        {
          planDigest: plan.digest,
          action: 'set-pinned',
          threadId: 'thread-z',
          pinned: true,
          previousPinned: false
        }
      ]
    });
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
    expect(validateSidebarApplyResult(result)).toEqual(result);
  });

  test('fails closed on invalid stored or confirmation digests before I/O', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    let ioCalls = 0;
    const io = {
      currentNames: new Map([['thread-1', null]]),
      setName: async () => {
        ioCalls += 1;
      },
      readName: async () => {
        ioCalls += 1;
        return null;
      }
    };

    await expect(applySidebarPlan({
      plan,
      confirmDigest: 'b'.repeat(64),
      ...io
    })).rejects.toMatchObject({
      field: 'confirmDigest',
      reason: 'digest-mismatch'
    });

    const tampered = clonePlan(plan);
    tampered.actions = [{
      ...plan.actions[0],
      desiredName: '[CC-Panes] Tampered'
    }];
    await expect(applySidebarPlan({
      plan: tampered as unknown as SidebarPlan,
      confirmDigest: plan.digest,
      ...io
    })).rejects.toMatchObject({
      field: 'digest',
      reason: 'digest-mismatch'
    });

    await expect(applySidebarPlan({
      plan: { ...plan, unexpected: true } as unknown as SidebarPlan,
      confirmDigest: plan.digest,
      ...io
    })).rejects.toMatchObject({
      field: 'root',
      reason: 'unknown-field'
    });
    expect(ioCalls).toBe(0);
  });

  test('detects missing and conflicting before-state while treating desired names as unchanged', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: 'conflict', currentName: 'Planned' }),
        candidate({ threadId: 'missing', currentName: 'Planned' }),
        candidate({ threadId: 'unchanged', currentName: 'Planned' })
      ]
    });
    let ioCalls = 0;

    const result = await applySidebarPlan({
      plan,
      confirmDigest: plan.digest,
      currentNames: new Map([
        ['conflict', 'Concurrent name'],
        ['unchanged', 'Planned']
      ]),
      setName: async () => {
        ioCalls += 1;
      },
      readName: async () => {
        ioCalls += 1;
        return null;
      }
    });

    expect(ioCalls).toBe(0);
    expect(result.entries).toEqual([
      {
        threadId: 'conflict',
        previousName: 'Concurrent name',
        previousPinned: false,
        desiredName: 'Planned',
        finalName: 'Concurrent name',
        status: 'conflict',
        error: 'before-state-conflict'
      },
      {
        threadId: 'missing',
        previousName: null,
        previousPinned: false,
        desiredName: 'Planned',
        finalName: null,
        status: 'thread-missing',
        error: 'thread-missing'
      },
      {
        threadId: 'unchanged',
        previousName: 'Planned',
        previousPinned: false,
        desiredName: 'Planned',
        finalName: 'Planned',
        status: 'unchanged',
        error: null
      }
    ]);
    expect(result.pendingHostActions).toEqual([{
      planDigest: plan.digest,
      executionDigest: result.executionDigest,
      action: 'set-pinned',
      threadId: 'unchanged',
      pinned: true,
      previousPinned: false
    }]);
  });

  test('uses one immutable presence and name snapshot across asynchronous actions', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [
        candidate({ threadId: 'thread-a', originalTitle: 'Alpha' }),
        candidate({ threadId: 'thread-b', originalTitle: 'Beta' }),
        candidate({ threadId: 'thread-c', originalTitle: 'Charlie' })
      ]
    });
    const currentNames = new Map<string, string | null>([
      ['thread-a', null],
      ['thread-b', null]
    ]);
    const observedNames = new Map<string, string | null>();
    const calls: string[] = [];

    const result = await applySidebarPlan({
      plan,
      confirmDigest: plan.digest,
      currentNames,
      setName: async (threadId, name) => {
        calls.push(`set:${threadId}`);
        observedNames.set(threadId, name);
        if (threadId === 'thread-a') {
          currentNames.delete('thread-b');
        }
      },
      readName: async (threadId) => {
        calls.push(`read:${threadId}`);
        if (threadId === 'thread-a') {
          currentNames.set('thread-c', null);
        }
        return observedNames.get(threadId) ?? null;
      }
    });

    expect(calls).toEqual([
      'set:thread-a',
      'read:thread-a',
      'set:thread-b',
      'read:thread-b'
    ]);
    expect(result.entries).toMatchObject([
      {
        threadId: 'thread-a',
        previousName: null,
        status: 'name-applied'
      },
      {
        threadId: 'thread-b',
        previousName: null,
        status: 'name-applied'
      },
      {
        threadId: 'thread-c',
        previousName: null,
        finalName: null,
        status: 'thread-missing',
        error: 'thread-missing'
      }
    ]);
    expect(result.pendingHostActions.map((action) => action.threadId))
      .toEqual(['thread-a', 'thread-b']);
  });

  test('treats invalid reread values as privacy-safe unknown outcomes', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate({
        currentName: 'Before',
        renameCustomized: true,
        originalTitle: 'After'
      })]
    });
    const secret = `AKIA${'Z'.repeat(16)}`;
    const cases: Array<{
      label: string;
      value: unknown;
      sensitiveMarker?: string;
    }> = [
      { label: 'undefined', value: undefined },
      {
        label: 'object',
        value: { raw: 'OBJECT_REREAD_SECRET' },
        sensitiveMarker: 'OBJECT_REREAD_SECRET'
      },
      {
        label: 'overlong string',
        value: `OVERLONG_REREAD_SECRET_${'x'.repeat(513)}`,
        sensitiveMarker: 'OVERLONG_REREAD_SECRET'
      },
      {
        label: 'C0 string',
        value: 'C0_REREAD_SECRET\u0000suffix',
        sensitiveMarker: 'C0_REREAD_SECRET'
      },
      {
        label: 'C1 string',
        value: 'C1_REREAD_SECRET\u0085suffix',
        sensitiveMarker: 'C1_REREAD_SECRET'
      },
      {
        label: 'secret-shaped string',
        value: `Name ${secret}`,
        sensitiveMarker: secret
      }
    ];

    for (const item of cases) {
      const result = await applySidebarPlan({
        plan,
        confirmDigest: plan.digest,
        currentNames: new Map([['thread-1', 'Before']]),
        setName: async () => {},
        readName: async () => item.value
      });

      expect(result.entries[0], item.label).toMatchObject({
        previousName: 'Before',
        finalName: null,
        status: 'unknown',
        error: 'name-outcome-unknown'
      });
      expect(result.pendingHostActions, item.label).toEqual([]);
      if (item.sensitiveMarker) {
        expect(JSON.stringify(result), item.label)
          .not.toContain(item.sensitiveMarker);
        expect(result.entries[0]?.error, item.label)
          .not.toContain(item.sensitiveMarker);
      }
    }
  });

  test('reconciles thrown writes by rereading without exposing dependency errors', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate({
        currentName: 'Before',
        renameCustomized: true,
        originalTitle: 'After'
      })]
    });
    const secret = `TOKEN-${'s'.repeat(40)}`;
    const desiredName = plan.actions[0]?.desiredName ?? '';
    const cases: Array<{
      readName: () => Promise<string | null>;
      status: 'name-applied' | 'failed' | 'unknown';
      finalName: string | null;
      error: string | null;
    }> = [
      {
        readName: async () => desiredName,
        status: 'name-applied',
        finalName: desiredName,
        error: null
      },
      {
        readName: async () => 'Before',
        status: 'failed',
        finalName: 'Before',
        error: 'name-not-applied'
      },
      {
        readName: async () => 'Third value',
        status: 'unknown',
        finalName: 'Third value',
        error: 'name-outcome-unknown'
      },
      {
        readName: async () => {
          throw new Error(`thread disappeared ${secret}`);
        },
        status: 'unknown',
        finalName: null,
        error: 'name-outcome-unknown'
      }
    ];

    for (const item of cases) {
      let reads = 0;
      const result = await applySidebarPlan({
        plan,
        confirmDigest: plan.digest,
        currentNames: new Map([['thread-1', 'Before']]),
        setName: async () => {
          throw new Error(`timeout ${secret}`);
        },
        readName: async () => {
          reads += 1;
          return item.readName();
        }
      });

      expect(reads).toBe(1);
      expect(result.entries[0]).toMatchObject({
        status: item.status,
        finalName: item.finalName,
        error: item.error
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.pendingHostActions).toHaveLength(
        item.status === 'name-applied' ? 1 : 0
      );
    }
  });

  test('classifies a verified previous value as failed and a third value as unknown after a resolved write', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate({
        currentName: 'Before',
        renameCustomized: true,
        originalTitle: 'After'
      })]
    });

    for (const [readValue, status, error] of [
      ['Before', 'failed', 'name-not-applied'],
      ['Concurrent after write', 'unknown', 'name-outcome-unknown']
    ] as const) {
      const result = await applySidebarPlan({
        plan,
        confirmDigest: plan.digest,
        currentNames: new Map([['thread-1', 'Before']]),
        setName: async () => {},
        readName: async () => readValue
      });

      expect(result.entries[0]).toMatchObject({
        finalName: readValue,
        status,
        error
      });
      expect(result.pendingHostActions).toEqual([]);
    }
  });
});

describe('validateSidebarApplyResult', () => {
  test('accepts a valid result and a preserved 512-character desired name', () => {
    const result = validApplyResult();
    const longName = 'n'.repeat(512);
    result.entries[0] = {
      ...result.entries[0]!,
      previousName: longName,
      desiredName: longName,
      finalName: longName
    };
    refreshApplyExecutionBinding(result);

    expect(validateSidebarApplyResult(structuredClone(result))).toEqual(result);
  });

  test('accepts valid unknown-null and long preserved conflict semantics', () => {
    const unknown = validApplyResult();
    unknown.entries[0] = {
      ...unknown.entries[0]!,
      previousName: null,
      desiredName: 'Desired name',
      finalName: null,
      status: 'unknown',
      error: 'name-outcome-unknown'
    };
    unknown.pendingHostActions = [];
    refreshApplyExecutionBinding(unknown);
    expect(validateSidebarApplyResult(structuredClone(unknown)))
      .toEqual(unknown);

    const conflict = validApplyResult();
    const longPreservedName = 'n'.repeat(512);
    conflict.entries[0] = {
      ...conflict.entries[0]!,
      previousName: 'Concurrent name',
      desiredName: longPreservedName,
      finalName: 'Concurrent name',
      status: 'conflict',
      error: 'before-state-conflict'
    };
    conflict.pendingHostActions = [];
    refreshApplyExecutionBinding(conflict);
    expect(validateSidebarApplyResult(structuredClone(conflict)))
      .toEqual(conflict);
  });

  test.each([
    [
      'unchanged with a different previous name',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: 'After',
        status: 'unchanged',
        error: null
      }
    ],
    [
      'unchanged with a different final name',
      {
        previousName: 'Same',
        desiredName: 'Same',
        finalName: 'Different',
        status: 'unchanged',
        error: null
      }
    ],
    [
      'name-applied with an already desired previous name',
      {
        previousName: 'Same',
        desiredName: 'Same',
        finalName: 'Same',
        status: 'name-applied',
        error: null
      }
    ],
    [
      'name-applied without the desired final name',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: 'Third',
        status: 'name-applied',
        error: null
      }
    ],
    [
      'thread-missing with a previous name',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: null,
        status: 'thread-missing',
        error: 'thread-missing'
      }
    ],
    [
      'thread-missing with a final name',
      {
        previousName: null,
        desiredName: 'After',
        finalName: 'Observed',
        status: 'thread-missing',
        error: 'thread-missing'
      }
    ],
    [
      'conflict whose final name differs from the previous name',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: 'Third',
        status: 'conflict',
        error: 'before-state-conflict'
      }
    ],
    [
      'conflict whose previous name is already desired',
      {
        previousName: 'Same',
        desiredName: 'Same',
        finalName: 'Same',
        status: 'conflict',
        error: 'before-state-conflict'
      }
    ],
    [
      'failed whose final name differs from the previous name',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: 'Third',
        status: 'failed',
        error: 'name-not-applied'
      }
    ],
    [
      'failed whose previous name is already desired',
      {
        previousName: 'Same',
        desiredName: 'Same',
        finalName: 'Same',
        status: 'failed',
        error: 'name-not-applied'
      }
    ],
    [
      'unknown whose final name is desired',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: 'After',
        status: 'unknown',
        error: 'name-outcome-unknown'
      }
    ],
    [
      'unknown whose non-null final name is previous',
      {
        previousName: 'Before',
        desiredName: 'After',
        finalName: 'Before',
        status: 'unknown',
        error: 'name-outcome-unknown'
      }
    ],
    [
      'unknown whose previous name is already desired',
      {
        previousName: 'Same',
        desiredName: 'Same',
        finalName: null,
        status: 'unknown',
        error: 'name-outcome-unknown'
      }
    ]
  ] as const)('rejects impossible %s semantics', (_case, entryOverride) => {
    const value = cloneApplyResult(validApplyResult());
    const entries = value.entries as Array<Record<string, unknown>>;
    entries[0] = {
      ...entries[0],
      ...entryOverride
    };
    if (
      entryOverride.status !== 'unchanged' &&
      entryOverride.status !== 'name-applied'
    ) {
      value.pendingHostActions = [];
    }

    expect(captureSidebarError(() => validateSidebarApplyResult(value)))
      .toMatchObject({
        field: 'entries[0]',
        reason: 'inconsistent-result'
      });
  });

  test('rejects missing pending actions for confirmed entries', () => {
    const value = cloneApplyResult(validMultiApplyResult());
    const pending = value.pendingHostActions as unknown[];
    pending.pop();

    expect(captureSidebarError(() => validateSidebarApplyResult(value)))
      .toMatchObject({
        field: 'pendingHostActions',
        reason: 'inconsistent-result'
      });
  });

  test('rejects extra pending actions for unconfirmed entries', () => {
    const value = cloneApplyResult(validMultiApplyResult());
    const pending = value.pendingHostActions as Array<Record<string, unknown>>;
    pending.push({
      planDigest: value.planDigest,
      executionDigest: value.executionDigest,
      action: 'set-pinned',
      threadId: 'thread-b',
      pinned: true,
      previousPinned: true
    });

    expect(captureSidebarError(() => validateSidebarApplyResult(value)))
      .toMatchObject({
        field: 'pendingHostActions',
        reason: 'inconsistent-result'
      });
  });

  test('rejects pending actions in a different order from confirmed entries', () => {
    const value = cloneApplyResult(validMultiApplyResult());
    const pending = value.pendingHostActions as unknown[];
    pending.reverse();

    expect(captureSidebarError(() => validateSidebarApplyResult(value)))
      .toMatchObject({
        field: 'pendingHostActions[0]',
        reason: 'inconsistent-result'
      });
  });

  test.each([
    ['root', (value: Record<string, unknown>) => {
      value.unexpected = true;
    }, 'root'],
    ['entry', (value: Record<string, unknown>) => {
      const entries = value.entries as Array<Record<string, unknown>>;
      entries[0]!.unexpected = true;
    }, 'entries[0]'],
    ['pending action', (value: Record<string, unknown>) => {
      const pending = value.pendingHostActions as Array<Record<string, unknown>>;
      pending[0]!.unexpected = true;
    }, 'pendingHostActions[0]']
  ] as const)('rejects an unknown %s field', (_case, mutate, field) => {
    const value = cloneApplyResult(validApplyResult());
    mutate(value);

    expect(captureSidebarError(() => validateSidebarApplyResult(value)))
      .toMatchObject({ field, reason: 'unknown-field' });
  });

  test.each([
    ['schemaVersion', 'schemaVersion', 'unsupported-schema'],
    ['generatedAt', 'generatedAt', 'unsafe-timestamp'],
    ['planDigest', 'planDigest', 'invalid-digest'],
    ['executionDigest', 'executionDigest', 'invalid-digest'],
    ['entries', 'entries', 'invalid-shape'],
    ['pendingHostActions', 'pendingHostActions', 'invalid-shape']
  ] as const)(
    'rejects a result with required %s deleted',
    (deletedField, field, reason) => {
      const value = cloneApplyResult(validApplyResult());
      delete value[deletedField];

      expect(captureSidebarError(() => validateSidebarApplyResult(value)))
        .toMatchObject({ field, reason });
    }
  );

  test.each([
    ['threadId', 'unsafe-identity'],
    ['previousName', 'unsafe-name'],
    ['previousPinned', 'invalid-shape'],
    ['desiredName', 'unsafe-name'],
    ['finalName', 'unsafe-name'],
    ['status', 'invalid-enum'],
    ['error', 'invalid-enum']
  ] as const)(
    'rejects an entry with required %s deleted',
    (deletedField, reason) => {
      const value = cloneApplyResult(validApplyResult());
      const entries = value.entries as Array<Record<string, unknown>>;
      delete entries[0]![deletedField];

      expect(captureSidebarError(() => validateSidebarApplyResult(value)))
        .toMatchObject({
          field: `entries[0].${deletedField}`,
          reason
        });
    }
  );

  test.each([
    ['planDigest', 'invalid-digest'],
    ['executionDigest', 'invalid-digest'],
    ['action', 'invalid-enum'],
    ['threadId', 'unsafe-identity'],
    ['pinned', 'invalid-enum'],
    ['previousPinned', 'invalid-shape']
  ] as const)(
    'rejects a pending action with required %s deleted',
    (deletedField, reason) => {
      const value = cloneApplyResult(validApplyResult());
      const pending = value.pendingHostActions as Array<Record<string, unknown>>;
      delete pending[0]![deletedField];

      expect(captureSidebarError(() => validateSidebarApplyResult(value)))
        .toMatchObject({
          field: `pendingHostActions[0].${deletedField}`,
          reason
        });
    }
  );

  test('rejects invalid enums, timestamps, digests, and inconsistent pending actions', () => {
    const mutations: Array<{
      mutate: (value: Record<string, unknown>) => void;
      field: string;
      reason: string;
    }> = [
      {
        mutate: (value) => {
          value.schemaVersion = 'hooks.codex-sidebar-apply/v2';
        },
        field: 'schemaVersion',
        reason: 'unsupported-schema'
      },
      {
        mutate: (value) => {
          value.generatedAt = 'not-a-timestamp';
        },
        field: 'generatedAt',
        reason: 'unsafe-timestamp'
      },
      {
        mutate: (value) => {
          value.planDigest = 'not-a-digest';
        },
        field: 'planDigest',
        reason: 'invalid-digest'
      },
      {
        mutate: (value) => {
          const entries = value.entries as Array<Record<string, unknown>>;
          entries[0]!.status = 'applied';
        },
        field: 'entries[0].status',
        reason: 'invalid-enum'
      },
      {
        mutate: (value) => {
          const entries = value.entries as Array<Record<string, unknown>>;
          entries[0]!.error = 'raw dependency error';
        },
        field: 'entries[0].error',
        reason: 'invalid-enum'
      },
      {
        mutate: (value) => {
          const pending = value.pendingHostActions as Array<Record<string, unknown>>;
          pending[0]!.planDigest = 'b'.repeat(64);
        },
        field: 'pendingHostActions[0].planDigest',
        reason: 'digest-mismatch'
      },
      {
        mutate: (value) => {
          const entries = value.entries as Array<Record<string, unknown>>;
          entries[0] = {
            ...entries[0],
            previousName: 'Concurrent name',
            desiredName: 'Planned name',
            finalName: 'Concurrent name',
            status: 'conflict',
            error: 'before-state-conflict'
          };
          refreshApplyExecutionBinding(value as unknown as SidebarApplyResult);
        },
        field: 'pendingHostActions',
        reason: 'inconsistent-result'
      }
    ];

    for (const item of mutations) {
      const value = cloneApplyResult(validApplyResult());
      item.mutate(value);
      expect(captureSidebarError(() => validateSidebarApplyResult(value)))
        .toMatchObject({ field: item.field, reason: item.reason });
    }
  });

  test('rejects duplicate IDs and capacities above 512', () => {
    const duplicateEntries = cloneApplyResult(validApplyResult());
    duplicateEntries.entries = [
      ...(duplicateEntries.entries as unknown[]),
      ...(duplicateEntries.entries as unknown[])
    ];
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(duplicateEntries)
    )).toMatchObject({
      field: 'entries',
      reason: 'duplicate-thread-id'
    });

    const duplicatePending = cloneApplyResult(validApplyResult());
    duplicatePending.pendingHostActions = [
      ...(duplicatePending.pendingHostActions as unknown[]),
      ...(duplicatePending.pendingHostActions as unknown[])
    ];
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(duplicatePending)
    )).toMatchObject({
      field: 'pendingHostActions',
      reason: 'duplicate-thread-id'
    });

    const tooManyEntries = cloneApplyResult(validApplyResult());
    tooManyEntries.entries = Array.from({ length: 513 }, (_value, index) => ({
      ...(validApplyResult().entries[0]),
      threadId: `thread-${index}`
    }));
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(tooManyEntries)
    )).toMatchObject({
      field: 'entries',
      reason: 'capacity-exceeded'
    });

    const tooManyPending = cloneApplyResult(validApplyResult());
    tooManyPending.pendingHostActions = Array.from(
      { length: 513 },
      (_value, index) => ({
        ...(validApplyResult().pendingHostActions[0]),
        threadId: `thread-${index}`
      })
    );
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(tooManyPending)
    )).toMatchObject({
      field: 'pendingHostActions',
      reason: 'capacity-exceeded'
    });
  });

  test('rejects unsafe result values without exposing them', () => {
    const unsafeId = 'thread/id';
    const secret = `AKIA${'X'.repeat(16)}`;
    const values = [
      (() => {
        const value = cloneApplyResult(validApplyResult());
        const entries = value.entries as Array<Record<string, unknown>>;
        entries[0]!.threadId = unsafeId;
        return [value, unsafeId] as const;
      })(),
      (() => {
        const value = cloneApplyResult(validApplyResult());
        const entries = value.entries as Array<Record<string, unknown>>;
        entries[0]!.finalName = `Name ${secret}`;
        return [value, secret] as const;
      })()
    ];

    for (const [value, sensitiveValue] of values) {
      const error = captureSidebarError(() =>
        validateSidebarApplyResult(value)
      );
      expect(error.message).not.toContain(sensitiveValue);
      expect(JSON.stringify(error)).not.toContain(sensitiveValue);
    }
  });
});

describe('validateCodexAppSidebarSnapshot', () => {
  test('accepts a canonical snapshot with exact nullable pin state', () => {
    const snapshot = validSidebarSnapshot();
    snapshot.generatedAt = '2026-08-15T17:01:00+08:00';
    snapshot.threads.push({
      threadId: 'thread-2',
      listed: false,
      readable: true,
      pinned: null
    });

    expect(validateCodexAppSidebarSnapshot(snapshot)).toEqual({
      ...snapshot,
      generatedAt: '2026-08-15T09:01:00.000Z'
    });
  });

  test.each([
    ['schemaVersion', 'schemaVersion', 'unsupported-schema'],
    ['generatedAt', 'generatedAt', 'unsafe-timestamp'],
    ['threads', 'threads', 'invalid-shape']
  ] as const)(
    'rejects a snapshot with required %s deleted',
    (deletedField, field, reason) => {
      const value = structuredClone(validSidebarSnapshot()) as unknown as
        Record<string, unknown>;
      delete value[deletedField];

      expect(captureSidebarError(() =>
        validateCodexAppSidebarSnapshot(value)
      )).toMatchObject({ field, reason });
    }
  );

  test.each([
    ['threadId', 'unsafe-identity'],
    ['listed', 'invalid-shape'],
    ['readable', 'invalid-shape'],
    ['pinned', 'invalid-shape']
  ] as const)(
    'rejects a snapshot thread with required %s deleted',
    (deletedField, reason) => {
      const value = structuredClone(validSidebarSnapshot()) as unknown as
        Record<string, unknown>;
      const threads = value.threads as Array<Record<string, unknown>>;
      delete threads[0]![deletedField];

      expect(captureSidebarError(() =>
        validateCodexAppSidebarSnapshot(value)
      )).toMatchObject({
        field: `threads[0].${deletedField}`,
        reason
      });
    }
  );

  test('strictly rejects unknown snapshot fields', () => {
    const root = {
      ...validSidebarSnapshot(),
      unexpected: true
    };
    expect(captureSidebarError(() =>
      validateCodexAppSidebarSnapshot(root)
    )).toMatchObject({ field: 'root', reason: 'unknown-field' });

    const entry = structuredClone(validSidebarSnapshot()) as unknown as
      Record<string, unknown>;
    (entry.threads as Array<Record<string, unknown>>)[0]!.unexpected = true;
    expect(captureSidebarError(() =>
      validateCodexAppSidebarSnapshot(entry)
    )).toMatchObject({ field: 'threads[0]', reason: 'unknown-field' });
  });

  test('accepts 512 snapshot threads and rejects 513', () => {
    const value = validSidebarSnapshot();
    value.threads = Array.from({ length: 512 }, (_item, index) => ({
      threadId: `thread-${index}`,
      listed: true,
      readable: true,
      pinned: index % 2 === 0
    }));
    expect(validateCodexAppSidebarSnapshot(value).threads).toHaveLength(512);

    value.threads.push({
      threadId: 'thread-512',
      listed: true,
      readable: true,
      pinned: true
    });
    expect(captureSidebarError(() =>
      validateCodexAppSidebarSnapshot(value)
    )).toMatchObject({ field: 'threads', reason: 'capacity-exceeded' });
  });

  test('validates snapshot IDs before duplicate detection without exposing them', () => {
    const unsafeId = 'thread/PRIVATE_MARKER';
    const value = validSidebarSnapshot();
    value.threads = [
      { ...value.threads[0]!, threadId: unsafeId },
      { ...value.threads[0]!, threadId: unsafeId }
    ];

    const error = captureSidebarError(() =>
      validateCodexAppSidebarSnapshot(value)
    );
    expect(error).toMatchObject({
      field: 'threads[0].threadId',
      reason: 'unsafe-identity'
    });
    expect(error.message).not.toContain(unsafeId);
    expect(JSON.stringify(error)).not.toContain(unsafeId);
  });

  test('rejects duplicate snapshot thread IDs after validation', () => {
    const value = validSidebarSnapshot();
    value.threads.push({ ...value.threads[0]! });

    expect(captureSidebarError(() =>
      validateCodexAppSidebarSnapshot(value)
    )).toMatchObject({ field: 'threads', reason: 'duplicate-thread-id' });
  });
});

describe('validateSidebarHostReceipt', () => {
  test('accepts applied and failed entries with fixed privacy-safe errors', () => {
    const receipt = validHostReceipt();
    receipt.entries.push({
      threadId: 'thread-2',
      pinned: true,
      status: 'failed',
      error: 'host-write-failed'
    });

    expect(validateSidebarHostReceipt(structuredClone(receipt)))
      .toEqual(receipt);
  });

  test.each([
    ['schemaVersion', 'schemaVersion', 'unsupported-schema'],
    ['generatedAt', 'generatedAt', 'unsafe-timestamp'],
    ['planDigest', 'planDigest', 'invalid-digest'],
    ['executionDigest', 'executionDigest', 'invalid-digest'],
    ['entries', 'entries', 'invalid-shape']
  ] as const)(
    'rejects a receipt with required %s deleted',
    (deletedField, field, reason) => {
      const value = structuredClone(validHostReceipt()) as unknown as
        Record<string, unknown>;
      delete value[deletedField];

      expect(captureSidebarError(() =>
        validateSidebarHostReceipt(value)
      )).toMatchObject({ field, reason });
    }
  );

  test.each([
    ['threadId', 'unsafe-identity'],
    ['pinned', 'invalid-enum'],
    ['status', 'invalid-enum'],
    ['error', 'invalid-enum']
  ] as const)(
    'rejects a receipt entry with required %s deleted',
    (deletedField, reason) => {
      const value = structuredClone(validHostReceipt()) as unknown as
        Record<string, unknown>;
      const entries = value.entries as Array<Record<string, unknown>>;
      delete entries[0]![deletedField];

      expect(captureSidebarError(() =>
        validateSidebarHostReceipt(value)
      )).toMatchObject({
        field: `entries[0].${deletedField}`,
        reason
      });
    }
  );

  test('strictly rejects unknown receipt fields', () => {
    expect(captureSidebarError(() => validateSidebarHostReceipt({
      ...validHostReceipt(),
      unexpected: true
    }))).toMatchObject({ field: 'root', reason: 'unknown-field' });

    const value = structuredClone(validHostReceipt()) as unknown as
      Record<string, unknown>;
    (value.entries as Array<Record<string, unknown>>)[0]!.unexpected = true;
    expect(captureSidebarError(() =>
      validateSidebarHostReceipt(value)
    )).toMatchObject({ field: 'entries[0]', reason: 'unknown-field' });
  });

  test.each([
    ['applied with failure error', 'applied', 'host-write-failed'],
    ['failed with null error', 'failed', null],
    ['failed with dependency text', 'failed', 'database TOKEN_PRIVATE failed']
  ] as const)('rejects %s', (_case, status, error) => {
    const receipt = validHostReceipt();
    receipt.entries[0] = {
      ...receipt.entries[0]!,
      status,
      error
    } as never;

    const failure = captureSidebarError(() =>
      validateSidebarHostReceipt(receipt)
    );
    expect(failure).toMatchObject({
      field: 'entries[0].error',
      reason: 'invalid-enum'
    });
    expect(failure.message).not.toContain('TOKEN_PRIVATE');
    expect(JSON.stringify(failure)).not.toContain('TOKEN_PRIVATE');
  });

  test('requires pinned true', () => {
    const receipt = validHostReceipt();
    receipt.entries[0] = { ...receipt.entries[0]!, pinned: false as true };

    expect(captureSidebarError(() =>
      validateSidebarHostReceipt(receipt)
    )).toMatchObject({
      field: 'entries[0].pinned',
      reason: 'invalid-enum'
    });
  });

  test('accepts 512 receipt entries and rejects 513', () => {
    const receipt = validHostReceipt();
    receipt.entries = Array.from({ length: 512 }, (_item, index) => ({
      threadId: `thread-${index}`,
      pinned: true,
      status: 'applied' as const,
      error: null
    }));
    expect(validateSidebarHostReceipt(receipt).entries).toHaveLength(512);

    receipt.entries.push({
      threadId: 'thread-512',
      pinned: true,
      status: 'applied',
      error: null
    });
    expect(captureSidebarError(() =>
      validateSidebarHostReceipt(receipt)
    )).toMatchObject({ field: 'entries', reason: 'capacity-exceeded' });
  });

  test('validates receipt IDs before duplicate detection', () => {
    const receipt = validHostReceipt();
    receipt.entries = [
      { ...receipt.entries[0]!, threadId: 'thread/id' },
      { ...receipt.entries[0]!, threadId: 'thread/id' }
    ];

    expect(captureSidebarError(() =>
      validateSidebarHostReceipt(receipt)
    )).toMatchObject({
      field: 'entries[0].threadId',
      reason: 'unsafe-identity'
    });
  });

  test('rejects duplicate receipt IDs after validation', () => {
    const receipt = validHostReceipt();
    receipt.entries.push({ ...receipt.entries[0]! });

    expect(captureSidebarError(() =>
      validateSidebarHostReceipt(receipt)
    )).toMatchObject({ field: 'entries', reason: 'duplicate-thread-id' });
  });
});

describe('createSidebarReconciliation', () => {
  test('classifies visible, not-visible, and host-failed in receipt order', () => {
    const receipt = validHostReceipt();
    receipt.entries = [
      {
        threadId: 'thread-z',
        pinned: true,
        status: 'applied',
        error: null
      },
      {
        threadId: 'thread-a',
        pinned: true,
        status: 'applied',
        error: null
      },
      {
        threadId: 'thread-m',
        pinned: true,
        status: 'failed',
        error: 'host-write-failed'
      }
    ];
    const snapshot = validSidebarSnapshot();
    snapshot.threads = [
      {
        threadId: 'thread-z',
        listed: true,
        readable: true,
        pinned: true
      },
      {
        threadId: 'thread-a',
        listed: true,
        readable: true,
        pinned: false
      },
      {
        threadId: 'thread-m',
        listed: true,
        readable: true,
        pinned: true
      }
    ];

    const result = createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt,
      snapshot,
      generatedAt: '2026-08-15T17:02:00+08:00'
    });

    expect(result).toEqual({
      schemaVersion: 'hooks.codex-sidebar-reconciliation/v1',
      generatedAt: '2026-08-15T09:02:00.000Z',
      planDigest: receipt.planDigest,
      receiptPlanDigest: receipt.planDigest,
      receiptExecutionDigest: receipt.executionDigest,
      status: 'reconciled',
      entries: [
        { threadId: 'thread-z', status: 'visible' },
        { threadId: 'thread-a', status: 'not-visible' },
        { threadId: 'thread-m', status: 'host-failed' }
      ]
    });
    expect(validateSidebarReconciliation(result)).toEqual(result);
  });

  test.each([
    ['not listed', { listed: false }],
    ['not readable', { readable: false }],
    ['pin false', { pinned: false }],
    ['pin unknown', { pinned: null }]
  ] as const)('classifies snapshot %s as not-visible', (_case, override) => {
    const receipt = validHostReceipt();
    const snapshot = validSidebarSnapshot();
    snapshot.threads[0] = { ...snapshot.threads[0]!, ...override };

    expect(createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt,
      snapshot,
      generatedAt
    }).entries[0]?.status).toBe('not-visible');
  });

  test('requires a fresh snapshot for visibility', () => {
    const receipt = validHostReceipt();
    const snapshot = validSidebarSnapshot();
    snapshot.generatedAt = '2026-08-15T09:00:00.000Z';

    expect(createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt,
      snapshot,
      generatedAt
    }).entries).toEqual([{
      threadId: 'thread-1',
      status: 'not-visible'
    }]);
  });

  test('returns typed digest-mismatch entries instead of throwing', () => {
    const receipt = validHostReceipt();
    const result = createSidebarReconciliation({
      planDigest: 'b'.repeat(64),
      receipt,
      snapshot: validSidebarSnapshot(),
      generatedAt
    });

    expect(result).toMatchObject({
      planDigest: 'b'.repeat(64),
      receiptPlanDigest: receipt.planDigest,
      status: 'digest-mismatch',
      entries: [{
        threadId: 'thread-1',
        status: 'digest-mismatch'
      }]
    });
  });

  test('expresses an empty-receipt digest mismatch at the root', () => {
    const receipt = validHostReceipt();
    receipt.entries = [];

    expect(createSidebarReconciliation({
      planDigest: 'b'.repeat(64),
      receipt,
      snapshot: validSidebarSnapshot(),
      generatedAt
    })).toMatchObject({
      status: 'digest-mismatch',
      entries: []
    });
  });

  test('strictly validates every reconciliation input before classifying', () => {
    const receipt = validHostReceipt();
    const snapshot = validSidebarSnapshot();

    expect(captureSidebarError(() => createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt,
      snapshot,
      unexpected: true
    } as never))).toMatchObject({
      field: 'input',
      reason: 'unknown-field'
    });

    expect(captureSidebarError(() => createSidebarReconciliation({
      planDigest: 'not-a-digest',
      receipt,
      snapshot
    }))).toMatchObject({
      field: 'planDigest',
      reason: 'invalid-digest'
    });

    expect(captureSidebarError(() => createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt: { ...receipt, unexpected: true } as never,
      snapshot
    }))).toMatchObject({
      field: 'root',
      reason: 'unknown-field'
    });
  });
});

describe('validateSidebarReconciliation', () => {
  test('rejects required, unknown, duplicate, capacity, and root/entry inconsistencies', () => {
    const valid = createSidebarReconciliation({
      planDigest: validHostReceipt().planDigest,
      receipt: validHostReceipt(),
      snapshot: validSidebarSnapshot(),
      generatedAt
    });

    for (const deletedField of [
      'schemaVersion',
      'generatedAt',
      'planDigest',
      'receiptPlanDigest',
      'receiptExecutionDigest',
      'status',
      'entries'
    ]) {
      const value = structuredClone(valid) as unknown as Record<string, unknown>;
      delete value[deletedField];
      expect(() => validateSidebarReconciliation(value)).toThrowError(
        CodexSidebarError
      );
    }

    expect(captureSidebarError(() => validateSidebarReconciliation({
      ...valid,
      unexpected: true
    }))).toMatchObject({ field: 'root', reason: 'unknown-field' });

    const unknownEntry = structuredClone(valid) as unknown as
      Record<string, unknown>;
    (unknownEntry.entries as Array<Record<string, unknown>>)[0]!.unexpected =
      true;
    expect(captureSidebarError(() =>
      validateSidebarReconciliation(unknownEntry)
    )).toMatchObject({ field: 'entries[0]', reason: 'unknown-field' });

    const duplicate = structuredClone(valid) as unknown as
      Record<string, unknown>;
    duplicate.entries = [
      ...(duplicate.entries as unknown[]),
      ...(duplicate.entries as unknown[])
    ];
    expect(captureSidebarError(() =>
      validateSidebarReconciliation(duplicate)
    )).toMatchObject({ field: 'entries', reason: 'duplicate-thread-id' });

    const overCapacity = structuredClone(valid) as unknown as
      Record<string, unknown>;
    overCapacity.entries = Array.from({ length: 513 }, (_item, index) => ({
      threadId: `thread-${index}`,
      status: 'visible'
    }));
    expect(captureSidebarError(() =>
      validateSidebarReconciliation(overCapacity)
    )).toMatchObject({ field: 'entries', reason: 'capacity-exceeded' });

    const inconsistentRoot = {
      ...valid,
      receiptPlanDigest: 'b'.repeat(64),
      status: 'reconciled'
    };
    expect(captureSidebarError(() =>
      validateSidebarReconciliation(inconsistentRoot)
    )).toMatchObject({ field: 'status', reason: 'inconsistent-result' });

    const inconsistentEntry = structuredClone(valid) as unknown as
      Record<string, unknown>;
    (inconsistentEntry.entries as Array<Record<string, unknown>>)[0]!.status =
      'digest-mismatch';
    expect(captureSidebarError(() =>
      validateSidebarReconciliation(inconsistentEntry)
    )).toMatchObject({
      field: 'entries[0].status',
      reason: 'inconsistent-result'
    });
  });
});

describe('createSidebarRollbackPlan', () => {
  function exactApplyResult(): SidebarApplyResult {
    const planDigest = 'd'.repeat(64);
    return refreshApplyExecutionBinding({
      schemaVersion: 'hooks.codex-sidebar-apply/v1',
      generatedAt,
      planDigest,
      executionDigest: '0'.repeat(64),
      entries: [
        {
          threadId: 'thread-a',
          previousName: 'Alpha',
          previousPinned: false,
          desiredName: 'Alpha',
          finalName: 'Alpha',
          status: 'unchanged',
          error: null
        },
        {
          threadId: 'thread-b',
          previousName: 'Before beta',
          previousPinned: true,
          desiredName: 'After beta',
          finalName: 'After beta',
          status: 'name-applied',
          error: null
        }
      ],
      pendingHostActions: [
        {
          planDigest,
          executionDigest: '0'.repeat(64),
          action: 'set-pinned',
          threadId: 'thread-a',
          pinned: true,
          previousPinned: false
        },
        {
          planDigest,
          executionDigest: '0'.repeat(64),
          action: 'set-pinned',
          threadId: 'thread-b',
          pinned: true,
          previousPinned: true
        }
      ]
    });
  }

  function exactReceipt(
    applyResult: SidebarApplyResult = exactApplyResult()
  ): SidebarHostReceipt {
    return {
      schemaVersion: 'hooks.codex-sidebar-host-receipt/v1',
      generatedAt: '2026-08-15T09:01:00.000Z',
      planDigest: applyResult.planDigest,
      executionDigest: applyResult.executionDigest,
      entries: [
        {
          threadId: 'thread-a',
          pinned: true,
          status: 'applied',
          error: null
        },
        {
          threadId: 'thread-b',
          pinned: true,
          status: 'failed',
          error: 'host-write-failed'
        }
      ]
    };
  }

  test('creates exact reverse-order rollback actions even when a host write failed', () => {
    const applyResult = exactApplyResult();
    const result = createSidebarRollbackPlan({
      applyResult,
      receipt: exactReceipt(applyResult),
      generatedAt: '2026-08-15T17:02:00+08:00'
    });

    expect(result).toEqual({
      schemaVersion: 'hooks.codex-sidebar-rollback-plan/v1',
      generatedAt: '2026-08-15T09:02:00.000Z',
      planDigest: 'd'.repeat(64),
      sourceExecutionDigest: applyResult.executionDigest,
      executable: true,
      actions: [
        {
          threadId: 'thread-b',
          restoreName: 'Before beta',
          restorePinned: true,
          nameAdapter: 'app-server',
          pinAdapter: 'codex-app-host'
        },
        {
          threadId: 'thread-a',
          restoreName: 'Alpha',
          restorePinned: false,
          nameAdapter: 'app-server',
          pinAdapter: 'codex-app-host'
        }
      ],
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(result.digest).toBe(digestSidebarRollbackPlan(result));
    expect(validateSidebarRollbackPlan(result)).toEqual(result);
  });

  test('records a null previous name as unsupported without guessing an empty string', () => {
    const applyResult = exactApplyResult();
    applyResult.entries[0] = {
      ...applyResult.entries[0]!,
      previousName: null,
      desiredName: 'Applied alpha',
      finalName: 'Applied alpha',
      status: 'name-applied'
    };
    refreshApplyExecutionBinding(applyResult);
    const result = createSidebarRollbackPlan({
      applyResult,
      receipt: exactReceipt(applyResult),
      generatedAt
    });

    expect(result.executable).toBe(false);
    expect(result.actions[1]).toEqual({
      threadId: 'thread-a',
      restoreName: null,
      restorePinned: false,
      nameAdapter: 'unsupported-clear-name-on-codex-0.147.0',
      pinAdapter: 'codex-app-host'
    });
    expect(JSON.stringify(result)).not.toContain('restoreName":""');
  });

  test('fails closed when any apply name outcome is unknown', () => {
    const applyResult = exactApplyResult();
    applyResult.entries.push({
      threadId: 'thread-unknown',
      previousName: 'Before unknown',
      previousPinned: false,
      desiredName: 'After unknown',
      finalName: null,
      status: 'unknown',
      error: 'name-outcome-unknown'
    });
    refreshApplyExecutionBinding(applyResult);

    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult,
      receipt: exactReceipt(applyResult),
      generatedAt
    }))).toMatchObject({
      field: 'applyResult.entries',
      reason: 'inconsistent-result'
    });
  });

  test.each([
    ['missing receipt entry', (receipt: SidebarHostReceipt) => {
      receipt.entries.pop();
    }, 'receipt.entries'],
    ['extra receipt entry', (receipt: SidebarHostReceipt) => {
      receipt.entries.push({
        threadId: 'thread-extra',
        pinned: true,
        status: 'applied',
        error: null
      });
    }, 'receipt.entries'],
    ['reordered receipt', (receipt: SidebarHostReceipt) => {
      receipt.entries.reverse();
    }, 'receipt.entries[0]'],
    ['wrong receipt thread', (receipt: SidebarHostReceipt) => {
      receipt.entries[0] = {
        ...receipt.entries[0]!,
        threadId: 'thread-other'
      };
    }, 'receipt.entries[0]'],
    ['wrong receipt digest', (receipt: SidebarHostReceipt) => {
      receipt.planDigest = 'e'.repeat(64);
    }, 'receipt.planDigest']
  ] as const)('rejects %s', (_case, mutate, field) => {
    const receipt = exactReceipt();
    mutate(receipt);

    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult: exactApplyResult(),
      receipt,
      generatedAt
    }))).toMatchObject({
      field,
      reason: field === 'receipt.planDigest'
        ? 'digest-mismatch'
        : 'inconsistent-result'
    });
  });

  test('rejects previousPinned null because exact pin restoration is unavailable', () => {
    const applyResult = exactApplyResult();
    applyResult.entries[0] = {
      ...applyResult.entries[0]!,
      previousPinned: null
    };
    applyResult.pendingHostActions[0] = {
      ...applyResult.pendingHostActions[0]!,
      previousPinned: null
    };
    refreshApplyExecutionBinding(applyResult);

    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult,
      receipt: exactReceipt(applyResult),
      generatedAt
    }))).toMatchObject({
      field: 'applyResult.entries[0].previousPinned',
      reason: 'inconsistent-result'
    });
  });

  test('strictly validates rollback input fields before mapping', () => {
    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult: exactApplyResult(),
      receipt: exactReceipt(),
      unexpected: true
    } as never))).toMatchObject({
      field: 'input',
      reason: 'unknown-field'
    });

    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult: {
        ...exactApplyResult(),
        unexpected: true
      } as never,
      receipt: exactReceipt()
    }))).toMatchObject({
      field: 'root',
      reason: 'unknown-field'
    });
  });
});

describe('validateSidebarRollbackPlan', () => {
  function validRollbackPlan(): Record<string, unknown> {
    const core: SidebarRollbackPlanDigestInput = {
      schemaVersion: 'hooks.codex-sidebar-rollback-plan/v1',
      generatedAt,
      planDigest: 'f'.repeat(64),
      sourceExecutionDigest: 'e'.repeat(64),
      executable: true,
      actions: [{
        threadId: 'thread-1',
        restoreName: 'Previous name',
        restorePinned: false,
        nameAdapter: 'app-server',
        pinAdapter: 'codex-app-host'
      }]
    };
    return {
      ...core,
      digest: digestSidebarRollbackPlan(core)
    };
  }

  test('enforces required and unknown root/action fields', () => {
    for (const deletedField of [
      'schemaVersion',
      'generatedAt',
      'planDigest',
      'sourceExecutionDigest',
      'executable',
      'actions',
      'digest'
    ]) {
      const value = validRollbackPlan();
      delete value[deletedField];
      expect(() => validateSidebarRollbackPlan(value)).toThrowError(
        CodexSidebarError
      );
    }

    for (const deletedField of [
      'threadId',
      'restoreName',
      'restorePinned',
      'nameAdapter',
      'pinAdapter'
    ]) {
      const value = validRollbackPlan();
      delete (value.actions as Array<Record<string, unknown>>)[0]![deletedField];
      expect(() => validateSidebarRollbackPlan(value)).toThrowError(
        CodexSidebarError
      );
    }

    expect(captureSidebarError(() => validateSidebarRollbackPlan({
      ...validRollbackPlan(),
      unexpected: true
    }))).toMatchObject({ field: 'root', reason: 'unknown-field' });

    const unknownAction = validRollbackPlan();
    (unknownAction.actions as Array<Record<string, unknown>>)[0]!.unexpected =
      true;
    expect(captureSidebarError(() =>
      validateSidebarRollbackPlan(unknownAction)
    )).toMatchObject({ field: 'actions[0]', reason: 'unknown-field' });
  });

  test.each([
    [
      'null name with app-server',
      {
        restoreName: null,
        nameAdapter: 'app-server',
        executable: false
      },
      'actions[0].nameAdapter'
    ],
    [
      'non-null name with unsupported clear adapter',
      {
        restoreName: 'Previous',
        nameAdapter: 'unsupported-clear-name-on-codex-0.147.0',
        executable: false
      },
      'actions[0].nameAdapter'
    ],
    [
      'supported actions marked non-executable',
      { executable: false },
      'executable'
    ],
    [
      'unsupported action marked executable',
      {
        restoreName: null,
        nameAdapter: 'unsupported-clear-name-on-codex-0.147.0',
        executable: true
      },
      'executable'
    ]
  ] as const)('rejects capability/value mismatch: %s', (_case, mutation, field) => {
    const value = validRollbackPlan();
    const action = (value.actions as Array<Record<string, unknown>>)[0]!;
    if ('restoreName' in mutation) action.restoreName = mutation.restoreName;
    if ('nameAdapter' in mutation) action.nameAdapter = mutation.nameAdapter;
    value.executable = mutation.executable;

    expect(captureSidebarError(() =>
      validateSidebarRollbackPlan(value)
    )).toMatchObject({ field, reason: 'inconsistent-result' });
  });

  test('accepts 512 actions and rejects 513 and duplicates', () => {
    const value = validRollbackPlan();
    value.actions = Array.from({ length: 512 }, (_item, index) => ({
      ...(validRollbackPlan().actions as unknown[])[0] as object,
      threadId: `thread-${index}`
    }));
    value.digest = digestSidebarRollbackPlan(
      value as unknown as SidebarRollbackPlan
    );
    expect(validateSidebarRollbackPlan(value).actions).toHaveLength(512);

    const tooMany = structuredClone(value);
    (tooMany.actions as unknown[]).push({
      ...(validRollbackPlan().actions as unknown[])[0] as object,
      threadId: 'thread-512'
    });
    expect(captureSidebarError(() =>
      validateSidebarRollbackPlan(tooMany)
    )).toMatchObject({ field: 'actions', reason: 'capacity-exceeded' });

    const duplicate = validRollbackPlan();
    duplicate.actions = [
      ...(duplicate.actions as unknown[]),
      ...(duplicate.actions as unknown[])
    ];
    expect(captureSidebarError(() =>
      validateSidebarRollbackPlan(duplicate)
    )).toMatchObject({ field: 'actions', reason: 'duplicate-thread-id' });
  });

  test('rejects invalid schema, timestamp, digest, enums, ID, pin, and unsafe name', () => {
    const secret = `AKIA${'Q'.repeat(16)}`;
    const mutations: Array<{
      mutate: (value: Record<string, unknown>) => void;
      field: string;
      reason: string;
      sensitive?: string;
    }> = [
      {
        mutate: (value) => {
          value.schemaVersion = 'hooks.codex-sidebar-rollback-plan/v2';
        },
        field: 'schemaVersion',
        reason: 'unsupported-schema'
      },
      {
        mutate: (value) => {
          value.generatedAt = 'bad-time';
        },
        field: 'generatedAt',
        reason: 'unsafe-timestamp'
      },
      {
        mutate: (value) => {
          value.planDigest = 'bad-digest';
        },
        field: 'planDigest',
        reason: 'invalid-digest'
      },
      {
        mutate: (value) => {
          value.sourceExecutionDigest = 'SOURCE_EXECUTION_PRIVATE_TOKEN';
        },
        field: 'sourceExecutionDigest',
        reason: 'invalid-digest',
        sensitive: 'SOURCE_EXECUTION_PRIVATE_TOKEN'
      },
      {
        mutate: (value) => {
          value.digest = 'ROLLBACK_DIGEST_PRIVATE_TOKEN';
        },
        field: 'digest',
        reason: 'invalid-digest',
        sensitive: 'ROLLBACK_DIGEST_PRIVATE_TOKEN'
      },
      {
        mutate: (value) => {
          const action = (value.actions as Array<Record<string, unknown>>)[0]!;
          action.threadId = 'thread/id';
        },
        field: 'actions[0].threadId',
        reason: 'unsafe-identity',
        sensitive: 'thread/id'
      },
      {
        mutate: (value) => {
          const action = (value.actions as Array<Record<string, unknown>>)[0]!;
          action.restoreName = `Name ${secret}`;
        },
        field: 'actions[0].restoreName',
        reason: 'unsafe-name',
        sensitive: secret
      },
      {
        mutate: (value) => {
          const action = (value.actions as Array<Record<string, unknown>>)[0]!;
          action.restorePinned = null;
        },
        field: 'actions[0].restorePinned',
        reason: 'invalid-shape'
      },
      {
        mutate: (value) => {
          const action = (value.actions as Array<Record<string, unknown>>)[0]!;
          action.nameAdapter = 'direct-db';
        },
        field: 'actions[0].nameAdapter',
        reason: 'invalid-enum'
      },
      {
        mutate: (value) => {
          const action = (value.actions as Array<Record<string, unknown>>)[0]!;
          action.pinAdapter = 'app-server';
        },
        field: 'actions[0].pinAdapter',
        reason: 'invalid-enum'
      }
    ];

    for (const item of mutations) {
      const value = validRollbackPlan();
      item.mutate(value);
      const error = captureSidebarError(() =>
        validateSidebarRollbackPlan(value)
      );
      expect(error).toMatchObject({
        field: item.field,
        reason: item.reason
      });
      if (item.sensitive) {
        expect(error.message).not.toContain(item.sensitive);
        expect(JSON.stringify(error)).not.toContain(item.sensitive);
      }
    }
  });

  test('canonicalizes keys and timestamps while preserving rollback action order', () => {
    const value = validRollbackPlan() as unknown as SidebarRollbackPlan;
    const equivalent = {
      actions: value.actions.map((action) => ({
        pinAdapter: action.pinAdapter,
        nameAdapter: action.nameAdapter,
        restorePinned: action.restorePinned,
        restoreName: action.restoreName,
        threadId: action.threadId
      })),
      executable: value.executable,
      sourceExecutionDigest: value.sourceExecutionDigest,
      planDigest: value.planDigest,
      generatedAt: '2026-08-15T17:00:00+08:00',
      schemaVersion: value.schemaVersion
    };

    expect(digestSidebarRollbackPlan(equivalent)).toBe(value.digest);
    expect(digestSidebarRollbackPlan({
      ...equivalent,
      actions: [
        ...equivalent.actions,
        {
          ...equivalent.actions[0]!,
          threadId: 'thread-2'
        }
      ].reverse()
    })).not.toBe(value.digest);
  });
});

describe('SidebarApplyResult execution binding', () => {
  test('canonicalizes execution timestamps and object keys while preserving entry order', () => {
    const firstEntry = executionBoundApplyResult().entries[0]!;
    const secondEntry = {
      ...firstEntry,
      threadId: 'thread-2',
      previousName: 'Same',
      desiredName: 'Same',
      finalName: 'Same',
      status: 'unchanged' as const
    };
    const first = {
      schemaVersion: 'hooks.codex-sidebar-apply/v1' as const,
      generatedAt: '2026-08-15T09:00:00.000Z',
      planDigest: '9'.repeat(64),
      entries: [firstEntry, secondEntry]
    };
    const equivalent = {
      entries: first.entries.map((entry) => ({
        error: entry.error,
        status: entry.status,
        finalName: entry.finalName,
        desiredName: entry.desiredName,
        previousPinned: entry.previousPinned,
        previousName: entry.previousName,
        threadId: entry.threadId
      })),
      planDigest: first.planDigest,
      generatedAt: '2026-08-15T17:00:00+08:00',
      schemaVersion: first.schemaVersion
    };

    const digest = digestSidebarApplyExecution(first);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digestSidebarApplyExecution(equivalent)).toBe(digest);
    expect(digestSidebarApplyExecution({
      ...first,
      entries: [...first.entries].reverse()
    })).not.toBe(digest);
  });

  test('requires and recomputes the root execution digest', () => {
    const valid = executionBoundApplyResult();
    expect(validateSidebarApplyResult(structuredClone(valid))).toEqual(valid);

    const missing = structuredClone(valid) as unknown as Record<string, unknown>;
    delete missing.executionDigest;
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(missing)
    )).toMatchObject({
      field: 'executionDigest',
      reason: 'invalid-digest'
    });

    const tampered = structuredClone(valid) as unknown as
      Record<string, unknown>;
    const entries = tampered.entries as Array<Record<string, unknown>>;
    entries[0]!.desiredName = 'Changed';
    entries[0]!.finalName = 'Changed';
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(tampered)
    )).toMatchObject({
      field: 'executionDigest',
      reason: 'digest-mismatch'
    });
  });

  test('requires every pending action to carry the root execution digest', () => {
    const valid = executionBoundApplyResult();
    const missing = structuredClone(valid) as unknown as
      Record<string, unknown>;
    delete (missing.pendingHostActions as Array<Record<string, unknown>>)[0]!
      .executionDigest;
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(missing)
    )).toMatchObject({
      field: 'pendingHostActions[0].executionDigest',
      reason: 'invalid-digest'
    });

    const stale = structuredClone(valid) as unknown as Record<string, unknown>;
    (stale.pendingHostActions as Array<Record<string, unknown>>)[0]!
      .executionDigest = '8'.repeat(64);
    expect(captureSidebarError(() =>
      validateSidebarApplyResult(stale)
    )).toMatchObject({
      field: 'pendingHostActions[0].executionDigest',
      reason: 'digest-mismatch'
    });
  });

  test('keeps execution digest errors privacy-safe', () => {
    const secret = 'EXECUTION_DIGEST_PRIVATE_TOKEN';
    const value = structuredClone(executionBoundApplyResult()) as unknown as
      Record<string, unknown>;
    value.executionDigest = secret;

    const error = captureSidebarError(() =>
      validateSidebarApplyResult(value)
    );
    expect(error).toMatchObject({
      field: 'executionDigest',
      reason: 'invalid-digest'
    });
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('apply emits one execution digest shared by root and pending actions', async () => {
    const plan = createSidebarPlan({
      project,
      generatedAt,
      candidates: [candidate()]
    });
    const result = await applySidebarPlan({
      plan,
      confirmDigest: plan.digest,
      currentNames: new Map([['thread-1', null]]),
      setName: async () => {},
      readName: async () => '[CC-Panes] Run task'
    });
    const executionDigest = (result as unknown as {
      executionDigest: string;
    }).executionDigest;

    expect(executionDigest).toBe(digestSidebarApplyExecution(result));
    expect(result.pendingHostActions).toHaveLength(1);
    expect((result.pendingHostActions[0] as unknown as {
      executionDigest: string;
    }).executionDigest).toBe(executionDigest);
  });
});

describe('receipt execution binding and reconciliation audit', () => {
  test('requires a privacy-safe execution digest on host receipts', () => {
    const valid = executionBoundReceipt();
    expect(validateSidebarHostReceipt(structuredClone(valid))).toEqual(valid);

    const missing = structuredClone(valid) as unknown as Record<string, unknown>;
    delete missing.executionDigest;
    expect(captureSidebarError(() =>
      validateSidebarHostReceipt(missing)
    )).toMatchObject({
      field: 'executionDigest',
      reason: 'invalid-digest'
    });

    const secret = 'RECEIPT_EXECUTION_PRIVATE_TOKEN';
    const unsafe = structuredClone(valid) as unknown as Record<string, unknown>;
    unsafe.executionDigest = secret;
    const error = captureSidebarError(() =>
      validateSidebarHostReceipt(unsafe)
    );
    expect(error).toMatchObject({
      field: 'executionDigest',
      reason: 'invalid-digest'
    });
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('carries the receipt execution digest into reconciliation artifacts', () => {
    const receipt = executionBoundReceipt();
    const result = createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt,
      snapshot: validSidebarSnapshot(),
      generatedAt
    });
    const receiptExecutionDigest = (receipt as unknown as {
      executionDigest: string;
    }).executionDigest;

    expect((result as unknown as {
      receiptExecutionDigest: string;
    }).receiptExecutionDigest).toBe(receiptExecutionDigest);
    expect(validateSidebarReconciliation(result)).toEqual(result);

    const missing = structuredClone(result) as unknown as
      Record<string, unknown>;
    delete missing.receiptExecutionDigest;
    expect(captureSidebarError(() =>
      validateSidebarReconciliation(missing)
    )).toMatchObject({
      field: 'receiptExecutionDigest',
      reason: 'invalid-digest'
    });
  });
});

describe('rollback execution and causal-time binding', () => {
  test('rejects an old execution receipt with the same plan and thread IDs', () => {
    const applyResult = executionBoundApplyResult();
    const receipt = executionBoundReceipt(applyResult) as unknown as
      SidebarHostReceipt & { executionDigest: string };
    receipt.executionDigest = '7'.repeat(64);

    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult,
      receipt,
      generatedAt
    }))).toMatchObject({
      field: 'receipt.executionDigest',
      reason: 'digest-mismatch'
    });
  });

  test('rejects a receipt timestamp older than the bound apply execution', () => {
    const applyResult = executionBoundApplyResult();
    const receipt = executionBoundReceipt(applyResult);
    receipt.generatedAt = '2026-08-15T08:59:59.999Z';

    expect(captureSidebarError(() => createSidebarRollbackPlan({
      applyResult,
      receipt,
      generatedAt
    }))).toMatchObject({
      field: 'receipt.generatedAt',
      reason: 'inconsistent-result'
    });
  });

  test('binds rollback lineage to the exact apply execution and rejects source-only tampering', () => {
    const firstApply = executionBoundApplyResult();
    const secondApply = structuredClone(firstApply);
    secondApply.generatedAt = '2026-08-15T09:00:00.001Z';
    refreshApplyExecutionBinding(secondApply);

    const first = createSidebarRollbackPlan({
      applyResult: firstApply,
      receipt: executionBoundReceipt(firstApply),
      generatedAt
    });
    const second = createSidebarRollbackPlan({
      applyResult: secondApply,
      receipt: executionBoundReceipt(secondApply),
      generatedAt
    });

    expect(first.planDigest).toBe(second.planDigest);
    expect(first.actions).toEqual(second.actions);
    expect(first.sourceExecutionDigest).toBe(firstApply.executionDigest);
    expect(second.sourceExecutionDigest).toBe(secondApply.executionDigest);
    expect(first.sourceExecutionDigest).not.toBe(second.sourceExecutionDigest);
    expect(first.digest).not.toBe(second.digest);
    expect(validateSidebarRollbackPlan(first)).toEqual(first);
    expect(validateSidebarRollbackPlan(second)).toEqual(second);

    const tampered = {
      ...first,
      sourceExecutionDigest: second.sourceExecutionDigest
    };
    expect(captureSidebarError(() =>
      validateSidebarRollbackPlan(tampered)
    )).toMatchObject({
      field: 'digest',
      reason: 'digest-mismatch'
    });
  });
});

describe('snapshot freshness millisecond boundaries', () => {
  test.each([
    ['equal UTC', '2026-08-15T09:00:30.000Z', 'visible'],
    ['equal offset', '2026-08-15T17:00:30+08:00', 'visible'],
    ['older by 1ms', '2026-08-15T09:00:29.999Z', 'not-visible'],
    ['newer by 1ms', '2026-08-15T09:00:30.001Z', 'visible']
  ] as const)('%s is classified at the exact freshness boundary', (
    _case,
    snapshotGeneratedAt,
    status
  ) => {
    const receipt = executionBoundReceipt();
    receipt.generatedAt = '2026-08-15T09:00:30.000Z';
    const snapshot = validSidebarSnapshot();
    snapshot.generatedAt = snapshotGeneratedAt;

    expect(createSidebarReconciliation({
      planDigest: receipt.planDigest,
      receipt,
      snapshot,
      generatedAt
    }).entries[0]?.status).toBe(status);
  });
});
