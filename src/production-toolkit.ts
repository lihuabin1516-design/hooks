import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildExpectedHooksConfig, expectedHookDefinitions, type ExpectedHookEvent } from './installed-hooks.js';
import { isPathInside } from './paths.js';

export interface ProductionToolkitFile {
  kind: 'install-hooks' | 'verify-installed' | 'bootstrap-project' | 'rollback-hooks' | 'production-readme';
  path: string;
  sha256: string;
}

export interface ProductionToolkitManifest {
  schema: 'ccpanes.production-toolkit-manifest.v1';
  mode: 'reviewable-production-toolkit';
  createdAt: string;
  outDir: string;
  prototypeRoot: string;
  auditRoot: string;
  hooksJsonPath: string;
  configTomlPath: string | null;
  expectedUpstreamHook: {
    path: string | null;
    sha256: string | null;
  };
  expectedHooks: Array<{
    event: ExpectedHookEvent;
    commandToken: string;
    trustStateKey: string;
  }>;
  files: ProductionToolkitFile[];
}

export interface CreateProductionToolkitInput {
  outDir: string;
  prototypeRoot: string;
  auditRoot: string;
  hooksJsonPath: string;
  configTomlPath?: string | null;
  expectedUpstreamHookPath?: string | null;
  expectedUpstreamSha256?: string | null;
  now?: string;
}

const forbiddenToolkitOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafeToolkitOutDir(outDir: string): void {
  for (const root of forbiddenToolkitOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid production toolkit output directory: forbidden root ${root}`);
    }
  }
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function writeTextFile(filePath: string, text: string, kind: ProductionToolkitFile['kind']): Promise<ProductionToolkitFile> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
  return { kind, path: filePath, sha256: sha256Text(text) };
}

function createInstallScript(input: CreateProductionToolkitInput): string {
  const expectedHooks = JSON.stringify(buildExpectedHooksConfig({ prototypeRoot: input.prototypeRoot, auditRoot: input.auditRoot }), null, 2);
  return [
    'param(',
    `  [string]$HooksPath = ${psSingleQuote(input.hooksJsonPath)},`,
    '  [string]$BackupDir = (Join-Path $PSScriptRoot "backups")',
    ')',
    '$ErrorActionPreference = "Stop"',
    'Write-Output "INSTALL-HOOKS: review this script before execution."',
    'New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null',
    '$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"',
    '$backupPath = Join-Path $BackupDir ("hooks.json." + $timestamp + ".bak")',
    'if (Test-Path -LiteralPath $HooksPath) { Copy-Item -LiteralPath $HooksPath -Destination $backupPath -Force }',
    '$expected = @\'',
    expectedHooks,
    '\'@ | ConvertFrom-Json',
    '$current = if (Test-Path -LiteralPath $HooksPath) { Get-Content -LiteralPath $HooksPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ hooks = [pscustomobject]@{} } }',
    'if (-not $current.PSObject.Properties.Name.Contains("hooks")) { $current | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }',
    'foreach ($name in @("UserPromptSubmit","SessionStart","PreToolUse","PermissionRequest","PostToolUse","Stop")) {',
    '  $value = $expected.hooks.$name',
    '  if ($current.hooks.PSObject.Properties.Name.Contains($name)) { $current.hooks.$name = $value } else { $current.hooks | Add-Member -NotePropertyName $name -NotePropertyValue $value }',
    '}',
    '$json = $current | ConvertTo-Json -Depth 32',
    'Set-Content -LiteralPath $HooksPath -Value ($json + [Environment]::NewLine) -Encoding UTF8',
    'Write-Output ("Backup: " + $backupPath)',
    'Write-Output "Next: run VERIFY-INSTALLED.ps1 and trust changed hooks in Codex /hooks."',
    ''
  ].join('\n');
}

function createVerifyScript(input: CreateProductionToolkitInput): string {
  const configArg = input.configTomlPath ? ` --config ${psSingleQuote(input.configTomlPath)}` : '';
  return [
    '$ErrorActionPreference = "Stop"',
    `node ${psSingleQuote(path.join(input.prototypeRoot, 'dist', 'src', 'cli.js'))} verify-installed-hooks --hooks-json ${psSingleQuote(input.hooksJsonPath)} --prototype-root ${psSingleQuote(input.prototypeRoot)} --audit-root ${psSingleQuote(input.auditRoot)}${configArg}`,
    ''
  ].join('\n');
}

function createBootstrapScript(input: CreateProductionToolkitInput): string {
  return [
    'param(',
    '  [Parameter(Mandatory=$true)][string]$ProjectRoot,',
    '  [Parameter(Mandatory=$true)][string]$TaskId,',
    '  [ValidateSet("shape","build","verify","archive")][string]$Phase = "shape"',
    ')',
    '$ErrorActionPreference = "Stop"',
    `$cli = ${psSingleQuote(path.join(input.prototypeRoot, 'dist', 'src', 'cli.js'))}`,
    'node $cli bootstrap-project --root $ProjectRoot --task-id $TaskId --phase $Phase',
    'Write-Output "Bootstrap complete. Start Codex in the project root to activate lifecycle hooks, AGENTS rules, and project policy files."',
    ''
  ].join('\n');
}

function createRollbackScript(input: CreateProductionToolkitInput): string {
  return [
    'param(',
    '  [Parameter(Mandatory=$true)][string]$BackupPath,',
    `  [string]$HooksPath = ${psSingleQuote(input.hooksJsonPath)}`,
    ')',
    '$ErrorActionPreference = "Stop"',
    'Write-Output "Rollback: restoring hooks.json from reviewed backup."',
    'if (-not (Test-Path -LiteralPath $BackupPath)) { throw "missing backup: $BackupPath" }',
    'Copy-Item -LiteralPath $BackupPath -Destination $HooksPath -Force',
    'Write-Output "Rollback complete. Restart/reopen Codex and inspect /hooks."',
    ''
  ].join('\n');
}

function createReadme(input: CreateProductionToolkitInput): string {
  return [
    '# CC-Panes Hook Production Toolkit',
    '',
    'This package installs and verifies the CC-Panes task hook stack:',
    '',
    '- SessionStart: inject task lifecycle context.',
    '- UserPromptSubmit: chain skills-hub routing and CC-Panes plan lifecycle intake.',
    '- PreToolUse: block out-of-bound writes before tool execution.',
    '- PermissionRequest: deny risky escalation requests.',
    '- PostToolUse: append per-task audit JSONL.',
    '- Stop: show a non-blocking completion gate reminder.',
    '',
    '## Files',
    '',
    '- `INSTALL-HOOKS.ps1`: backs up and merges hook entries into hooks.json.',
    '- `VERIFY-INSTALLED.ps1`: runs read-only installed hook verification.',
    '- `BOOTSTRAP-PROJECT.ps1`: runs `bootstrap-project`, which writes `<project>/.ccpanes-task/current-task.json`, injects the managed `AGENTS.md` hook entry, initializes `policy.md` / `policy.json`, and records `bootstrap-report.json`.',
    '- `ROLLBACK-HOOKS.ps1`: restores hooks.json from a captured backup.',
    '',
    '## Required review order',
    '',
    '1. Inspect `manifest.json` and this README.',
    '2. Inspect `INSTALL-HOOKS.ps1` before running it.',
    '3. Run `VERIFY-INSTALLED.ps1`.',
    '4. Open Codex `/hooks`, review changed hooks, and trust them.',
    '5. Bootstrap each project with `BOOTSTRAP-PROJECT.ps1`.',
    '',
    '## Fixed paths',
    '',
    `- prototypeRoot: ${input.prototypeRoot}`,
    `- auditRoot: ${input.auditRoot}`,
    `- hooksJsonPath: ${input.hooksJsonPath}`,
    `- configTomlPath: ${input.configTomlPath ?? 'null'}`,
    `- expectedUpstreamHookPath: ${input.expectedUpstreamHookPath ?? 'null'}`,
    `- expectedUpstreamSha256: ${input.expectedUpstreamSha256 ?? 'null'}`,
    ''
  ].join('\n');
}

export async function createProductionToolkit(input: CreateProductionToolkitInput): Promise<ProductionToolkitManifest> {
  assertSafeToolkitOutDir(input.outDir);
  const now = input.now ?? new Date().toISOString();
  await fs.rm(input.outDir, { recursive: true, force: true });
  await fs.mkdir(input.outDir, { recursive: true });

  const files: ProductionToolkitFile[] = [];
  files.push(await writeTextFile(path.join(input.outDir, 'INSTALL-HOOKS.ps1'), createInstallScript(input), 'install-hooks'));
  files.push(await writeTextFile(path.join(input.outDir, 'VERIFY-INSTALLED.ps1'), createVerifyScript(input), 'verify-installed'));
  files.push(await writeTextFile(path.join(input.outDir, 'BOOTSTRAP-PROJECT.ps1'), createBootstrapScript(input), 'bootstrap-project'));
  files.push(await writeTextFile(path.join(input.outDir, 'ROLLBACK-HOOKS.ps1'), createRollbackScript(input), 'rollback-hooks'));
  files.push(await writeTextFile(path.join(input.outDir, 'PRODUCTION-README.md'), createReadme(input), 'production-readme'));

  const manifestWithoutFile: Omit<ProductionToolkitManifest, 'files'> = {
    schema: 'ccpanes.production-toolkit-manifest.v1',
    mode: 'reviewable-production-toolkit',
    createdAt: now,
    outDir: input.outDir,
    prototypeRoot: input.prototypeRoot,
    auditRoot: input.auditRoot,
    hooksJsonPath: input.hooksJsonPath,
    configTomlPath: input.configTomlPath ?? null,
    expectedUpstreamHook: {
      path: input.expectedUpstreamHookPath ?? null,
      sha256: input.expectedUpstreamSha256 ?? null
    },
    expectedHooks: expectedHookDefinitions().map((definition) => ({
      event: definition.event,
      commandToken: definition.commandToken,
      trustStateKey: definition.trustStateKey
    }))
  };
  const manifest: ProductionToolkitManifest = { ...manifestWithoutFile, files };
  await fs.writeFile(path.join(input.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
