import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createAcceptanceEvidence } from '../src/acceptance.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').toUpperCase();
}

function task(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'verify',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'acceptance fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-acceptance-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createAcceptanceEvidence', () => {
  test('binds task metadata, artifact hashes, and checks', async () => {
    const artifact = path.join(tempRoot, 'artifact.md');
    await fs.writeFile(artifact, 'hello evidence', 'utf8');

    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [artifact],
      checks: [{ name: 'unit tests', command: 'npm test', result: 'pass', evidence: '34 tests passed' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });

    expect(evidence).toMatchObject({
      schema: 'ccpanes.acceptance.v1',
      taskId: 'task-alpha',
      worktreeRoot: tempRoot,
      branch: 'feature/task-alpha',
      head: 'abc123',
      artifactHashes: [{ path: artifact, sha256: sha256('hello evidence') }],
      checks: [{ name: 'unit tests', command: 'npm test', result: 'pass', evidence: '34 tests passed' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });
    expect(evidence.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'task-scope', state: 'pass', required: true }),
      expect.objectContaining({ name: 'artifact-hashes', state: 'pass', required: true }),
      expect.objectContaining({ name: 'repo-gates', state: 'pass', required: true }),
      expect.objectContaining({ name: 'completion', state: 'pass', required: true })
    ]));
    expect(evidence.summary).toMatchObject({ passed: true, completionAllowed: true, failingLayerCount: 0 });
  });

  test('marks completion as not-run when repo gates are missing', async () => {
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });

    expect(evidence.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'repo-gates', state: 'not-run', required: true }),
      expect.objectContaining({ name: 'completion', state: 'not-run', required: true })
    ]));
    expect(evidence.summary).toMatchObject({ passed: false, completionAllowed: false, notRunLayerCount: 2 });
  });

  test('allows explicit reference repo and user config truth layers', async () => {
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [{ name: 'unit tests', command: 'npm test', result: 'pass', evidence: '34 tests passed' }],
      truthLayers: [
        { name: 'reference-repos', state: 'pass', required: true, evidence: 'comet clean; fastctx clean' },
        { name: 'user-config', state: 'not-applicable', required: false, evidence: 'no user config touched' }
      ],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });

    expect(evidence.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'reference-repos', state: 'pass', required: true }),
      expect.objectContaining({ name: 'user-config', state: 'not-applicable', required: false }),
      expect.objectContaining({ name: 'completion', state: 'pass' })
    ]));
    expect(evidence.summary.completionAllowed).toBe(true);
  });

  test('rejects invalid check results', async () => {
    await expect(createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [{ name: 'bad', command: 'bad', result: 'unknown', evidence: 'bad' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    })).rejects.toThrow('invalid acceptance check result: unknown');
  });

  test('rejects invalid truth layer states', async () => {
    await expect(createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [],
      truthLayers: [{ name: 'user-config', state: 'unknown', evidence: 'bad' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    })).rejects.toThrow('invalid acceptance truth state: unknown');
  });

  test('rejects explicit overrides for derived truth layers', async () => {
    await expect(createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [],
      truthLayers: [{ name: 'repo-gates', state: 'pass', evidence: 'manual override' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    })).rejects.toThrow('acceptance truth layer is derived from task/check/artifact evidence: repo-gates');
  });
});
