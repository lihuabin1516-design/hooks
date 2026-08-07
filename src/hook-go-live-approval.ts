import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookGoLiveApprovalFile {
  kind: 'approval' | 'commands' | 'evidence-index';
  path: string;
  sha256: string;
}

export interface HookGoLiveApprovalPackage {
  schema: 'ccpanes.hook-go-live-approval-package.v1';
  mode: 'manual-approval-package';
  createdAt: string;
  outDir: string;
  readiness: {
    path: string;
    sha256: string;
    ready: boolean;
  };
  upstreamHook: {
    path: string;
    sha256: string | null;
  };
  manualApproval: {
    approved: true;
    approvedBy: string;
    approvedAt: string;
    note: string;
  };
  targetConfigSnapshots: Array<{
    path: string;
    sha256: string | null;
    size: number | null;
  }>;
  evidencePaths: {
    releaseGatePath: string;
    approvalCheckPath: string;
    writePreviewPath: string;
    applyReportPath: string;
    restoreReportPath: string;
  };
  files: HookGoLiveApprovalFile[];
}

export interface CreateHookGoLiveApprovalInput {
  readinessPath: string;
  outDir: string;
  approvedBy: string;
  approvalNote?: string;
  upstreamHookPath: string;
  now?: string;
}

const forbiddenGoLiveOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeGoLiveOutDir(outDir: string): void {
  for (const root of forbiddenGoLiveOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid go-live approval package output directory: forbidden root ${root}`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function sha256FileOrNull(filePath: string): Promise<string | null> {
  try {
    return sha256Buffer(await fs.readFile(filePath));
  } catch {
    return null;
  }
}

async function writeTextFile(filePath: string, text: string, kind: HookGoLiveApprovalFile['kind']): Promise<HookGoLiveApprovalFile> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
  return { kind, path: filePath, sha256: sha256Text(text) };
}

function createApprovalMarkdown(input: {
  approvedBy: string;
  approvedAt: string;
  approvalNote: string;
  readinessPath: string;
  readinessSha256: string;
  upstreamHookPath: string;
  upstreamHookSha256: string | null;
}): string {
  return [
    '# Go-Live Approval',
    '',
    `Approved: true`,
    `Approved by: ${input.approvedBy}`,
    `Approved at: ${input.approvedAt}`,
    `Approval note: ${input.approvalNote}`,
    '',
    'Readiness evidence:',
    `- Path: ${input.readinessPath}`,
    `- SHA-256: ${input.readinessSha256}`,
    '',
    'Upstream hook evidence:',
    `- Path: ${input.upstreamHookPath}`,
    `- SHA-256: ${input.upstreamHookSha256 ?? 'missing'}`,
    '',
    'Scope:',
    '- This package records manual approval evidence only.',
    '- It does not execute hook registration or config writes.',
    ''
  ].join('\n');
}

function createCommands(evidence: HookGoLiveApprovalPackage['evidencePaths']): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '# Review-only command ledger. Do not run blindly.',
    `# release gate: ${evidence.releaseGatePath}`,
    `# approval check: ${evidence.approvalCheckPath}`,
    `# write preview: ${evidence.writePreviewPath}`,
    `# synthetic apply: ${evidence.applyReportPath}`,
    `# synthetic restore: ${evidence.restoreReportPath}`,
    '',
    'Write-Output "Review production-readiness.json and GO-LIVE-APPROVAL.md before any real config write."',
    ''
  ].join('\n');
}

function createEvidenceIndex(manifest: Omit<HookGoLiveApprovalPackage, 'files'>): string {
  return [
    '# Evidence Index',
    '',
    `Readiness: ${manifest.readiness.path}`,
    `Readiness SHA-256: ${manifest.readiness.sha256}`,
    '',
    'Gate artifacts:',
    `- release-gate: ${manifest.evidencePaths.releaseGatePath}`,
    `- approval-check: ${manifest.evidencePaths.approvalCheckPath}`,
    `- write-preview: ${manifest.evidencePaths.writePreviewPath}`,
    `- synthetic-apply: ${manifest.evidencePaths.applyReportPath}`,
    `- synthetic-restore: ${manifest.evidencePaths.restoreReportPath}`,
    '',
    'Target config snapshots:',
    ...manifest.targetConfigSnapshots.map((snapshot) => `- ${snapshot.path} size=${snapshot.size ?? 'missing'} sha256=${snapshot.sha256 ?? 'missing'}`),
    ''
  ].join('\n');
}

export async function createHookGoLiveApprovalPackage(input: CreateHookGoLiveApprovalInput): Promise<HookGoLiveApprovalPackage> {
  assertSafeGoLiveOutDir(input.outDir);
  if (!input.approvedBy.trim()) throw new Error('approvedBy is required');
  const now = input.now ?? new Date().toISOString();
  const readinessText = await fs.readFile(input.readinessPath, 'utf8');
  const readiness = asRecord(JSON.parse(readinessText));
  if (readiness.schema !== 'ccpanes.hook-production-readiness.v1') throw new Error('invalid production readiness: schema');
  if (readiness.mode !== 'final-readiness') throw new Error('invalid production readiness: mode');
  if (readiness.ready !== true) throw new Error('production readiness must be ready');

  const releaseGatePath = typeof readiness.releaseGatePath === 'string' ? readiness.releaseGatePath : '';
  const releaseGate = asRecord(JSON.parse(await fs.readFile(releaseGatePath, 'utf8')));
  const snapshots = Array.isArray(releaseGate.configSnapshots) ? releaseGate.configSnapshots.map((snapshot) => asRecord(snapshot)) : [];
  const targetConfigSnapshots = snapshots.map((snapshot) => ({
    path: typeof snapshot.path === 'string' ? snapshot.path : '',
    sha256: typeof snapshot.sha256 === 'string' ? snapshot.sha256 : null,
    size: typeof snapshot.size === 'number' ? snapshot.size : null
  }));

  const readinessSha256 = sha256Text(readinessText);
  const upstreamHookSha256 = await sha256FileOrNull(input.upstreamHookPath);
  const evidencePaths = {
    releaseGatePath,
    approvalCheckPath: typeof readiness.approvalCheckPath === 'string' ? readiness.approvalCheckPath : '',
    writePreviewPath: typeof readiness.writePreviewPath === 'string' ? readiness.writePreviewPath : '',
    applyReportPath: typeof readiness.applyReportPath === 'string' ? readiness.applyReportPath : '',
    restoreReportPath: typeof readiness.restoreReportPath === 'string' ? readiness.restoreReportPath : ''
  };

  await fs.rm(input.outDir, { recursive: true, force: true });
  await fs.mkdir(input.outDir, { recursive: true });

  const baseManifest = {
    schema: 'ccpanes.hook-go-live-approval-package.v1' as const,
    mode: 'manual-approval-package' as const,
    createdAt: now,
    outDir: input.outDir,
    readiness: { path: input.readinessPath, sha256: readinessSha256, ready: true },
    upstreamHook: { path: input.upstreamHookPath, sha256: upstreamHookSha256 },
    manualApproval: {
      approved: true as const,
      approvedBy: input.approvedBy,
      approvedAt: now,
      note: input.approvalNote ?? ''
    },
    targetConfigSnapshots,
    evidencePaths
  };

  const files: HookGoLiveApprovalFile[] = [];
  files.push(await writeTextFile(path.join(input.outDir, 'GO-LIVE-APPROVAL.md'), createApprovalMarkdown({
    approvedBy: input.approvedBy,
    approvedAt: now,
    approvalNote: input.approvalNote ?? '',
    readinessPath: input.readinessPath,
    readinessSha256,
    upstreamHookPath: input.upstreamHookPath,
    upstreamHookSha256
  }), 'approval'));
  files.push(await writeTextFile(path.join(input.outDir, 'COMMANDS.ps1'), createCommands(evidencePaths), 'commands'));
  files.push(await writeTextFile(path.join(input.outDir, 'EVIDENCE-INDEX.md'), createEvidenceIndex(baseManifest), 'evidence-index'));

  const manifest: HookGoLiveApprovalPackage = { ...baseManifest, files };
  await fs.writeFile(path.join(input.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
