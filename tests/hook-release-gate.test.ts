import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookPackage } from '../src/hook-package.js';
import { createHookReleaseGate } from '../src/hook-release-gate.js';
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
    notes: 'hook-release-gate fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-release-gate-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookReleaseGate', () => {
  test('passes when package, configs, repos, and verification checks pass', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outDir = path.join(tempRoot, 'package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    await fs.writeFile(configPath, 'config bytes', 'utf8');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });

    const manifest = await createHookPackage({
      task: task(),
      prototypeRoot: 'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      target: 'both',
      upstreamHookPath: upstreamHook,
      outDir,
      now: '2026-08-06T00:00:07.000Z'
    });

    const gate = await createHookReleaseGate({
      packageDir: outDir,
      expectedUpstreamSha256: manifest.upstreamHookSha256,
      configPaths: [configPath],
      referenceRepoPaths: [repoPath],
      verificationChecks: [{ name: 'smoke', result: 'pass', evidence: 'SMOKE_PASS' }],
      now: '2026-08-06T00:00:08.000Z'
    });

    expect(gate.schema).toBe('ccpanes.hook-release-gate.v1');
    expect(gate.mode).toBe('final-preflight');
    expect(gate.passed).toBe(true);
    expect(gate.failures).toEqual([]);
    expect(gate.packageRehearsal.passed).toBe(true);
    expect(gate.configSnapshots[0].sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(gate.referenceRepos[0].status).toBe('clean');
    expect(gate.checks.find((check) => check.name === 'verification checks')?.result).toBe('pass');
  });
});
