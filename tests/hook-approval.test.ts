import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookPackage } from '../src/hook-package.js';
import { createHookReleaseGate } from '../src/hook-release-gate.js';
import { createHookApplyPlan } from '../src/hook-apply-plan.js';
import { checkHookApproval } from '../src/hook-approval.js';
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
    notes: 'hook-approval fixture task'
  };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex').toUpperCase();
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-approval-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('checkHookApproval', () => {
  test('passes when approval matches apply-plan, release-gate, config hash, rollback, and window', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const packageDir = path.join(tempRoot, 'package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const applyPlanDir = path.join(tempRoot, 'apply-plan');
    const applyPlanPath = path.join(applyPlanDir, 'apply-plan.json');
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
      now: '2026-08-06T00:00:12.000Z'
    });
    const gate = await createHookReleaseGate({
      packageDir,
      expectedUpstreamSha256: manifest.upstreamHookSha256,
      configPaths: [configPath],
      referenceRepoPaths: [repoPath],
      verificationChecks: [{ name: 'smoke', result: 'pass', evidence: 'SMOKE_PASS' }],
      now: '2026-08-06T00:00:13.000Z'
    });
    await fs.writeFile(releaseGatePath, `${JSON.stringify(gate, null, 2)}\n`, 'utf8');
    await createHookApplyPlan({ releaseGatePath, outDir: applyPlanDir, now: '2026-08-06T00:00:14.000Z' });

    const report = await checkHookApproval({
      applyPlanPath,
      approval: {
        schema: 'ccpanes.hook-approval.v1',
        approved: true,
        applyPlanSha256: await sha256File(applyPlanPath),
        releaseGateSha256: await sha256File(releaseGatePath),
        targetConfigPaths: [configPath],
        expectedConfigSha256ByPath: { [configPath]: await sha256File(configPath) },
        backupDir: path.join(applyPlanDir, 'backups'),
        rollbackCommand: path.join(applyPlanDir, 'scripts', 'restore-from-backup.ps1'),
        writeWindow: {
          startsAt: '2026-08-06T00:00:00.000Z',
          endsAt: '2026-08-06T01:00:00.000Z'
        }
      },
      now: '2026-08-06T00:30:00.000Z'
    });

    expect(report.schema).toBe('ccpanes.hook-approval-check.v1');
    expect(report.mode).toBe('approval-preflight');
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.checks.find((check) => check.name === 'config hashes')?.result).toBe('pass');
    expect(report.checks.find((check) => check.name === 'write window')?.result).toBe('pass');
  });
});
