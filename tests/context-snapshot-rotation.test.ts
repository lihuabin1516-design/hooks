import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  recoverContextSnapshotRotation,
  rotateContextSnapshotsAtomic
} from '../src/context-snapshot-rotation.js';
import { runCli } from '../src/cli.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-context-rotate-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function snapshot(generation: number, marker: string): string {
  return [
    '# 上下文压缩后先读 `context.md`',
    '',
    '## 0. 快照元信息',
    '',
    '```yaml',
    'schema: ccpanes.context.v1',
    `snapshotGeneration: ${generation}`,
    'retentionPolicy: current-plus-two-previous',
    '```',
    '',
    '## 1. 当前任务',
    marker,
    '',
    '## 2. 当前进度',
    marker,
    '',
    '## 3. 当前卡点',
    marker,
    '',
    '## 4. 下一步',
    marker,
    '',
    '## 5. 上下文快照保留策略',
    marker,
    '',
    '## 6. 避坑点',
    marker,
    '',
    '## 7. 上下文压缩后的恢复步骤',
    marker,
    '',
    '## 8. 本轮增量',
    marker,
    '',
    '## 9. 更新检查清单',
    marker,
    ''
  ].join('\n');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

describe('context snapshot rotation', () => {
  test('rotates current plus two previous generations and commits context.md last', async () => {
    const generation1 = snapshot(1, 'generation-one');
    const generation2 = snapshot(2, 'generation-two');
    const generation3 = snapshot(3, 'generation-three');
    await fs.writeFile(path.join(tempRoot, 'context.prev.md'), generation1, 'utf8');
    await fs.writeFile(path.join(tempRoot, 'context.md'), generation2, 'utf8');

    const report = await rotateContextSnapshotsAtomic({
      root: tempRoot,
      nextContent: generation3,
      expectedCurrentSha256: sha256(generation2),
      now: '2026-08-30T02:00:00.000Z'
    });

    expect(report).toMatchObject({
      schema: 'ccpanes.context-snapshot-rotation.v1',
      status: 'completed',
      recoveredTransaction: false,
      beforeGeneration: 2,
      afterGeneration: 3,
      currentSha256Before: sha256(generation2),
      currentSha256After: sha256(generation3),
      previousSha256After: sha256(generation2),
      previous2Sha256After: sha256(generation1)
    });
    expect(await fs.readFile(path.join(tempRoot, 'context.md'), 'utf8'))
      .toBe(generation3);
    expect(await fs.readFile(path.join(tempRoot, 'context.prev.md'), 'utf8'))
      .toBe(generation2);
    expect(await fs.readFile(path.join(tempRoot, 'context.prev2.md'), 'utf8'))
      .toBe(generation1);
    await expect(fs.stat(path.join(tempRoot, '.context-rotation.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects a stale optimistic-lock hash without changing any snapshot', async () => {
    const generation1 = snapshot(1, 'generation-one');
    const generation2 = snapshot(2, 'generation-two');
    await fs.writeFile(path.join(tempRoot, 'context.md'), generation1, 'utf8');

    await expect(rotateContextSnapshotsAtomic({
      root: tempRoot,
      nextContent: generation2,
      expectedCurrentSha256: '0'.repeat(64)
    })).rejects.toThrow('current context SHA-256 changed');

    expect(await fs.readFile(path.join(tempRoot, 'context.md'), 'utf8'))
      .toBe(generation1);
    await expect(fs.stat(path.join(tempRoot, 'context.prev.md')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects a missing section or non-sequential generation before staging', async () => {
    const generation1 = snapshot(1, 'generation-one');
    await fs.writeFile(path.join(tempRoot, 'context.md'), generation1, 'utf8');

    await expect(rotateContextSnapshotsAtomic({
      root: tempRoot,
      nextContent: snapshot(3, 'generation-three'),
      expectedCurrentSha256: sha256(generation1)
    })).rejects.toThrow('next snapshot generation must be 2');

    await expect(rotateContextSnapshotsAtomic({
      root: tempRoot,
      nextContent: snapshot(2, 'generation-two').replace(
        '## 8. 本轮增量',
        '## missing'
      ),
      expectedCurrentSha256: sha256(generation1)
    })).rejects.toThrow('missing required section: ## 8. 本轮增量');
  });

  test('recovers an interrupted prepared transaction idempotently', async () => {
    const generation1 = snapshot(1, 'generation-one');
    const generation2 = snapshot(2, 'generation-two');
    const generation3 = snapshot(3, 'generation-three');
    await fs.writeFile(path.join(tempRoot, 'context.prev.md'), generation1, 'utf8');
    await fs.writeFile(path.join(tempRoot, 'context.md'), generation2, 'utf8');

    await expect(rotateContextSnapshotsAtomic({
      root: tempRoot,
      nextContent: generation3,
      expectedCurrentSha256: sha256(generation2),
      faultAfterDestinationForTest: 'context.prev.md'
    })).rejects.toThrow('synthetic context rotation interruption');

    const journal = JSON.parse(
      await fs.readFile(path.join(tempRoot, '.context-rotation.json'), 'utf8')
    );
    expect(journal.schema).toBe('ccpanes.context-snapshot-transaction.v1');
    expect(await fs.readFile(path.join(tempRoot, 'context.md'), 'utf8'))
      .toBe(generation2);

    const recovered = await recoverContextSnapshotRotation(tempRoot);

    expect(recovered).toMatchObject({
      status: 'completed',
      recoveredTransaction: true,
      beforeGeneration: 2,
      afterGeneration: 3
    });
    expect(await fs.readFile(path.join(tempRoot, 'context.md'), 'utf8'))
      .toBe(generation3);
    expect(await fs.readFile(path.join(tempRoot, 'context.prev.md'), 'utf8'))
      .toBe(generation2);
    expect(await fs.readFile(path.join(tempRoot, 'context.prev2.md'), 'utf8'))
      .toBe(generation1);
  });

  test('rejects concurrent writers while a live lock is present', async () => {
    const generation1 = snapshot(1, 'generation-one');
    await fs.writeFile(path.join(tempRoot, 'context.md'), generation1, 'utf8');
    await fs.writeFile(
      path.join(tempRoot, '.context-rotation.lock'),
      `${JSON.stringify({ pid: process.pid })}\n`,
      'utf8'
    );

    await expect(rotateContextSnapshotsAtomic({
      root: tempRoot,
      nextContent: snapshot(2, 'generation-two'),
      expectedCurrentSha256: sha256(generation1)
    })).rejects.toThrow('context snapshot rotation is already active');
  });

  test('exposes a strict CLI for synthetic Coordinator/Leader consumption', async () => {
    const generation1 = snapshot(1, 'generation-one');
    const generation2 = snapshot(2, 'generation-two');
    const nextPath = path.join(tempRoot, 'next-context.md');
    await fs.writeFile(path.join(tempRoot, 'context.md'), generation1, 'utf8');
    await fs.writeFile(nextPath, generation2, 'utf8');

    const output = await runCli([
      'codex-context-snapshot',
      'rotate',
      '--root',
      tempRoot,
      '--next',
      nextPath,
      '--expected-current-sha256',
      sha256(generation1)
    ]);
    const report = JSON.parse(output);

    expect(report).toMatchObject({
      schema: 'ccpanes.context-snapshot-rotation.v1',
      status: 'completed',
      beforeGeneration: 1,
      afterGeneration: 2
    });
    expect(await fs.readFile(path.join(tempRoot, 'context.md'), 'utf8'))
      .toBe(generation2);
    await expect(runCli([
      'codex-context-snapshot',
      'rotate',
      '--root',
      tempRoot,
      '--next',
      nextPath
    ])).rejects.toThrow('missing --expected-current-sha256');
  });
});
