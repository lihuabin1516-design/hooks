import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookGoLiveApprovalPackage } from '../src/hook-go-live-approval.js';

let tempRoot: string;

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex').toUpperCase();
}

async function writeJson(filePath: string, value: unknown): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

async function writeApprovalFixture(ready = true): Promise<string> {
  const configPath = path.join(tempRoot, 'config.toml');
  const configText = 'original = true\n';
  await fs.writeFile(configPath, configText, 'utf8');
  const releaseGatePath = await writeJson(path.join(tempRoot, 'release-gate.json'), {
    schema: 'ccpanes.hook-release-gate.v1',
    mode: 'final-preflight',
    passed: true,
    configSnapshots: [{ path: configPath, exists: true, size: configText.length, lastWriteUtc: '2026-08-06T00:00:00.000Z', sha256: sha256Text(configText) }],
    referenceRepos: [{ path: path.join(tempRoot, 'repo'), isGitRepo: true, head: 'HEAD', status: 'clean', statusShort: '' }],
    checks: [],
    failures: []
  });
  const approvalCheckPath = await writeJson(path.join(tempRoot, 'approval-check.json'), {
    schema: 'ccpanes.hook-approval-check.v1',
    mode: 'approval-preflight',
    passed: true,
    applyPlanPath: path.join(tempRoot, 'apply-plan.json'),
    checks: [],
    failures: []
  });
  const writePreviewPath = await writeJson(path.join(tempRoot, 'write-preview.json'), {
    schema: 'ccpanes.hook-write-preview.v1',
    mode: 'dry-run-write-preview',
    approvalCheckPath,
    approvalCheckPassed: true,
    entries: [{ configPath, beforeSha256: sha256Text(configText), afterSha256: sha256Text(`${configText}# preview\n`) }],
    artifacts: []
  });
  const applyReportPath = await writeJson(path.join(tempRoot, 'apply-report.json'), {
    schema: 'ccpanes.hook-write-apply.v1',
    mode: 'guarded-apply',
    passed: true,
    entries: [],
    failures: []
  });
  const restoreReportPath = await writeJson(path.join(tempRoot, 'restore-report.json'), {
    schema: 'ccpanes.hook-write-restore.v1',
    mode: 'guarded-restore',
    passed: true,
    entries: [],
    failures: []
  });
  return writeJson(path.join(tempRoot, 'production-readiness.json'), {
    schema: 'ccpanes.hook-production-readiness.v1',
    mode: 'final-readiness',
    createdAt: '2026-08-06T00:00:00.000Z',
    ready,
    releaseGatePath,
    approvalCheckPath,
    writePreviewPath,
    applyReportPath,
    restoreReportPath,
    checks: [{ name: 'all', result: ready ? 'pass' : 'fail', evidence: 'fixture' }],
    failures: ready ? [] : ['all: fixture']
  });
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-go-live-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookGoLiveApprovalPackage', () => {
  test('creates a signed go-live approval package from a ready report', async () => {
    const readinessPath = await writeApprovalFixture(true);
    const outDir = path.join(tempRoot, 'go-live-approval-package');

    const manifest = await createHookGoLiveApprovalPackage({
      readinessPath,
      outDir,
      approvedBy: 'AI001',
      approvalNote: 'manual authorization approved',
      upstreamHookPath: 'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe',
      now: '2026-08-06T00:00:01.000Z'
    });

    expect(manifest.schema).toBe('ccpanes.hook-go-live-approval-package.v1');
    expect(manifest.mode).toBe('manual-approval-package');
    expect(manifest.manualApproval.approved).toBe(true);
    expect(manifest.manualApproval.approvedBy).toBe('AI001');
    expect(manifest.readiness.ready).toBe(true);
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'GO-LIVE-APPROVAL.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'COMMANDS.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'EVIDENCE-INDEX.md'))).resolves.toBeTruthy();
    expect(manifest.files).toHaveLength(3);
    for (const file of manifest.files) {
      await expect(sha256File(file.path)).resolves.toBe(file.sha256);
    }
  });

  test('rejects a go-live package when production readiness is not ready', async () => {
    const readinessPath = await writeApprovalFixture(false);
    const outDir = path.join(tempRoot, 'go-live-approval-package');

    await expect(createHookGoLiveApprovalPackage({
      readinessPath,
      outDir,
      approvedBy: 'AI001',
      upstreamHookPath: 'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe'
    })).rejects.toThrow(/production readiness must be ready/);
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).rejects.toThrow();
  });
});
