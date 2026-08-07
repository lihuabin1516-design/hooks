import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookPackageRehearsalCheck {
  name: string;
  result: 'pass' | 'fail';
  evidence: string;
}

export interface HookPackageRehearsalReport {
  schema: 'ccpanes.hook-package-rehearsal.v1';
  mode: 'dry-run-rehearsal';
  createdAt: string;
  packageDir: string;
  passed: boolean;
  checks: HookPackageRehearsalCheck[];
  failures: string[];
}

export interface RehearseHookPackageInput {
  packageDir: string;
  expectedUpstreamSha256?: string | null;
  now?: string;
}

const forbiddenReportOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function addCheck(checks: HookPackageRehearsalCheck[], name: string, ok: boolean, evidence: string): void {
  checks.push({ name, result: ok ? 'pass' : 'fail', evidence });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function rehearseHookPackage(input: RehearseHookPackageInput): Promise<HookPackageRehearsalReport> {
  const checks: HookPackageRehearsalCheck[] = [];
  const failures: string[] = [];
  const manifestPath = path.join(input.packageDir, 'manifest.json');

  let manifest: Record<string, unknown> = {};
  try {
    manifest = asRecord(await readJson(manifestPath));
    addCheck(checks, 'manifest schema', manifest.schema === 'ccpanes.hook-package-manifest.v1' && manifest.mode === 'review-only', `manifest=${manifestPath}`);
  } catch (error) {
    addCheck(checks, 'manifest schema', false, error instanceof Error ? error.message : String(error));
  }

  const files = Array.isArray(manifest.files) ? manifest.files.map((file) => asRecord(file)) : [];
  let fileHashesPass = files.length > 0;
  const hashEvidence: string[] = [];
  for (const file of files) {
    const filePath = typeof file.path === 'string' ? file.path : '';
    const expected = typeof file.sha256 === 'string' ? file.sha256 : '';
    try {
      const text = await fs.readFile(filePath, 'utf8');
      const actual = sha256Text(text);
      const ok = actual === expected;
      fileHashesPass = fileHashesPass && ok;
      hashEvidence.push(`${path.basename(filePath)}=${ok ? 'match' : 'mismatch'}`);
    } catch (error) {
      fileHashesPass = false;
      hashEvidence.push(`${filePath}=missing`);
    }
  }
  addCheck(checks, 'file hashes', fileHashesPass, hashEvidence.join(', ') || 'no files');

  let installPlan: Record<string, unknown> = {};
  try {
    installPlan = asRecord(await readJson(path.join(input.packageDir, 'install-plan.json')));
    addCheck(checks, 'install plan schema', installPlan.schema === 'ccpanes.hook-install-plan.v1' && installPlan.mode === 'review-only', 'install-plan.json');
  } catch (error) {
    addCheck(checks, 'install plan schema', false, error instanceof Error ? error.message : String(error));
  }

  try {
    const rollbackPlan = asRecord(await readJson(path.join(input.packageDir, 'rollback-plan.json')));
    addCheck(checks, 'rollback plan schema', rollbackPlan.schema === 'ccpanes.hook-rollback-plan.v1' && rollbackPlan.mode === 'manual-rollback', 'rollback-plan.json');
  } catch (error) {
    addCheck(checks, 'rollback plan schema', false, error instanceof Error ? error.message : String(error));
  }

  const proposed = Array.isArray(installPlan.proposedConfigChanges) ? installPlan.proposedConfigChanges.map((change) => asRecord(change)) : [];
  let patchesPass = proposed.length > 0;
  const patchEvidence: string[] = [];
  for (const change of proposed) {
    const surface = typeof change.surface === 'string' ? change.surface : 'unknown';
    const patchPath = path.join(input.packageDir, 'patches', `${surface}.patch`);
    try {
      const patch = await fs.readFile(patchPath, 'utf8');
      const ok = patch.includes('hook-shadow') && patch.includes('mode = "shadow"');
      patchesPass = patchesPass && ok;
      patchEvidence.push(`${surface}=${ok ? 'ok' : 'invalid'}`);
    } catch {
      patchesPass = false;
      patchEvidence.push(`${surface}=missing`);
    }
  }
  addCheck(checks, 'patch candidates', patchesPass, patchEvidence.join(', ') || 'no patches');

  const manifestUpstreamHash = typeof manifest.upstreamHookSha256 === 'string' ? manifest.upstreamHookSha256 : null;
  const expected = input.expectedUpstreamSha256 ?? manifestUpstreamHash;
  const upstreamPass = Boolean(manifestUpstreamHash && expected && manifestUpstreamHash.toUpperCase() === expected.toUpperCase());
  addCheck(checks, 'upstream hash', upstreamPass, `manifest=${manifestUpstreamHash ?? 'missing'} expected=${expected ?? 'missing'}`);

  for (const check of checks) {
    if (check.result === 'fail') failures.push(`${check.name}: ${check.evidence}`);
  }

  return {
    schema: 'ccpanes.hook-package-rehearsal.v1',
    mode: 'dry-run-rehearsal',
    createdAt: input.now ?? new Date().toISOString(),
    packageDir: input.packageDir,
    passed: failures.length === 0,
    checks,
    failures
  };
}

function assertSafeReportOutPath(outPath: string): void {
  for (const root of forbiddenReportOutRoots) {
    if (isPathInside(root, outPath)) {
      throw new Error(`invalid hook package rehearsal output path: forbidden root ${root}`);
    }
  }
}

export async function writeHookPackageRehearsalAtomic(outPath: string, report: HookPackageRehearsalReport): Promise<void> {
  assertSafeReportOutPath(outPath);
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}
