import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookPackage } from '../src/hook-package.js';
import { createHookReleaseGate } from '../src/hook-release-gate.js';
import { createHookApplyPlan } from '../src/hook-apply-plan.js';
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
    notes: 'hook-apply-plan fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-apply-plan-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookApplyPlan', () => {
  test('creates staged apply artifacts from a passing release gate', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const packageDir = path.join(tempRoot, 'package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const outDir = path.join(tempRoot, 'apply-plan');
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    await fs.writeFile(configPath, 'config bytes', 'utf8');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
    const manifest = await createHookPackage({
      task: task(),
      prototypeRoot: 'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      target: 'both',
      upstreamHookPath: upstreamHook,
      outDir: packageDir,
      now: '2026-08-06T00:00:09.000Z'
    });
    const gate = await createHookReleaseGate({
      packageDir,
      expectedUpstreamSha256: manifest.upstreamHookSha256,
      configPaths: [configPath],
      referenceRepoPaths: [repoPath],
      verificationChecks: [{ name: 'smoke', result: 'pass', evidence: 'SMOKE_PASS' }],
      now: '2026-08-06T00:00:10.000Z'
    });
    await fs.writeFile(releaseGatePath, `${JSON.stringify(gate, null, 2)}\n`, 'utf8');

    const plan = await createHookApplyPlan({
      releaseGatePath,
      outDir,
      now: '2026-08-06T00:00:11.000Z'
    });

    expect(plan.schema).toBe('ccpanes.hook-apply-plan.v1');
    expect(plan.mode).toBe('staged-review');
    expect(plan.releaseGatePassed).toBe(true);
    expect(plan.artifacts.map((artifact) => artifact.kind)).toEqual([
      'instructions',
      'backup-script',
      'rollback-script',
      'patch',
      'patch'
    ]);
    await expect(fs.stat(path.join(outDir, 'apply-plan.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'APPLY-INSTRUCTIONS.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'scripts', 'capture-prechange.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'scripts', 'restore-from-backup.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'staged-patches', 'codex.patch'))).resolves.toBeTruthy();
  });
});
