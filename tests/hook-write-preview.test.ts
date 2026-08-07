import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookWritePreview } from '../src/hook-write-preview.js';

let tempRoot: string;

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex').toUpperCase();
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-write-preview-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookWritePreview', () => {
  test('creates preview artifacts from a passing approval check without touching source config', async () => {
    const configPath = path.join(tempRoot, 'config.toml');
    const applyPlanDir = path.join(tempRoot, 'apply-plan');
    const applyPlanPath = path.join(applyPlanDir, 'apply-plan.json');
    const patchPath = path.join(applyPlanDir, 'staged-patches', 'codex.patch');
    const outDir = path.join(tempRoot, 'write-preview');
    await fs.writeFile(configPath, 'original = true\n', 'utf8');
    await fs.mkdir(path.dirname(patchPath), { recursive: true });
    await fs.writeFile(patchPath, '[hooks]\npreview = "node hook-runner.js"\n', 'utf8');
    await fs.writeFile(applyPlanPath, `${JSON.stringify({
      schema: 'ccpanes.hook-apply-plan.v1',
      targetConfigPaths: [configPath],
      artifacts: [{ kind: 'patch', path: patchPath, sha256: 'PATCH_SHA256' }]
    }, null, 2)}\n`, 'utf8');
    const approvalCheckPath = path.join(tempRoot, 'approval-check.json');
    await fs.writeFile(approvalCheckPath, `${JSON.stringify({
      schema: 'ccpanes.hook-approval-check.v1',
      passed: true,
      applyPlanPath
    }, null, 2)}\n`, 'utf8');

    const preview = await createHookWritePreview({ approvalCheckPath, outDir, now: '2026-08-06T00:00:18.000Z' });

    expect(preview.schema).toBe('ccpanes.hook-write-preview.v1');
    expect(preview.mode).toBe('dry-run-write-preview');
    expect(preview.approvalCheckPassed).toBe(true);
    expect(preview.entries).toHaveLength(1);
    expect(preview.artifacts.some((artifact) => artifact.kind === 'backup-manifest')).toBe(true);
    await expect(fs.stat(path.join(outDir, 'write-preview.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'backup-manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(preview.entries[0].diffPreviewPath)).resolves.toBeTruthy();
    await expect(fs.readFile(preview.entries[0].afterPreviewPath, 'utf8')).resolves.toContain('# ccpanes-hook-preview:begin');
    await expect(fs.readFile(preview.entries[0].diffPreviewPath, 'utf8')).resolves.toContain('+[hooks]');
    for (const artifact of preview.artifacts) {
      await expect(sha256File(artifact.path)).resolves.toBe(artifact.sha256);
    }
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe('original = true\n');
  });
});
