import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  probeCodexContextPressure
} from '../src/codex-context-pressure.js';
import { runCli } from '../src/cli.js';

let root: string;
let codexRoot: string;
let sessionsDir: string;
let stateDb: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-context-pressure-'));
  codexRoot = path.join(root, '.codex');
  sessionsDir = path.join(codexRoot, 'sessions', '2026', '08', '30');
  stateDb = path.join(codexRoot, 'state_5.sqlite');
  await fs.mkdir(sessionsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function tokenCountLine(inputTokens: number, modelContextWindow = 258_400): string {
  return JSON.stringify({
    timestamp: '2026-08-30T12:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: inputTokens,
          output_tokens: 100,
          reasoning_output_tokens: 20,
          total_tokens: inputTokens + 120
        }
      },
      model_context_window: modelContextWindow
    }
  });
}

function currentTokenCountLine(
  inputTokens: number,
  modelContextWindow = 258_400
): string {
  return JSON.stringify({
    timestamp: '2026-08-30T12:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: inputTokens * 3,
          total_tokens: inputTokens * 3
        },
        last_token_usage: {
          input_tokens: inputTokens,
          output_tokens: 100,
          reasoning_output_tokens: 20,
          total_tokens: inputTokens + 120
        },
        model_context_window: modelContextWindow
      },
      rate_limits: null
    }
  });
}

async function writeRollout(
  name: string,
  contextTokens: number[],
  modelContextWindow = 258_400
): Promise<string> {
  const rollout = path.join(sessionsDir, `${name}.jsonl`);
  const lines = [
    JSON.stringify({
      timestamp: '2026-08-30T11:59:00.000Z',
      type: 'session_meta',
      payload: {
        id: name,
        cwd: 'D:\\fixture',
        originator: 'codex-app'
      }
    }),
    ...contextTokens.map((tokens) => tokenCountLine(tokens, modelContextWindow))
  ];
  await fs.writeFile(rollout, `${lines.join('\n')}\n`, 'utf8');
  return rollout;
}

function writeStateDb(rows: Array<{
  id: string;
  rolloutPath: string;
  updatedAt: number;
}>): void {
  const db = new DatabaseSync(stateDb);
  try {
    db.exec(
      'create table threads (' +
      'id text primary key, rollout_path text, updated_at integer' +
      ')'
    );
    const insert = db.prepare(
      'insert into threads (id, rollout_path, updated_at) values (?, ?, ?)'
    );
    for (const row of rows) {
      insert.run(row.id, row.rolloutPath, row.updatedAt);
    }
  } finally {
    db.close();
  }
}

describe('Codex context pressure probe', () => {
  test('reports normal pressure from the latest rollout token_count event', async () => {
    const rollout = await writeRollout('thread-normal', [100_000]);
    writeStateDb([{ id: 'thread-normal', rolloutPath: rollout, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-normal',
      now: new Date('2026-08-30T12:01:00.000Z')
    });

    expect(result).toMatchObject({
      schemaVersion: 'hooks.codex-context-pressure/v1',
      availability: 'available',
      pressure: 'normal',
      action: 'continue',
      contextTokens: 100_000,
      modelContextWindow: 258_400,
      remainingTokens: 158_400,
      checkpointRequired: false,
      thresholdMode: 'absolute',
      softThresholdTokens: 220_000,
      hardThresholdTokens: 240_000
    });
    expect(result.percentUsed).toBeCloseTo(38.7, 1);
    expect(result.threadRef).toMatch(/^sha256:[0-9a-f]{16}$/u);
    expect(result.rolloutRef).toMatch(/^sha256:[0-9a-f]{16}$/u);
    expect(JSON.stringify(result)).not.toContain('thread-normal');
    expect(JSON.stringify(result)).not.toContain(rollout);
  });

  test('requests a context update at the soft threshold', async () => {
    const rollout = await writeRollout('thread-soft', [225_000]);
    writeStateDb([{ id: 'thread-soft', rolloutPath: rollout, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-soft'
    });

    expect(result).toMatchObject({
      availability: 'available',
      pressure: 'soft',
      action: 'update-context',
      checkpointRequired: true
    });
  });

  test('supports the current Codex shape with model_context_window inside info', async () => {
    const rollout = path.join(sessionsDir, 'thread-current-shape.jsonl');
    await fs.writeFile(
      rollout,
      `${currentTokenCountLine(221_000)}\n`,
      'utf8'
    );
    writeStateDb([{
      id: 'thread-current-shape',
      rolloutPath: rollout,
      updatedAt: 1
    }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-current-shape'
    });

    expect(result).toMatchObject({
      availability: 'available',
      contextTokens: 221_000,
      modelContextWindow: 258_400,
      pressure: 'soft',
      action: 'update-context'
    });
  });

  test('requires rotation and checkpoint at the hard threshold', async () => {
    const rollout = await writeRollout('thread-hard', [245_000]);
    writeStateDb([{ id: 'thread-hard', rolloutPath: rollout, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-hard'
    });

    expect(result).toMatchObject({
      availability: 'available',
      pressure: 'hard',
      action: 'rotate-context-and-checkpoint',
      checkpointRequired: true
    });
  });

  test('reports a heuristic compaction signal after a material token drop', async () => {
    const rollout = await writeRollout('thread-compact', [245_000, 70_000]);
    writeStateDb([{ id: 'thread-compact', rolloutPath: rollout, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-compact'
    });

    expect(result).toMatchObject({
      availability: 'available',
      pressure: 'normal',
      compactionSignal: 'heuristic-token-drop',
      action: 'reconcile-after-compaction',
      checkpointRequired: true
    });
  });

  test('gives a native compaction event precedence over the token-drop heuristic', async () => {
    const rollout = await writeRollout('thread-native-compact', [245_000, 70_000]);
    await fs.appendFile(rollout, `${JSON.stringify({
      type: 'event_msg',
      payload: { type: 'context_compaction_completed' }
    })}\n`, 'utf8');
    writeStateDb([{
      id: 'thread-native-compact',
      rolloutPath: rollout,
      updatedAt: 1
    }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-native-compact',
      now: new Date('2026-08-31T00:00:00.000Z')
    });

    expect(result.compactionSignal).toBe('native-compaction-event');
    expect(result.action).toBe('reconcile-after-compaction');
    expect(result.checkpointRequired).toBe(true);
  });

  test('scales thresholds when the model window is smaller than the absolute policy', async () => {
    const rollout = await writeRollout('thread-small', [100_000], 128_000);
    writeStateDb([{ id: 'thread-small', rolloutPath: rollout, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-small'
    });

    expect(result).toMatchObject({
      thresholdMode: 'scaled',
      softThresholdTokens: 108_800,
      hardThresholdTokens: 119_040,
      pressure: 'normal'
    });
  });

  test('uses the latest state row when no current thread id is available', async () => {
    const oldRollout = await writeRollout('thread-old', [80_000]);
    const latestRollout = await writeRollout('thread-latest', [225_000]);
    writeStateDb([
      { id: 'thread-old', rolloutPath: oldRollout, updatedAt: 1 },
      { id: 'thread-latest', rolloutPath: latestRollout, updatedAt: 2 }
    ]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: null
    });

    expect(result).toMatchObject({
      availability: 'available',
      pressure: 'soft',
      contextTokens: 225_000
    });
  });

  test('fails closed when the state database points outside CODEX_HOME', async () => {
    const outside = path.join(root, 'outside.jsonl');
    await fs.writeFile(outside, `${tokenCountLine(245_000)}\n`, 'utf8');
    writeStateDb([{ id: 'thread-outside', rolloutPath: outside, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-outside'
    });

    expect(result).toMatchObject({
      availability: 'unavailable',
      pressure: 'unknown',
      action: 'inspect',
      checkpointRequired: false,
      diagnostics: ['rollout-outside-codex-root']
    });
    expect(JSON.stringify(result)).not.toContain(outside);
  });

  test('distinguishes a missing admitted rollout from an out-of-root path', async () => {
    const missing = path.join(sessionsDir, 'missing.jsonl');
    writeStateDb([{
      id: 'thread-missing-rollout',
      rolloutPath: missing,
      updatedAt: 1
    }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-missing-rollout'
    });

    expect(result).toMatchObject({
      availability: 'unavailable',
      action: 'inspect',
      diagnostics: ['rollout-unavailable']
    });
    expect(JSON.stringify(result)).not.toContain(missing);
  });

  test('returns typed unavailable output when no token_count event is present', async () => {
    const rollout = path.join(sessionsDir, 'thread-empty.jsonl');
    await fs.writeFile(
      rollout,
      `${JSON.stringify({ type: 'session_meta', payload: { id: 'thread-empty' } })}\n`,
      'utf8'
    );
    writeStateDb([{ id: 'thread-empty', rolloutPath: rollout, updatedAt: 1 }]);

    const result = await probeCodexContextPressure({
      codexRoot,
      stateDb,
      threadId: 'thread-empty'
    });

    expect(result).toMatchObject({
      availability: 'unavailable',
      pressure: 'unknown',
      action: 'inspect',
      diagnostics: ['token-count-event-not-found']
    });
  });

  test('rejects invalid threshold ordering at the input boundary', async () => {
    await expect(probeCodexContextPressure({
      codexRoot,
      stateDb,
      softThresholdTokens: 240_000,
      hardThresholdTokens: 220_000
    })).rejects.toThrow('hard threshold must be greater than soft threshold');
  });

  test('exposes a strict CLI without leaking raw thread or rollout identities', async () => {
    const rollout = await writeRollout('thread-cli', [241_000]);
    writeStateDb([{ id: 'thread-cli', rolloutPath: rollout, updatedAt: 1 }]);

    const output = await runCli([
      'codex-context-pressure',
      '--codex-root', codexRoot,
      '--state-db', stateDb,
      '--thread-id', 'thread-cli'
    ]);
    const result = JSON.parse(output) as Record<string, unknown>;

    expect(result).toMatchObject({
      schemaVersion: 'hooks.codex-context-pressure/v1',
      availability: 'available',
      pressure: 'hard',
      action: 'rotate-context-and-checkpoint'
    });
    expect(output).not.toContain('thread-cli');
    expect(output).not.toContain(rollout);
    await expect(runCli([
      'codex-context-pressure',
      '--codex-root', codexRoot,
      '--unknown'
    ])).rejects.toThrow('unknown option: --unknown');
  });
});
