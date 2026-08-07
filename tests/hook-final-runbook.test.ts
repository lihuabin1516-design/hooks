import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookFinalRunbook } from '../src/hook-final-runbook.js';

let tempRoot: string;

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function writeGoLiveManifest(approved = true): Promise<string> {
  const manifestPath = path.join(tempRoot, 'go-live-approval-package', 'manifest.json');
  const configText = 'original = true\n';
  const configPath = path.join(tempRoot, 'config.toml');
  await fs.writeFile(configPath, configText, 'utf8');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify({
    schema: 'ccpanes.hook-go-live-approval-package.v1',
    mode: 'manual-approval-package',
    createdAt: '2026-08-06T00:00:00.000Z',
    outDir: path.dirname(manifestPath),
    readiness: {
      path: path.join(tempRoot, 'production-readiness.json'),
      sha256: 'R'.repeat(64),
      ready: true
    },
    upstreamHook: {
      path: 'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe',
      sha256: 'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4'
    },
    manualApproval: {
      approved,
      approvedBy: 'AI001',
      approvedAt: '2026-08-06T00:00:00.000Z',
      note: 'manual authorization approved'
    },
    targetConfigSnapshots: [{ path: configPath, sha256: sha256Text(configText), size: configText.length }],
    evidencePaths: {
      releaseGatePath: path.join(tempRoot, 'release-gate.json'),
      approvalCheckPath: path.join(tempRoot, 'approval-check.json'),
      writePreviewPath: path.join(tempRoot, 'write-preview.json'),
      applyReportPath: path.join(tempRoot, 'apply-report.json'),
      restoreReportPath: path.join(tempRoot, 'restore-report.json')
    },
    files: []
  }, null, 2)}\n`, 'utf8');
  return manifestPath;
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-final-runbook-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookFinalRunbook', () => {
  test('creates final manual runbook files from an approved go-live package', async () => {
    const goLiveManifestPath = await writeGoLiveManifest(true);
    const outDir = path.join(tempRoot, 'final-runbook');

    const manifest = await createHookFinalRunbook({
      goLiveManifestPath,
      outDir,
      now: '2026-08-06T00:00:01.000Z'
    });

    expect(manifest.schema).toBe('ccpanes.hook-final-runbook.v1');
    expect(manifest.mode).toBe('manual-execution-runbook');
    expect(manifest.goLive.manualApproval.approved).toBe(true);
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'FINAL-RUNBOOK.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'PRE-FLIGHT.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'POST-FLIGHT.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'ROLLBACK-CHECKLIST.md'))).resolves.toBeTruthy();
    const runbook = await fs.readFile(path.join(outDir, 'FINAL-RUNBOOK.md'), 'utf8');
    expect(runbook).toContain('Write pre-flight snapshot');
    expect(runbook).toContain('Apply one config at a time');
    expect(runbook).toContain('Rollback condition');
  });

  test('rejects final runbook generation when manual approval is not approved', async () => {
    const goLiveManifestPath = await writeGoLiveManifest(false);
    const outDir = path.join(tempRoot, 'final-runbook');

    await expect(createHookFinalRunbook({ goLiveManifestPath, outDir })).rejects.toThrow(/manual approval must be approved/);
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).rejects.toThrow();
  });
});

