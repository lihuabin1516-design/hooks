import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookWriteApply } from '../src/hook-write-apply.js';

let tempRoot: string;

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function writeFixturePreview(configPath: string, before: string, after: string): Promise<{ approvalCheckPath: string; writePreviewPath: string }> {
  const fixtureDir = path.join(tempRoot, 'preview-fixture');
  const beforePath = path.join(fixtureDir, 'before.toml');
  const afterPath = path.join(fixtureDir, 'after.toml');
  const diffPath = path.join(fixtureDir, 'config.diff');
  const approvalCheckPath = path.join(fixtureDir, 'approval-check.json');
  const writePreviewPath = path.join(fixtureDir, 'write-preview.json');
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(beforePath, before, 'utf8');
  await fs.writeFile(afterPath, after, 'utf8');
  await fs.writeFile(diffPath, `--- ${configPath}\n+++ ${configPath}.preview\n@@\n`, 'utf8');
  await fs.writeFile(approvalCheckPath, `${JSON.stringify({
    schema: 'ccpanes.hook-approval-check.v1',
    passed: true,
    applyPlanPath: path.join(fixtureDir, 'apply-plan.json')
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(writePreviewPath, `${JSON.stringify({
    schema: 'ccpanes.hook-write-preview.v1',
    mode: 'dry-run-write-preview',
    createdAt: '2026-08-06T00:00:00.000Z',
    approvalCheckPath,
    approvalCheckPassed: true,
    entries: [{
      configPath,
      beforePreviewPath: beforePath,
      afterPreviewPath: afterPath,
      diffPreviewPath: diffPath,
      beforeSha256: sha256Text(before),
      afterSha256: sha256Text(after)
    }],
    artifacts: []
  }, null, 2)}\n`, 'utf8');
  return { approvalCheckPath, writePreviewPath };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-write-apply-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookWriteApply', () => {
  test('backs up and atomically applies preview output to an explicitly allowed synthetic config', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const outDir = path.join(tempRoot, 'apply-report');
    const before = 'original = true\n';
    const after = 'original = true\n\n# ccpanes-hook-preview:begin\n[hooks]\npreview = "node hook-runner.js"\n# ccpanes-hook-preview:end\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.writeFile(configPath, before, 'utf8');
    const fixture = await writeFixturePreview(configPath, before, after);

    const report = await createHookWriteApply({
      approvalCheckPath: fixture.approvalCheckPath,
      writePreviewPath: fixture.writePreviewPath,
      outDir,
      allowRoots: [configRoot],
      now: '2026-08-06T00:00:01.000Z'
    });

    expect(report.schema).toBe('ccpanes.hook-write-apply.v1');
    expect(report.mode).toBe('guarded-apply');
    expect(report.passed).toBe(true);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].configPath).toBe(configPath);
    expect(report.entries[0].beforeSha256).toBe(sha256Text(before));
    expect(report.entries[0].afterSha256).toBe(sha256Text(after));
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(after);
    await expect(fs.readFile(report.entries[0].backupPath, 'utf8')).resolves.toBe(before);
  });

  test('rejects config paths outside explicit allow roots without changing the file', async () => {
    const configPath = path.join(tempRoot, 'outside', 'config.toml');
    const outDir = path.join(tempRoot, 'apply-report');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, before, 'utf8');
    const fixture = await writeFixturePreview(configPath, before, after);

    await expect(createHookWriteApply({
      approvalCheckPath: fixture.approvalCheckPath,
      writePreviewPath: fixture.writePreviewPath,
      outDir,
      allowRoots: [path.join(tempRoot, 'allowed-only')]
    })).rejects.toThrow(/outside allow roots/);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(before);
  });

  test('rejects stale previews when current config hash differs from before hash', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const outDir = path.join(tempRoot, 'apply-report');
    await fs.mkdir(configRoot, { recursive: true });
    await fs.writeFile(configPath, 'current = true\n', 'utf8');
    const fixture = await writeFixturePreview(configPath, 'original = true\n', 'changed = true\n');

    await expect(createHookWriteApply({
      approvalCheckPath: fixture.approvalCheckPath,
      writePreviewPath: fixture.writePreviewPath,
      outDir,
      allowRoots: [configRoot]
    })).rejects.toThrow(/before hash mismatch/);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe('current = true\n');
  });
});

