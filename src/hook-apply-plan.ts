import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookApplyPlanArtifact {
  kind: 'instructions' | 'backup-script' | 'rollback-script' | 'patch';
  path: string;
  sha256: string;
}

export interface HookApplyPlan {
  schema: 'ccpanes.hook-apply-plan.v1';
  mode: 'staged-review';
  createdAt: string;
  releaseGatePath: string;
  releaseGatePassed: boolean;
  packageDir: string;
  targetConfigPaths: string[];
  artifacts: HookApplyPlanArtifact[];
  instructions: string[];
}

export interface CreateHookApplyPlanInput {
  releaseGatePath: string;
  outDir: string;
  now?: string;
}

const forbiddenApplyPlanOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeApplyPlanOutDir(outDir: string): void {
  for (const root of forbiddenApplyPlanOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid hook apply plan output directory: forbidden root ${root}`);
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

async function writeTextArtifact(filePath: string, text: string, kind: HookApplyPlanArtifact['kind']): Promise<HookApplyPlanArtifact> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
  return { kind, path: filePath, sha256: sha256Text(text) };
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function createInstructions(configPaths: string[]): string {
  return [
    '# Staged Hook Apply Plan',
    '',
    'This directory contains review artifacts only. No script in this package was executed by the generator.',
    '',
    'Manual order:',
    '',
    '1. Re-check release-gate.json and confirm `passed=true`.',
    '2. Run `scripts/capture-prechange.ps1` manually to capture backups and hashes.',
    '3. Review `staged-patches/*.patch`.',
    '4. Apply at most one config patch manually.',
    '5. Run the production gate checks and a synthetic hook-shadow event.',
    '6. If validation fails, run `scripts/restore-from-backup.ps1` manually.',
    '',
    'Target config paths:',
    ...configPaths.map((configPath) => `- ${configPath}`),
    ''
  ].join('\n');
}

function createBackupScript(configPaths: string[]): string {
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '$backupRoot = Join-Path $PSScriptRoot "..\\backups"',
    'New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null',
    '$items = @(',
    ...configPaths.map((configPath) => `  ${psSingleQuote(configPath)}`),
    ')',
    'foreach ($item in $items) {',
    '  if (Test-Path -LiteralPath $item) {',
    '    $name = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($item)).Replace("/", "_").Replace("+", "-")',
    '    $backup = Join-Path $backupRoot "$name.bak"',
    '    Copy-Item -LiteralPath $item -Destination $backup -Force',
    '    Get-FileHash -LiteralPath $item -Algorithm SHA256',
    '  } else {',
    '    Write-Output "MISSING $item"',
    '  }',
    '}',
    ''
  ];
  return lines.join('\n');
}

function createRollbackScript(configPaths: string[]): string {
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '$backupRoot = Join-Path $PSScriptRoot "..\\backups"',
    '$items = @(',
    ...configPaths.map((configPath) => `  ${psSingleQuote(configPath)}`),
    ')',
    'foreach ($item in $items) {',
    '  $name = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($item)).Replace("/", "_").Replace("+", "-")',
    '  $backup = Join-Path $backupRoot "$name.bak"',
    '  if (Test-Path -LiteralPath $backup) {',
    '    Copy-Item -LiteralPath $backup -Destination $item -Force',
    '    Get-FileHash -LiteralPath $item -Algorithm SHA256',
    '  } else {',
    '    Write-Output "BACKUP_MISSING $item"',
    '  }',
    '}',
    ''
  ];
  return lines.join('\n');
}

export async function createHookApplyPlan(input: CreateHookApplyPlanInput): Promise<HookApplyPlan> {
  assertSafeApplyPlanOutDir(input.outDir);
  const gate = asRecord(JSON.parse(await fs.readFile(input.releaseGatePath, 'utf8')));
  if (gate.schema !== 'ccpanes.hook-release-gate.v1') throw new Error('invalid release gate: schema');
  if (gate.passed !== true) throw new Error('invalid release gate: passed must be true');
  const packageDir = typeof gate.packageDir === 'string' ? gate.packageDir : '';
  if (!packageDir) throw new Error('invalid release gate: packageDir');
  const snapshots = Array.isArray(gate.configSnapshots) ? gate.configSnapshots.map((snapshot) => asRecord(snapshot)) : [];
  const configPaths = snapshots.map((snapshot) => snapshot.path).filter((value): value is string => typeof value === 'string' && value.length > 0);

  await fs.rm(input.outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(input.outDir, 'staged-patches'), { recursive: true });
  await fs.mkdir(path.join(input.outDir, 'scripts'), { recursive: true });

  const artifacts: HookApplyPlanArtifact[] = [];
  artifacts.push(await writeTextArtifact(path.join(input.outDir, 'APPLY-INSTRUCTIONS.md'), createInstructions(configPaths), 'instructions'));
  artifacts.push(await writeTextArtifact(path.join(input.outDir, 'scripts', 'capture-prechange.ps1'), createBackupScript(configPaths), 'backup-script'));
  artifacts.push(await writeTextArtifact(path.join(input.outDir, 'scripts', 'restore-from-backup.ps1'), createRollbackScript(configPaths), 'rollback-script'));

  const patchDir = path.join(packageDir, 'patches');
  let patchNames: string[] = [];
  try {
    patchNames = (await fs.readdir(patchDir)).filter((name) => name.endsWith('.patch')).sort();
  } catch {
    patchNames = [];
  }
  for (const patchName of patchNames) {
    const text = await fs.readFile(path.join(patchDir, patchName), 'utf8');
    artifacts.push(await writeTextArtifact(path.join(input.outDir, 'staged-patches', patchName), text, 'patch'));
  }

  const plan: HookApplyPlan = {
    schema: 'ccpanes.hook-apply-plan.v1',
    mode: 'staged-review',
    createdAt: input.now ?? new Date().toISOString(),
    releaseGatePath: input.releaseGatePath,
    releaseGatePassed: true,
    packageDir,
    targetConfigPaths: configPaths,
    artifacts,
    instructions: [
      'Review this apply plan and release gate before any real config write.',
      'Capture pre-change backups and hashes before applying a config patch.',
      'Apply one patch at a time and run release checks after each patch.',
      'Use rollback script only after confirming backup artifacts exist.'
    ]
  };
  await fs.writeFile(path.join(input.outDir, 'apply-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return plan;
}
