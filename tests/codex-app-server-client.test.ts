import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import {
  AppServerTransportError,
  CodexAppServerClient,
  isCodexAppServerThreadId,
  resolveCodexAppServerExecutable,
  spawnCodexAppServer,
  type AppServerThread,
  type AppServerTransport,
  type ThreadListPage,
  type ThreadListParams
} from '../src/codex-app-server-client.js';
import { isCodexThreadId } from '../src/codex-session-identity.js';
import { CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES } from
  '../src/codex-session-privacy.js';

type RequestMessage = {
  id?: number;
  method?: string;
  params?: unknown;
};

class FakeTransport implements AppServerTransport {
  readonly writes: unknown[] = [];
  closeCount = 0;
  onWrite: ((request: RequestMessage) => void) | null = null;
  private messageListener: ((value: unknown) => void) | null = null;
  private errorListener: ((error: AppServerTransportError) => void) | null = null;

  onMessage(listener: (value: unknown) => void): void {
    this.messageListener = listener;
  }

  onError(listener: (error: AppServerTransportError) => void): void {
    this.errorListener = listener;
  }

  write(value: unknown): void {
    this.writes.push(value);
    this.onWrite?.(value as RequestMessage);
  }

  respond(value: unknown): void {
    this.messageListener?.(value);
  }

  fail(reason: ConstructorParameters<typeof AppServerTransportError>[0]): void {
    this.errorListener?.(new AppServerTransportError(reason));
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.exitCode = 0;
    queueMicrotask(() => this.emit('exit', 0, signal ?? null));
    return true;
  });
}

const THREAD_FIELDS = [
  'id',
  'extra',
  'sessionId',
  'forkedFromId',
  'parentThreadId',
  'preview',
  'ephemeral',
  'section',
  'sectionEnteredAt',
  'historyMode',
  'modelProvider',
  'createdAt',
  'updatedAt',
  'recencyAt',
  'status',
  'path',
  'cwd',
  'cliVersion',
  'source',
  'canAcceptDirectInput',
  'threadSource',
  'agentNickname',
  'agentRole',
  'gitInfo',
  'name',
  'turns'
] as const;
const THREAD_REQUIRED_FIELDS = [
  'id',
  'sessionId',
  'preview',
  'ephemeral',
  'modelProvider',
  'createdAt',
  'updatedAt',
  'status',
  'cwd',
  'cliVersion',
  'source',
  'turns'
] as const;

function initializeResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    userAgent: 'Codex Desktop/0.147.0 (Windows 11; x86_64)',
    codexHome: 'C:\\Users\\fixture\\.codex',
    platformFamily: 'windows',
    platformOs: 'windows',
    ...overrides
  };
}

function rawThread(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    extra: null,
    sessionId: `session-${id}`,
    forkedFromId: null,
    parentThreadId: null,
    preview: `Preview ${id}`,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: 'legacy',
    modelProvider: 'openai',
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    status: { type: 'notLoaded' },
    path: null,
    cwd: 'D:\\Repo',
    cliVersion: '0.147.0',
    source: 'cli',
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides
  };
}

function requiredRawThread(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const value = rawThread(id, overrides);
  for (const field of THREAD_FIELDS) {
    if (!(THREAD_REQUIRED_FIELDS as readonly string[]).includes(field)) {
      delete value[field];
    }
  }
  return value;
}

function page(
  data: unknown[],
  nextCursor: string | null = null,
  backwardsCursor: string | null = null
): Record<string, unknown> {
  return { data, nextCursor, backwardsCursor };
}

function installSuccessfulInitialize(transport: FakeTransport): void {
  transport.onWrite = (request) => {
    if (request.method === 'initialize') {
      transport.respond({
        id: request.id,
        result: initializeResponse()
      });
    }
  };
}

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test('exposes the App Server thread ID contract for consumers', () => {
  expect(isCodexAppServerThreadId).toBe(isCodexThreadId);
  expect(isCodexAppServerThreadId('thread-1')).toBe(true);
  expect(isCodexAppServerThreadId(`t${'a'.repeat(511)}`)).toBe(true);
  expect(isCodexAppServerThreadId('线程-1')).toBe(false);
  expect(isCodexAppServerThreadId('thread/id')).toBe(false);
  expect(isCodexAppServerThreadId(`t${'a'.repeat(512)}`)).toBe(false);
});

test('routes App Server thread fields directly through core owner helpers', () => {
  const source = fs.readFileSync(
    new URL('../src/codex-app-server-client.ts', import.meta.url),
    'utf8'
  );

  expect(source).toContain('function requireInputThreadId(');
  expect(source).toContain('function requireResponseThreadId(');
  expect(source).toContain('function requireNullableResponseThreadId(');
  expect(source.match(/return requireCodexThreadId\(value, \(\) => \{/gu))
    .toHaveLength(2);
  expect(source).toContain("throw clientError('invalid-argument');");
  expect(source).toContain("throw clientError('invalid-response');");
  expect(source).toContain('const id = requireResponseThreadId(thread.id);');
  expect(source).toContain(
    'requireNullableResponseThreadId(thread.forkedFromId);'
  );
  expect(source).toContain(
    'requireNullableResponseThreadId(thread.parentThreadId);'
  );
  expect(source).toContain(
    'requireResponseThreadId(details.parent_thread_id);'
  );
  expect(source).not.toContain('function requireNullableThreadId(');
});

test.each([
  '',
  `a${'b'.repeat(512)}`,
  ' leading',
  'trailing ',
  'thread/with/slash',
  'thread\nwith-control',
  'sk-proj-secret-shaped'
])('rejects core-invalid thread/read input without exposing it: %j', async (threadId) => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();

  const error = await rejectedError(client.readThread(threadId));

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-argument'
  });
  if (threadId) {
    expect(error.message).not.toContain(threadId);
    expect(JSON.stringify(error)).not.toContain(threadId);
  }
  expect(transport.writes.filter(
    (value) => (value as RequestMessage).method === 'thread/read'
  )).toEqual([]);
});

test('initializes once, sends initialized, and lists cli plus vscode threads', async () => {
  const transport = new FakeTransport();
  transport.onWrite = (request) => {
    if (request.method === 'initialize') {
      transport.respond({
        id: request.id,
        result: initializeResponse()
      });
    } else if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread('thread-cli')])
      });
    }
  };
  const client = new CodexAppServerClient(transport, 1_000);

  await Promise.all([client.initialize(), client.initialize()]);
  const params: ThreadListParams = {
    cwd: ['D:\\Repo'],
    sourceKinds: ['cli', 'vscode'],
    archived: false,
    limit: 100,
    useStateDbOnly: true
  };
  const threads: AppServerThread[] = await client.listAllThreads(params);

  expect(threads).toEqual([{
    id: 'thread-cli',
    name: null,
    cwd: 'D:\\Repo',
    source: 'cli',
    preview: 'Preview thread-cli',
    updatedAt: 2,
    recencyAt: 2
  }]);
  expect(transport.writes.filter(
    (value) => (value as RequestMessage).method === 'initialize'
  )).toHaveLength(1);
  expect(transport.writes.map(
    (value) => (value as RequestMessage).method
  )).toEqual(['initialize', 'initialized', 'thread/list']);
  expect(transport.writes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'hooks-session-federation',
          title: 'Hooks Session Federation',
          version: '0.1.0'
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      }
    }),
    { method: 'initialized' },
    expect.objectContaining({
      method: 'thread/list',
      params: expect.objectContaining({
        cwd: ['D:\\Repo'],
        sourceKinds: ['cli', 'vscode']
      })
    })
  ]));
});

test('requires the exact codex-cli 0.147.0 initialize response shape', async () => {
  const required = [
    'userAgent',
    'codexHome',
    'platformFamily',
    'platformOs'
  ] as const;
  const variants: Record<string, unknown>[] = [];
  for (const field of required) {
    const value = initializeResponse();
    delete value[field];
    variants.push(value);
  }
  variants.push(initializeResponse({ unexpected: 'TOKEN-private' }));

  for (const result of variants) {
    const transport = new FakeTransport();
    transport.onWrite = (request) => {
      if (request.method === 'initialize') {
        transport.respond({ id: request.id, result });
      }
    };
    const client = new CodexAppServerClient(transport, 1_000);

    const error = await rejectedError(client.initialize());

    expect(error).toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-response'
    });
    expect(JSON.stringify(error)).not.toContain('TOKEN-private');
  }
});

test('rejects initialize userAgent without the exact installed 0.147.0 version', async () => {
  const variants = [
    'Codex Desktop/0.148.0 (Windows 11; x86_64)',
    'Codex Desktop/10.147.0 (Windows 11; x86_64)',
    'Codex Desktop/0.147.00 (Windows 11; x86_64)',
    'codex_cli_rs/0.147.0-alpha.4',
    'x0.147.0y'
  ];

  for (const userAgent of variants) {
    const transport = new FakeTransport();
    transport.onWrite = (request) => {
      if (request.method === 'initialize') {
        transport.respond({
          id: request.id,
          result: initializeResponse({ userAgent })
        });
      }
    };
    const client = new CodexAppServerClient(transport, 1_000);

    const error = await rejectedError(client.initialize());

    expect(error).toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'unsupported-version'
    });
    expect(error.message).not.toContain(userAgent);
    expect(JSON.stringify(error)).not.toContain(userAgent);
  }
});

test('supports string and null cwd list filters', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();

  const paramsSeen: unknown[] = [];
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      paramsSeen.push(request.params);
      transport.respond({ id: request.id, result: page([]) });
    }
  };

  const first: ThreadListPage = await client.listThreads({ cwd: 'D:\\Repo' });
  const second = await client.listThreads({ cwd: null });

  expect(first).toEqual({
    data: [],
    nextCursor: null,
    backwardsCursor: null
  });
  expect(second.data).toEqual([]);
  expect(paramsSeen).toEqual([
    { cwd: 'D:\\Repo' },
    { cwd: null }
  ]);
});

test('reads a hidden thread by ID without loading turns', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/read') {
      transport.respond({
        id: request.id,
        result: {
          thread: rawThread('thread-hidden', {
            name: null,
            preview: 'Hidden thread'
          })
        }
      });
    }
  };

  await expect(client.readThread('thread-hidden')).resolves.toMatchObject({
    id: 'thread-hidden',
    name: null,
    preview: 'Hidden thread'
  });
  expect(transport.writes).toContainEqual(expect.objectContaining({
    method: 'thread/read',
    params: {
      threadId: 'thread-hidden',
      includeTurns: false
    }
  }));
});

test('maps thread/read not-found to null and rejects a mismatched returned ID', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const results = [
    {
      error: {
        code: -32600,
        message:
          'thread not loaded: 00000000-0000-7000-8000-000000000001'
      }
    },
    {
      result: {
        thread: rawThread('different-thread')
      }
    },
    {
      error: {
        code: -32600,
        message: 'invalid thread id: invalid character'
      }
    }
  ];
  transport.onWrite = (request) => {
    if (request.method === 'thread/read') {
      transport.respond({
        id: request.id,
        ...results.shift()
      });
    }
  };

  await expect(
    client.readThread('00000000-0000-7000-8000-000000000001')
  ).resolves.toBeNull();
  await expect(client.readThread('requested-thread')).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-response'
  });
  await expect(client.readThread('thread-hidden')).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'app-server-error',
    serverCode: -32600,
    category: null
  });
  await expect(client.readThread('unsafe thread id')).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-argument'
  });
});

test('rejects a thread/read not-found error for a different requested ID', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/read') {
      transport.respond({
        id: request.id,
        error: {
          code: -32600,
          message:
            'thread not loaded: 00000000-0000-7000-8000-000000000003'
        }
      });
    }
  };

  await expect(
    client.readThread('00000000-0000-7000-8000-000000000002')
  ).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-response'
  });
});

test('defaults omitted thread/list cursors to null', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({ id: request.id, result: { data: [] } });
    }
  };

  await expect(client.listThreads({})).resolves.toEqual({
    data: [],
    nextCursor: null,
    backwardsCursor: null
  });
});

test('requires only schema-required Thread fields and still rejects unknown keys', async () => {
  expect(Object.keys(rawThread('thread-contract'))).toEqual(THREAD_FIELDS);
  const variants: Record<string, unknown>[] = [];
  for (const field of THREAD_REQUIRED_FIELDS) {
    const value = requiredRawThread('thread-contract');
    delete value[field];
    variants.push(value);
  }
  variants.push(rawThread('thread-contract', {
    unexpectedMetadata: { secret: 'TOKEN-private' }
  }));

  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([variants.shift()])
      });
    }
  };

  for (let index = 0; index < THREAD_REQUIRED_FIELDS.length + 1; index += 1) {
    const error = await rejectedError(client.listThreads({}));
    expect(error).toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-response'
    });
    expect(JSON.stringify(error)).not.toContain('TOKEN-private');
  }
});

test('accepts a Thread containing only the 12 schema-required fields', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([requiredRawThread('thread-required')])
      });
    }
  };

  await expect(client.listThreads({ limit: 1 })).resolves.toEqual({
    data: [{
      id: 'thread-required',
      name: null,
      cwd: 'D:\\Repo',
      source: 'cli',
      preview: 'Preview thread-required',
      updatedAt: 2,
      recencyAt: null
    }],
    nextCursor: null,
    backwardsCursor: null
  });
});

test('accepts a non-empty page with every codex-cli 0.147.0 Thread field', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread('thread-complete', {
          extra: {},
          historyMode: 'paginated',
          canAcceptDirectInput: true
        })])
      });
    }
  };

  await expect(client.listThreads({ limit: 1 })).resolves.toMatchObject({
    data: [{
      id: 'thread-complete',
      name: null,
      source: 'cli'
    }]
  });
});

test('accepts owner-valid 512-character IDs in every App Server thread field', async () => {
  const threadId = `T${'t'.repeat(511)}`;
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread(threadId, {
          sessionId: 'session-owner-boundary',
          forkedFromId: threadId,
          parentThreadId: threadId,
          section: { id: threadId, name: 'Section' },
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: threadId,
                depth: 1
              }
            }
          }
        })])
      });
    }
  };

  await expect(client.listThreads({ limit: 1 })).resolves.toMatchObject({
    data: [{ id: threadId }]
  });
});

test.each([
  [
    'thread.id',
    (overlong: string) => rawThread(overlong, {
      sessionId: 'session-owner-overlong'
    })
  ],
  [
    'thread.forkedFromId',
    (overlong: string) => rawThread('thread-owner-overlong', {
      forkedFromId: overlong
    })
  ],
  [
    'thread.parentThreadId',
    (overlong: string) => rawThread('thread-owner-overlong', {
      parentThreadId: overlong
    })
  ],
  [
    'thread.section.id',
    (overlong: string) => rawThread('thread-owner-overlong', {
      section: { id: overlong, name: 'Section' }
    })
  ],
  [
    'thread.source.subAgent.thread_spawn.parent_thread_id',
    (overlong: string) => rawThread('thread-owner-overlong', {
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: overlong,
            depth: 1
          }
        }
      }
    })
  ]
] as const)(
  'rejects a 513-character response thread ID at %s without exposing it',
  async (_field, responseThread) => {
    const overlong = `T${'t'.repeat(512)}`;
    const transport = new FakeTransport();
    installSuccessfulInitialize(transport);
    const client = new CodexAppServerClient(transport, 1_000);
    await client.initialize();
    transport.onWrite = (request) => {
      if (request.method === 'thread/list') {
        transport.respond({
          id: request.id,
          result: page([responseThread(overlong)])
        });
      }
    };

    const error = await rejectedError(client.listThreads({ limit: 1 }));
    expect(error).toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-response'
    });
    expect(error.message).not.toContain(overlong);
    expect(JSON.stringify(error)).not.toContain(overlong);
  }
);

test('projects an overlong App Server preview instead of rejecting the page', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread('thread-long-preview', {
          preview: 'x'.repeat(1_172)
        })])
      });
    }
  };

  await expect(client.listThreads({ limit: 1 })).resolves.toMatchObject({
    data: [{
      id: 'thread-long-preview',
      preview: `${'x'.repeat(511)}…`
    }]
  });
});

test('strictly validates bounded nested Thread fields without metadata containers', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const valid = rawThread('thread-nested', {
    extra: {
      provider: 'fixture',
      flags: [true, false],
      nested: { value: 1 }
    },
    section: { id: 'section-1', name: 'Section' },
    sectionEnteredAt: 3,
    status: {
      type: 'active',
      activeFlags: ['waitingOnApproval', 'waitingOnUserInput']
    },
    path: 'D:\\sessions\\thread-nested.jsonl',
    source: { custom: 'fixture-source' },
    threadSource: 'fixture-thread-source',
    agentNickname: 'fixture-agent',
    agentRole: 'worker',
    gitInfo: { sha: null, branch: 'main', originUrl: null },
    turns: []
  });
  let tooDeep: unknown = 'leaf';
  for (let index = 0; index < 20; index += 1) {
    tooDeep = { next: tooDeep };
  }
  const invalid = [
    rawThread('thread-section-extra', {
      section: { id: 'section-1', name: 'Section', metadata: 'TOKEN-private' }
    }),
    rawThread('thread-section-long', {
      section: { id: 'section-1', name: 'x'.repeat(513) }
    }),
    rawThread('thread-status-extra', {
      status: { type: 'idle', metadata: 'TOKEN-private' }
    }),
    rawThread('thread-flags-capacity', {
      status: {
        type: 'active',
        activeFlags: Array(513).fill('waitingOnApproval')
      }
    }),
    rawThread('thread-git-extra', {
      gitInfo: {
        sha: null,
        branch: 'main',
        originUrl: null,
        metadata: 'TOKEN-private'
      }
    }),
    rawThread('thread-source-extra', {
      source: { custom: 'fixture-source', metadata: 'TOKEN-private' }
    }),
    rawThread('thread-extra-depth', {
      extra: { value: tooDeep }
    }),
    rawThread('thread-extra-array', {
      extra: { values: Array(513).fill(null) }
    }),
    rawThread('thread-extra-string', {
      extra: { value: 'x'.repeat(513) }
    }),
    rawThread('thread-extra-nodes', {
      extra: {
        groups: Array.from(
          { length: 9 },
          () => Array(512).fill(null)
        )
      }
    }),
    rawThread('thread-extra-raw-size', {
      extra: {
        values: Array.from(
          { length: 130 },
          () => 'x'.repeat(512)
        )
      }
    }),
    rawThread('thread-history-mode', {
      historyMode: 'future-mode'
    }),
    rawThread('thread-direct-input', {
      canAcceptDirectInput: 'yes'
    }),
    rawThread('thread-source-long', {
      threadSource: 'x'.repeat(513)
    }),
    rawThread('thread-created-fraction', { createdAt: 1.5 }),
    rawThread('thread-created-unsafe', {
      createdAt: Number.MAX_SAFE_INTEGER + 1
    }),
    rawThread('thread-updated-fraction', { updatedAt: 1.5 }),
    rawThread('thread-updated-unsafe', {
      updatedAt: Number.MAX_SAFE_INTEGER + 1
    }),
    rawThread('thread-recency-fraction', { recencyAt: 1.5 }),
    rawThread('thread-recency-unsafe', {
      recencyAt: Number.MAX_SAFE_INTEGER + 1
    }),
    rawThread('thread-section-entered-fraction', { sectionEnteredAt: 1.5 }),
    rawThread('thread-section-entered-unsafe', {
      sectionEnteredAt: Number.MAX_SAFE_INTEGER + 1
    })
  ];
  const results = [valid, ...invalid];
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([results.shift()])
      });
    }
  };

  await expect(client.listThreads({})).resolves.toMatchObject({
    data: [{
      id: 'thread-nested',
      source: { custom: 'fixture-source' }
    }]
  });
  for (let index = 0; index < invalid.length; index += 1) {
    const error = await rejectedError(client.listThreads({}));
    expect(error).toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-response'
    });
    expect(JSON.stringify(error)).not.toContain('TOKEN-private');
  }
});

test('accepts GitInfo objects with every field omitted or partially present', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const results = [
    rawThread('thread-git-empty', { gitInfo: {} }),
    rawThread('thread-git-partial', {
      gitInfo: { branch: 'main', originUrl: null }
    })
  ];
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([results.shift()])
      });
    }
  };

  await expect(client.listThreads({})).resolves.toMatchObject({
    data: [{ id: 'thread-git-empty' }]
  });
  await expect(client.listThreads({})).resolves.toMatchObject({
    data: [{ id: 'thread-git-partial' }]
  });
});

test('accepts thread_spawn with only required parent and depth fields', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const source = {
    subAgent: {
      thread_spawn: {
        parent_thread_id: 'thread-parent',
        depth: 1
      }
    }
  };
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread('thread-subagent', { source })])
      });
    }
  };

  await expect(client.listThreads({})).resolves.toMatchObject({
    data: [{
      id: 'thread-subagent',
      source
    }]
  });
});

test('rejects non-empty Thread turns in thread/list responses', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const secret = 'sk-proj-AbCdEf123456';
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread('thread-with-turn', {
          turns: [{ id: 'turn-1', text: secret }]
        })])
      });
    }
  };

  const error = await rejectedError(client.listThreads({}));

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-response'
  });
  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('rejects a thread/list page larger than the requested limit', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread('thread-1'), rawThread('thread-2')])
      });
    }
  };

  await expect(client.listThreads({ limit: 1 })).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'thread-limit'
  });
});

test('requires explicit initialization before list or set name', async () => {
  const transport = new FakeTransport();
  const client = new CodexAppServerClient(transport, 1_000);

  await expect(client.listThreads({})).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'not-initialized'
  });
  await expect(client.setThreadName('thread-1', 'Name')).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'not-initialized'
  });
  expect(transport.writes).toEqual([]);
});

test('sets a bounded thread name through thread/name/set', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/name/set') {
      transport.respond({
        id: request.id,
        result: {
          acknowledged: true,
          metadata: { state: 'updated' }
        }
      });
    }
  };

  const name = '😀'.repeat(120);
  await client.setThreadName('thread-cli', name);

  expect(transport.writes).toContainEqual(expect.objectContaining({
    method: 'thread/name/set',
    params: { threadId: 'thread-cli', name }
  }));
  await expect(client.setThreadName('thread-cli', '😀'.repeat(121)))
    .rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-argument'
    });
  await expect(client.setThreadName('unsafe thread id', 'Name'))
    .rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-argument'
    });
  await expect(client.setThreadName('thread-cli', 'unsafe\uD800name'))
    .rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-argument'
    });
});

test('rejects an unbounded thread/name/set object response', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/name/set') {
      transport.respond({
        id: request.id,
        result: { metadata: 'x'.repeat(513) }
      });
    }
  };

  await expect(client.setThreadName('thread-cli', 'Name'))
    .rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-response'
    });
});

test('rejects foreseeable oversized list input before writing a request', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({ id: request.id, result: page([]) });
    }
  };
  const oversizedCwd = Array.from(
    { length: 130 },
    (_, index) => `C:\\${String(index).padStart(3, '0')}${'x'.repeat(506)}`
  );

  await expect(client.listThreads({ cwd: oversizedCwd }))
    .rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-argument'
    });
  expect(transport.writes.filter(
    (value) => (value as RequestMessage).method === 'thread/list'
  )).toEqual([]);
});

test('rejects a request on timeout with a typed privacy-safe error', async () => {
  vi.useFakeTimers();
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 10);
  await client.initialize();
  transport.onWrite = null;

  const pending = client.listThreads({});
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'timeout'
  });
  await vi.advanceTimersByTimeAsync(11);
  await assertion;
});

test('retains only a safe machine code and category from App Server errors', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const secret = 'TOKEN-super-secret';
  const privatePath = 'D:\\private\\metadata.json';
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        error: {
          code: -32001,
          message: `${secret} ${privatePath}`,
          data: {
            category: 'transient',
            metadata: { secret, privatePath }
          }
        }
      });
    }
  };

  const error = await rejectedError(client.listThreads({}));

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'app-server-error',
    serverCode: -32001,
    category: 'transient'
  });
  expect(error.message).not.toContain(secret);
  expect(error.message).not.toContain(privatePath);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(privatePath);
});

test('drops non-integer App Server codes and non-allowlisted categories', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const secret = 'sk-proj-AbCdEf123456';
  const unsafeCategory = 'opaque-class';
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        error: {
          code: secret,
          message: secret,
          data: {
            category: unsafeCategory,
            nested: { marker: secret }
          }
        }
      });
    }
  };

  const error = await rejectedError(client.listThreads({}));

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'app-server-error',
    serverCode: null,
    category: null
  });
  expect(error.message).not.toContain(secret);
  expect(error.message).not.toContain(unsafeCategory);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(unsafeCategory);
});

test('rejects unbounded App Server error data without exposing it', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const secret = 'sk-proj-AbCdEf123456';
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        error: {
          code: -32001,
          message: 'request failed',
          data: {
            category: 'transient',
            values: Array(513).fill(secret)
          }
        }
      });
    }
  };

  const error = await rejectedError(client.listThreads({}));

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-response'
  });
  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('rejects a malformed correlated error response instead of leaving it pending', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        error: {
          code: 'SERVER_ERROR',
          message: 'TOKEN-private',
          unexpected: 'D:\\private\\metadata.json'
        }
      });
    }
  };

  const outcome = await Promise.race([
    client.listThreads({}).then(
      () => ({ status: 'resolved' as const, error: null }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    ),
    new Promise<{ status: 'pending'; error: null }>((resolve) => {
      setTimeout(() => resolve({ status: 'pending', error: null }), 20);
    })
  ]);

  expect(outcome.status).toBe('rejected');
  expect(outcome.error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'invalid-response'
  });
  expect(JSON.stringify(outcome.error)).not.toContain('TOKEN-private');
  expect(JSON.stringify(outcome.error)).not.toContain('D:\\private');
});

test.each([
  ['malformed-json', Buffer.from('{"id":1,"secret":"TOKEN-private"')],
  [
    'line-too-long',
    Buffer.concat([
      Buffer.alloc(CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES + 1, 0x78),
      Buffer.from('\n')
    ])
  ]
] as const)(
  'surfaces %s stdout as a typed privacy-safe transport error',
  async (reason, bytes) => {
    const child = new FakeChildProcess();
    const spawnProcess = vi.fn(() => child);
    const transport = spawnCodexAppServer(
      'codex-test',
      spawnProcess as never
    );
    const client = new CodexAppServerClient(transport, 1_000);

    const pending = client.initialize();
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_TRANSPORT',
      reason
    });
    child.stdout.write(bytes);
    if (reason === 'malformed-json') child.stdout.write('\n');
    await assertion;

    const error = await rejectedError(client.initialize());
    expect(error.message).not.toContain('TOKEN-private');
    expect(JSON.stringify(error)).not.toContain('TOKEN-private');
    expect(spawnProcess).toHaveBeenCalledWith(
      'codex-test',
      ['app-server', '--stdio'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    await client.close();
  }
);

test('maps a child stdin error to write-failed without an uncaught error', async () => {
  const child = new FakeChildProcess();
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );
  const client = new CodexAppServerClient(transport, 1_000);
  const secret = 'sk-proj-AbCdEf123456';

  const pending = client.initialize();
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'write-failed'
  });
  expect(() => child.stdin.emit('error', new Error(secret))).not.toThrow();
  await assertion;

  const error = await rejectedError(client.initialize());
  expect(error.message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  child.exitCode = 0;
  await client.close();
});

test('suppresses child stdin errors after transport close starts', async () => {
  const child = new FakeChildProcess();
  child.exitCode = 0;
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );

  const closing = transport.close();
  expect(() => child.stdin.emit(
    'error',
    new Error('sk-proj-AbCdEf123456')
  )).not.toThrow();
  await closing;
});

test('accepts a 64 KiB JSON payload terminated by CRLF', async () => {
  const child = new FakeChildProcess();
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );
  const client = new CodexAppServerClient(transport, 1_000);
  const pending = client.initialize();
  const json = JSON.stringify({
    id: 1,
    result: initializeResponse()
  });
  const paddingLength =
    CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES - Buffer.byteLength(json, 'utf8');
  const payload = Buffer.concat([
    Buffer.alloc(paddingLength, 0x20),
    Buffer.from(json, 'utf8')
  ]);

  expect(payload).toHaveLength(CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES);
  child.stdout.write(Buffer.concat([payload, Buffer.from('\r\n')]));
  await expect(pending).resolves.toBeUndefined();

  child.exitCode = 0;
  await client.close();
});

test('decodes a multi-byte UTF-8 sequence split across stdout chunks', async () => {
  const child = new FakeChildProcess();
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );
  const client = new CodexAppServerClient(transport, 1_000);
  const pending = client.initialize();
  const emoji = Buffer.from('😀', 'utf8');
  const line = Buffer.from(JSON.stringify({
    id: 1,
    result: initializeResponse({
      userAgent: 'Codex Desktop/0.147.0 😀'
    })
  }), 'utf8');
  const emojiOffset = line.indexOf(emoji);

  expect(emojiOffset).toBeGreaterThan(0);
  child.stdout.write(line.subarray(0, emojiOffset + 1));
  child.stdout.write(line.subarray(emojiOffset + 1));
  child.stdout.write('\n');
  await expect(pending).resolves.toBeUndefined();

  child.exitCode = 0;
  await client.close();
});

test('rejects invalid UTF-8 stdout without exposing decoded payload data', async () => {
  const child = new FakeChildProcess();
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );
  const client = new CodexAppServerClient(transport, 1_000);
  const pending = client.initialize();
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'invalid-utf8'
  });

  child.stdout.write(Buffer.concat([
    Buffer.from('{"id":1,"result":"', 'utf8'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}\n', 'utf8')
  ]));
  await assertion;

  child.exitCode = 0;
  await client.close();
});

test('transport close returns after a graceful child exit', async () => {
  const child = new FakeChildProcess();
  child.stdin.once('finish', () => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  });
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );

  await transport.close();

  expect(child.kill).not.toHaveBeenCalled();
});

test('transport close escalates to kill after graceful timeout', async () => {
  vi.useFakeTimers();
  const child = new FakeChildProcess();
  child.kill.mockImplementation((signal?: NodeJS.Signals | number) => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0, signal ?? null));
    return true;
  });
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );

  const closing = transport.close();
  await vi.advanceTimersByTimeAsync(251);
  await closing;

  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(child.kill).toHaveBeenCalledWith();
});

test('transport close escalates from kill to SIGKILL', async () => {
  vi.useFakeTimers();
  const child = new FakeChildProcess();
  child.kill.mockImplementation((signal?: NodeJS.Signals | number) => {
    if (signal === 'SIGKILL') {
      child.signalCode = 'SIGKILL';
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
    }
    return true;
  });
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );

  const closing = transport.close();
  await vi.advanceTimersByTimeAsync(501);
  await closing;

  expect(child.kill.mock.calls).toEqual([[], ['SIGKILL']]);
});

test('transport close reports close-timeout after all escalation stages', async () => {
  vi.useFakeTimers();
  const child = new FakeChildProcess();
  child.kill.mockImplementation(() => true);
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );

  const closing = transport.close();
  const assertion = expect(closing).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'close-timeout'
  });
  await vi.advanceTimersByTimeAsync(751);
  await assertion;

  expect(child.kill.mock.calls).toEqual([[], ['SIGKILL']]);
});

test('rejects oversized outbound JSONL before writing child stdin', async () => {
  const child = new FakeChildProcess();
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );

  expect(() => transport.write({
    payload: 'x'.repeat(CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES)
  })).toThrow(expect.objectContaining({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'line-too-long'
  }));
  expect(child.stdin.readableLength).toBe(0);
  child.exitCode = 0;
  await transport.close();
});

test('prefers a direct native codex.exe within each Windows PATH entry', () => {
  const pathEntry = 'C:\\npm-bin';
  const directNative = `${pathEntry}\\codex.exe`;
  const nestedNative = [
    pathEntry,
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe'
  ].join('\\');
  const exists = vi.fn(
    (candidate: string) => candidate === directNative || candidate === nestedNative
  );

  expect(resolveCodexAppServerExecutable('codex', {
    platform: 'win32',
    arch: 'x64',
    pathValue: pathEntry,
    exists
  })).toBe(directNative);
  expect(exists).toHaveBeenCalledTimes(1);
});

test('resolves the first nested x64 native Codex executable from Windows PATH', () => {
  const firstEntry = 'C:\\npm-first';
  const secondEntry = 'D:\\npm-second';
  const nativePath = [
    secondEntry,
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe'
  ].join('\\');
  const exists = vi.fn((candidate: string) => candidate === nativePath);

  expect(resolveCodexAppServerExecutable('codex', {
    platform: 'win32',
    arch: 'x64',
    pathValue: `${firstEntry};${secondEntry}`,
    exists
  })).toBe(nativePath);
  expect(exists).toHaveBeenCalledWith(nativePath);
});

test('resolves a hoisted arm64 native Codex executable from Windows PATH', () => {
  const pathEntry = 'C:\\npm-bin';
  const nativePath = [
    pathEntry,
    'node_modules',
    '@openai',
    'codex-win32-arm64',
    'vendor',
    'aarch64-pc-windows-msvc',
    'bin',
    'codex.exe'
  ].join('\\');
  const exists = vi.fn((candidate: string) => candidate === nativePath);

  expect(resolveCodexAppServerExecutable('codex', {
    platform: 'win32',
    arch: 'arm64',
    pathValue: pathEntry,
    exists
  })).toBe(nativePath);
});

test('resolves the package vendor fallback from Windows PATH', () => {
  const pathEntry = 'C:\\npm-bin';
  const nativePath = [
    pathEntry,
    'node_modules',
    '@openai',
    'codex',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe'
  ].join('\\');
  const exists = vi.fn((candidate: string) => candidate === nativePath);

  expect(resolveCodexAppServerExecutable('codex', {
    platform: 'win32',
    arch: 'x64',
    pathValue: pathEntry,
    exists
  })).toBe(nativePath);
});

test('reports native Codex lookup failure without exposing PATH candidates', () => {
  const privatePath = 'D:\\TOKEN-private\\npm-bin';
  let error: unknown;

  try {
    resolveCodexAppServerExecutable('codex', {
      platform: 'win32',
      arch: 'x64',
      pathValue: privatePath,
      exists: () => false
    });
  } catch (caught) {
    error = caught;
  }

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'process-error'
  });
  expect((error as Error).message).not.toContain(privatePath);
  expect(JSON.stringify(error)).not.toContain(privatePath);
});

test('spawns the resolved native executable for default Windows Codex', async () => {
  const pathEntry = 'C:\\npm-bin';
  const nativePath = `${pathEntry}\\codex.exe`;
  const defaultChild = new FakeChildProcess();
  const defaultSpawn = vi.fn(() => defaultChild);
  const defaultTransport = spawnCodexAppServer(
    'codex',
    defaultSpawn as never,
    'win32',
    {
      arch: 'x64',
      pathValue: pathEntry,
      exists: (candidate) => candidate === nativePath
    }
  );
  expect(defaultSpawn).toHaveBeenCalledWith(
    nativePath,
    ['app-server', '--stdio'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  );
  defaultChild.exitCode = 0;
  await defaultTransport.close();

  const customChild = new FakeChildProcess();
  const customSpawn = vi.fn(() => customChild);
  const customTransport = spawnCodexAppServer(
    'D:\\tools\\custom-codex.exe',
    customSpawn as never,
    'win32',
    {
      arch: 'x64',
      pathValue: 'D:\\TOKEN-private',
      exists: () => {
        throw new Error('custom command must not inspect PATH');
      }
    }
  );
  expect(customSpawn).toHaveBeenCalledWith(
    'D:\\tools\\custom-codex.exe',
    ['app-server', '--stdio'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  );
  customChild.exitCode = 0;
  await customTransport.close();
});

test.each([
  'D:\\tools\\custom-codex.cmd',
  'D:\\tools\\custom-codex.BAT',
  'D:\\tools\\custom-codex.ps1'
])('rejects a Windows custom script command without spawning: %s', (command) => {
  const spawnProcess = vi.fn();
  const secretPath = 'D:\\sk-proj-AbCdEf123456';
  let error: unknown;

  try {
    spawnCodexAppServer(command, spawnProcess as never, 'win32', {
      arch: 'x64',
      pathValue: secretPath,
      exists: () => {
        throw new Error('custom scripts must not inspect PATH');
      }
    });
  } catch (caught) {
    error = caught;
  }

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'process-error'
  });
  expect(spawnProcess).not.toHaveBeenCalled();
  expect((error as Error).message).not.toContain(command);
  expect(JSON.stringify(error)).not.toContain(secretPath);
});

test('converts synchronous spawn failures to privacy-safe transport errors', () => {
  const secret = 'TOKEN-private D:\\private\\codex.exe';
  const nativePath = [
    'C:\\npm-bin',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe'
  ].join('\\');
  const spawnProcess = vi.fn(() => {
    throw new Error(secret);
  });

  let error: unknown;
  try {
    spawnCodexAppServer('codex', spawnProcess as never, 'win32', {
      arch: 'x64',
      pathValue: 'C:\\npm-bin',
      exists: (candidate) => candidate === nativePath
    });
  } catch (caught) {
    error = caught;
  }

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'process-error'
  });
  expect((error as Error).message).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('rejects duplicate cursors before a pagination loop', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  let listCalls = 0;
  transport.onWrite = (request) => {
    if (request.method !== 'thread/list') return;
    listCalls += 1;
    transport.respond({
      id: request.id,
      result: listCalls === 1
        ? page([rawThread('thread-1')], 'cursor-1')
        : page([rawThread('thread-2')], 'cursor-1')
    });
  };

  await expect(client.listAllThreads({ sourceKinds: ['cli', 'vscode'] }))
    .rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'duplicate-cursor'
    });
  expect(listCalls).toBe(2);
});

test('enforces the 64-page pagination bound', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  let listCalls = 0;
  transport.onWrite = (request) => {
    if (request.method !== 'thread/list') return;
    listCalls += 1;
    transport.respond({
      id: request.id,
      result: page([], `cursor-${listCalls}`)
    });
  };

  await expect(client.listAllThreads({})).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'page-limit'
  });
  expect(listCalls).toBe(64);
});

test('returns exactly 512 projected threads successfully', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page(
          Array.from({ length: 512 }, (_, index) => rawThread(`thread-${index}`))
        )
      });
    }
  };

  const threads = await client.listAllThreads({ limit: 512 });

  expect(threads).toHaveLength(512);
  expect(threads[0]?.id).toBe('thread-0');
  expect(threads[511]?.id).toBe('thread-511');
});

test('accepts 512 projected threads and rejects a 513th across pages', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  let listCalls = 0;
  transport.onWrite = (request) => {
    if (request.method !== 'thread/list') return;
    listCalls += 1;
    transport.respond({
      id: request.id,
      result: listCalls === 1
        ? page(
          Array.from({ length: 512 }, (_, index) => rawThread(`thread-${index}`)),
          'more'
        )
        : page([rawThread('thread-512')])
    });
  };

  await expect(client.listAllThreads({ limit: 512 })).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'thread-limit'
  });
});

test('rejects duplicate thread IDs without exposing the ID', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const duplicateId = 'thread-TOKEN-private';
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({
        id: request.id,
        result: page([rawThread(duplicateId), rawThread(duplicateId)])
      });
    }
  };

  const error = await rejectedError(client.listThreads({}));

  expect(error).toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'duplicate-thread-id'
  });
  expect(error.message).not.toContain(duplicateId);
  expect(JSON.stringify(error)).not.toContain(duplicateId);
});

test('rejects duplicate thread IDs across pages', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  let listCalls = 0;
  transport.onWrite = (request) => {
    if (request.method !== 'thread/list') return;
    listCalls += 1;
    transport.respond({
      id: request.id,
      result: listCalls === 1
        ? page([rawThread('thread-duplicate')], 'next-page')
        : page([rawThread('thread-duplicate')])
    });
  };

  await expect(client.listAllThreads({ limit: 2 })).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'duplicate-thread-id'
  });
  expect(listCalls).toBe(2);
});

test('strictly rejects invalid page shapes and overlong response strings', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  const results = [
    page([], 'x'.repeat(513)),
    page([rawThread('thread-1', { cwd: `D:\\${'x'.repeat(513)}` })]),
    page([rawThread('unsafe thread id')])
  ];
  transport.onWrite = (request) => {
    if (request.method === 'thread/list') {
      transport.respond({ id: request.id, result: results.shift() });
    }
  };

  for (let index = 0; index < 3; index += 1) {
    await expect(client.listThreads({})).rejects.toMatchObject({
      code: 'CODEX_APP_SERVER_CLIENT',
      reason: 'invalid-response'
    });
  }
});

test('close rejects pending requests and closes the transport once', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = null;

  const pending = client.listThreads({});
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_CLIENT',
    reason: 'closed'
  });
  await Promise.all([client.close(), client.close()]);
  await assertion;
  expect(transport.closeCount).toBe(1);
});

test('transport process exit rejects pending requests', async () => {
  const transport = new FakeTransport();
  installSuccessfulInitialize(transport);
  const client = new CodexAppServerClient(transport, 1_000);
  await client.initialize();
  transport.onWrite = null;

  const pending = client.listThreads({});
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'process-exit'
  });
  transport.fail('process-exit');
  await assertion;
});

test('real FakeChildProcess exit event rejects a pending request', async () => {
  const child = new FakeChildProcess();
  const transport = spawnCodexAppServer(
    'codex-test',
    vi.fn(() => child) as never
  );
  const client = new CodexAppServerClient(transport, 1_000);

  const pending = client.initialize();
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'CODEX_APP_SERVER_TRANSPORT',
    reason: 'process-exit'
  });
  child.exitCode = 1;
  child.emit('exit', 1, null);

  await assertion;
  await client.close();
});
