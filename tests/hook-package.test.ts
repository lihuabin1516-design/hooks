import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookPackage } from '../src/hook-package.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

function task(): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: path.join(tempRoot, 'project-alpha'),
    worktreeRoot: path.join(tempRoot, 'project-alpha'),
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'hook-package fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-hook-package-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookPackage', () => {
  test('creates manifest, install plan, rollback plan, patches, and checklist', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outDir = path.join(tempRoot, 'package');
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');

    const manifest = await createHookPackage({
      task: task(),
      prototypeRoot: 'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      target: 'both',
      upstreamHookPath: upstreamHook,
      outDir,
      now: '2026-08-06T00:00:04.000Z'
    });

    expect(manifest.schema).toBe('ccpanes.hook-package-manifest.v1');
    expect(manifest.mode).toBe('review-only');
    expect(manifest.target).toBe('both');
    expect(manifest.files.map((file) => file.kind)).toEqual([
      'install-plan',
      'rollback-plan',
      'patch',
      'patch',
      'acceptance-checklist'
    ]);
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'install-plan.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'rollback-plan.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'patches', 'codex.patch'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'patches', 'ccpanes.patch'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'ACCEPTANCE-CHECKLIST.md'))).resolves.toBeTruthy();

    const rollback = JSON.parse(await fs.readFile(path.join(outDir, 'rollback-plan.json'), 'utf8'));
    expect(rollback.schema).toBe('ccpanes.hook-rollback-plan.v1');
    expect(rollback.steps[0]).toContain('Capture pre-change config hashes');
  });
});
