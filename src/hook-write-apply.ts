import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, normalizeForComparison } from './paths.js';

export interface HookWriteApplyEntry {
  configPath: string;
  backupPath: string;
  beforeSha256: string;
  afterSha256: string;
  verifiedAfterSha256: string;
}

export interface HookWriteApplyReport {
  schema: 'ccpanes.hook-write-apply.v1';
  mode: 'guarded-apply';
  createdAt: string;
  approvalCheckPath: string;
  writePreviewPath: string;
  allowRoots: string[];
  passed: boolean;
  entries: HookWriteApplyEntry[];
  failures: string[];
}

export interface CreateHookWriteApplyInput {
  approvalCheckPath: string;
  writePreviewPath: string;
  outDir: string;
  allowRoots: string[];
  now?: string;
}

const forbiddenApplyOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeApplyOutDir(outDir: string): void {
  for (const root of forbiddenApplyOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid hook write apply output directory: forbidden root ${root}`);
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

function safeName(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
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

export async function createHookWriteApply(input: CreateHookWriteApplyInput): Promise<HookWriteApplyReport> {
  assertSafeApplyOutDir(input.outDir);
  if (input.allowRoots.length === 0) throw new Error('missing --allow-root');

  const approvalCheck = asRecord(JSON.parse(await fs.readFile(input.approvalCheckPath, 'utf8')));
  if (approvalCheck.schema !== 'ccpanes.hook-approval-check.v1') throw new Error('invalid approval check: schema');
  if (approvalCheck.passed !== true) throw new Error('invalid approval check: passed must be true');

  const writePreview = asRecord(JSON.parse(await fs.readFile(input.writePreviewPath, 'utf8')));
  if (writePreview.schema !== 'ccpanes.hook-write-preview.v1') throw new Error('invalid write preview: schema');
  if (writePreview.mode !== 'dry-run-write-preview') throw new Error('invalid write preview: mode');
  const previewApprovalCheckPath = typeof writePreview.approvalCheckPath === 'string' ? writePreview.approvalCheckPath : '';
  if (normalizeForComparison(previewApprovalCheckPath) !== normalizeForComparison(input.approvalCheckPath)) {
    throw new Error('invalid write preview: approvalCheckPath mismatch');
  }

  await fs.mkdir(path.join(input.outDir, 'backups'), { recursive: true });
  const entries: HookWriteApplyEntry[] = [];
  const previewEntries = Array.isArray(writePreview.entries) ? writePreview.entries.map((entry) => asRecord(entry)) : [];
  for (const entry of previewEntries) {
    const configPath = typeof entry.configPath === 'string' ? entry.configPath : '';
    const afterPreviewPath = typeof entry.afterPreviewPath === 'string' ? entry.afterPreviewPath : '';
    const beforeSha256 = typeof entry.beforeSha256 === 'string' ? entry.beforeSha256.toUpperCase() : '';
    const afterSha256 = typeof entry.afterSha256 === 'string' ? entry.afterSha256.toUpperCase() : '';
    if (!configPath) throw new Error('invalid write preview entry: configPath');
    if (!afterPreviewPath) throw new Error(`invalid write preview entry: afterPreviewPath for ${configPath}`);
    assertInsideAllowRoots(configPath, input.allowRoots);

    const before = await fs.readFile(configPath, 'utf8');
    const actualBeforeSha256 = sha256Text(before);
    if (actualBeforeSha256 !== beforeSha256) {
      throw new Error(`before hash mismatch: ${configPath}`);
    }

    const after = await fs.readFile(afterPreviewPath, 'utf8');
    const actualAfterPreviewSha256 = sha256Text(after);
    if (actualAfterPreviewSha256 !== afterSha256) {
      throw new Error(`after preview hash mismatch: ${configPath}`);
    }

    const backupPath = path.join(input.outDir, 'backups', `${safeName(configPath)}.bak`);
    await fs.writeFile(backupPath, before, 'utf8');
    await writeConfigAtomic(configPath, after);

    const verifiedAfterSha256 = sha256Text(await fs.readFile(configPath, 'utf8'));
    if (verifiedAfterSha256 !== afterSha256) {
      throw new Error(`after hash mismatch: ${configPath}`);
    }

    entries.push({ configPath, backupPath, beforeSha256, afterSha256, verifiedAfterSha256 });
  }

  return {
    schema: 'ccpanes.hook-write-apply.v1',
    mode: 'guarded-apply',
    createdAt: input.now ?? new Date().toISOString(),
    approvalCheckPath: input.approvalCheckPath,
    writePreviewPath: input.writePreviewPath,
    allowRoots: input.allowRoots,
    passed: true,
    entries,
    failures: []
  };
}

export async function writeHookWriteApplyReportAtomic(outPath: string, report: HookWriteApplyReport): Promise<void> {
  assertSafeApplyOutDir(path.dirname(outPath));
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}

