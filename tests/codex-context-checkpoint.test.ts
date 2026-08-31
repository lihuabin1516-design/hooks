import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CONTEXT_CHECKPOINT_MAX_CHARS,
  generateContextCheckpoint
} from '../src/codex-context-checkpoint.js';
import { runCli } from '../src/cli.js';
import type { CurrentTask } from '../src/types.js';

function task(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-context-generation-3',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567',
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'verify',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    source: 'manual-import',
    notes: 'validate bounded context recovery'
  };
}

describe('Generation 3 context checkpoint', () => {
  test('renders authoritative task and Git projection with bounded fixed sections', () => {
    const result = generateContextCheckpoint({
      task: task('D:/synthetic/project'),
      git: {
        root: 'D:/synthetic/project',
        branch: 'feature/test',
        head: 'abcdef0123456789abcdef0123456789abcdef01',
        dirty: true,
        statusShort: ' M src/app.ts'
      },
      snapshotGeneration: 7,
      now: '2026-08-31T12:00:00.000Z',
      goalState: 'RUNNING',
      workflowState: 'RUNNING',
      workerState: 'WAITING_RESULT',
      completedMilestones: ['Goal state persisted', 'Worker result reconciled'],
      blockers: ['Human gate: inspect acceptance evidence'],
      nextActions: ['Run full verify', 'Read Coordinator state'],
      decisions: ['Keep current plus two previous snapshots'],
      verificationEvidence: ['npm test=pass']
    });
    expect(result.schema).toBe('ccpanes.context-checkpoint.v1');
    expect(result.snapshotGeneration).toBe(7);
    expect(result.sha256).toMatch(/^[A-F0-9]{64}$/u);
    expect(result.characters).toBe(result.content.length);
    expect(result.characters).toBeLessThanOrEqual(CONTEXT_CHECKPOINT_MAX_CHARS);
    expect(result.content).toContain('schema: ccpanes.context.v1');
    expect(result.content).toContain('snapshotGeneration: 7');
    expect(result.content).toContain('Goal: RUNNING');
    expect(result.content).toContain('## 10. 验证证据');
    expect(result.content).not.toContain('0123456789abcdef0123456789abcdef01234567');
  });

  test('CLI writes a checkpoint and returns digest metadata without content duplication', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-context-checkpoint-'));
    try {
      const taskPath = path.join(root, 'current-task.json');
      const outPath = path.join(root, 'context.md');
      await fs.writeFile(taskPath, JSON.stringify(task(root)), 'utf8');
      const output = await runCli([
        'codex-context-checkpoint',
        '--task-context', taskPath,
        '--out', outPath,
        '--generation', '2',
        '--goal', 'RUNNING',
        '--completed', 'baseline verified',
        '--next-action', 'rotate snapshots'
      ]);
      const report = JSON.parse(output);
      const content = await fs.readFile(outPath, 'utf8');
      expect(report).toMatchObject({
        schema: 'ccpanes.context-checkpoint.v1',
        status: 'generated',
        snapshotGeneration: 2,
        outputPath: path.resolve(outPath)
      });
      expect(report.content).toBeUndefined();
      expect(content).toContain('snapshotGeneration: 2');
      expect(content).toContain('Goal: RUNNING');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
