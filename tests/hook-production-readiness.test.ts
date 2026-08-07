import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookProductionReadiness } from '../src/hook-production-readiness.js';

let tempRoot: string;

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function writeJson(filePath: string, value: unknown): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

async function writeReadinessFixture(overrides: {
  releasePassed?: boolean;
  releaseConfigSha256?: string;
  restorePassed?: boolean;
} = {}): Promise<{
  releaseGatePath: string;
  approvalCheckPath: string;
  writePreviewPath: string;
  applyReportPath: string;
  restoreReportPath: string;
}> {
  const configPath = path.join(tempRoot, 'config-root', 'config.toml');
  const before = 'original = true\n';
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, before, 'utf8');
  const releaseGatePath = path.join(tempRoot, 'release-gate.json');
  const approvalCheckPath = path.join(tempRoot, 'approval-check.json');
  const writePreviewPath = path.join(tempRoot, 'write-preview.json');
  const applyReportPath = path.join(tempRoot, 'apply-report.json');
  const restoreReportPath = path.join(tempRoot, 'restore-report.json');
  await writeJson(releaseGatePath, {
    schema: 'ccpanes.hook-release-gate.v1',
    mode: 'final-preflight',
    passed: overrides.releasePassed ?? true,
    configSnapshots: [{
      path: configPath,
      exists: true,
      size: Buffer.byteLength(before, 'utf8'),
      lastWriteUtc: '2026-08-06T00:00:00.000Z',
      sha256: overrides.releaseConfigSha256 ?? sha256Text(before)
    }],
    referenceRepos: [
      { path: path.join(tempRoot, 'repo-a'), isGitRepo: true, head: 'HEAD_A', status: 'clean', statusShort: '' },
      { path: path.join(tempRoot, 'repo-b'), isGitRepo: true, head: 'HEAD_B', status: 'clean', statusShort: '' }
    ],
    checks: [],
    failures: []
  });
  await writeJson(approvalCheckPath, {
    schema: 'ccpanes.hook-approval-check.v1',
    mode: 'approval-preflight',
    passed: true,
    applyPlanPath: path.join(tempRoot, 'apply-plan.json'),
    configSnapshots: [{ path: configPath, exists: true, sha256: sha256Text(before), expectedSha256: sha256Text(before) }],
    checks: [],
    failures: []
  });
  await writeJson(writePreviewPath, {
    schema: 'ccpanes.hook-write-preview.v1',
    mode: 'dry-run-write-preview',
    approvalCheckPath,
    approvalCheckPassed: true,
    entries: [{ configPath, beforeSha256: sha256Text(before), afterSha256: sha256Text(`${before}# preview\n`) }],
    artifacts: []
  });
  await writeJson(applyReportPath, {
    schema: 'ccpanes.hook-write-apply.v1',
    mode: 'guarded-apply',
    passed: true,
    entries: [{ configPath, beforeSha256: sha256Text(before), afterSha256: sha256Text(`${before}# preview\n`), verifiedAfterSha256: sha256Text(`${before}# preview\n`) }],
    failures: []
  });
  await writeJson(restoreReportPath, {
    schema: 'ccpanes.hook-write-restore.v1',
    mode: 'guarded-restore',
    passed: overrides.restorePassed ?? true,
    entries: [{ configPath, beforeSha256: sha256Text(before), afterSha256: sha256Text(`${before}# preview\n`), restoredSha256: sha256Text(before) }],
    failures: []
  });
  return { releaseGatePath, approvalCheckPath, writePreviewPath, applyReportPath, restoreReportPath };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-readiness-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookProductionReadiness', () => {
  test('marks ready when every release, approval, preview, apply, restore, and hash check passes', async () => {
    const fixture = await writeReadinessFixture();

    const report = await createHookProductionReadiness({ ...fixture, now: '2026-08-06T00:00:01.000Z' });

    expect(report.schema).toBe('ccpanes.hook-production-readiness.v1');
    expect(report.mode).toBe('final-readiness');
    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.result === 'pass')).toBe(true);
    expect(report.checks.map((check) => check.name)).toContain('artifact chain');
  });

  test('marks not ready when release gate failed', async () => {
    const fixture = await writeReadinessFixture({ releasePassed: false });

    const report = await createHookProductionReadiness({ ...fixture });

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.name === 'release gate')?.result).toBe('fail');
  });

  test('marks not ready when current config hash differs from release snapshot', async () => {
    const fixture = await writeReadinessFixture({ releaseConfigSha256: '0'.repeat(64) });

    const report = await createHookProductionReadiness({ ...fixture });

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.name === 'config current hashes')?.result).toBe('fail');
  });

  test('marks not ready when synthetic restore failed', async () => {
    const fixture = await writeReadinessFixture({ restorePassed: false });

    const report = await createHookProductionReadiness({ ...fixture });

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.name === 'synthetic restore')?.result).toBe('fail');
  });
});

