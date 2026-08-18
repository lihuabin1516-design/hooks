import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildCodexSessionIndex,
  classifyCodexScope,
  normalizeCodexPath,
  sanitizeCodexSessionArtifactExcerpt,
  sanitizeCodexSessionExternalIdentity,
  sanitizeCodexSessionPromptDerivedIdentifier,
  type CodexSessionRecord
} from '../src/codex-session-index.js';
import {
  CODEX_SESSION_INDEX_ARTIFACT_LIMITS,
  digestDiagnosticSubject,
  validateCodexSessionIndexArtifact,
  type CodexSessionDiagnostic
} from '../src/codex-session-index-artifact.js';
import {
  isCodexThreadId,
  requireCodexThreadId
} from '../src/codex-session-identity.js';
import { isCodexAppServerThreadId } from
  '../src/codex-app-server-client.js';
import { isCodexPathInside } from '../src/codex-session-path.js';
import {
  renderCodexSessionResolution,
  resolveCodexSessions,
  validateCodexSessionResolutionArtifact
} from '../src/codex-session-resolver.js';
import {
  createRetentionManifest,
  generateCodexHandoff,
  validateCodexSessionRetentionManifest
} from '../src/codex-session-handoff.js';
import {
  buildSessionFederation,
  isSessionFederationCodexThreadId
} from '../src/session-federation.js';

let tempRoot: string;
const validThreadId = `a${'b'.repeat(511)}`;
const invalidThreadIds = [
  '',
  `a${'b'.repeat(512)}`,
  ' leading',
  'trailing ',
  'thread/with/slash',
  'thread\nwith-control',
  'sk-proj-secret-shaped'
];

function artifactSession(
  threadId: string,
  overrides: Partial<CodexSessionRecord> = {}
): CodexSessionRecord {
  return {
    threadId,
    source: 'codex-app',
    threadSource: 'user',
    originator: 'Codex Desktop',
    cwdRaw: 'D:\\Repo',
    cwdNorm: 'd:/repo',
    projectOwner: 'D:\\Repo',
    scopeMatch: 'exact',
    confidence: 1,
    rolloutPath: 'D:\\Repo\\sessions\\rollout.jsonl',
    stateDbPresent: true,
    rolloutPresent: true,
    updatedAt: '2026-08-17T00:00:01.000Z',
    firstUserPrompt: 'Implement bridge',
    lastSummary: 'Done',
    storageState: 'active',
    runtimeScope: 'exact',
    projectRelation: 'owned',
    relationConfidence: 1,
    relationReasons: ['matched task binding'],
    evidence: [{ kind: 'cwd', relation: 'exact' }],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null,
    ...overrides
  };
}

function indexArtifact(
  sessions: CodexSessionRecord[],
  diagnostics: CodexSessionDiagnostic[] = []
) {
  return {
    schemaVersion: 'hooks.codex-session-index/v3',
    generatedAt: '2026-08-17T00:00:00.000Z',
    sources: {
      sessionsDir: {
        path: 'D:\\Repo\\sessions',
        availability: 'present'
      },
      stateDb: {
        path: 'D:\\Repo\\state.sqlite',
        availability: 'present'
      },
      threadHistoryDb: {
        path: 'D:\\Repo\\history.sqlite',
        availability: 'present',
        role: 'availability-only'
      },
      taskContext: null
    },
    sessions,
    diagnostics
  };
}

function artifactDiagnostic(index: number): CodexSessionDiagnostic {
  return {
    code: 'rollout-jsonl-invalid',
    source: 'rollout',
    field: 'updatedAt',
    reason: 'invalid-json',
    subjectDigest: index.toString(16).padStart(64, '0')
  };
}

function retentionEntry(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    threadId: 'retention-thread',
    rolloutPath: 'D:\\Repo\\sessions\\rollout.jsonl',
    rolloutPresent: true,
    stateDbPresent: true,
    cwdNorm: 'd:/repo',
    projectOwner: 'D:\\Repo',
    updatedAt: '2026-08-17T00:00:01.000Z',
    risk: 'ok',
    ...overrides
  };
}

function retentionArtifact(
  sessions: Record<string, unknown>[] = [retentionEntry()],
  diagnostics: unknown[] = []
): Record<string, unknown> {
  return {
    schemaVersion: 'hooks.codex-session-retention/v2',
    generatedAt: '2026-08-17T00:00:00.000Z',
    sessions,
    diagnostics
  };
}

async function withIndexArtifactLimits(
  limits: Partial<Record<
    keyof typeof CODEX_SESSION_INDEX_ARTIFACT_LIMITS,
    number
  >>,
  run: (
    indexModule: typeof import('../src/codex-session-index.js')
  ) => Promise<void>
): Promise<void> {
  vi.resetModules();
  vi.doMock('../src/codex-session-index-artifact.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/codex-session-index-artifact.js')
    >('../src/codex-session-index-artifact.js');
    return {
      ...actual,
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS: Object.freeze({
        ...actual.CODEX_SESSION_INDEX_ARTIFACT_LIMITS,
        ...limits
      })
    };
  });
  try {
    await run(await import('../src/codex-session-index.js'));
  } finally {
    vi.doUnmock('../src/codex-session-index-artifact.js');
    vi.resetModules();
  }
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-session-bridge-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('uses one core Codex thread ID contract across all consumers', () => {
  expect(isCodexAppServerThreadId).toBe(isCodexThreadId);
  expect(isSessionFederationCodexThreadId).toBe(isCodexThreadId);
  expect(isCodexThreadId(validThreadId)).toBe(true);
  expect(requireCodexThreadId(validThreadId, () => {
    throw new Error('unexpected invalid thread ID');
  })).toBe(validThreadId);

  for (const value of invalidThreadIds) {
    expect(isCodexThreadId(value)).toBe(false);
    expect(isCodexAppServerThreadId(value)).toBe(false);
    expect(isSessionFederationCodexThreadId(value)).toBe(false);
    const error = (() => {
      try {
        requireCodexThreadId(value, () => {
          throw new Error('invalid thread ID');
        });
      } catch (reason) {
        return reason as Error;
      }
      throw new Error('expected invalid thread ID');
    })();
    expect(error.message).toBe('invalid thread ID');
    if (value) expect(error.message).not.toContain(value);
  }
});

test('keeps raw rollout parsing private to the index implementation', async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), 'src', 'codex-session-index.ts'),
    'utf8'
  );
  const indexModule = await import('../src/codex-session-index.js');

  expect(source).not.toMatch(
    /\bexport\s+interface\s+ParsedCodexRollout\b/u
  );
  expect(source).not.toMatch(
    /\bexport\s+async\s+function\s+parseCodexRolloutFile\b/u
  );
  expect(indexModule).not.toHaveProperty('parseCodexRolloutFile');
});

describe('normalizeCodexPath', () => {
  test('normalizes Windows device, WSL, separator, case, and trailing slash variants', () => {
    expect(normalizeCodexPath('\\\\?\\D:\\Work\\Repo\\')).toBe('d:/work/repo');
    expect(normalizeCodexPath('/mnt/d/Work/Repo')).toBe('d:/work/repo');
    expect(normalizeCodexPath('D:/WORK/Repo')).toBe('d:/work/repo');
    expect(normalizeCodexPath('D:/Work/Repo///')).toBe('d:/work/repo');
  });

  test('resolves dot segments without collapsing a drive root', () => {
    expect(normalizeCodexPath('D:\\Work\\Repo\\.\\src\\..\\')).toBe('d:/work/repo');
    expect(normalizeCodexPath('D:/../Repo')).toBe('d:/repo');
    expect(normalizeCodexPath('D:\\')).toBe('d:/');
    expect(normalizeCodexPath('/mnt/d')).toBe('d:/');
  });

  test('normalizes only filesystem-backed Windows device and UNC forms', () => {
    expect(normalizeCodexPath('\\\\?\\UNC\\server\\share\\Repo'))
      .toBe(normalizeCodexPath('\\\\server\\share\\Repo'));
    expect(normalizeCodexPath('\\\\.\\D:\\Repo'))
      .toBe(normalizeCodexPath('D:\\Repo'));
    expect(normalizeCodexPath('\\\\.\\PhysicalDrive0')).toBe('');
  });

  test('preserves native POSIX case and rejects drive-relative paths', () => {
    expect(normalizeCodexPath('/home/User/Repo')).toBe('/home/User/Repo');
    expect(normalizeCodexPath('/home/user/repo')).toBe('/home/user/repo');
    expect(normalizeCodexPath('/home/User/Repo'))
      .not.toBe(normalizeCodexPath('/home/user/repo'));
    expect(normalizeCodexPath('D:')).toBe('');
    expect(normalizeCodexPath('D:Repo')).toBe('');
  });

  test('resolves WSL dot segments before deciding whether to map a drive', () => {
    expect(normalizeCodexPath('/mnt/d/Repo/../Work')).toBe('d:/work');
    expect(normalizeCodexPath('/mnt/d/../e/Repo')).toBe('e:/repo');
    expect(normalizeCodexPath('/mnt/d/../Repo')).toBe('/mnt/Repo');
    expect(normalizeCodexPath('/mnt/d/../../etc')).toBe('/etc');
  });
});

describe('isCodexPathInside', () => {
  test('uses path boundaries instead of sibling prefixes', () => {
    expect(isCodexPathInside('D:\\Work\\Repo', 'd:/work/repo')).toBe(true);
    expect(isCodexPathInside('D:\\Work\\Repo', 'd:/work/repo/packages/core')).toBe(true);
    expect(isCodexPathInside('D:\\Work\\Repo', 'd:/work/repository')).toBe(false);
  });

  test('handles drive-root containment', () => {
    expect(isCodexPathInside('D:\\', 'd:/work/repo')).toBe(true);
    expect(isCodexPathInside('D:\\', 'e:/work/repo')).toBe(false);
  });

  test('does not let drive-relative paths participate in containment', () => {
    expect(isCodexPathInside('D:', 'D:/Repo')).toBe(false);
    expect(isCodexPathInside('D:Repo', 'D:/Repo')).toBe(false);
    expect(isCodexPathInside('D:/Repo', 'D:Repo')).toBe(false);
  });
});

describe('classifyCodexScope prompt matching', () => {
  test.each([
    ['D:\\Repo', 'Work in d:\\repo\\src today', 'prompt-mention'],
    ['D:\\Repo', 'Work in /mnt/D/REPO/src today', 'prompt-mention'],
    ['\\\\server\\share\\Repo', 'Work in \\\\SERVER\\SHARE\\repo today', 'prompt-mention'],
    ['/home/User/Repo', 'Work in /home/User/Repo/src today', 'prompt-mention'],
    ['/home/User/Repo', 'Work in /home/user/repo today', 'unknown'],
    ['D:\\Repo', 'Work in D:\\Repo-tools today', 'unknown']
  ] as const)(
    'classifies prompt %j for project %j as %s',
    (promptProject, prompt, expected) => {
      expect(classifyCodexScope('c:/other', promptProject, prompt)).toBe(expected);
    }
  );
});

async function createHistoryCloseFixture(label: string): Promise<{
  sessionsDir: string;
  stateDb: string;
  threadHistoryDb: string;
  expectedThreadIds: string[];
}> {
  const fixtureRoot = path.join(tempRoot, `history-close-${label}`);
  const sessionsDir = path.join(fixtureRoot, 'sessions');
  const stateDb = path.join(fixtureRoot, 'state.sqlite');
  const threadHistoryDb = path.join(fixtureRoot, 'thread_history_1.sqlite');
  const rolloutPath = path.join(sessionsDir, 'rollout-only.jsonl');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(rolloutPath, [
    JSON.stringify({
      timestamp: '2026-08-17T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'rollout-only-thread',
        cwd: 'D:\\Repo',
        thread_source: 'user'
      }
    }),
    JSON.stringify({
      timestamp: '2026-08-17T00:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Rollout only' }
    })
  ].join('\n'), 'utf8');
  const db = new DatabaseSync(stateDb);
  db.exec(
    'create table threads (' +
    'id text, rollout_path text, updated_at integer, source text, cwd text, ' +
    'first_user_message text, thread_source text, preview text)'
  );
  db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      'state-only-thread',
      path.join(fixtureRoot, 'missing-state-rollout.jsonl'),
      1,
      'cli',
      'D:\\Repo',
      'State only',
      'user',
      'State summary'
    );
  db.close();
  return {
    sessionsDir,
    stateDb,
    threadHistoryDb,
    expectedThreadIds: ['rollout-only-thread', 'state-only-thread']
  };
}

describe('buildCodexSessionIndex', () => {
  test(
    'threadHistoryDb FileHandle.close closes a synthetic readable handle exactly once',
    async () => {
      const fixture = await createHistoryCloseFixture('synthetic-success');
      const close = vi.fn().mockResolvedValue(undefined);
      const originalOpen = fs.open.bind(fs);
      const openSpy = vi.spyOn(fs, 'open').mockImplementation(
        async (...args: Parameters<typeof fs.open>) => {
          if (
            path.resolve(String(args[0])) === fixture.threadHistoryDb
          ) {
            return { close } as unknown as Awaited<
              ReturnType<typeof fs.open>
            >;
          }
          return originalOpen(...args);
        }
      );
      try {
        const index = await buildCodexSessionIndex({
          sessionsDir: fixture.sessionsDir,
          stateDb: fixture.stateDb,
          threadHistoryDb: fixture.threadHistoryDb,
          project: 'D:\\Repo'
        });

        expect(index.sources.threadHistoryDb.availability).toBe('present');
        expect(index.sessions.map((session) => session.threadId).sort())
          .toEqual(fixture.expectedThreadIds);
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        openSpy.mockRestore();
      }
    }
  );

  test(
    'threadHistoryDb FileHandle.close rejection is unreadable and privacy-safe',
    async () => {
      const fixture = await createHistoryCloseFixture('synthetic-close-failure');
      const secret = 'PRIVATE_THREAD_HISTORY_CLOSE_EXCEPTION';
      const close = vi.fn().mockRejectedValue(new Error(secret));
      const originalOpen = fs.open.bind(fs);
      const openSpy = vi.spyOn(fs, 'open').mockImplementation(
        async (...args: Parameters<typeof fs.open>) => {
          if (
            path.resolve(String(args[0])) === fixture.threadHistoryDb
          ) {
            return { close } as unknown as Awaited<
              ReturnType<typeof fs.open>
            >;
          }
          return originalOpen(...args);
        }
      );
      try {
        const index = await buildCodexSessionIndex({
          sessionsDir: fixture.sessionsDir,
          stateDb: fixture.stateDb,
          threadHistoryDb: fixture.threadHistoryDb,
          project: 'D:\\Repo'
        });

        expect(index.sources.threadHistoryDb).toEqual({
          path: fixture.threadHistoryDb,
          availability: 'unreadable',
          role: 'availability-only'
        });
        expect(index.diagnostics).toContainEqual(expect.objectContaining({
          code: 'source-unreadable',
          source: 'thread-history-db',
          reason: 'unreadable'
        }));
        expect(index.sessions.map((session) => session.threadId).sort())
          .toEqual(fixture.expectedThreadIds);
        expect(close).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(index)).not.toContain(secret);
      } finally {
        openSpy.mockRestore();
      }
    }
  );

  test(
    'threadHistoryDb FileHandle.close is not called when open fails',
    async () => {
      const fixture = await createHistoryCloseFixture('synthetic-open-failure');
      const originalOpen = fs.open.bind(fs);
      let historyOpenAttempts = 0;
      const successfulHandles: Array<{
        owner: string;
        closeSpy: ReturnType<typeof vi.spyOn>;
      }> = [];
      const openSpy = vi.spyOn(fs, 'open').mockImplementation(
        async (...args: Parameters<typeof fs.open>) => {
          const owner = path.resolve(String(args[0]));
          if (
            owner === fixture.threadHistoryDb
          ) {
            historyOpenAttempts += 1;
            throw Object.assign(new Error('synthetic missing file'), {
              code: 'ENOENT'
            });
          }
          const handle = await originalOpen(...args);
          successfulHandles.push({
            owner,
            closeSpy: vi.spyOn(handle, 'close')
          });
          return handle;
        }
      );
      try {
        const index = await buildCodexSessionIndex({
          sessionsDir: fixture.sessionsDir,
          stateDb: fixture.stateDb,
          threadHistoryDb: fixture.threadHistoryDb,
          project: 'D:\\Repo'
        });

        expect(index.sources.threadHistoryDb.availability).toBe('missing');
        expect(historyOpenAttempts).toBe(1);
        expect(successfulHandles.length).toBeGreaterThan(0);
        expect(successfulHandles.map(({ owner }) => owner))
          .not.toContain(fixture.threadHistoryDb);
        expect(successfulHandles.every(
          ({ closeSpy }) => closeSpy.mock.calls.length === 1
        )).toBe(true);
        expect(successfulHandles.reduce(
          (total, { closeSpy }) => total + closeSpy.mock.calls.length,
          0
        )).toBe(successfulHandles.length);
      } finally {
        openSpy.mockRestore();
        for (const { closeSpy } of successfulHandles) {
          closeSpy.mockRestore();
        }
      }
    }
  );

  test(
    'threadHistoryDb FileHandle.close closes a real present file exactly once',
    async () => {
      const fixture = await createHistoryCloseFixture('real-success');
      await fs.writeFile(fixture.threadHistoryDb, 'metadata only', 'utf8');
      const originalOpen = fs.open.bind(fs);
      let closeSpy: ReturnType<typeof vi.spyOn> | null = null;
      const openSpy = vi.spyOn(fs, 'open').mockImplementation(
        async (...args: Parameters<typeof fs.open>) => {
          const handle = await originalOpen(...args);
          if (
            path.resolve(String(args[0])) === fixture.threadHistoryDb
          ) {
            closeSpy = vi.spyOn(handle, 'close');
          }
          return handle;
        }
      );
      try {
        const index = await buildCodexSessionIndex({
          sessionsDir: fixture.sessionsDir,
          stateDb: fixture.stateDb,
          threadHistoryDb: fixture.threadHistoryDb,
          project: 'D:\\Repo'
        });

        expect(index.sources.threadHistoryDb.availability).toBe('present');
        expect(closeSpy).not.toBeNull();
        expect(closeSpy).toHaveBeenCalledTimes(1);
      } finally {
        closeSpy?.mockRestore();
        openSpy.mockRestore();
      }
    }
  );

  test.each([
    'present',
    'missing',
    'unreadable'
  ] as const)(
    'treats threadHistoryDb %s as metadata-only without changing sessions',
    async (availability) => {
      const sessionsDir = path.join(tempRoot, `history-${availability}`, 'sessions');
      const stateDb = path.join(tempRoot, `history-${availability}`, 'state.sqlite');
      const threadHistoryDb = path.join(
        tempRoot,
        `history-${availability}`,
        'thread_history_1.sqlite'
      );
      const rolloutPath = path.join(sessionsDir, 'rollout-only.jsonl');
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(rolloutPath, [
        JSON.stringify({
          timestamp: '2026-08-17T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'rollout-only-thread',
            cwd: 'D:\\Repo',
            thread_source: 'user'
          }
        }),
        JSON.stringify({
          timestamp: '2026-08-17T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Rollout only' }
        })
      ].join('\n'), 'utf8');
      const db = new DatabaseSync(stateDb);
      db.exec(
        'create table threads (' +
        'id text, rollout_path text, updated_at integer, source text, cwd text, ' +
        'first_user_message text, thread_source text, preview text)'
      );
      db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          'state-only-thread',
          path.join(tempRoot, 'missing-state-rollout.jsonl'),
          1,
          'cli',
          'D:\\Repo',
          'State only',
          'user',
          'State summary'
        );
      db.close();

      if (availability === 'present') {
        await fs.writeFile(
          threadHistoryDb,
          'deliberately not a SQLite database',
          'utf8'
        );
      }
      const originalOpen = fs.open.bind(fs);
      const openSpy = vi.spyOn(fs, 'open').mockImplementation(
        async (...args: Parameters<typeof fs.open>) => {
          const requestedPath = path.resolve(String(args[0]));
          if (
            availability === 'unreadable' &&
            requestedPath === threadHistoryDb
          ) {
            throw Object.assign(new Error('synthetic unreadable file'), {
              code: 'EACCES'
            });
          }
          return originalOpen(...args);
        }
      );
      const prepareSpy = vi.spyOn(DatabaseSync.prototype, 'prepare');

      try {
        const index = await buildCodexSessionIndex({
          sessionsDir,
          stateDb,
          threadHistoryDb,
          project: 'D:\\Repo'
        });

        expect(index.sources.threadHistoryDb).toEqual({
          path: threadHistoryDb,
          availability,
          role: 'availability-only'
        });
        expect(index.sessions.map((session) => session.threadId).sort())
          .toEqual(['rollout-only-thread', 'state-only-thread']);
        expect(openSpy.mock.calls.filter(
          ([candidate]) => path.resolve(String(candidate)) === threadHistoryDb
        )).toHaveLength(1);
        expect(prepareSpy).toHaveBeenCalledTimes(1);
        expect(prepareSpy.mock.calls[0]?.[0])
          .toBe('select * from threads order by id limit ?');
      } finally {
        prepareSpy.mockRestore();
        openSpy.mockRestore();
      }
    }
  );

  test('selects the latest rollout timestamp by epoch across mixed offsets', async () => {
    const sessionsDir = path.join(tempRoot, 'mixed-offset-rollout');
    const rolloutPath = path.join(sessionsDir, 'mixed-offset.jsonl');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-08-17T08:00:00+08:00',
        type: 'session_meta',
        payload: {
          id: 'mixed-offset-thread',
          cwd: 'D:\\Repo',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-17T01:30:00+00:00',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Review' }
      })
    ].join('\n'), 'utf8');
    await fs.utimes(
      rolloutPath,
      new Date('2020-01-01T00:00:00.000Z'),
      new Date('2020-01-01T00:00:00.000Z')
    );

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions[0]?.updatedAt)
      .toBe('2026-08-17T01:30:00.000Z');
  });

  test('keeps a valid rollout timestamp when a later raw value is invalid', async () => {
    const sessionsDir = path.join(tempRoot, 'invalid-late-timestamp');
    const rolloutPath = path.join(sessionsDir, 'invalid-late.jsonl');
    const secret = 'syntheticInvalidTimestampSecret123456';
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-08-17T01:30:00Z',
        type: 'session_meta',
        payload: {
          id: 'valid-then-invalid-thread',
          cwd: 'D:\\Repo',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: `zzzz-${secret}`,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Review' }
      })
    ].join('\n'), 'utf8');
    await fs.utimes(
      rolloutPath,
      new Date('2020-01-01T00:00:00.000Z'),
      new Date('2020-01-01T00:00:00.000Z')
    );

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions[0]?.updatedAt)
      .toBe('2026-08-17T01:30:00.000Z');
    expect(index.diagnostics).toContainEqual(expect.objectContaining({
      code: 'privacy-projection-dropped',
      source: 'rollout',
      field: 'updatedAt',
      reason: 'invalid-record'
    }));
    expect(JSON.stringify(index)).not.toContain(secret);
  });

  test('merges duplicate rollout thread IDs before downstream projection', async () => {
    const sessionsDir = path.join(tempRoot, 'duplicate-rollout-thread');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, 'older.jsonl'), [
      JSON.stringify({
        timestamp: '2026-08-17T00:00:00Z',
        type: 'session_meta',
        payload: {
          id: 'duplicate-rollout-thread',
          cwd: 'D:\\Other',
          originator: 'codex-tui',
          source: 'cli',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-17T00:00:01Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Older prompt' }
      })
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(sessionsDir, 'newer.jsonl'), [
      JSON.stringify({
        timestamp: '2026-08-17T02:00:00+00:00',
        type: 'session_meta',
        payload: {
          id: 'duplicate-rollout-thread',
          cwd: 'D:\\Repo',
          originator: 'Codex Desktop',
          source: 'vscode',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-17T02:00:01+00:00',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Newer prompt' }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });
    const resolution = resolveCodexSessions(index.sessions, 'D:\\Repo');
    const graph = buildSessionFederation({
      project: 'D:\\Repo',
      codexSessions: index.sessions
    });

    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]).toMatchObject({
      threadId: 'duplicate-rollout-thread',
      cwdRaw: 'D:\\Repo',
      updatedAt: '2026-08-17T02:00:01.000Z',
      firstUserPrompt: 'Newer prompt'
    });
    expect(resolution.totals.defaultVisible).toBe(1);
    expect(graph.nodes.filter((node) =>
      node.id === 'codex-thread:duplicate-rollout-thread'
    )).toHaveLength(1);
  });

  test('merges state-row authority with orphan rollout evidence coherently', async () => {
    const sessionsDir = path.join(tempRoot, 'state-orphan-merge');
    const rolloutPath = path.join(sessionsDir, 'orphan.jsonl');
    const stateDb = path.join(tempRoot, 'state-orphan-merge.sqlite');
    const threadId = 'state-orphan-shared-thread';
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-08-17T02:00:00Z',
        type: 'session_meta',
        payload: {
          id: threadId,
          cwd: 'D:\\Other',
          originator: 'codex-tui',
          source: 'cli',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-17T02:00:01Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Orphan prompt' }
      })
    ].join('\n'), 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text, rollout_path text, updated_at integer, source text, cwd text,
      first_user_message text, thread_source text, preview text
    )`);
    db.prepare('insert into threads values (?, null, ?, ?, ?, ?, ?, ?)')
      .run(
        threadId,
        Date.parse('2026-08-17T01:00:00Z'),
        'vscode',
        'D:\\Repo',
        'State prompt',
        'user',
        'State summary'
      );
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });
    const resolution = resolveCodexSessions(index.sessions, 'D:\\Repo');
    const retention = createRetentionManifest(index.sessions);
    const graph = buildSessionFederation({
      project: 'D:\\Repo',
      codexSessions: index.sessions
    });

    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]).toMatchObject({
      threadId,
      source: 'codex-app',
      cwdRaw: 'D:\\Repo',
      firstUserPrompt: 'State prompt',
      lastSummary: 'State summary',
      stateDbPresent: true,
      rolloutPath,
      rolloutPresent: true,
      storageState: 'active'
    });
    expect(resolution.sessions).toHaveLength(1);
    expect(resolution.totals.defaultVisible).toBe(1);
    expect(retention.sessions).toEqual([
      expect.objectContaining({
        threadId,
        rolloutPath,
        rolloutPresent: true,
        stateDbPresent: true,
        risk: 'ok'
      })
    ]);
    expect(graph.nodes.filter((node) =>
      node.id === `codex-thread:${threadId}`
    )).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({ storageState: 'active' })
      })
    ]);
  });

  test('uses a stable total-order tie-break independent of insertion order', async () => {
    const threadId = 'fully-tied-state-thread';
    const rows = [
      {
        cwd: 'D:\\Repo\\alpha',
        prompt: 'Alpha prompt',
        summary: 'Alpha summary'
      },
      {
        cwd: 'D:\\Repo\\beta',
        prompt: 'Beta prompt',
        summary: 'Beta summary'
      }
    ];
    const buildFromRows = async (
      fixture: string,
      orderedRows: typeof rows
    ): Promise<CodexSessionRecord> => {
      const sessionsDir = path.join(tempRoot, fixture, 'sessions');
      const stateDb = path.join(tempRoot, fixture, 'state.sqlite');
      await fs.mkdir(sessionsDir, { recursive: true });
      const db = new DatabaseSync(stateDb);
      db.exec(`create table threads (
        id text, rollout_path text, updated_at integer, source text, cwd text,
        first_user_message text, thread_source text, preview text
      )`);
      const insert = db.prepare(
        'insert into threads values (?, null, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of orderedRows) {
        insert.run(
          threadId,
          Date.parse('2026-08-17T01:00:00Z'),
          'vscode',
          row.cwd,
          row.prompt,
          'user',
          row.summary
        );
      }
      db.close();
      const index = await buildCodexSessionIndex({
        sessionsDir,
        stateDb,
        threadHistoryDb: path.join(tempRoot, fixture, 'missing-history.sqlite'),
        project: 'D:\\Repo'
      });
      expect(index.sessions).toHaveLength(1);
      return index.sessions[0]!;
    };

    const forward = await buildFromRows('tie-forward', rows);
    const reversed = await buildFromRows('tie-reversed', [...rows].reverse());

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      threadId,
      cwdRaw: 'D:\\Repo\\alpha',
      firstUserPrompt: 'Alpha prompt',
      lastSummary: 'Alpha summary',
      stateDbPresent: true,
      rolloutPath: null,
      rolloutPresent: false,
      storageState: 'missing'
    });
  });

  test('bounds SQLite admission before constructing session candidates', async () => {
    const sessionsDir = path.join(tempRoot, 'bounded-sqlite-sessions');
    const stateDb = path.join(tempRoot, 'bounded-state.sqlite');
    const historyDb = path.join(tempRoot, 'bounded-history.sqlite');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(historyDb, '', 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text, rollout_path text, updated_at integer, source text, cwd text,
      first_user_message text, thread_source text, preview text
    )`);
    const insert = db.prepare(
      'insert into threads values (?, null, 1, ?, ?, ?, ?, ?)'
    );
    for (const threadId of ['thread-a', 'thread-b', 'thread-c']) {
      insert.run(
        threadId,
        'vscode',
        'D:\\Repo',
        threadId,
        'user',
        threadId
      );
    }
    db.close();

    await withIndexArtifactLimits({ sessions: 2 }, async ({
      buildCodexSessionIndex: buildWithLimits
    }) => {
      const index = await buildWithLimits({
        sessionsDir,
        stateDb,
        threadHistoryDb: historyDb,
        project: 'D:\\Repo'
      });

      expect(index.sessions.map((session) => session.threadId))
        .toEqual(['thread-a', 'thread-b']);
      expect(index.diagnostics).toContainEqual({
        code: 'record-skipped',
        source: 'state-row',
        field: null,
        reason: 'capacity-exceeded',
        subjectDigest: null
      });
    });
  });

  test('stops recursive rollout admission after the overflow sentinel', async () => {
    const sessionsDir = path.join(tempRoot, 'bounded-rollout-sessions');
    const stateDb = path.join(tempRoot, 'bounded-rollout-state.sqlite');
    const historyDb = path.join(tempRoot, 'bounded-rollout-history.sqlite');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(historyDb, '', 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text, rollout_path text, updated_at integer, source text, cwd text,
      first_user_message text, thread_source text, preview text
    )`);
    db.close();
    for (const name of ['a', 'b', 'c', 'd']) {
      const directory = path.join(sessionsDir, name);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'rollout.jsonl'), JSON.stringify({
        type: 'session_meta',
        payload: {
          id: `thread-${name}`,
          cwd: 'D:\\Repo',
          thread_source: 'user'
        }
      }), 'utf8');
    }
    const readdir = vi.spyOn(fs, 'readdir');
    try {
      await withIndexArtifactLimits({ sessions: 2 }, async ({
        buildCodexSessionIndex: buildWithLimits
      }) => {
        const index = await buildWithLimits({
          sessionsDir,
          stateDb,
          threadHistoryDb: historyDb,
          project: 'D:\\Repo'
        });

        expect(index.sessions.map((session) => session.threadId).sort())
          .toEqual(['thread-a', 'thread-b']);
        expect(index.diagnostics).toContainEqual({
          code: 'record-skipped',
          source: 'state-row',
          field: null,
          reason: 'capacity-exceeded',
          subjectDigest: null
        });
      });
      expect(readdir.mock.calls.some(([directory]) =>
        directory === path.join(sessionsDir, 'd')
      )).toBe(false);
    } finally {
      readdir.mockRestore();
    }
  });

  test('caps builder diagnostics with one fixed capacity marker', async () => {
    const sessionsDir = path.join(tempRoot, 'bounded-diagnostics-sessions');
    const stateDb = path.join(tempRoot, 'bounded-diagnostics-state.sqlite');
    const historyDb = path.join(
      tempRoot,
      'bounded-diagnostics-history.sqlite'
    );
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(historyDb, '', 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text, rollout_path text, updated_at integer, source text, cwd text,
      first_user_message text, thread_source text, preview text
    )`);
    db.close();
    for (let index = 0; index < 4; index += 1) {
      await fs.writeFile(
        path.join(sessionsDir, `invalid-${index}.jsonl`),
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: `invalid/thread-${index}`,
            cwd: 'D:\\Repo',
            thread_source: 'user'
          }
        }),
        'utf8'
      );
    }

    await withIndexArtifactLimits(
      { sessions: 10, diagnostics: 3 },
      async ({ buildCodexSessionIndex: buildWithLimits }) => {
        const index = await buildWithLimits({
          sessionsDir,
          stateDb,
          threadHistoryDb: historyDb,
          project: 'D:\\Repo'
        });
        const capacityDiagnostics = index.diagnostics.filter((diagnostic) =>
          diagnostic.reason === 'capacity-exceeded'
        );

        expect(index.diagnostics).toHaveLength(3);
        expect(capacityDiagnostics).toEqual([{
          code: 'record-skipped',
          source: 'state-row',
          field: null,
          reason: 'capacity-exceeded',
          subjectDigest: null
        }]);
      }
    );
  });

  test('drops SQLite and rollout records with invalid core thread IDs', async () => {
    const sessionsDir = path.join(tempRoot, 'invalid-thread-ids');
    const stateDb = path.join(tempRoot, 'state.sqlite');
    const invalidStateThreadId = 'sk-proj-secret-shaped';
    const invalidRolloutThreadId = 'thread/with/slash';
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, 'invalid.jsonl'), JSON.stringify({
      type: 'session_meta',
      payload: {
        id: invalidRolloutThreadId,
        cwd: 'D:\\Repo',
        thread_source: 'user'
      }
    }), 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`
      create table threads (
        id text,
        rollout_path text,
        updated_at integer,
        source text,
        cwd text,
        title text,
        thread_source text,
        preview text
      )
    `);
    db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        invalidStateThreadId,
        null,
        1,
        'vscode',
        'D:\\Repo',
        'Unsafe state row',
        'user',
        'Unsafe state row'
      );
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions).toEqual([]);
    expect(index.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'record-skipped',
        source: 'state-row',
        field: 'threadId',
        reason: 'unsafe-identity'
      }),
      expect.objectContaining({
        code: 'record-skipped',
        source: 'rollout',
        field: 'threadId',
        reason: 'unsafe-identity'
      })
    ]));
    expect(JSON.stringify(index)).not.toContain(invalidStateThreadId);
    expect(JSON.stringify(index)).not.toContain(invalidRolloutThreadId);
  });

  test('projects index v3 records and diagnostics without raw unsafe values', async () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const unsafeRoot = path.join(tempRoot, secret);
    const sessionsDir = path.join(unsafeRoot, 'sessions');
    const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
    const stateDb = path.join(unsafeRoot, `raw exception payload ${secret}.sqlite`);
    const threadHistoryDb = path.join(
      unsafeRoot,
      `missing-history-${secret}.sqlite`
    );
    const taskContext = path.join(unsafeRoot, `task-${secret}.json`);
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-08-17T08:00:00+08:00',
        type: 'session_meta',
        payload: {
          id: 'privacy-thread',
          cwd: `D:\\Repo\\${secret}`,
          originator: `Codex Desktop ${secret}`,
          source: 'vscode',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-17T08:00:01+08:00',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: `Audit D:\\Repo\\${secret} with ${secret}`
        }
      }),
      `raw exception payload ${secret}`
    ].join('\n'), 'utf8');
    await fs.writeFile(stateDb, `raw exception payload ${secret}`, 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb,
      taskContext,
      project: 'D:\\Repo'
    });
    const serialized = JSON.stringify(index);

    expect(index.schemaVersion).toBe('hooks.codex-session-index/v3');
    expect(index.sources).toEqual({
      sessionsDir: { path: null, availability: 'present' },
      stateDb: { path: null, availability: 'unreadable' },
      threadHistoryDb: {
        path: null,
        availability: 'missing',
        role: 'availability-only'
      },
      taskContext: { path: null, availability: 'missing' }
    });
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]).toMatchObject({
      threadId: 'privacy-thread',
      cwdRaw: null,
      cwdNorm: null,
      rolloutPath: null,
      updatedAt: '2026-08-17T00:00:01.000Z'
    });
    expect(index.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'source-unreadable',
        source: 'state-db',
        field: 'path',
        reason: 'unreadable'
      }),
      expect.objectContaining({
        code: 'rollout-jsonl-invalid',
        source: 'rollout',
        reason: 'invalid-json'
      }),
      expect.objectContaining({
        code: 'privacy-projection-dropped',
        source: 'rollout',
        reason: 'unsafe-path'
      })
    ]));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('raw exception payload');
  });

  test('drops an unsafe rollout timestamp without dropping the session record', async () => {
    const secret = 'sk-proj-unsafeTimestamp1234567890';
    const sessionsDir = path.join(tempRoot, 'unsafe-timestamp');
    const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
    const stateDb = path.join(tempRoot, 'unsafe-timestamp.sqlite');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, JSON.stringify({
      timestamp: secret,
      type: 'session_meta',
      payload: {
        id: 'unsafe-timestamp-thread',
        cwd: 'D:\\Repo',
        thread_source: 'user'
      }
    }), 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text, rollout_path text, updated_at text, source text, cwd text,
      first_user_message text, thread_source text, preview text
    )`);
    db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'unsafe-timestamp-thread',
        rolloutPath,
        null,
        'vscode',
        'D:\\Repo',
        'Implement bridge',
        'user',
        null
      );
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]?.updatedAt).toBeNull();
    expect(index.diagnostics).toContainEqual(expect.objectContaining({
      code: 'privacy-projection-dropped',
      source: 'rollout',
      field: 'updatedAt',
      reason: 'invalid-record'
    }));
    expect(JSON.stringify(index)).not.toContain(secret);
  });

  test('strictly reconstructs index v3 and projects unsafe nullable fields', async () => {
    const {
      validateCodexSessionIndexArtifact
    } = await import('../src/codex-session-index-artifact.js');
    const validArtifact = {
      schemaVersion: 'hooks.codex-session-index/v3',
      generatedAt: '2026-08-17T08:00:00+08:00',
      sources: {
        sessionsDir: {
          path: 'D:\\Repo\\sessions',
          availability: 'present'
        },
        stateDb: {
          path: 'D:\\Repo\\state.sqlite',
          availability: 'present'
        },
        threadHistoryDb: {
          path: 'D:\\Repo\\history.sqlite',
          availability: 'present',
          role: 'availability-only'
        },
        taskContext: null
      },
      sessions: [{
        threadId: 'thread-1',
        source: 'codex-app',
        threadSource: 'user',
        originator: 'Codex Desktop',
        cwdRaw: 'D:\\Repo',
        cwdNorm: 'd:/repo',
        projectOwner: 'D:\\Repo',
        scopeMatch: 'exact',
        confidence: 1,
        rolloutPath: 'D:\\Repo\\sessions\\rollout.jsonl',
        stateDbPresent: true,
        rolloutPresent: true,
        updatedAt: '2026-08-17T08:00:01+08:00',
        firstUserPrompt: 'Implement bridge',
        lastSummary: null,
        storageState: 'active',
        runtimeScope: 'exact',
        projectRelation: 'owned',
        relationConfidence: 1,
        relationReasons: ['matched task binding'],
        evidence: [{ kind: 'cwd', relation: 'exact' }],
        appVisibility: 'unknown',
        taskBinding: {
          taskId: 'task-1',
          projectPathRaw: 'D:\\Repo',
          worktreeRootRaw: 'D:\\Repo'
        },
        delegatedFromThreadId: null,
        primaryTargetRaw: 'D:\\Repo',
        primaryTargetNorm: 'd:/repo'
      }],
      diagnostics: []
    };

    const reconstructed = validateCodexSessionIndexArtifact(validArtifact);
    expect(reconstructed.generatedAt).toBe('2026-08-17T00:00:00.000Z');
    expect(reconstructed.sessions[0]?.updatedAt)
      .toBe('2026-08-17T00:00:01.000Z');
    expect(reconstructed).not.toBe(validArtifact);
    expect(reconstructed.sessions[0]).not.toBe(validArtifact.sessions[0]);

    const unsafeIdentity = structuredClone(validArtifact);
    unsafeIdentity.sessions[0]!.threadId = 'sk-proj-secret-shaped';
    const dropped = validateCodexSessionIndexArtifact(unsafeIdentity);
    expect(dropped.sessions).toEqual([]);
    expect(dropped.diagnostics).toContainEqual(expect.objectContaining({
      code: 'record-skipped',
      source: 'state-row',
      field: 'threadId',
      reason: 'unsafe-identity'
    }));
    expect(JSON.stringify(dropped)).not.toContain('sk-proj-secret-shaped');

    const unsafeNullablePath = structuredClone(validArtifact);
    unsafeNullablePath.sessions[0]!.rolloutPath =
      'D:\\Repo\\sk-proj-secret-shaped\\rollout.jsonl';
    const projected = validateCodexSessionIndexArtifact(unsafeNullablePath);
    expect(projected.sessions[0]?.rolloutPath).toBeNull();
    expect(projected.diagnostics).toContainEqual(expect.objectContaining({
      code: 'privacy-projection-dropped',
      field: 'rolloutPath',
      reason: 'unsafe-path'
    }));
    expect(JSON.stringify(projected)).not.toContain('sk-proj-secret-shaped');
  });

  test('shares canonical diagnostic keys across raw, source, and session projection', async () => {
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'src', 'codex-session-index-artifact.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/\bdiagnostics\.some\s*\(/u);

    const secret = 'sk-shared-diagnostic-key-secret';
    const unsafePath = `D:\\Repo\\${secret}\\rollout.jsonl`;
    const sourceDiagnostic: CodexSessionDiagnostic = {
      code: 'privacy-projection-dropped',
      source: 'sessions-dir',
      field: 'path',
      reason: 'unsafe-path',
      subjectDigest: digestDiagnosticSubject(unsafePath)
    };
    const sessionDiagnostic: CodexSessionDiagnostic = {
      ...sourceDiagnostic,
      source: 'state-row',
      field: 'rolloutPath'
    };
    const artifact = indexArtifact([
      artifactSession('diagnostic-key-one', { rolloutPath: unsafePath }),
      artifactSession('diagnostic-key-two', { rolloutPath: unsafePath })
    ], [sourceDiagnostic, sessionDiagnostic]);
    artifact.sources.sessionsDir.path = unsafePath;

    const projected = validateCodexSessionIndexArtifact(artifact);

    expect(projected.diagnostics).toEqual([
      sourceDiagnostic,
      sessionDiagnostic
    ]);
    expect(JSON.stringify(projected)).not.toContain(secret);
  });

  test('enforces exact index v3 array and diagnostic field boundaries', () => {
    const reasonLimit =
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.relationReasons;
    const evidenceLimit =
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.evidencePerRecord;
    const diagnosticFieldLimit =
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnosticField;
    const reasonsAtLimit = Array.from(
      { length: reasonLimit },
      (_value, index) => `reason-${index}`
    );
    const evidenceAtLimit = Array.from(
      { length: evidenceLimit },
      () => ({ kind: 'cwd' as const, relation: 'exact' as const })
    );
    const diagnosticAtLimit: CodexSessionDiagnostic = {
      ...artifactDiagnostic(1),
      field: `f${'x'.repeat(diagnosticFieldLimit - 1)}`
    };

    expect(validateCodexSessionIndexArtifact(indexArtifact([
      artifactSession('boundary-thread', {
        relationReasons: reasonsAtLimit,
        evidence: evidenceAtLimit
      })
    ], [diagnosticAtLimit])).sessions).toHaveLength(1);

    expect(() => validateCodexSessionIndexArtifact(indexArtifact([
      artifactSession('reason-overflow', {
        relationReasons: [...reasonsAtLimit, 'overflow']
      })
    ]))).toThrow(/relationReasons: capacity-exceeded/u);
    expect(() => validateCodexSessionIndexArtifact(indexArtifact([
      artifactSession('evidence-overflow', {
        evidence: [
          ...evidenceAtLimit,
          { kind: 'cwd', relation: 'exact' }
        ]
      })
    ]))).toThrow(/evidence: capacity-exceeded/u);
    expect(() => validateCodexSessionIndexArtifact(indexArtifact([], [{
      ...diagnosticAtLimit,
      field: `f${'x'.repeat(diagnosticFieldLimit)}`
    }]))).toThrow(/diagnostics\[0\]\.field: invalid-shape/u);
  });

  test('enforces raw diagnostic capacity before deduplicating accepted input', () => {
    const diagnosticLimit =
      CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnostics;
    const duplicate = artifactDiagnostic(1);
    const duplicatesAtLimit = validateCodexSessionIndexArtifact(indexArtifact(
      [],
      Array.from({ length: diagnosticLimit }, () => duplicate)
    ));
    expect(duplicatesAtLimit.diagnostics).toEqual([duplicate]);
    const overflowDuplicate = {
      ...duplicate,
      rawUnsafeDiagnostic: 'sk-diagnostic-overflow-secret'
    };
    const overflowError = (() => {
      try {
        validateCodexSessionIndexArtifact(indexArtifact(
          [],
          Array.from(
            { length: diagnosticLimit + 1 },
            () => overflowDuplicate
          )
        ));
      } catch (reason) {
        return reason as Error;
      }
      throw new Error('expected raw diagnostics capacity rejection');
    })();
    expect(overflowError.message).toBe(
      'CODEX_SESSION_INDEX_ARTIFACT: diagnostics: capacity-exceeded'
    );
    expect(overflowError.message).not.toContain(
      'sk-diagnostic-overflow-secret'
    );

    const atLimit = Array.from(
      { length: diagnosticLimit },
      (_value, index) => artifactDiagnostic(index)
    );
    expect(validateCodexSessionIndexArtifact(
      indexArtifact([], atLimit)
    ).diagnostics).toHaveLength(diagnosticLimit);
    expect(() => validateCodexSessionIndexArtifact(indexArtifact(
      [],
      [...atLimit, artifactDiagnostic(diagnosticLimit)]
    ))).toThrow(/diagnostics: capacity-exceeded/u);
  });

  test('accepts exactly the session capacity and rejects one additional record', () => {
    const sessionLimit = CODEX_SESSION_INDEX_ARTIFACT_LIMITS.sessions;
    const atLimit = Array.from(
      { length: sessionLimit },
      (_value, index) => artifactSession(`capacity-thread-${index}`)
    );

    expect(validateCodexSessionIndexArtifact(
      indexArtifact(atLimit)
    ).sessions).toHaveLength(sessionLimit);
    expect(() => validateCodexSessionIndexArtifact(indexArtifact([
      ...atLimit,
      artifactSession(`capacity-thread-${sessionLimit}`)
    ]))).toThrow(/sessions: capacity-exceeded/u);
  });

  test('rejects duplicate thread IDs without echoing the identity', () => {
    const duplicateThreadId = 'duplicate-thread-id';
    const error = (() => {
      try {
        validateCodexSessionIndexArtifact(indexArtifact([
          artifactSession(duplicateThreadId),
          artifactSession(duplicateThreadId, {
            rolloutPath: 'D:\\Repo\\sessions\\other.jsonl'
          })
        ]));
      } catch (reason) {
        return reason as Error;
      }
      throw new Error('expected duplicate thread ID rejection');
    })();

    expect(error.message).toContain('sessions');
    expect(error.message).not.toContain(duplicateThreadId);
  });

  type MutableIndexArtifactFixture = Record<string, unknown> & {
    sources: {
      sessionsDir: Record<string, unknown>;
    };
    sessions: Array<Record<string, unknown> & {
      evidence: Array<Record<string, unknown>>;
    }>;
    diagnostics: unknown[];
  };

  test.each([
    ['root unknown field', (value: MutableIndexArtifactFixture) => {
      value.unexpected = true;
    }],
    ['source unknown field', (value: MutableIndexArtifactFixture) => {
      value.sources.sessionsDir.unexpected = true;
    }],
    ['record unknown field', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].unexpected = true;
    }],
    ['invalid enum', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].source = 'desktop';
    }],
    ['invalid boolean', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].stateDbPresent = 1;
    }],
    ['timestamp without timezone', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].updatedAt = '2026-08-17T08:00:01';
    }],
    ['non-finite confidence', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].confidence = Number.POSITIVE_INFINITY;
    }],
    ['out-of-range confidence', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].relationConfidence = 1.01;
    }],
    ['oversized reasons array', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].relationReasons =
        Array.from({ length: 1_001 }, () => 'reason');
    }],
    ['oversized evidence array', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].evidence =
        Array.from({ length: 1_001 }, () => ({
          kind: 'cwd',
          relation: 'exact'
        }));
    }],
    ['evidence unknown field', (value: MutableIndexArtifactFixture) => {
      value.sessions[0].evidence[0].unexpected = true;
    }],
    ['diagnostic unknown enum', (value: MutableIndexArtifactFixture) => {
      value.diagnostics = [{
        code: 'raw-warning',
        source: 'rollout',
        field: null,
        reason: 'invalid-json',
        subjectDigest: null
      }];
    }]
  ])('rejects %s while reconstructing index v3', async (_name, mutate) => {
    const {
      validateCodexSessionIndexArtifact
    } = await import('../src/codex-session-index-artifact.js');
    const value = {
      schemaVersion: 'hooks.codex-session-index/v3',
      generatedAt: '2026-08-17T00:00:00.000Z',
      sources: {
        sessionsDir: { path: 'D:\\Repo\\sessions', availability: 'present' },
        stateDb: { path: 'D:\\Repo\\state.sqlite', availability: 'present' },
        threadHistoryDb: {
          path: 'D:\\Repo\\history.sqlite',
          availability: 'present',
          role: 'availability-only'
        },
        taskContext: null
      },
      sessions: [{
        threadId: 'thread-1',
        source: 'codex-app',
        threadSource: 'user',
        originator: 'Codex Desktop',
        cwdRaw: 'D:\\Repo',
        cwdNorm: 'd:/repo',
        projectOwner: 'D:\\Repo',
        scopeMatch: 'exact',
        confidence: 1,
        rolloutPath: 'D:\\Repo\\sessions\\rollout.jsonl',
        stateDbPresent: true,
        rolloutPresent: true,
        updatedAt: '2026-08-17T00:00:01.000Z',
        firstUserPrompt: 'Implement bridge',
        lastSummary: null,
        storageState: 'active',
        runtimeScope: 'exact',
        projectRelation: 'owned',
        relationConfidence: 1,
        relationReasons: ['matched task binding'],
        evidence: [{ kind: 'cwd', relation: 'exact' }],
        appVisibility: 'unknown',
        taskBinding: null,
        delegatedFromThreadId: null,
        primaryTargetRaw: null,
        primaryTargetNorm: null
      }],
      diagnostics: []
    } as unknown as MutableIndexArtifactFixture;
    mutate(value);
    expect(() => validateCodexSessionIndexArtifact(value)).toThrow();
  });

  test.each([
    ['OpenAI', 'sk-syntheticOpenAi123456'],
    ['GitHub', 'ghp_syntheticGithub123456'],
    ['Slack', 'xoxb-syntheticSlack123456'],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.e30.syntheticJwtSignature123'
    ],
    ['AWS', `AKIA${'A'.repeat(16)}`],
    ['GitLab', 'glpat-syntheticToken1234567890'],
    ['npm', 'npm_syntheticToken12345678901234567890'],
    ['Hugging Face', 'hf_syntheticToken12345678901234567890'],
    ['Google', `AIza${'C'.repeat(35)}`],
    ['Stripe', `sk_live_${'D'.repeat(24)}`]
  ])(
    'uses raw lifecycle paths for relation classification but drops an unsafe %s task binding from every artifact',
    async (name, secret) => {
      const project = 'D:\\Repo';
      const fixtureId = `lifecycle-${name.toLowerCase().replaceAll(' ', '-')}`;
      const sessionsDir = path.join(tempRoot, fixtureId);
      const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
      const taskProjectPath = `${project}\\packages\\${secret}`;
      const worktreeRoot = `${project}\\worktrees\\${secret}`;
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(rolloutPath, [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: fixtureId,
            cwd: `${project}\\src`,
            thread_source: 'user'
          }
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'developer',
            content: [{
              type: 'input_text',
              text: [
                'ccpanes-task-probe lifecycle context',
                `taskId: task-${secret}`,
                `projectPath: ${taskProjectPath}`,
                `worktreeRoot: ${worktreeRoot}`
              ].join('\n')
            }]
          }
        })
      ].join('\n'), 'utf8');

      const index = await buildCodexSessionIndex({
        sessionsDir,
        stateDb: path.join(tempRoot, 'missing-state.sqlite'),
        threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
        project
      });
      const record = index.sessions[0];

      expect(record).toMatchObject({
        projectRelation: 'supporting',
        relationConfidence: 0.8,
        projectOwner: project,
        taskBinding: null
      });
      expect(record?.evidence.some((item) => item.kind === 'task-binding'))
        .toBe(false);

      const resolution = resolveCodexSessions(index.sessions, project);
      const graph = buildSessionFederation({
        generatedAt: '2026-08-16T00:00:00.000Z',
        project,
        codexSessions: resolution.sessions,
        ccpanes: null
      });
      for (const artifact of [index, resolution, graph]) {
        expect(JSON.stringify(artifact)).not.toContain(secret);
      }
      expect(graph.nodes.some((node) => node.type === 'ccpanes-task'))
        .toBe(false);
      expect(graph.edges.some((edge) => edge.type === 'belongs-to-task'))
        .toBe(false);
    }
  );

  test('drops overlong lifecycle paths without losing raw relation classification', async () => {
    const project = 'D:\\Repo';
    const sessionsDir = path.join(tempRoot, 'lifecycle-overlong');
    const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
    const overlongPath = `${project}\\${'x'.repeat(520)}`;
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'lifecycle-overlong',
          cwd: `${project}\\src`,
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{
            type: 'input_text',
            text: [
              'ccpanes-task-probe lifecycle context',
              'taskId: bounded-task',
              `projectPath: ${overlongPath}`,
              `worktreeRoot: ${overlongPath}`
            ].join('\n')
          }]
        }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project
    });
    const record = index.sessions[0];

    expect(record).toMatchObject({
      projectRelation: 'supporting',
      relationConfidence: 0.8,
      taskBinding: null
    });
    expect(record?.evidence.some((item) => item.kind === 'task-binding'))
      .toBe(false);
    expect(JSON.stringify(index)).not.toContain(overlongPath);
  });

  test('drops the whole lifecycle binding when either path requires redaction', async () => {
    const project = 'D:\\Repo';
    const sessionsDir = path.join(tempRoot, 'lifecycle-redacted-paths');
    const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
    const projectSecret = 'glpat-syntheticLifecyclePath123456';
    const worktreeSecret = `AKIA${'L'.repeat(16)}`;
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'lifecycle-redacted-paths',
          cwd: `${project}\\src`,
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{
            type: 'input_text',
            text: [
              'ccpanes-task-probe lifecycle context',
              'taskId: safe-task',
              `projectPath: ${project}\\packages\\${projectSecret}`,
              `worktreeRoot: ${project}\\worktrees\\${worktreeSecret}`
            ].join('\n')
          }]
        }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project
    });
    const record = index.sessions[0];

    expect(record).toMatchObject({
      projectRelation: 'supporting',
      relationConfidence: 0.8,
      taskBinding: null
    });
    expect(record?.evidence.some((item) => item.kind === 'task-binding'))
      .toBe(false);

    const resolution = resolveCodexSessions(index.sessions, project);
    const graph = buildSessionFederation({
      generatedAt: '2026-08-16T00:00:00.000Z',
      project,
      codexSessions: resolution.sessions,
      ccpanes: null
    });
    for (const artifact of [index, resolution, graph]) {
      const serialized = JSON.stringify(artifact);
      expect(serialized).not.toContain(projectSecret);
      expect(serialized).not.toContain(worktreeSecret);
    }
    expect(graph.nodes.some((node) => node.type === 'ccpanes-task'))
      .toBe(false);
    expect(graph.edges.some((edge) => edge.type === 'belongs-to-task'))
      .toBe(false);
  });

  test('bounds the shared redaction core by UTF-8 bytes and repairs lone surrogates', async () => {
    const indexModule = await import('../src/codex-session-index.js');
    const redactor = (
      indexModule as Record<string, unknown>
    ).redactCodexSessionArtifactValue as undefined | ((
      value: string | null
    ) => { value: string | null; changed: boolean });

    expect(typeof redactor).toBe('function');
    if (!redactor) return;

    const maxBytes = 64 * 1024;
    const prefix = '界'.repeat((maxBytes - 4) / 3);
    const secret = `AKIA${'Z'.repeat(16)}`;
    const bounded = redactor(`${prefix}😀\uD800${secret}`);
    expect(Buffer.byteLength(bounded.value ?? '', 'utf8')).toBe(maxBytes);
    expect(bounded.value?.endsWith('😀')).toBe(true);
    expect(bounded.value).not.toContain(secret);
    expect(bounded.changed).toBe(true);

    const repaired = redactor('alpha\uD800omega');
    expect(repaired).toEqual({
      value: 'alpha�omega',
      changed: true
    });
  });

  test('keeps raw overlong primary-target classification but omits its display projection and evidence', async () => {
    const project = 'D:\\Repo';
    const sessionsDir = path.join(tempRoot, 'primary-target-overlong');
    const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
    const overlongTarget = `${project}\\${'x'.repeat(520)}`;
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'primary-target-overlong',
          cwd: `${project}\\src`,
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: `Audit "${overlongTarget}"`
        }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project
    });
    const record = index.sessions[0];

    expect(record).toMatchObject({
      projectRelation: 'supporting',
      relationConfidence: 0.8,
      primaryTargetRaw: null,
      primaryTargetNorm: null
    });
    expect(record?.evidence.some((item) => item.kind === 'primary-target'))
      .toBe(false);
    expect(record?.firstUserPrompt?.length).toBeLessThanOrEqual(512);
    expect(JSON.stringify(index)).not.toContain(overlongTarget);
  });

  test.each([
    {
      name: 'AWS AKIA access key',
      secret: `AKIA${'A'.repeat(16)}`
    },
    {
      name: 'AWS ASIA access key',
      secret: `ASIA${'B'.repeat(16)}`
    },
    {
      name: 'GitLab personal access token',
      secret: 'glpat-syntheticToken1234567890'
    },
    {
      name: 'GitHub OAuth token',
      secret: 'gho_syntheticGithubOAuth123456'
    },
    {
      name: 'GitHub user token',
      secret: 'ghu_syntheticGithubUser1234567'
    },
    {
      name: 'GitHub server token',
      secret: 'ghs_syntheticGithubServer12345'
    },
    {
      name: 'GitHub refresh token',
      secret: 'ghr_syntheticGithubRefresh1234'
    },
    {
      name: 'npm access token',
      secret: 'npm_syntheticToken12345678901234567890'
    },
    {
      name: 'Hugging Face token',
      secret: 'hf_syntheticToken12345678901234567890'
    },
    {
      name: 'Google API key',
      secret: `AIza${'C'.repeat(35)}`
    },
    {
      name: 'Stripe live secret key',
      secret: `sk_live_${'D'.repeat(24)}`
    },
    {
      name: 'Stripe live restricted key',
      secret: `rk_live_${'E'.repeat(24)}`
    }
  ])('redacts a bare $name from prompt and summary artifacts', async ({
    name,
    secret
  }) => {
    const sessionsDir = path.join(tempRoot, `sessions-${name}`);
    const stateDb = path.join(tempRoot, `state-${name}.sqlite`);
    const threadId =
      `redaction-${name.toLowerCase().replaceAll(' ', '-')}`;
    const raw = `Use ${secret}; keep npm_config_registry unchanged.`;
    await fs.mkdir(sessionsDir, { recursive: true });
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text primary key, rollout_path text, updated_at integer,
      source text, cwd text, first_user_message text, thread_source text, preview text
    )`);
    db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(threadId, null, 1, 'vscode', 'D:\\Repo', raw, 'user', raw);
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    const record = index.sessions[0];
    for (const artifact of [
      record?.firstUserPrompt,
      record?.lastSummary
    ]) {
      expect(artifact).toContain('[REDACTED]');
      expect(artifact).not.toContain(secret);
      expect(artifact).toContain('npm_config_registry');
    }
  });

  test.each([
    ['OpenAI', 'sk-syntheticOpenAi123456'],
    ['GitHub', 'ghp_syntheticGithub123456'],
    ['Slack', 'xoxb-syntheticSlack123456'],
    ['AWS', `AKIA${'F'.repeat(16)}`],
    ['GitLab', 'glpat-syntheticGitlab123456'],
    ['npm', 'npm_syntheticToken12345678901234567890'],
    ['Hugging Face', 'hf_syntheticToken12345678901234567890'],
    ['Google', `AIza${'G'.repeat(35)}`],
    ['Stripe', `sk_live_${'H'.repeat(24)}`]
  ] as const)(
    'redacts a hyphen-delimited %s provider token from an artifact excerpt',
    (_family, secret) => {
      const artifact = sanitizeCodexSessionArtifactExcerpt(
        `prefix-${secret}-suffix`
      );

      expect(artifact).toContain('[REDACTED]');
      expect(artifact).not.toContain(secret);
    }
  );

  test.each([
    ['OpenAI', 'sk-syntheticOpenAi123456'],
    ['GitHub', 'ghp_syntheticGithub123456'],
    ['Slack', 'xoxb-syntheticSlack123456'],
    ['AWS', `AKIA${'F'.repeat(16)}`],
    ['GitLab', 'glpat-syntheticGitlab123456'],
    ['npm', 'npm_syntheticToken12345678901234567890'],
    ['Hugging Face', 'hf_syntheticToken12345678901234567890'],
    ['Google', `AIza${'G'.repeat(35)}`],
    ['Stripe', `sk_live_${'H'.repeat(24)}`]
  ] as const)(
    'redacts a hyphen-delimited %s provider token from indexed prompt and summary',
    async (family, secret) => {
      const familySlug = family.toLowerCase().replaceAll(' ', '-');
      const sessionsDir = path.join(tempRoot, `hyphen-${familySlug}`);
      const stateDb = path.join(tempRoot, `hyphen-${familySlug}.sqlite`);
      const raw = `prefix-${secret}-suffix`;
      await fs.mkdir(sessionsDir, { recursive: true });
      const db = new DatabaseSync(stateDb);
      db.exec(`create table threads (
        id text primary key, rollout_path text, updated_at integer,
        source text, cwd text, first_user_message text, thread_source text, preview text
      )`);
      db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          `hyphen-${familySlug}`,
          null,
          1,
          'vscode',
          'D:\\Repo',
          raw,
          'user',
          raw
        );
      db.close();

      const index = await buildCodexSessionIndex({
        sessionsDir,
        stateDb,
        threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
        project: 'D:\\Repo'
      });

      for (const artifact of [
        index.sessions[0]?.firstUserPrompt,
        index.sessions[0]?.lastSummary
      ]) {
        expect(artifact).toContain('[REDACTED]');
        expect(artifact).not.toContain(secret);
      }
    }
  );

  test.each([
    'task-synthetic-sk-value',
    'desk-synthetic-sk-value',
    'risk-synthetic-sk-value'
  ])('does not redact an embedded OpenAI-like substring in %s', async (raw) => {
    const sessionsDir = path.join(tempRoot, `boundary-${raw.slice(0, 4)}`);
    const stateDb = path.join(tempRoot, `boundary-${raw.slice(0, 4)}.sqlite`);
    await fs.mkdir(sessionsDir, { recursive: true });
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text primary key, rollout_path text, updated_at integer,
      source text, cwd text, first_user_message text, thread_source text, preview text
    )`);
    db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(raw, null, 1, 'vscode', 'D:\\Repo', raw, 'user', raw);
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions[0]?.firstUserPrompt).toBe(raw);
    expect(index.sessions[0]?.lastSummary).toBe(raw);
  });

  test.each([8 * 1024, 32 * 1024])(
    'rejects an oversized %i-character identity before starting privacy scans',
    (length) => {
      const byteLength = vi.spyOn(Buffer, 'byteLength');
      try {
        const oversized = 'a'.repeat(length);
        expect(sanitizeCodexSessionPromptDerivedIdentifier(oversized))
          .toBeNull();
        expect(sanitizeCodexSessionExternalIdentity(oversized)).toBeNull();
        expect(byteLength).not.toHaveBeenCalled();
      } finally {
        byteLength.mockRestore();
      }
    }
  );

  test.each([
    [
      'external identity',
      sanitizeCodexSessionExternalIdentity
    ],
    [
      'prompt-derived identifier',
      sanitizeCodexSessionPromptDerivedIdentifier
    ]
  ] as const)(
    '%s requires lexical boundaries around embedded provider secrets',
    (_name, sanitize) => {
      const githubSecret = 'ghp_syntheticGithub123456';
      const awsSecret = `AKIA${'B'.repeat(16)}`;

      expect(sanitize(`parent-${githubSecret}`)).toBeNull();
      expect(sanitize(`parent-${awsSecret}`)).toBeNull();

      for (const ordinaryIdentity of [
        `parentx${githubSecret}`,
        `parent-${awsSecret}suffix`,
        'task-synthetic-sk-value',
        'desk-synthetic-sk-value',
        'risk-synthetic-sk-value'
      ]) {
        expect(sanitize(ordinaryIdentity)).toBe(ordinaryIdentity);
      }
    }
  );

  test('redacts sensitive artifact excerpts with one deterministic 512-character bound', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const stateDb = path.join(tempRoot, 'state.sqlite');
    await fs.mkdir(sessionsDir, { recursive: true });
    const cases = [
      {
        id: 'known-prefixes',
        raw: [
          'sk-syntheticOpenAi123456',
          'ghp_syntheticGithub123456',
          'github_pat_syntheticFineGrained_123456',
          'xoxb-syntheticSlack123456'
        ].join(' '),
        secrets: [
          'sk-syntheticOpenAi123456',
          'ghp_syntheticGithub123456',
          'github_pat_syntheticFineGrained_123456',
          'xoxb-syntheticSlack123456'
        ]
      },
      {
        id: 'authorization-and-jwt',
        raw: [
          'Authorization: Bearer syntheticAuthorization123456',
          'Bearer syntheticBearer123456',
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.syntheticJwtSignature123'
        ].join(' '),
        secrets: [
          'syntheticAuthorization123456',
          'syntheticBearer123456',
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.syntheticJwtSignature123'
        ]
      },
      {
        id: 'assignments',
        raw: [
          'token=syntheticToken123456',
          'apiKey: syntheticApiKey123456',
          '"api_key": "syntheticJsonApiKey123456"',
          'password=syntheticPassword123456',
          'passwd: syntheticPasswd123456',
          'secret = syntheticSecret123456'
        ].join(' '),
        secrets: [
          'syntheticToken123456',
          'syntheticApiKey123456',
          'syntheticJsonApiKey123456',
          'syntheticPassword123456',
          'syntheticPasswd123456',
          'syntheticSecret123456'
        ]
      },
      {
        id: 'expanded-sensitive-keys',
        raw: [
          'client_secret=syntheticClientSecretAssignment',
          'refresh-token: syntheticRefreshTokenAssignment',
          'AWS_SECRET_ACCESS_KEY=syntheticAwsAssignment',
          'https://example.test/callback?client-secret=syntheticClientSecretQuery&refresh_token=syntheticRefreshTokenQuery&aws-secret-access-key=syntheticAwsQuery'
        ].join(' '),
        secrets: [
          'syntheticClientSecretAssignment',
          'syntheticRefreshTokenAssignment',
          'syntheticAwsAssignment',
          'syntheticClientSecretQuery',
          'syntheticRefreshTokenQuery',
          'syntheticAwsQuery'
        ]
      },
      {
        id: 'provider-prefixed-sensitive-keys',
        raw: [
          'Discuss OPENAI_API_KEY rotation safely.',
          'OPENAI_API_KEY=syntheticOpenAiAssignment',
          '"AZURE_CLIENT_SECRET": "syntheticAzureAssignment"',
          'GITHUB_TOKEN: syntheticGithubAssignment',
          'tenant-client-secret=syntheticTenantAssignment',
          'https://example.test/callback?OPENAI_API_KEY=syntheticOpenAiQuery&AZURE_CLIENT_SECRET=syntheticAzureQuery&GITHUB_TOKEN=syntheticGithubQuery&tenant_client_secret=syntheticTenantQuery'
        ].join(' '),
        secrets: [
          'syntheticOpenAiAssignment',
          'syntheticAzureAssignment',
          'syntheticGithubAssignment',
          'syntheticTenantAssignment',
          'syntheticOpenAiQuery',
          'syntheticAzureQuery',
          'syntheticGithubQuery',
          'syntheticTenantQuery'
        ]
      },
      {
        id: 'short-base64url-jwt-segments',
        raw: [
          'eyJhbGciOiJIUzI1NiJ9.e30.abcdefgh',
          'eyJhbGciOiJIUzI1NiJ9.e30.abcd-_'
        ].join(' '),
        secrets: [
          'eyJhbGciOiJIUzI1NiJ9.e30.abcdefgh',
          'eyJhbGciOiJIUzI1NiJ9.e30.abcd-_'
        ]
      },
      {
        id: 'escaped-json-values',
        raw: [
          '"Authorization": "Bearer syntheticAuthPrefix\\"syntheticAuthSuffix"',
          '"api_key": "syntheticApiPrefix\\"syntheticApiSuffix"'
        ].join(' '),
        secrets: [
          'syntheticAuthPrefix',
          'syntheticAuthSuffix',
          'syntheticApiPrefix',
          'syntheticApiSuffix'
        ]
      },
      {
        id: 'pem-private-key',
        raw: [
          'before',
          '-----BEGIN PRIVATE KEY-----',
          'SYNTHETICPRIVATEKEYDATA123456',
          '-----END PRIVATE KEY-----',
          'after'
        ].join('\n'),
        secrets: ['SYNTHETICPRIVATEKEYDATA123456']
      },
      {
        id: 'pem-after-unicode-uppercase-expansion',
        raw: [
          'unicode ß prefix',
          '-----BEGIN PRIVATE KEY-----',
          'SYNTHETICUNICODEPRIVATEKEYDATA',
          '-----END PRIVATE KEY-----SAFE_SUFFIX'
        ].join('\n'),
        secrets: ['SYNTHETICUNICODEPRIVATEKEYDATA']
      },
      {
        id: 'unterminated-large-pem',
        raw: [
          'safe prefix',
          '-----BEGIN PRIVATE KEY-----',
          'SYNTHETICUNTERMINATEDPRIVATEKEY'.repeat(8_192)
        ].join('\n'),
        secrets: ['SYNTHETICUNTERMINATEDPRIVATEKEY']
      },
      {
        id: 'url-credentials',
        raw: [
          'https://syntheticUser:syntheticPassword@example.test/path',
          'https://example.test/callback?token=syntheticQueryToken&access_token=syntheticAccessToken&api_key=syntheticQueryApiKey&key=syntheticQueryKey&password=syntheticQueryPassword&secret=syntheticQuerySecret'
        ].join(' '),
        secrets: [
          'syntheticUser',
          'syntheticPassword',
          'syntheticQueryToken',
          'syntheticAccessToken',
          'syntheticQueryApiKey',
          'syntheticQueryKey',
          'syntheticQueryPassword',
          'syntheticQuerySecret'
        ]
      },
      {
        id: 'bounded-whitespace',
        raw: `  alpha \n\t beta token=syntheticBoundarySecret ${'x'.repeat(128 * 1024)}  `,
        secrets: ['syntheticBoundarySecret']
      },
      {
        id: 'surrogate-boundary',
        raw: `token=syntheticEmojiSecret ${'a'.repeat(493)}😀tail`,
        secrets: ['syntheticEmojiSecret']
      }
    ];
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text primary key, rollout_path text, updated_at integer,
      source text, cwd text, first_user_message text, thread_source text, preview text
    )`);
    const insert = db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const entry of cases) {
      insert.run(
        entry.id,
        null,
        1,
        'vscode',
        'D:\\Repo',
        entry.raw,
        'user',
        entry.raw
      );
    }
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    for (const entry of cases) {
      const record = index.sessions.find((session) => session.threadId === entry.id);
      expect(record).toBeDefined();
      for (const artifact of [record?.firstUserPrompt, record?.lastSummary]) {
        expect.soft(artifact).not.toBeNull();
        expect.soft(artifact).toContain('[REDACTED]');
        expect.soft(artifact?.length).toBeLessThanOrEqual(512);
        for (const secret of entry.secrets) {
          expect.soft(artifact).not.toContain(secret);
        }
      }
    }
    const providerPrefixed = index.sessions.find((session) =>
      session.threadId === 'provider-prefixed-sensitive-keys'
    );
    for (const artifact of [
      providerPrefixed?.firstUserPrompt,
      providerPrefixed?.lastSummary
    ]) {
      expect(artifact).toContain('Discuss OPENAI_API_KEY rotation safely.');
    }
    const unicodePem = index.sessions.find((session) =>
      session.threadId === 'pem-after-unicode-uppercase-expansion'
    );
    for (const artifact of [
      unicodePem?.firstUserPrompt,
      unicodePem?.lastSummary
    ]) {
      expect(artifact).toBe('unicode ß prefix [REDACTED]SAFE_SUFFIX');
    }
    const bounded = index.sessions.find((session) =>
      session.threadId === 'bounded-whitespace'
    )?.firstUserPrompt;
    expect(bounded).toHaveLength(512);
    expect(bounded).toMatch(/^alpha beta token=\[REDACTED\] /);
    expect(bounded?.endsWith('…')).toBe(true);
    const expectedEmojiBoundary =
      `token=[REDACTED] ${'a'.repeat(493)}…`;
    const emojiRecord = index.sessions.find((session) =>
      session.threadId === 'surrogate-boundary'
    );
    expect(emojiRecord?.firstUserPrompt).toBe(expectedEmojiBoundary);
    expect(emojiRecord?.lastSummary).toBe(expectedEmojiBoundary);
    expect(emojiRecord?.firstUserPrompt?.length).toBeLessThanOrEqual(512);
    expect(emojiRecord?.lastSummary?.length).toBeLessThanOrEqual(512);
    const unterminatedPem = index.sessions.find((session) =>
      session.threadId === 'unterminated-large-pem'
    );
    expect(unterminatedPem?.firstUserPrompt).toBe(
      'safe prefix [REDACTED]'
    );
    expect(unterminatedPem?.lastSummary).toBe(
      'safe prefix [REDACTED]'
    );
  });

  test('parses multiline rollout evidence and persists only projected v3 fields', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const rolloutPath = path.join(sessionsDir, 'rollout-raw-evidence.jsonl');
    const rawSecret = 'syntheticRolloutSecret123456';
    const rawPrompt = [
      '<source_thread_id>parent-raw</source_thread_id>',
      'x'.repeat(550),
      `Audit D:\\Repo\\packages\\tool token=${rawSecret}`
    ].join('\n');
    const rawSummary =
      'Summary Authorization: Bearer syntheticSummaryAuthorization123456';
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'raw-evidence-thread',
          cwd: 'D:\\Other',
          originator: 'Codex Desktop',
          source: 'vscode',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: rawPrompt }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: rawSummary }]
        }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });
    const serialized = JSON.stringify(index);

    expect(index.schemaVersion).toBe('hooks.codex-session-index/v3');
    expect(index.sessions[0]).toMatchObject({
      threadId: 'raw-evidence-thread',
      scopeMatch: 'prompt-mention',
      projectRelation: 'mentioned',
      projectOwner: null,
      delegatedFromThreadId: 'parent-raw',
      primaryTargetRaw: 'D:\\Repo\\packages\\tool',
      primaryTargetNorm: 'd:/repo/packages/tool'
    });
    expect(index.sessions[0]?.firstUserPrompt).toHaveLength(512);
    expect(index.sessions[0]?.firstUserPrompt).not.toContain(rawSecret);
    expect(index.sessions[0]?.lastSummary).toContain(
      'Authorization: [REDACTED]'
    );
    expect(index.sessions[0]?.lastSummary).not.toContain(
      'syntheticSummaryAuthorization123456'
    );
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain(
      'syntheticSummaryAuthorization123456'
    );
  });

  test.each([
    {
      name: 'quoted Windows',
      project: 'D:\\Repo',
      cwd: 'D:\\Repo\\src',
      secret: `AKIA${'W'.repeat(16)}`,
      target: `D:\\Repo\\packages\\AKIA${'W'.repeat(16)}`
    },
    {
      name: 'quoted POSIX',
      project: '/srv/repo',
      cwd: '/srv/repo/src',
      secret: 'glpat-posixSyntheticToken123456',
      target: '/srv/repo/packages/glpat-posixSyntheticToken123456'
    }
  ])(
    'uses the raw $name primary target for attribution but sanitizes every artifact field',
    async ({ name, project: targetProject, cwd, secret, target }) => {
      const sessionsDir = path.join(tempRoot, `sessions-${name}`);
      const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
      const delegatedFrom = `parent-${secret}`;
      const rawPrompt = [
        `<source_thread_id>${delegatedFrom}</source_thread_id>`,
        `Audit "${target}"`
      ].join('\n');
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(rolloutPath, [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: `primary-target-${name.toLowerCase().replaceAll(' ', '-')}`,
            cwd,
            originator: 'Codex Desktop',
            source: 'vscode',
            thread_source: 'user'
          }
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: rawPrompt }
        }),
        JSON.stringify({
          type: 'turn_context',
          payload: { summary: `Summary for ${secret}` }
        })
      ].join('\n'), 'utf8');

      const index = await buildCodexSessionIndex({
        sessionsDir,
        stateDb: path.join(tempRoot, 'missing-state.sqlite'),
        threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
        project: targetProject
      });
      const record = index.sessions[0];

      expect(record).toMatchObject({
        projectRelation: 'supporting',
        relationConfidence: 0.8,
        projectOwner: targetProject,
        delegatedFromThreadId: null,
        primaryTargetRaw: null,
        primaryTargetNorm: null
      });
      expect(record?.evidence.some((item) => item.kind === 'primary-target'))
        .toBe(false);
      expect(record?.evidence.some((item) => item.kind === 'delegation'))
        .toBe(false);

      const resolution = resolveCodexSessions(index.sessions, targetProject);
      expect(resolution.sessions).toHaveLength(1);
      expect(JSON.stringify(index)).not.toContain(secret);
      expect(JSON.stringify(resolution)).not.toContain(secret);
    }
  );

  test.each([
    {
      name: 'OpenAI token',
      secret: 'sk-syntheticOpenAi123456'
    },
    {
      name: 'GitHub token',
      secret: 'ghp_syntheticGithub123456'
    },
    {
      name: 'Slack token',
      secret: 'xoxb-syntheticSlack123456'
    },
    {
      name: 'JWT',
      secret:
        'eyJhbGciOiJIUzI1NiJ9.e30.syntheticJwtSignature123'
    }
  ])(
    'drops a delegation ID containing an embedded $name',
    async ({ name, secret }) => {
      const sessionsDir = path.join(tempRoot, `delegation-${name}`);
      const rolloutPath = path.join(sessionsDir, 'rollout.jsonl');
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(rolloutPath, [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: `delegation-${name.toLowerCase().replaceAll(' ', '-')}`,
            cwd: 'D:\\Repo',
            thread_source: 'user'
          }
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message:
              `<source_thread_id>parent-${secret}</source_thread_id>\nReview`
          }
        })
      ].join('\n'), 'utf8');

      const index = await buildCodexSessionIndex({
        sessionsDir,
        stateDb: path.join(tempRoot, 'missing-state.sqlite'),
        threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
        project: 'D:\\Repo'
      });
      const record = index.sessions[0];

      expect(record?.delegatedFromThreadId).toBeNull();
      expect(record?.evidence.some((item) => item.kind === 'delegation'))
        .toBe(false);
      expect(JSON.stringify(index)).not.toContain(secret);
      expect(JSON.stringify(resolveCodexSessions(index.sessions, 'D:\\Repo')))
        .not.toContain(secret);
    }
  );

  test('projects projectOwner from the final initial project relation', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const stateDb = path.join(tempRoot, 'state.sqlite');
    const ownedRollout = path.join(sessionsDir, 'rollout-owned.jsonl');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(ownedRollout, [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'owned', cwd: 'D:\\Other', thread_source: 'user' }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{
            type: 'input_text',
            text: [
              'ccpanes-task-probe lifecycle context',
              'taskId: owned-task',
              'projectPath: D:\\Repo',
              'worktreeRoot: D:\\Repo'
            ].join('\n')
          }]
        }
      })
    ].join('\n'), 'utf8');
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text primary key, rollout_path text, updated_at integer,
      source text, cwd text, first_user_message text, thread_source text, preview text
    )`);
    const insert = db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('owned', ownedRollout, 6, 'vscode', 'D:\\Other', 'Work', 'user', null);
    insert.run('supporting', null, 5, 'vscode', 'D:\\Repo\\pkg', 'Work', 'user', null);
    insert.run(
      'mentioned',
      null,
      4,
      'vscode',
      'D:\\Other',
      `${'x'.repeat(600)} Work in D:\\Repo\\src`,
      'user',
      null
    );
    insert.run('ambient', null, 3, 'vscode', 'D:\\', 'Work', 'user', null);
    insert.run('unrelated', null, 2, 'vscode', 'D:\\Other', 'Work', 'user', null);
    insert.run('unknown', null, 1, 'vscode', null, 'Work', 'user', null);
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });
    const projection = Object.fromEntries(index.sessions.map((session) => [
      session.threadId,
      {
        projectRelation: session.projectRelation,
        projectOwner: session.projectOwner
      }
    ]));

    expect(projection).toEqual({
      ambient: { projectRelation: 'ambient', projectOwner: null },
      mentioned: { projectRelation: 'mentioned', projectOwner: null },
      owned: { projectRelation: 'owned', projectOwner: 'D:\\Repo' },
      supporting: { projectRelation: 'supporting', projectOwner: 'D:\\Repo' },
      unrelated: { projectRelation: 'unrelated', projectOwner: null },
      unknown: { projectRelation: 'unknown', projectOwner: null }
    });
  });

  test('reads state sqlite in read-only mode and tolerates a missing history database', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const rolloutPath = path.join(sessionsDir, '2026', '08', '15', 'rollout-thread-1.jsonl');
    const stateDb = path.join(tempRoot, 'state.sqlite');
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-08-15T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'thread-1',
          cwd: 'D:\\Work\\Repo',
          originator: 'Codex Desktop',
          source: 'vscode',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-15T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{
            type: 'input_text',
            text: [
              'ccpanes-task-probe lifecycle context',
              'taskId: bridge-task',
              'projectPath: D:\\Work\\Repo',
              'worktreeRoot: D:\\Work\\Repo'
            ].join('\n')
          }]
        }
      }),
      JSON.stringify({
        timestamp: '2026-08-15T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<codex_delegation><source_thread_id>parent-thread</source_thread_id><input>Audit D:\\Work\\Repo</input></codex_delegation>'
          }]
        }
      })
    ].join('\n'), 'utf8');

    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text primary key, rollout_path text, created_at integer, updated_at integer,
      source text, cwd text, title text, first_user_message text, thread_source text, preview text
    )`);
    db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('thread-1', rolloutPath, 1, 2, 'vscode', 'D:\\Work\\Repo', 'Bridge', 'Implement bridge', 'user', 'Latest preview');
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Work\\Repo'
    });

    expect(index.schemaVersion).toBe('hooks.codex-session-index/v3');
    expect(index.sessions).toHaveLength(1);
    expect(index.sessions[0]).toMatchObject({
      threadId: 'thread-1',
      source: 'codex-app',
      scopeMatch: 'exact',
      stateDbPresent: true,
      rolloutPresent: true,
      storageState: 'active',
      runtimeScope: 'exact',
      projectRelation: 'owned',
      relationConfidence: 1,
      relationReasons: ['matched task binding'],
      appVisibility: 'unknown',
      taskBinding: {
        taskId: 'bridge-task',
        projectPathRaw: 'D:\\Work\\Repo',
        worktreeRootRaw: 'D:\\Work\\Repo'
      },
      delegatedFromThreadId: 'parent-thread',
      primaryTargetRaw: 'D:\\Work\\Repo',
      primaryTargetNorm: 'd:/work/repo'
    });
    expect(index.sessions[0]?.evidence).toEqual(expect.arrayContaining([
      { kind: 'cwd', relation: 'exact' },
      { kind: 'primary-target', target: 'd:/work/repo' },
      { kind: 'task-binding', projectPath: 'd:/work/repo', taskId: 'bridge-task' },
      { kind: 'delegation', sourceThreadId: 'parent-thread' }
    ]));
    expect(index.diagnostics).toContainEqual(expect.objectContaining({
      code: 'source-missing',
      source: 'thread-history-db',
      field: 'path',
      reason: 'missing'
    }));
  });

  test('classifies archived paths by segment and not by filename substring', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const archivedRollout = path.join(
      sessionsDir,
      'archived_sessions',
      'rollout-archived.jsonl'
    );
    const activeRollout = path.join(
      sessionsDir,
      'active',
      'rollout-archived_sessions-copy.jsonl'
    );
    await fs.mkdir(path.dirname(archivedRollout), { recursive: true });
    await fs.mkdir(path.dirname(activeRollout), { recursive: true });
    await fs.writeFile(archivedRollout, `${JSON.stringify({
      type: 'session_meta',
      payload: { id: 'archived-thread', cwd: 'D:\\Repo', thread_source: 'user' }
    })}\n`, 'utf8');
    await fs.writeFile(activeRollout, `${JSON.stringify({
      type: 'session_meta',
      payload: { id: 'active-thread', cwd: 'D:\\Repo', thread_source: 'user' }
    })}\n`, 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(Object.fromEntries(index.sessions.map((session) => [
      session.threadId,
      {
        storageState: session.storageState,
        stateDbPresent: session.stateDbPresent
      }
    ]))).toEqual({
      'active-thread': { storageState: 'active', stateDbPresent: false },
      'archived-thread': { storageState: 'archived', stateDbPresent: false }
    });
  });

  test('marks a SQLite row with no valid rollout as missing', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const stateDb = path.join(tempRoot, 'state.sqlite');
    await fs.mkdir(sessionsDir, { recursive: true });
    const db = new DatabaseSync(stateDb);
    db.exec(`create table threads (
      id text primary key, rollout_path text, updated_at integer,
      source text, cwd text, first_user_message text, thread_source text, preview text
    )`);
    db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'missing-thread',
        path.join(tempRoot, 'missing-rollout.jsonl'),
        1,
        'cli',
        'D:\\Repo',
        'Audit D:\\Repo',
        'user',
        'Missing rollout'
      );
    db.close();

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions[0]).toMatchObject({
      threadId: 'missing-thread',
      rolloutPresent: false,
      storageState: 'missing'
    });
  });

  test('appends delegation evidence for orphan rollouts', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const rolloutPath = path.join(sessionsDir, 'rollout-delegated.jsonl');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'delegated-thread', cwd: 'D:\\Repo', thread_source: 'subagent' }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<codex_delegation><source_thread_id>parent-1</source_thread_id><input>Review implementation</input></codex_delegation>'
          }]
        }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: 'D:\\Repo'
    });

    expect(index.sessions[0]).toMatchObject({
      threadId: 'delegated-thread',
      stateDbPresent: false,
      storageState: 'active',
      runtimeScope: 'exact',
      projectRelation: 'supporting',
      relationConfidence: 0.6,
      relationReasons: ['exact runtime cwd', 'no strong ownership evidence'],
      delegatedFromThreadId: 'parent-1'
    });
    expect(index.sessions[0]?.evidence).toEqual([
      { kind: 'cwd', relation: 'exact' },
      { kind: 'delegation', sourceThreadId: 'parent-1' }
    ]);
  });

  test('keeps project attribution unknown when no project is supplied', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const rolloutPath = path.join(sessionsDir, 'rollout-project-unknown.jsonl');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(rolloutPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'project-unknown',
          cwd: 'D:\\Repo',
          thread_source: 'user'
        }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{
            type: 'input_text',
            text: [
              'ccpanes-task-probe lifecycle context',
              'taskId: project-unknown-task',
              'projectPath: D:\\Repo',
              'worktreeRoot: D:\\Repo'
            ].join('\n')
          }]
        }
      })
    ].join('\n'), 'utf8');

    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb: path.join(tempRoot, 'missing-state.sqlite'),
      threadHistoryDb: path.join(tempRoot, 'missing-history.sqlite'),
      project: null
    });

    expect(index.sessions[0]).toMatchObject({
      threadId: 'project-unknown',
      runtimeScope: 'unknown',
      projectRelation: 'unknown',
      relationConfidence: 0.1,
      relationReasons: ['project path is missing'],
      taskBinding: {
        taskId: 'project-unknown-task',
        projectPathRaw: 'D:\\Repo',
        worktreeRootRaw: 'D:\\Repo'
      }
    });
    expect(index.sessions[0]?.evidence).toEqual([{
      kind: 'task-binding',
      projectPath: 'd:/repo',
      taskId: 'project-unknown-task'
    }]);
  });

  test('resolves filesystem inputs and relative rollout rows at the entry boundary', async () => {
    const originalCwd = process.cwd();
    const relativeSessionsDir = 'sessions';
    const relativeStateDb = 'state.sqlite';
    const relativeHistoryDb = 'history.sqlite';
    const relativeTaskContext = path.join('task', 'context.json');
    const rolloutEntries = [
      { threadId: 'thread-relative-1', file: path.join('sessions', 'one.jsonl') },
      { threadId: 'thread-relative-2', file: path.join('sessions', 'two.jsonl') }
    ];

    await fs.mkdir(path.join(tempRoot, relativeSessionsDir), { recursive: true });
    for (const entry of rolloutEntries) {
      await fs.writeFile(path.join(tempRoot, entry.file), `${JSON.stringify({
        timestamp: '2026-08-15T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: entry.threadId,
          cwd: 'D:\\Work\\Repo',
          originator: 'Codex Desktop',
          thread_source: 'user'
        }
      })}\n`, 'utf8');
    }

    const db = new DatabaseSync(path.join(tempRoot, relativeStateDb));
    db.exec(`create table threads (
      id text primary key, rollout_path text, created_at integer, updated_at integer,
      source text, cwd text, title text, first_user_message text, thread_source text, preview text
    )`);
    const insert = db.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [index, entry] of rolloutEntries.entries()) {
      insert.run(
        entry.threadId,
        entry.file,
        index + 1,
        index + 1,
        'vscode',
        'D:\\Work\\Repo',
        entry.threadId,
        'Implement bridge',
        'user',
        entry.threadId
      );
    }
    db.close();

    try {
      process.chdir(tempRoot);
      const index = await buildCodexSessionIndex({
        sessionsDir: relativeSessionsDir,
        stateDb: relativeStateDb,
        threadHistoryDb: relativeHistoryDb,
        taskContext: relativeTaskContext,
        project: 'D:\\Work\\Repo'
      });

      expect(index.sources).toEqual({
        sessionsDir: {
          path: path.resolve(tempRoot, relativeSessionsDir),
          availability: 'present'
        },
        stateDb: {
          path: path.resolve(tempRoot, relativeStateDb),
          availability: 'present'
        },
        threadHistoryDb: {
          path: path.resolve(tempRoot, relativeHistoryDb),
          availability: 'missing',
          role: 'availability-only'
        },
        taskContext: {
          path: path.resolve(tempRoot, relativeTaskContext),
          availability: 'missing'
        }
      });
      expect(index.sessions).toHaveLength(2);
      expect(index.sessions.map((session) => session.rolloutPath).sort()).toEqual(
        rolloutEntries.map((entry) => path.resolve(tempRoot, entry.file)).sort()
      );
      expect(index.sessions.every((session) => session.rolloutPresent)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('resolveCodexSessions', () => {
  const base: Omit<CodexSessionRecord, 'threadId'> = {
    source: 'unknown',
    threadSource: 'user',
    originator: 'unknown',
    projectOwner: 'D:\\Repo',
    confidence: 0,
    cwdRaw: 'C:\\Other',
    cwdNorm: 'c:/other',
    scopeMatch: 'unknown',
    rolloutPath: null,
    stateDbPresent: true,
    rolloutPresent: true,
    updatedAt: '2026-08-15T00:00:00.000Z',
    firstUserPrompt: null,
    lastSummary: null,
    storageState: 'active',
    runtimeScope: 'unrelated',
    projectRelation: 'owned',
    relationConfidence: 0.1,
    relationReasons: ['fixture'],
    evidence: [],
    appVisibility: 'unknown',
    taskBinding: null,
    delegatedFromThreadId: null,
    primaryTargetRaw: null,
    primaryTargetNorm: null
  };

  function record(
    threadId: string,
    overrides: Partial<typeof base> = {}
  ) {
    return { ...base, threadId, ...overrides };
  }

  test('uses v2 attribution without reclassifying cwd and summarizes the full input', () => {
    const result = resolveCodexSessions([
      record('owned-from-v2', {
        relationConfidence: 0.95,
        relationReasons: ['matched task binding']
      }),
      record('supporting', {
        cwdRaw: 'D:\\Repo\\pkg',
        cwdNorm: 'd:/repo/pkg',
        runtimeScope: 'descendant',
        projectRelation: 'supporting',
        relationConfidence: 0.6
      }),
      record('ambient', {
        cwdRaw: 'D:\\',
        cwdNorm: 'd:/',
        projectOwner: null,
        runtimeScope: 'ancestor',
        projectRelation: 'ambient',
        relationConfidence: 0.2
      }),
      record('mentioned', {
        projectOwner: null,
        projectRelation: 'mentioned',
        relationConfidence: 0.35
      }),
      record('archived-owned', {
        storageState: 'archived'
      }),
      record('subagent-owned', {
        threadSource: 'subagent'
      }),
      record('unrelated', {
        projectOwner: null,
        projectRelation: 'unrelated',
        relationConfidence: 0
      })
    ], 'D:\\Repo');

    expect(result.schemaVersion).toBe('hooks.codex-session-resolution/v3');
    expect(result.sessions.map((session) => session.threadId)).toEqual([
      'owned-from-v2',
      'supporting'
    ]);
    expect(result.sessions[0]).toMatchObject({
      threadId: 'owned-from-v2',
      runtimeScope: 'unrelated',
      projectRelation: 'owned',
      relationConfidence: 0.95,
      scopeMatch: 'unknown',
      projectOwner: 'D:\\Repo',
      confidence: 0.95
    });
    expect(result.sessions[1]?.resumeDirectory).toBe('D:\\Repo\\pkg');
    expect(result.totals).toEqual({
      defaultVisible: 2,
      owned: 3,
      supporting: 1,
      mentioned: 1,
      ambient: 1,
      archived: 1,
      subagents: 1
    });
  });

  test('rejects a Project A owner when resolving the record for Project B', () => {
    let caught: unknown;
    try {
      resolveCodexSessions([
        record('project-owner-mismatch', {
          projectOwner: 'D:\\Project A',
          projectRelation: 'owned'
        })
      ], 'D:\\Project B');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionProjectOwnerInvariantError',
      code: 'CODEX_SESSION_PROJECT_OWNER_INVARIANT',
      threadId: 'project-owner-mismatch',
      reason: 'owner-project-mismatch'
    });
  });

  test.each([
    [
      'missing owner',
      {
        projectRelation: 'supporting',
        projectOwner: null
      },
      'missing-owner'
    ],
    [
      'unexpected owner',
      {
        projectRelation: 'unrelated',
        projectOwner: 'D:\\Repo'
      },
      'unexpected-owner'
    ]
  ] satisfies Array<[
    string,
    Partial<typeof base>,
    'missing-owner' | 'unexpected-owner'
  ]>)('rejects a %s with the typed owner invariant', (
    _name,
    overrides,
    reason
  ) => {
    let caught: unknown;
    try {
      resolveCodexSessions([
        record(`resolver-${reason}`, overrides)
      ], 'D:\\Repo');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'CodexSessionProjectOwnerInvariantError',
      code: 'CODEX_SESSION_PROJECT_OWNER_INVARIANT',
      threadId: `resolver-${reason}`,
      reason
    });
  });

  test('filters raw records before projecting resolver-only fields', () => {
    const excluded = record('unrelated-projection-trap', {
      projectOwner: null,
      projectRelation: 'unrelated',
      relationConfidence: 0
    });
    Object.defineProperty(excluded, 'relationConfidence', {
      get() {
        throw new Error('excluded record was projected');
      }
    });

    const result = resolveCodexSessions([
      record('owned'),
      excluded
    ], 'D:\\Repo');

    expect(result.sessions.map((session) => session.threadId))
      .toEqual(['owned']);
  });

  test('sorts broad views stably and renders the two-line totals prefix', () => {
    const result = resolveCodexSessions([
      record('supporting', {
        runtimeScope: 'descendant',
        projectRelation: 'supporting',
        updatedAt: '2026-08-15T09:00:00.000Z'
      }),
      record('owned-active-z', {
        updatedAt: '2026-08-15T03:00:00.000Z'
      }),
      record('ambient', {
        projectOwner: null,
        runtimeScope: 'ancestor',
        projectRelation: 'ambient',
        updatedAt: '2026-08-15T10:00:00.000Z'
      }),
      record('owned-no-time-a', {
        updatedAt: null
      }),
      record('owned-no-time-b', {
        updatedAt: null
      }),
      record('owned-no-time-c', {
        updatedAt: null
      }),
      record('mentioned', {
        projectOwner: null,
        projectRelation: 'mentioned',
        updatedAt: '2026-08-15T11:00:00.000Z'
      }),
      record('owned-active-a', {
        updatedAt: '2026-08-15T03:00:00.000Z'
      }),
      record('owned-active-old', {
        updatedAt: '2026-08-15T01:00:00.000Z'
      }),
      record('owned-archived', {
        storageState: 'archived',
        updatedAt: '2026-08-15T13:00:00.000Z'
      }),
      record('unrelated', {
        projectOwner: null,
        projectRelation: 'unrelated',
        updatedAt: '2026-08-15T14:00:00.000Z'
      })
    ], 'D:\\Repo', {
      includeArchived: true,
      includeSubagents: true,
      includeRelated: true,
      includeAmbient: true
    });

    expect(result.sessions.map((session) => session.threadId)).toEqual([
      'owned-active-a',
      'owned-active-z',
      'owned-active-old',
      'owned-no-time-a',
      'owned-no-time-b',
      'owned-no-time-c',
      'owned-archived',
      'supporting',
      'mentioned',
      'ambient'
    ]);

    const human = renderCodexSessionResolution(result);
    expect(human.startsWith([
      'Codex sessions for D:\\Repo',
      'owned=7 supporting=1 mentioned=1 ambient=1 archived=1 subagents=0',
      'default-visible=7'
    ].join('\n'))).toBe(true);
    expect(human).toContain('[owned] owned-active-a');
    expect(human).toContain('[ambient] ambient');
    expect(result.sessions.find((session) =>
      session.threadId === 'mentioned'
    )?.projectOwner).toBeNull();
    expect(result.sessions.find((session) =>
      session.threadId === 'ambient'
    )?.projectOwner).toBeNull();
  });
});

describe('resolution and retention artifact clean breaks', () => {
  test('uses resolution v3 and retention v2 with typed diagnostics', () => {
    const sessions = [artifactSession('artifact-version-thread')];
    const resolution = resolveCodexSessions(sessions, 'D:\\Repo');
    const retention = createRetentionManifest(sessions);

    expect(resolution.schemaVersion)
      .toBe('hooks.codex-session-resolution/v3');
    expect(retention.schemaVersion)
      .toBe('hooks.codex-session-retention/v2');
    expect(retention.diagnostics).toEqual([]);
  });

  test.each([
    'hooks.codex-session-resolution/v1',
    'hooks.codex-session-resolution/v2'
  ])('rejects old resolution schema %s with typed unsupported-schema', async (
    schemaVersion
  ) => {
    const resolverModule = await import('../src/codex-session-resolver.js');
    const validate = (
      resolverModule as typeof resolverModule & {
        validateCodexSessionResolutionArtifact?: (value: unknown) => unknown;
      }
    ).validateCodexSessionResolutionArtifact;
    expect(validate).toEqual(expect.any(Function));
    const secret = 'PRIVATE_OLD_RESOLUTION_SECRET';
    let caught: unknown;
    try {
      validate?.({
        ...resolveCodexSessions(
          [artifactSession('old-resolution-thread')],
          'D:\\Repo'
        ),
        project: `D:\\${secret}`,
        schemaVersion
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      field: 'schemaVersion',
      reason: 'unsupported-schema'
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  test('rejects retention v1 with typed unsupported-schema', async () => {
    const handoffModule = await import('../src/codex-session-handoff.js');
    const validate = (
      handoffModule as typeof handoffModule & {
        validateCodexSessionRetentionManifest?: (value: unknown) => unknown;
      }
    ).validateCodexSessionRetentionManifest;
    expect(validate).toEqual(expect.any(Function));
    const secret = 'PRIVATE_OLD_RETENTION_SECRET';
    let caught: unknown;
    try {
      validate?.({
        ...createRetentionManifest([
          artifactSession('old-retention-thread', {
            rolloutPath: `D:\\${secret}\\rollout.jsonl`
          })
        ]),
        schemaVersion: 'hooks.codex-session-retention/v1'
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      field: 'schemaVersion',
      reason: 'unsupported-schema'
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });
});

describe('Task 3 quality fixes', () => {
  test('recomputes retention risk after unsafe rollout path projection', () => {
    const secret = 'sk-proj-retention-risk-secret';
    const projected = validateCodexSessionRetentionManifest(
      retentionArtifact([retentionEntry({
        rolloutPath: `D:\\${secret}\\rollout.jsonl`,
        risk: 'ok'
      })])
    );

    expect(projected.sessions[0]).toMatchObject({
      rolloutPath: null,
      rolloutPresent: true,
      risk: 'rollout-missing'
    });
    expect(projected.diagnostics).toContainEqual(expect.objectContaining({
      code: 'privacy-projection-dropped',
      field: 'rolloutPath',
      reason: 'unsafe-path'
    }));
    expect(JSON.stringify(projected)).not.toContain(secret);
  });

  test.each([
    [
      'missing path',
      { rolloutPath: null, rolloutPresent: true, risk: 'ok' },
      'rollout-missing'
    ],
    [
      'not present',
      { rolloutPresent: false, risk: 'ok' },
      'rollout-missing'
    ],
    [
      'missing state',
      { stateDbPresent: false, risk: 'ok' },
      'state-missing'
    ],
    [
      'ambiguous cwd',
      { cwdNorm: null, risk: 'ok' },
      'cwd-ambiguous'
    ]
  ] as const)(
    'overrides forged retention risk for %s',
    (_name, overrides, expectedRisk) => {
      const projected = validateCodexSessionRetentionManifest(
        retentionArtifact([retentionEntry(overrides)])
      );
      expect(projected.sessions[0]?.risk).toBe(expectedRisk);
    }
  );

  test('preserves typed diagnostics capacity errors at 10,000/10,001', () => {
    const limit = CODEX_SESSION_INDEX_ARTIFACT_LIMITS.diagnostics;
    const diagnostic = artifactDiagnostic(0);
    const exact = Array.from({ length: limit }, () => diagnostic);
    expect(validateCodexSessionRetentionManifest(
      retentionArtifact([], exact)
    ).diagnostics).toEqual([diagnostic]);

    const secret = 'PRIVATE_RETENTION_CAPACITY_SECRET';
    const over = [
      ...exact,
      { ...diagnostic, unexpectedPrivateValue: secret }
    ];
    let caught: unknown;
    try {
      validateCodexSessionRetentionManifest(retentionArtifact([], over));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      field: 'diagnostics',
      reason: 'capacity-exceeded'
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  test('recomputes exact and descendant resume fields after base projection', () => {
    const valid = resolveCodexSessions([
      artifactSession('resume-exact', {
        stateDbPresent: false,
        rolloutPresent: false,
        runtimeScope: 'exact'
      }),
      artifactSession('resume-descendant', {
        cwdRaw: 'D:\\Repo\\pkg',
        cwdNorm: 'd:/repo/pkg',
        stateDbPresent: false,
        rolloutPresent: true,
        runtimeScope: 'descendant',
        projectRelation: 'supporting'
      })
    ], 'D:\\Repo');
    const projected = validateCodexSessionResolutionArtifact({
      ...valid,
      sessions: valid.sessions.map((session) => ({
        ...session,
        resumeAvailable: !session.resumeAvailable,
        resumeDirectory: 'C:\\Forged'
      }))
    });

    expect(projected.sessions.find(({ threadId }) =>
      threadId === 'resume-exact'
    )).toMatchObject({
      resumeAvailable: false,
      resumeDirectory: 'D:\\Repo'
    });
    expect(projected.sessions.find(({ threadId }) =>
      threadId === 'resume-descendant'
    )).toMatchObject({
      resumeAvailable: true,
      resumeDirectory: 'D:\\Repo\\pkg'
    });
  });

  test('falls back to projected project when descendant cwd is unsafe', () => {
    const secret = 'sk-proj-unsafe-resume-cwd';
    const valid = resolveCodexSessions([
      artifactSession('unsafe-resume-cwd', {
        runtimeScope: 'descendant',
        projectRelation: 'supporting'
      })
    ], 'D:\\Repo');
    const projected = validateCodexSessionResolutionArtifact({
      ...valid,
      sessions: [{
        ...valid.sessions[0],
        cwdRaw: `D:\\${secret}`,
        cwdNorm: null,
        resumeAvailable: false,
        resumeDirectory: 'C:\\Forged'
      }]
    });

    expect(projected.sessions[0]).toMatchObject({
      cwdRaw: null,
      resumeAvailable: true,
      resumeDirectory: 'D:\\Repo'
    });
    expect(JSON.stringify(projected)).not.toContain(secret);
  });

  test.each([
    'hooks.codex-session-resolution/v1',
    'hooks.codex-session-resolution/v2'
  ])('generateCodexHandoff rejects direct old resolution %s', async (
    schemaVersion
  ) => {
    const resolution = resolveCodexSessions(
      [artifactSession('handoff-old-resolution')],
      'D:\\Repo'
    );
    const caught = await generateCodexHandoff({
      mode: 'ccpanes-worker',
      project: 'D:\\Repo',
      indexPath: 'D:\\Repo\\live\\index.json',
      taskContextPath: null,
      resolution: {
        ...resolution,
        schemaVersion
      } as never
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(caught).toMatchObject({
      field: 'schemaVersion',
      reason: 'unsupported-schema'
    });
  });

  test.each([
    [
      'resolution root',
      () => validateCodexSessionResolutionArtifact({
        ...resolveCodexSessions(
          [artifactSession('resolution-root-unknown')],
          'D:\\Repo'
        ),
        unexpected: true
      }),
      'root.unexpected'
    ],
    [
      'resolution entry',
      () => {
        const valid = resolveCodexSessions(
          [artifactSession('resolution-entry-unknown')],
          'D:\\Repo'
        );
        return validateCodexSessionResolutionArtifact({
          ...valid,
          sessions: [{ ...valid.sessions[0], unexpected: true }]
        });
      },
      'sessions[0].unexpected'
    ],
    [
      'retention root',
      () => validateCodexSessionRetentionManifest({
        ...retentionArtifact(),
        unexpected: true
      }),
      'root.unexpected'
    ],
    [
      'retention entry',
      () => validateCodexSessionRetentionManifest(
        retentionArtifact([retentionEntry({ unexpected: true })])
      ),
      'sessions[0].unexpected'
    ]
  ] as const)('rejects unknown fields at %s', (_name, invoke, field) => {
    let caught: unknown;
    try {
      invoke();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ field, reason: 'unknown-field' });
  });

  test.each([
    [
      'boolean',
      () => validateCodexSessionRetentionManifest(
        retentionArtifact([retentionEntry({ rolloutPresent: 'yes' })])
      ),
      'invalid-shape'
    ],
    [
      'timestamp',
      () => validateCodexSessionRetentionManifest(
        retentionArtifact([retentionEntry({
          updatedAt: 'PRIVATE_INVALID_TIMESTAMP'
        })])
      ),
      'invalid-shape'
    ],
    [
      'project path',
      () => {
        const valid = resolveCodexSessions(
          [artifactSession('unsafe-resolution-project')],
          'D:\\Repo'
        );
        return validateCodexSessionResolutionArtifact({
          ...valid,
          project: 'D:\\sk-proj-unsafe-resolution-project'
        });
      },
      'unsafe-path'
    ],
    [
      'thread ID',
      () => validateCodexSessionRetentionManifest(
        retentionArtifact([retentionEntry({ threadId: 'invalid/thread' })])
      ),
      'invalid-shape'
    ]
  ] as const)('rejects invalid %s without leaking input', (
    _name,
    invoke,
    reason
  ) => {
    let caught: unknown;
    try {
      invoke();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ reason });
    expect(JSON.stringify(caught)).not.toContain('PRIVATE_');
  });

  test('returns isolated resolution and retention object graphs', () => {
    const rawResolution = structuredClone(resolveCodexSessions(
      [artifactSession('isolated-resolution')],
      'D:\\Repo'
    ));
    const projectedResolution =
      validateCodexSessionResolutionArtifact(rawResolution);
    expect(projectedResolution).not.toBe(rawResolution);
    expect(projectedResolution.totals).not.toBe(rawResolution.totals);
    expect(projectedResolution.sessions).not.toBe(rawResolution.sessions);
    expect(projectedResolution.sessions[0])
      .not.toBe(rawResolution.sessions[0]);
    expect(projectedResolution.sessions[0]?.relationReasons)
      .not.toBe(rawResolution.sessions[0]?.relationReasons);
    expect(projectedResolution.sessions[0]?.evidence)
      .not.toBe(rawResolution.sessions[0]?.evidence);

    const rawRetention = retentionArtifact(
      [retentionEntry()],
      [artifactDiagnostic(1)]
    );
    const projectedRetention =
      validateCodexSessionRetentionManifest(rawRetention);
    expect(projectedRetention).not.toBe(rawRetention);
    expect(projectedRetention.sessions).not.toBe(rawRetention.sessions);
    expect(projectedRetention.sessions[0])
      .not.toBe((rawRetention.sessions as unknown[])[0]);
    expect(projectedRetention.diagnostics)
      .not.toBe(rawRetention.diagnostics);
    expect(projectedRetention.diagnostics[0])
      .not.toBe((rawRetention.diagnostics as unknown[])[0]);
  });
});
