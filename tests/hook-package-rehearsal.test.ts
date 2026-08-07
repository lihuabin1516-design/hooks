import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookPackage } from '../src/hook-package.js';
import { rehearseHookPackage } from '../src/hook-package-rehearsal.js';
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
    notes: 'hook-package-rehearsal fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-hook-rehearsal-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('rehearseHookPackage', () => {
  test('passes a generated hook package with matching upstream hash', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outDir = path.join(tempRoot, 'package');
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    const manifest = await createHookPackage({
      task: task(),
      prototypeRoot: 'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      target: 'both',
      upstreamHookPath: upstreamHook,
      outDir,
      now: '2026-08-06T00:00:05.000Z'
    });

    const report = await rehearseHookPackage({
      packageDir: outDir,
      expectedUpstreamSha256: manifest.upstreamHookSha256,
      now: '2026-08-06T00:00:06.000Z'
    });

    expect(report.schema).toBe('ccpanes.hook-package-rehearsal.v1');
    expect(report.mode).toBe('dry-run-rehearsal');
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.checks.find((check) => check.name === 'manifest schema')?.result).toBe('pass');
    expect(report.checks.find((check) => check.name === 'file hashes')?.result).toBe('pass');
    expect(report.checks.find((check) => check.name === 'patch candidates')?.result).toBe('pass');
    expect(report.checks.find((check) => check.name === 'upstream hash')?.result).toBe('pass');
  });
});
