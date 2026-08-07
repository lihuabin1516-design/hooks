import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookWritePreviewArtifact {
  kind: 'backup-manifest' | 'before' | 'after' | 'diff';
  path: string;
  sha256: string;
}

export interface HookWritePreviewEntry {
  configPath: string;
  beforePreviewPath: string;
  afterPreviewPath: string;
  diffPreviewPath: string;
  beforeSha256: string;
  afterSha256: string;
}

export interface HookWritePreview {
  schema: 'ccpanes.hook-write-preview.v1';
  mode: 'dry-run-write-preview';
  createdAt: string;
  approvalCheckPath: string;
  approvalCheckPassed: boolean;
  entries: HookWritePreviewEntry[];
  artifacts: HookWritePreviewArtifact[];
}

export interface CreateHookWritePreviewInput {
  approvalCheckPath: string;
  outDir: string;
  now?: string;
}

const forbiddenWritePreviewOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeWritePreviewOutDir(outDir: string): void {
  for (const root of forbiddenWritePreviewOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid hook write preview output directory: forbidden root ${root}`);
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

async function writeArtifact(filePath: string, text: string, kind: HookWritePreviewArtifact['kind']): Promise<HookWritePreviewArtifact> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
  return { kind, path: filePath, sha256: sha256Text(text) };
}

function choosePatch(configPath: string, patches: { path: string; text: string }[]): string {
  const normalized = configPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('.codex')) {
    return patches.find((patch) => path.basename(patch.path).toLowerCase().includes('codex'))?.text ?? patches[0]?.text ?? '';
  }
  if (normalized.includes('.cc-panes') || normalized.includes('ccpanes')) {
    return patches.find((patch) => path.basename(patch.path).toLowerCase().includes('ccpanes'))?.text ?? patches[0]?.text ?? '';
  }
  return patches[0]?.text ?? '';
}

function createAfterText(before: string, patch: string): string {
  const separator = before.endsWith('\n') ? '\n' : '\n\n';
  return `${before}${separator}# ccpanes-hook-preview:begin\n${patch.trimEnd()}\n# ccpanes-hook-preview:end\n`;
}

function createSimpleDiff(configPath: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const commonPrefixLength = beforeLines.length;
  return [
    `--- ${configPath}`,
    `+++ ${configPath}.preview`,
    '@@',
    ...beforeLines.map((line) => ` ${line}`),
    ...afterLines.slice(commonPrefixLength).map((line) => `+${line}`),
    ''
  ].join('\n');
}

export async function createHookWritePreview(input: CreateHookWritePreviewInput): Promise<HookWritePreview> {
  assertSafeWritePreviewOutDir(input.outDir);
  const approvalCheck = asRecord(JSON.parse(await fs.readFile(input.approvalCheckPath, 'utf8')));
  if (approvalCheck.schema !== 'ccpanes.hook-approval-check.v1') throw new Error('invalid approval check: schema');
  if (approvalCheck.passed !== true) throw new Error('invalid approval check: passed must be true');
  const applyPlanPath = typeof approvalCheck.applyPlanPath === 'string' ? approvalCheck.applyPlanPath : '';
  if (!applyPlanPath) throw new Error('invalid approval check: applyPlanPath');
  const applyPlan = asRecord(JSON.parse(await fs.readFile(applyPlanPath, 'utf8')));
  if (applyPlan.schema !== 'ccpanes.hook-apply-plan.v1') throw new Error('invalid apply plan: schema');

  await fs.rm(input.outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(input.outDir, 'before'), { recursive: true });
  await fs.mkdir(path.join(input.outDir, 'after'), { recursive: true });
  await fs.mkdir(path.join(input.outDir, 'diffs'), { recursive: true });

  const artifacts = Array.isArray(applyPlan.artifacts) ? applyPlan.artifacts.map((artifact) => asRecord(artifact)) : [];
  const patchArtifacts = artifacts.filter((artifact) => artifact.kind === 'patch' && typeof artifact.path === 'string');
  const patches = await Promise.all(patchArtifacts.map(async (artifact) => ({
    path: artifact.path as string,
    text: await fs.readFile(artifact.path as string, 'utf8')
  })));
  const targetConfigPaths = Array.isArray(applyPlan.targetConfigPaths) ? applyPlan.targetConfigPaths.filter((item): item is string => typeof item === 'string') : [];

  const previewArtifacts: HookWritePreviewArtifact[] = [];
  const entries: HookWritePreviewEntry[] = [];
  const backupEntries: Array<{ configPath: string; sha256: string; size: number; backupPreviewPath: string }> = [];
  for (const configPath of targetConfigPaths) {
    const before = await fs.readFile(configPath, 'utf8');
    const patch = choosePatch(configPath, patches);
    const after = createAfterText(before, patch);
    const diff = createSimpleDiff(configPath, before, after);
    const name = safeName(configPath);
    const beforePath = path.join(input.outDir, 'before', `${name}.toml`);
    const afterPath = path.join(input.outDir, 'after', `${name}.toml`);
    const diffPath = path.join(input.outDir, 'diffs', `${name}.diff`);
    previewArtifacts.push(await writeArtifact(beforePath, before, 'before'));
    previewArtifacts.push(await writeArtifact(afterPath, after, 'after'));
    previewArtifacts.push(await writeArtifact(diffPath, diff, 'diff'));
    entries.push({
      configPath,
      beforePreviewPath: beforePath,
      afterPreviewPath: afterPath,
      diffPreviewPath: diffPath,
      beforeSha256: sha256Text(before),
      afterSha256: sha256Text(after)
    });
    backupEntries.push({ configPath, sha256: sha256Text(before), size: Buffer.byteLength(before, 'utf8'), backupPreviewPath: beforePath });
  }

  const backupManifest = {
    schema: 'ccpanes.hook-backup-manifest.v1',
    mode: 'dry-run-preview',
    createdAt: input.now ?? new Date().toISOString(),
    entries: backupEntries
  };
  previewArtifacts.unshift(await writeArtifact(path.join(input.outDir, 'backup-manifest.json'), `${JSON.stringify(backupManifest, null, 2)}\n`, 'backup-manifest'));

  const preview: HookWritePreview = {
    schema: 'ccpanes.hook-write-preview.v1',
    mode: 'dry-run-write-preview',
    createdAt: input.now ?? new Date().toISOString(),
    approvalCheckPath: input.approvalCheckPath,
    approvalCheckPassed: true,
    entries,
    artifacts: previewArtifacts
  };
  await fs.writeFile(path.join(input.outDir, 'write-preview.json'), `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
  return preview;
}
