import { describe, expect, test } from 'vitest';
import {
  CCPANES_SESSION_SNAPSHOT_LIMITS,
  inspectCcPanesSnapshotFreshness,
  validateCcPanesSessionSnapshot
} from '../src/ccpanes-session-snapshot.js';

function validSnapshot() {
  return {
    schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
    generatedAt: '2026-08-15T10:46:58.097+02:00',
    launches: [{
      launchId: ' launch-1 ',
      projectPath: ' D:\\CC-Pane\\Tool\\Repos\\Hooks\\ ',
      workspaceName: ' hooks ',
      cliTool: ' codex ',
      resumeSessionId: ' thread-old ',
      launchedAt: '2026-08-15T08:36:14.400Z'
    }],
    sessions: [{
      sessionId: ' pty-1 ',
      launchId: ' launch-1 ',
      taskId: ' task-1 ',
      projectPath: ' /mnt/d/CC-Pane/Tool/Repos/Hooks ',
      status: ' active ',
      title: ' hooks resume ',
      observedCodexThreadId: ' thread-old '
    }]
  };
}

function expectInvalid(value: unknown, field: string): void {
  const expectedMessage = `invalid CC-Panes snapshot: ${field}`;
  let error: unknown;
  try {
    validateCcPanesSessionSnapshot(value);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(expectedMessage);
}

function windowsPathWithLength(length: number): string {
  return `C:\\${'a'.repeat(length - 3)}`;
}

describe('validateCcPanesSessionSnapshot', () => {
  test('exports the literal frozen snapshot limits contract', () => {
    expect(CCPANES_SESSION_SNAPSHOT_LIMITS).toEqual({
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
    expect(Object.isFrozen(CCPANES_SESSION_SNAPSHOT_LIMITS)).toBe(true);
  });

  test('normalizes a valid snapshot at the trust boundary', () => {
    expect(validateCcPanesSessionSnapshot(validSnapshot())).toEqual({
      schemaVersion: 'hooks.ccpanes-session-snapshot/v1',
      generatedAt: '2026-08-15T08:46:58.097Z',
      launches: [{
        launchId: 'launch-1',
        projectPath: 'D:\\CC-Pane\\Tool\\Repos\\Hooks\\',
        projectPathNorm: 'd:/cc-pane/tool/repos/hooks',
        workspaceName: 'hooks',
        cliTool: 'codex',
        resumeSessionId: 'thread-old',
        launchedAt: '2026-08-15T08:36:14.400Z'
      }],
      sessions: [{
        sessionId: 'pty-1',
        launchId: 'launch-1',
        taskId: 'task-1',
        projectPath: '/mnt/d/CC-Pane/Tool/Repos/Hooks',
        projectPathNorm: 'd:/cc-pane/tool/repos/hooks',
        status: 'active',
        title: 'hooks resume',
        observedCodexThreadId: 'thread-old'
      }]
    });
  });

  test('normalizes absent optional fields to null', () => {
    const value = validSnapshot();
    delete (value.launches[0] as Partial<typeof value.launches[0]>).workspaceName;
    value.launches[0].resumeSessionId = null as never;
    value.sessions[0] = {
      sessionId: 'pty-1',
      status: 'idle'
    } as typeof value.sessions[0];

    expect(validateCcPanesSessionSnapshot(value)).toMatchObject({
      launches: [{
        workspaceName: null,
        resumeSessionId: null
      }],
      sessions: [{
        launchId: null,
        taskId: null,
        projectPath: null,
        projectPathNorm: null,
        title: null,
        observedCodexThreadId: null
      }]
    });
  });

  test.each([
    ['null', null],
    ['array', []],
    ['string', 'snapshot']
  ])('rejects an invalid root shape: %s', (_name, value) => {
    expectInvalid(value, 'root');
  });

  test('requires the exact v1 schema', () => {
    expectInvalid({
      ...validSnapshot(),
      schemaVersion: 'hooks.ccpanes-session-snapshot/v2'
    }, 'schemaVersion');
  });

  test.each([
    ['root.extra', { extra: true }],
    ['launches[0].taskID', { launches: [{ ...validSnapshot().launches[0], taskID: 'task-1' }] }],
    ['sessions[0].state', { sessions: [{ ...validSnapshot().sessions[0], state: 'active' }] }]
  ])('rejects unknown own enumerable field %s', (field, override) => {
    expectInvalid({ ...validSnapshot(), ...override }, field);
  });

  test('selects the lexicographically first unknown field independent of insertion order', () => {
    expectInvalid({
      ...validSnapshot(),
      zeta: true,
      alpha: true
    }, 'root.alpha');
    expectInvalid({
      ...validSnapshot(),
      alpha: true,
      zeta: true
    }, 'root.alpha');
  });

  test.each([
    ['launches', { launches: {} }],
    ['sessions', { sessions: {} }]
  ])('requires %s to be an array', (field, override) => {
    expectInvalid({ ...validSnapshot(), ...override }, field);
  });

  test.each([
    ['launches[0]', { launches: [[]] }],
    ['sessions[0]', { sessions: [null] }]
  ])('rejects invalid entry shape at %s', (field, override) => {
    expectInvalid({ ...validSnapshot(), ...override }, field);
  });

  test.each([
    ['launches[0].launchId', 'launchId'],
    ['launches[0].projectPath', 'projectPath'],
    ['launches[0].cliTool', 'cliTool']
  ])('rejects a blank required launch string: %s', (field, key) => {
    const value = validSnapshot();
    value.launches[0][key as 'launchId'] = '   ';
    expectInvalid(value, field);
  });

  test.each([
    ['sessions[0].sessionId', 'sessionId'],
    ['sessions[0].status', 'status']
  ])('rejects a blank required session string: %s', (field, key) => {
    const value = validSnapshot();
    value.sessions[0][key as 'sessionId'] = '   ';
    expectInvalid(value, field);
  });

  test('rejects a non-string required value', () => {
    const value = validSnapshot();
    value.launches[0].cliTool = 7 as never;
    expectInvalid(value, 'launches[0].cliTool');
  });

  test.each([
    ['launches[0].workspaceName', 'launch', 'workspaceName'],
    ['launches[0].resumeSessionId', 'launch', 'resumeSessionId'],
    ['sessions[0].launchId', 'session', 'launchId'],
    ['sessions[0].taskId', 'session', 'taskId'],
    ['sessions[0].projectPath', 'session', 'projectPath'],
    ['sessions[0].title', 'session', 'title'],
    ['sessions[0].observedCodexThreadId', 'session', 'observedCodexThreadId']
  ] as const)(
    'rejects a provided blank optional string: %s',
    (field, entryType, key) => {
      const value = validSnapshot();
      if (entryType === 'launch') {
        value.launches[0][key] = '   ';
      } else {
        value.sessions[0][key] = '   ';
      }
      expectInvalid(value, field);
    }
  );

  test('measures identity limits in UTF-16 code units', () => {
    const exact = '😀'.repeat(
      CCPANES_SESSION_SNAPSHOT_LIMITS.identityReferenceId / 2
    );
    const accepted = validSnapshot();
    accepted.launches[0].launchId = exact;
    expect(validateCcPanesSessionSnapshot(accepted).launches[0].launchId)
      .toBe(exact);

    const rejected = validSnapshot();
    rejected.launches[0].launchId = `${exact}x`;
    expectInvalid(rejected, 'launches[0].launchId');
  });

  test('accepts required and optional IDs at the trimmed exact boundary', () => {
    const exact = 'x'.repeat(256);
    const value = validSnapshot();
    value.launches[0].launchId = `  ${exact}  `;
    value.sessions[0].sessionId = `  ${exact}  `;

    expect(validateCcPanesSessionSnapshot(value)).toMatchObject({
      launches: [{ launchId: exact }],
      sessions: [{ sessionId: exact }]
    });
  });

  test.each([
    [
      'launches[0].resumeSessionId',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].resumeSessionId = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.launches[0].resumeSessionId
    ],
    [
      'sessions[0].observedCodexThreadId',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].observedCodexThreadId = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].observedCodexThreadId
    ]
  ] as const)(
    'uses the 512-character core thread ID boundary at %s',
    (field, assign, select) => {
      const exact = `a${'b'.repeat(511)}`;
      const accepted = validSnapshot();
      assign(accepted, `  ${exact}  `);
      expect(select(validateCcPanesSessionSnapshot(accepted))).toBe(exact);

      const overlong = `a${'b'.repeat(512)}`;
      const rejected = validSnapshot();
      assign(rejected, overlong);
      let error: unknown;
      try {
        validateCcPanesSessionSnapshot(rejected);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message)
        .toBe(`invalid CC-Panes snapshot: ${field}`);
      expect((error as Error).message).not.toContain(overlong);
      expect(JSON.stringify(error)).not.toContain(overlong);
    }
  );

  test('accepts the ordinary raw cap and rejects +1', () => {
    const exact = 'x'.repeat(256);
    const accepted = validSnapshot();
    accepted.launches[0].launchId =
      `${' '.repeat(512)}${exact}${' '.repeat(512)}`;
    expect(accepted.launches[0].launchId.length).toBe(256 + 1024);
    expect(validateCcPanesSessionSnapshot(accepted).launches[0].launchId)
      .toBe(exact);

    const rejected = validSnapshot();
    rejected.launches[0].launchId =
      `${' '.repeat(513)}${exact}${' '.repeat(512)}`;
    expectInvalid(rejected, 'launches[0].launchId');
  });

  test('rejects a provided non-string optional value', () => {
    const value = validSnapshot();
    value.sessions[0].title = false as never;
    expectInvalid(value, 'sessions[0].title');
  });

  test.each([
    [
      'launches[0].launchId',
      256,
      'x',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].launchId = text;
      }
    ],
    [
      'launches[0].workspaceName',
      256,
      'x',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].workspaceName = text;
      }
    ],
    [
      'launches[0].cliTool',
      64,
      'x',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].cliTool = text;
      }
    ],
    [
      'sessions[0].status',
      128,
      'x',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].status = text;
      }
    ],
    [
      'sessions[0].title',
      512,
      'x',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].title = text;
      }
    ],
    [
      'launches[0].projectPath',
      4096,
      'C:\\repo',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].projectPath = text;
      }
    ],
    [
      'sessions[0].projectPath',
      4096,
      'C:\\repo',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].projectPath = text;
      }
    ]
  ] as const)(
    'rejects raw over-limit strings before trimming at %s',
    (field, limit, normalized, assign) => {
      const value = validSnapshot();
      const raw = `${' '.repeat(100_000)}${normalized}`;
      expect(raw.length).toBeGreaterThan(limit + 1024);
      assign(value, raw);
      expectInvalid(value, field);
    }
  );

  test.each([
    [
      'launches[0].launchId',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].launchId = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.launches[0].launchId
    ],
    [
      'sessions[0].sessionId',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].sessionId = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].sessionId
    ],
    [
      'sessions[0].launchId',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].launchId = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].launchId
    ],
    [
      'sessions[0].taskId',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].taskId = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].taskId
    ]
  ] as const)(
    'accepts the exact identity/reference limit and rejects +1 at %s',
    (field, assign, select) => {
      const exact = 'x'.repeat(CCPANES_SESSION_SNAPSHOT_LIMITS.identityReferenceId);
      const accepted = validSnapshot();
      assign(accepted, exact);
      expect(select(validateCcPanesSessionSnapshot(accepted))).toBe(exact);

      const rejected = validSnapshot();
      assign(rejected, `${exact}x`);
      expectInvalid(rejected, field);
    }
  );

  test.each([
    [
      'launches[0].workspaceName',
      CCPANES_SESSION_SNAPSHOT_LIMITS.workspaceName,
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].workspaceName = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.launches[0].workspaceName
    ],
    [
      'launches[0].cliTool',
      CCPANES_SESSION_SNAPSHOT_LIMITS.cliTool,
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].cliTool = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.launches[0].cliTool
    ],
    [
      'sessions[0].status',
      CCPANES_SESSION_SNAPSHOT_LIMITS.status,
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].status = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].status
    ],
    [
      'sessions[0].title',
      CCPANES_SESSION_SNAPSHOT_LIMITS.title,
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].title = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].title
    ]
  ] as const)(
    'accepts the exact field limit and rejects +1 at %s',
    (field, limit, assign, select) => {
      const exact = 'x'.repeat(limit);
      const accepted = validSnapshot();
      assign(accepted, exact);
      expect(select(validateCcPanesSessionSnapshot(accepted))).toBe(exact);

      const rejected = validSnapshot();
      assign(rejected, `${exact}x`);
      expectInvalid(rejected, field);
    }
  );

  test.each([
    [
      'launches[0].projectPath',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.launches[0].projectPath = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.launches[0].projectPath
    ],
    [
      'sessions[0].projectPath',
      (value: ReturnType<typeof validSnapshot>, text: string) => {
        value.sessions[0].projectPath = text;
      },
      (value: ReturnType<typeof validateCcPanesSessionSnapshot>) =>
        value.sessions[0].projectPath
    ]
  ] as const)(
    'accepts the exact project path limit and rejects +1 at %s',
    (field, assign, select) => {
      const exact = windowsPathWithLength(
        CCPANES_SESSION_SNAPSHOT_LIMITS.projectPath
      );
      const accepted = validSnapshot();
      assign(accepted, exact);
      expect(select(validateCcPanesSessionSnapshot(accepted))).toBe(exact);

      const rejected = validSnapshot();
      assign(rejected, `${exact}a`);
      expectInvalid(rejected, field);
    }
  );

  test('checks project path length before path normalization', () => {
    const value = validSnapshot();
    value.launches[0].projectPath =
      `C:\\${'segment\\..\\'.repeat(410)}repo`;
    expect(value.launches[0].projectPath.length)
      .toBeGreaterThan(CCPANES_SESSION_SNAPSHOT_LIMITS.projectPath);
    expectInvalid(value, 'launches[0].projectPath');
  });

  test.each([
    ['launches[0].projectPath', 'D:relative', 'launch'],
    ['sessions[0].projectPath', 'relative/path', 'session']
  ] as const)('rejects an invalid filesystem path at %s', (field, path, entryType) => {
    const value = validSnapshot();
    if (entryType === 'launch') {
      value.launches[0].projectPath = path;
    } else {
      value.sessions[0].projectPath = path;
    }
    expectInvalid(value, field);
  });

  test.each([
    ['generatedAt', 'snapshot'],
    ['launches[0].launchedAt', 'launch']
  ] as const)(
    'rejects raw over-limit timestamp input at %s before trimming',
    (field, target) => {
      const value = validSnapshot();
      const raw = `${' '.repeat(100_000)}2026-08-15T08:46:58.097Z`;
      expect(raw.length).toBeGreaterThan(99);
      if (target === 'snapshot') {
        value.generatedAt = raw;
      } else {
        value.launches[0].launchedAt = raw;
      }
      expectInvalid(value, field);
    }
  );

  test('accepts at most nine timestamp fractional digits and rejects ten', () => {
    const accepted = validSnapshot();
    accepted.generatedAt = '2026-08-15T08:46:58.123456789+00:00';
    expect(accepted.generatedAt.length).toBe(35);
    expect(validateCcPanesSessionSnapshot(accepted).generatedAt)
      .toBe('2026-08-15T08:46:58.123Z');

    const rejected = validSnapshot();
    rejected.generatedAt = '2026-08-15T08:46:58.1234567890Z';
    expectInvalid(rejected, 'generatedAt');
  });

  test('accepts a normalized max-length timestamp at the raw cap', () => {
    const timestamp = '2026-08-15T08:46:58.123456789+00:00';
    const raw = `${' '.repeat(32)}${timestamp}${' '.repeat(32)}`;
    expect(timestamp.length).toBe(35);
    expect(raw.length).toBe(99);

    const value = validSnapshot();
    value.generatedAt = raw;
    expect(validateCcPanesSessionSnapshot(value).generatedAt)
      .toBe('2026-08-15T08:46:58.123Z');

    const rejected = validSnapshot();
    rejected.generatedAt =
      `${' '.repeat(33)}${timestamp}${' '.repeat(32)}`;
    expect(rejected.generatedAt.length).toBe(100);
    expectInvalid(rejected, 'generatedAt');
  });

  test.each([
    ['generatedAt', 'not-a-date'],
    ['generatedAt', '2026-08-15'],
    ['generatedAt', '2026-08-15T08:46:58.097'],
    ['generatedAt', '2026-02-30T08:46:58.097Z'],
    ['generatedAt', '1900-02-29T08:46:58.097Z'],
    ['generatedAt', '2026-08-15T24:00:00.000Z'],
    ['generatedAt', '9999-12-31T23:59:59.999-23:59'],
    ['generatedAt', '0000-01-01T00:00:00.000+23:59'],
    ['launches[0].launchedAt', '2026-13-15T08:36:14.400Z']
  ])('rejects invalid timestamp %s=%s', (field, timestamp) => {
    const value = validSnapshot();
    if (field === 'generatedAt') {
      value.generatedAt = timestamp;
    } else {
      value.launches[0].launchedAt = timestamp;
    }
    expectInvalid(value, field);
  });

  test.each([
    '0000-01-01T00:00:00.000Z',
    '9999-12-31T23:59:59.999Z'
  ])('accepts closed four-digit year boundary %s', (timestamp) => {
    const value = validSnapshot();
    value.generatedAt = timestamp;
    value.launches[0].launchedAt = timestamp;

    const normalized = validateCcPanesSessionSnapshot(value);
    expect(normalized.generatedAt).toBe(timestamp);
    expect(normalized.launches[0].launchedAt).toBe(timestamp);
    expect(inspectCcPanesSnapshotFreshness(timestamp, timestamp, 0)).toEqual({
      state: 'fresh',
      ageMs: 0,
      maxAgeMs: 0
    });

    const replay = validSnapshot();
    replay.generatedAt = normalized.generatedAt;
    replay.launches[0].launchedAt = normalized.launches[0].launchedAt;
    expect(validateCcPanesSessionSnapshot(replay).generatedAt).toBe(timestamp);
  });

  test('accepts a valid Gregorian leap day', () => {
    const value = validSnapshot();
    value.generatedAt = '2000-02-29T12:00:00.000Z';
    expect(validateCcPanesSessionSnapshot(value).generatedAt)
      .toBe('2000-02-29T12:00:00.000Z');
  });

  test('canonicalizes a normal offset across a year boundary', () => {
    const value = validSnapshot();
    value.generatedAt = '2026-01-01T00:30:00.000+01:00';
    expect(validateCcPanesSessionSnapshot(value).generatedAt)
      .toBe('2025-12-31T23:30:00.000Z');
  });

  test('rejects duplicate launch IDs after trimming', () => {
    const value = validSnapshot();
    value.launches.push({
      ...value.launches[0],
      launchId: 'launch-1',
      projectPath: '/home/User/Repo'
    });
    expectInvalid(value, 'duplicate launchId');
  });

  test('rejects duplicate session IDs after trimming', () => {
    const value = validSnapshot();
    value.sessions.push({
      ...value.sessions[0],
      sessionId: 'pty-1',
      projectPath: '/home/User/Repo'
    });
    expectInvalid(value, 'duplicate sessionId');
  });

  test('accepts the exact launches capacity', () => {
    const value = validSnapshot();
    const entry = value.launches[0];
    value.launches = Array.from(
      { length: CCPANES_SESSION_SNAPSHOT_LIMITS.launches },
      (_, index) => ({ ...entry, launchId: `launch-${index}` })
    );
    value.sessions = [];

    expect(validateCcPanesSessionSnapshot(value).launches)
      .toHaveLength(CCPANES_SESSION_SNAPSHOT_LIMITS.launches);
  });

  test('rejects launches capacity +1 before entry normalization', () => {
    const value = validSnapshot();
    const entry = value.launches[0];
    let entryAccessed = false;
    value.launches = Array.from(
      { length: CCPANES_SESSION_SNAPSHOT_LIMITS.launches + 1 },
      (_, index) => ({ ...entry, launchId: `launch-${index}` })
    );
    value.launches[0] = new Proxy(entry, {
      get() {
        entryAccessed = true;
        throw new Error('launch entry accessed');
      },
      ownKeys() {
        entryAccessed = true;
        throw new Error('launch entry accessed');
      }
    });
    expectInvalid(value, 'launches');
    expect(entryAccessed).toBe(false);
  });

  test('accepts the exact sessions capacity', () => {
    const value = validSnapshot();
    const entry = value.sessions[0];
    value.launches = [];
    value.sessions = Array.from(
      { length: CCPANES_SESSION_SNAPSHOT_LIMITS.sessions },
      (_, index) => ({ ...entry, sessionId: `session-${index}` })
    );

    expect(validateCcPanesSessionSnapshot(value).sessions)
      .toHaveLength(CCPANES_SESSION_SNAPSHOT_LIMITS.sessions);
  });

  test('rejects sessions capacity +1 before entry normalization', () => {
    const value = validSnapshot();
    const entry = value.sessions[0];
    let entryAccessed = false;
    value.sessions = Array.from(
      { length: CCPANES_SESSION_SNAPSHOT_LIMITS.sessions + 1 },
      (_, index) => ({ ...entry, sessionId: `session-${index}` })
    );
    value.sessions[0] = new Proxy(entry, {
      get() {
        entryAccessed = true;
        throw new Error('session entry accessed');
      },
      ownKeys() {
        entryAccessed = true;
        throw new Error('session entry accessed');
      }
    });
    expectInvalid(value, 'sessions');
    expect(entryAccessed).toBe(false);
  });
});

describe('inspectCcPanesSnapshotFreshness', () => {
  test.each([
    ['generatedAt', `${' '.repeat(100_000)}2026-08-15T08:00:00.000Z`, '2026-08-15T09:00:00.000Z'],
    ['now', '2026-08-15T08:00:00.000Z', `${' '.repeat(100_000)}2026-08-15T09:00:00.000Z`],
    ['generatedAt', '2026-08-15T08:00:00.1234567890Z', '2026-08-15T09:00:00.000Z']
  ])('rejects over-limit freshness timestamp %s before parsing', (
    field,
    generatedAt,
    now
  ) => {
    expect(() => inspectCcPanesSnapshotFreshness(generatedAt, now))
      .toThrow(field);
  });

  test('reports a fresh snapshot', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-15T08:00:00.000Z',
      '2026-08-15T09:00:00.000Z'
    )).toEqual({
      state: 'fresh',
      ageMs: 3_600_000,
      maxAgeMs: 86_400_000
    });
  });

  test('keeps the exact max-age boundary fresh', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-14T09:00:00.000Z',
      '2026-08-15T09:00:00.000Z'
    )).toEqual({
      state: 'fresh',
      ageMs: 86_400_000,
      maxAgeMs: 86_400_000
    });
  });

  test('keeps zero age fresh when maxAgeMs is zero', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-15T09:00:00.000Z',
      '2026-08-15T09:00:00.000Z',
      0
    )).toEqual({
      state: 'fresh',
      ageMs: 0,
      maxAgeMs: 0
    });
  });

  test('reports stale snapshots as typed diagnostics', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-13T08:00:00.000Z',
      '2026-08-15T09:00:00.000Z',
      24 * 60 * 60 * 1_000
    )).toEqual({
      state: 'stale',
      ageMs: 176_400_000,
      maxAgeMs: 86_400_000
    });
  });

  test('keeps snapshots within the default future clock skew fresh', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-15T09:05:00.000Z',
      '2026-08-15T09:00:00.000Z',
      1
    )).toEqual({
      state: 'fresh',
      ageMs: 0,
      maxAgeMs: 1
    });
  });

  test('reports snapshots beyond future clock skew as typed future state', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-15T09:05:00.001Z',
      '2026-08-15T09:00:00.000Z',
      1
    )).toEqual({
      state: 'future',
      ageMs: 0,
      maxAgeMs: 1,
      futureByMs: 300_001,
      maxFutureSkewMs: 300_000
    });
  });

  test('honors a custom future clock skew boundary', () => {
    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-15T09:01:00.000Z',
      '2026-08-15T09:00:00.000Z',
      1,
      60_000
    )).toEqual({
      state: 'fresh',
      ageMs: 0,
      maxAgeMs: 1
    });

    expect(inspectCcPanesSnapshotFreshness(
      '2026-08-15T09:01:00.001Z',
      '2026-08-15T09:00:00.000Z',
      1,
      60_000
    )).toEqual({
      state: 'future',
      ageMs: 0,
      maxAgeMs: 1,
      futureByMs: 60_001,
      maxFutureSkewMs: 60_000
    });
  });

  test.each([
    ['generatedAt', 'not-a-date', '2026-08-15T09:00:00.000Z'],
    ['generatedAt', '2026-08-15', '2026-08-15T09:00:00.000Z'],
    ['generatedAt', '2026-02-30T09:00:00.000Z', '2026-08-15T09:00:00.000Z'],
    ['now', '2026-08-15T08:00:00.000Z', 'not-a-date'],
    ['now', '2026-08-15T08:00:00.000Z', '2026-08-15T09:00:00.000']
  ])('rejects invalid %s timestamp input', (field, generatedAt, now) => {
    expect(() => inspectCcPanesSnapshotFreshness(generatedAt, now)).toThrow(field);
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1
  ])('rejects invalid maxAgeMs=%s', (maxAgeMs) => {
    expect(() => inspectCcPanesSnapshotFreshness(
      '2026-08-15T08:00:00.000Z',
      '2026-08-15T09:00:00.000Z',
      maxAgeMs
    )).toThrow('maxAgeMs');
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1
  ])('rejects invalid maxFutureSkewMs=%s', (maxFutureSkewMs) => {
    expect(() => inspectCcPanesSnapshotFreshness(
      '2026-08-15T08:00:00.000Z',
      '2026-08-15T09:00:00.000Z',
      1,
      maxFutureSkewMs
    )).toThrow('maxFutureSkewMs');
  });
});
