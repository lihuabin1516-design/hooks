import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookWriteRestoreEntry {
  configPath: string;
  backupPath: string;
  beforeSha256: string;
  afterSha256: string;
  restoredSha256: string;
}

export interface HookWriteRestoreReport {
  schema: 'ccpanes.hook-write-restore.v1';
  mode: 'guarded-restore';
  createdAt: string;
  applyReportPath: string;
  allowRoots: string[];
  passed: boolean;
  entries: HookWriteRestoreEntry[];
  failures: string[];
}

export interface CreateHookWriteRestoreInput {
  applyReportPath: string;
  outDir: string;
  allowRoots: string[];
  now?: string;
}

const forbiddenRestoreOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeRestoreOutDir(outDir: string): void {
  for (const root of forbiddenRestoreOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid hook write restore output directory: forbidden root ${root}`);
    }
  }
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function assertInsideAllowRoots(configPath: string, allowRoots: string[]): void {
  if (allowRoots.length === 0) throw new Error('missing allow roots');
  const inside = allowRoots.some((root) => isPathInside(root, configPath));
  if (!inside) throw new Error(`config path outside allow roots: ${configPath}`);
}

async function writeConfigAtomic(configPath: string, text: string): Promise<void> {
  const dir = path.dirname(configPath);
  const tempPath = path.join(dir, `${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, text, 'utf8');
  await fs.rename(tempPath, configPath);
}

export async function createHookWriteRestore(input: CreateHookWriteRestoreInput): Promise<HookWriteRestoreReport> {
  assertSafeRestoreOutDir(input.outDir);
  if (input.allowRoots.length === 0) throw new Error('missing --allow-root');

  const applyReport = asRecord(JSON.parse(await fs.readFile(input.applyReportPath, 'utf8')));
  if (applyReport.schema !== 'ccpanes.hook-write-apply.v1') throw new Error('invalid apply report: schema');
  if (applyReport.mode !== 'guarded-apply') throw new Error('invalid apply report: mode');
  if (applyReport.passed !== true) throw new Error('invalid apply report: passed must be true');

  await fs.mkdir(input.outDir, { recursive: true });
  const entries: HookWriteRestoreEntry[] = [];
  const applyEntries = Array.isArray(applyReport.entries) ? applyReport.entries.map((entry) => asRecord(entry)) : [];
  for (const entry of applyEntries) {
    const configPath = typeof entry.configPath === 'string' ? entry.configPath : '';
    const backupPath = typeof entry.backupPath === 'string' ? entry.backupPath : '';
    const beforeSha256 = typeof entry.beforeSha256 === 'string' ? entry.beforeSha256.toUpperCase() : '';
    const afterSha256 = typeof entry.afterSha256 === 'string' ? entry.afterSha256.toUpperCase() : '';
    if (!configPath) throw new Error('invalid apply report entry: configPath');
    if (!backupPath) throw new Error(`invalid apply report entry: backupPath for ${configPath}`);
    assertInsideAllowRoots(configPath, input.allowRoots);

    const current = await fs.readFile(configPath, 'utf8');
    const currentSha256 = sha256Text(current);
    if (currentSha256 !== afterSha256) {
      throw new Error(`after hash mismatch: ${configPath}`);
    }

    const backup = await fs.readFile(backupPath, 'utf8');
    const backupSha256 = sha256Text(backup);
    if (backupSha256 !== beforeSha256) {
      throw new Error(`backup hash mismatch: ${configPath}`);
    }

    await writeConfigAtomic(configPath, backup);
    const restoredSha256 = sha256Text(await fs.readFile(configPath, 'utf8'));
    if (restoredSha256 !== beforeSha256) {
      throw new Error(`restored hash mismatch: ${configPath}`);
    }

    entries.push({ configPath, backupPath, beforeSha256, afterSha256, restoredSha256 });
  }

  return {
    schema: 'ccpanes.hook-write-restore.v1',
    mode: 'guarded-restore',
    createdAt: input.now ?? new Date().toISOString(),
    applyReportPath: input.applyReportPath,
    allowRoots: input.allowRoots,
    passed: true,
    entries,
    failures: []
  };
}

export async function writeHookWriteRestoreReportAtomic(outPath: string, report: HookWriteRestoreReport): Promise<void> {
  assertSafeRestoreOutDir(path.dirname(outPath));
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}

