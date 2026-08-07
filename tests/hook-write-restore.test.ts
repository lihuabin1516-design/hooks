import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookWriteRestore } from '../src/hook-write-restore.js';

let tempRoot: string;

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function writeApplyReport(configPath: string, backupPath: string, before: string, after: string): Promise<string> {
  const reportPath = path.join(tempRoot, 'hook-write-apply.json');
  await fs.writeFile(reportPath, `${JSON.stringify({
    schema: 'ccpanes.hook-write-apply.v1',
    mode: 'guarded-apply',
    createdAt: '2026-08-06T00:00:00.000Z',
    approvalCheckPath: path.join(tempRoot, 'approval-check.json'),
    writePreviewPath: path.join(tempRoot, 'write-preview.json'),
    allowRoots: [path.dirname(configPath)],
    passed: true,
    entries: [{
      configPath,
      backupPath,
      beforeSha256: sha256Text(before),
      afterSha256: sha256Text(after),
      verifiedAfterSha256: sha256Text(after)
    }],
    failures: []
  }, null, 2)}\n`, 'utf8');
  return reportPath;
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-write-restore-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookWriteRestore', () => {
  test('restores an applied synthetic config from backup when hashes and allow-root match', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const backupPath = path.join(tempRoot, 'backups', 'config.bak');
    const outDir = path.join(tempRoot, 'restore-report');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(configPath, after, 'utf8');
    await fs.writeFile(backupPath, before, 'utf8');
    const applyReportPath = await writeApplyReport(configPath, backupPath, before, after);

    const report = await createHookWriteRestore({
      applyReportPath,
      outDir,
      allowRoots: [configRoot],
      now: '2026-08-06T00:00:01.000Z'
    });

    expect(report.schema).toBe('ccpanes.hook-write-restore.v1');
    expect(report.mode).toBe('guarded-restore');
    expect(report.passed).toBe(true);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].configPath).toBe(configPath);
    expect(report.entries[0].restoredSha256).toBe(sha256Text(before));
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(before);
  });

  test('rejects config paths outside explicit allow roots without restoring', async () => {
    const configPath = path.join(tempRoot, 'outside', 'config.toml');
    const backupPath = path.join(tempRoot, 'backups', 'config.bak');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(configPath, after, 'utf8');
    await fs.writeFile(backupPath, before, 'utf8');
    const applyReportPath = await writeApplyReport(configPath, backupPath, before, after);

    await expect(createHookWriteRestore({
      applyReportPath,
      outDir: path.join(tempRoot, 'restore-report'),
      allowRoots: [path.join(tempRoot, 'allowed-only')]
    })).rejects.toThrow(/outside allow roots/);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(after);
  });

  test('rejects restore when current config is not the applied after state', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const backupPath = path.join(tempRoot, 'backups', 'config.bak');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(configPath, 'manual drift = true\n', 'utf8');
    await fs.writeFile(backupPath, before, 'utf8');
    const applyReportPath = await writeApplyReport(configPath, backupPath, before, after);

    await expect(createHookWriteRestore({
      applyReportPath,
      outDir: path.join(tempRoot, 'restore-report'),
      allowRoots: [configRoot]
    })).rejects.toThrow(/after hash mismatch/);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe('manual drift = true\n');
  });

  test('rejects restore when backup hash does not match the original before hash', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const backupPath = path.join(tempRoot, 'backups', 'config.bak');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(configPath, after, 'utf8');
    await fs.writeFile(backupPath, 'wrong backup = true\n', 'utf8');
    const applyReportPath = await writeApplyReport(configPath, backupPath, before, after);

    await expect(createHookWriteRestore({
      applyReportPath,
      outDir: path.join(tempRoot, 'restore-report'),
      allowRoots: [configRoot]
    })).rejects.toThrow(/backup hash mismatch/);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(after);
  });
});

