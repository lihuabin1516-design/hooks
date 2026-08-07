import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookFinalRunbookFile {
  kind: 'runbook' | 'pre-flight' | 'post-flight' | 'rollback-checklist';
  path: string;
  sha256: string;
}

export interface HookFinalRunbook {
  schema: 'ccpanes.hook-final-runbook.v1';
  mode: 'manual-execution-runbook';
  createdAt: string;
  outDir: string;
  goLive: {
    manifestPath: string;
    manifestSha256: string;
    manualApproval: {
      approved: true;
      approvedBy: string;
      approvedAt: string;
      note: string;
    };
  };
  upstreamHook: {
    path: string;
    sha256: string | null;
  };
  targetConfigSnapshots: Array<{
    path: string;
    sha256: string | null;
    size: number | null;
  }>;
  files: HookFinalRunbookFile[];
}

export interface CreateHookFinalRunbookInput {
  goLiveManifestPath: string;
  outDir: string;
  now?: string;
}

const forbiddenRunbookOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeRunbookOutDir(outDir: string): void {
  for (const root of forbiddenRunbookOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid final runbook output directory: forbidden root ${root}`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function writeTextFile(filePath: string, text: string, kind: HookFinalRunbookFile['kind']): Promise<HookFinalRunbookFile> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
  return { kind, path: filePath, sha256: sha256Text(text) };
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function createRunbook(input: {
  approvedBy: string;
  approvedAt: string;
  targets: Array<{ path: string; sha256: string | null; size: number | null }>;
  upstreamHookPath: string;
  upstreamHookSha256: string | null;
}): string {
  return [
    '# Final Hook Integration Runbook',
    '',
    `Approval: ${input.approvedBy} at ${input.approvedAt}`,
    '',
    '## 1. Write pre-flight snapshot',
    '',
    'Run `PRE-FLIGHT.ps1` and compare emitted SHA-256 values with the package manifest before any write.',
    '',
    '## 2. Apply one config at a time',
    '',
    'Apply one reviewed config change, then stop and verify before moving to the next config.',
    '',
    '## 3. Verify',
    '',
    'Run `POST-FLIGHT.ps1`, then run the production gate checks recorded in the approval package.',
    '',
    '## 4. Rollback condition',
    '',
    'Rollback condition: any hash mismatch, failed smoke check, hook runner failure, unexpected prompt behavior, or operator uncertainty.',
    '',
    '## 5. Stop conditions',
    '',
    '- Stop on any mismatch between current config hashes and pre-flight snapshots.',
    '- Stop if reference repos are dirty.',
    '- Stop if the upstream hook hash differs from the approved hash.',
    '',
    'Approved upstream hook:',
    `- ${input.upstreamHookPath}`,
    `- ${input.upstreamHookSha256 ?? 'missing'}`,
    '',
    'Target configs:',
    ...input.targets.map((target) => `- ${target.path} size=${target.size ?? 'missing'} sha256=${target.sha256 ?? 'missing'}`),
    ''
  ].join('\n');
}

function createPreFlight(targets: Array<{ path: string }>, upstreamHookPath: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '# Read-only pre-flight snapshot commands.',
    `Get-FileHash -LiteralPath ${psSingleQuote(upstreamHookPath)} -Algorithm SHA256`,
    ...targets.map((target) => `Get-FileHash -LiteralPath ${psSingleQuote(target.path)} -Algorithm SHA256`),
    ''
  ].join('\n');
}

function createPostFlight(targets: Array<{ path: string }>, upstreamHookPath: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '# Read-only post-flight verification commands.',
    `Get-FileHash -LiteralPath ${psSingleQuote(upstreamHookPath)} -Algorithm SHA256`,
    ...targets.map((target) => `Get-FileHash -LiteralPath ${psSingleQuote(target.path)} -Algorithm SHA256`),
    'Write-Output "Run npm test, npm run typecheck, npm run build, npm run smoke from the prototype root."',
    ''
  ].join('\n');
}

function createRollbackChecklist(targets: Array<{ path: string }>): string {
  return [
    '# Rollback Checklist',
    '',
    '- [ ] Confirm rollback condition is met.',
    '- [ ] Stop further config writes.',
    '- [ ] Restore the affected config from the approved backup.',
    '- [ ] Re-run pre-flight hash checks.',
    '- [ ] Re-run hook shadow synthetic event.',
    '',
    'Target configs:',
    ...targets.map((target) => `- [ ] ${target.path}`),
    ''
  ].join('\n');
}

export async function createHookFinalRunbook(input: CreateHookFinalRunbookInput): Promise<HookFinalRunbook> {
  assertSafeRunbookOutDir(input.outDir);
  const now = input.now ?? new Date().toISOString();
  const goLiveText = await fs.readFile(input.goLiveManifestPath, 'utf8');
  const goLive = asRecord(JSON.parse(goLiveText));
  if (goLive.schema !== 'ccpanes.hook-go-live-approval-package.v1') throw new Error('invalid go-live manifest: schema');
  if (goLive.mode !== 'manual-approval-package') throw new Error('invalid go-live manifest: mode');
  const manualApproval = asRecord(goLive.manualApproval);
  if (manualApproval.approved !== true) throw new Error('manual approval must be approved');
  const readiness = asRecord(goLive.readiness);
  if (readiness.ready !== true) throw new Error('go-live readiness must be ready');

  const upstreamHook = asRecord(goLive.upstreamHook);
  const targets = Array.isArray(goLive.targetConfigSnapshots)
    ? goLive.targetConfigSnapshots.map((snapshot) => {
      const record = asRecord(snapshot);
      return {
        path: typeof record.path === 'string' ? record.path : '',
        sha256: typeof record.sha256 === 'string' ? record.sha256 : null,
        size: typeof record.size === 'number' ? record.size : null
      };
    })
    : [];

  await fs.rm(input.outDir, { recursive: true, force: true });
  await fs.mkdir(input.outDir, { recursive: true });
  const upstreamHookPath = typeof upstreamHook.path === 'string' ? upstreamHook.path : '';
  const upstreamHookSha256 = typeof upstreamHook.sha256 === 'string' ? upstreamHook.sha256 : null;
  const approvedBy = typeof manualApproval.approvedBy === 'string' ? manualApproval.approvedBy : '';
  const approvedAt = typeof manualApproval.approvedAt === 'string' ? manualApproval.approvedAt : '';
  const note = typeof manualApproval.note === 'string' ? manualApproval.note : '';

  const files: HookFinalRunbookFile[] = [];
  files.push(await writeTextFile(path.join(input.outDir, 'FINAL-RUNBOOK.md'), createRunbook({
    approvedBy,
    approvedAt,
    targets,
    upstreamHookPath,
    upstreamHookSha256
  }), 'runbook'));
  files.push(await writeTextFile(path.join(input.outDir, 'PRE-FLIGHT.ps1'), createPreFlight(targets, upstreamHookPath), 'pre-flight'));
  files.push(await writeTextFile(path.join(input.outDir, 'POST-FLIGHT.ps1'), createPostFlight(targets, upstreamHookPath), 'post-flight'));
  files.push(await writeTextFile(path.join(input.outDir, 'ROLLBACK-CHECKLIST.md'), createRollbackChecklist(targets), 'rollback-checklist'));

  const manifest: HookFinalRunbook = {
    schema: 'ccpanes.hook-final-runbook.v1',
    mode: 'manual-execution-runbook',
    createdAt: now,
    outDir: input.outDir,
    goLive: {
      manifestPath: input.goLiveManifestPath,
      manifestSha256: sha256Text(goLiveText),
      manualApproval: {
        approved: true,
        approvedBy,
        approvedAt,
        note
      }
    },
    upstreamHook: { path: upstreamHookPath, sha256: upstreamHookSha256 },
    targetConfigSnapshots: targets,
    files
  };
  await fs.writeFile(path.join(input.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

