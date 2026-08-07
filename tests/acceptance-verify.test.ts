import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createAcceptanceEvidence } from '../src/acceptance.js';
import { verifyAcceptanceEvidence } from '../src/acceptance-verify.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

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
    notes: 'verify fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-acceptance-verify-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('verifyAcceptanceEvidence', () => {
  test('passes when artifact hashes match and checks all pass', async () => {
    const artifact = path.join(tempRoot, 'artifact.md');
    await fs.writeFile(artifact, 'stable artifact', 'utf8');
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [artifact],
      checks: [{ name: 'unit tests', command: 'npm test', result: 'pass', evidence: '37 tests passed' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });

    const result = await verifyAcceptanceEvidence(evidence);

    expect(result.schema).toBe('ccpanes.acceptance.verify.v1');
    expect(result.passed).toBe(true);
    expect(result.artifactResults[0]).toMatchObject({ path: artifact, status: 'match' });
    expect(result.checkResults[0]).toMatchObject({ name: 'unit tests', status: 'pass' });
    expect(result.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'artifact-hashes', state: 'pass' }),
      expect.objectContaining({ name: 'completion', state: 'pass' })
    ]));
    expect(result.summary).toMatchObject({ passed: true, completionAllowed: true });
    expect(result.failures).toEqual([]);
  });

  test('fails when artifact content has changed', async () => {
    const artifact = path.join(tempRoot, 'artifact.md');
    await fs.writeFile(artifact, 'old artifact', 'utf8');
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [artifact],
      checks: [{ name: 'unit tests', command: 'npm test', result: 'pass', evidence: '37 tests passed' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });
    await fs.writeFile(artifact, 'changed artifact', 'utf8');

    const result = await verifyAcceptanceEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.artifactResults[0]?.status).toBe('mismatch');
    expect(result.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'artifact-hashes', state: 'fail' }),
      expect.objectContaining({ name: 'completion', state: 'fail' })
    ]));
    expect(result.failures[0]).toContain('artifact hash mismatch');
  });

  test('fails when an artifact is missing', async () => {
    const artifact = path.join(tempRoot, 'artifact.md');
    await fs.writeFile(artifact, 'soon missing', 'utf8');
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [artifact],
      checks: [{ name: 'unit tests', command: 'npm test', result: 'pass', evidence: '37 tests passed' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });
    await fs.unlink(artifact);

    const result = await verifyAcceptanceEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.artifactResults[0]?.status).toBe('missing');
    expect(result.failures[0]).toContain('artifact missing');
  });

  test('fails when any check is not pass', async () => {
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [{ name: 'typecheck', command: 'npm run typecheck', result: 'blocked', evidence: 'dependency missing' }],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });

    const result = await verifyAcceptanceEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.checkResults[0]).toMatchObject({ name: 'typecheck', status: 'blocked' });
    expect(result.summary.completionAllowed).toBe(false);
    expect(result.failures[0]).toContain('check not pass: typecheck');
  });

  test('fails completion when stored evidence has no repo gates', async () => {
    const evidence = await createAcceptanceEvidence({
      task: task(tempRoot),
      artifacts: [],
      checks: [],
      recordedAt: '2026-08-06T00:00:02.000Z'
    });

    const result = await verifyAcceptanceEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'repo-gates', state: 'not-run' }),
      expect.objectContaining({ name: 'completion', state: 'not-run' })
    ]));
    expect(result.failures).toContain('truth layer not pass: repo-gates (not-run)');
  });
});
