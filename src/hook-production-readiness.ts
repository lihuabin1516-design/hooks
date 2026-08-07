import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, normalizeForComparison } from './paths.js';

export interface HookProductionReadinessCheck {
  name: string;
  result: 'pass' | 'fail';
  evidence: string;
}

export interface HookProductionReadinessReport {
  schema: 'ccpanes.hook-production-readiness.v1';
  mode: 'final-readiness';
  createdAt: string;
  ready: boolean;
  releaseGatePath: string;
  approvalCheckPath: string;
  writePreviewPath: string;
  applyReportPath: string;
  restoreReportPath: string;
  checks: HookProductionReadinessCheck[];
  failures: string[];
}

export interface CreateHookProductionReadinessInput {
  releaseGatePath: string;
  approvalCheckPath: string;
  writePreviewPath: string;
  applyReportPath: string;
  restoreReportPath: string;
  now?: string;
}

const forbiddenReadinessOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await fs.readFile(filePath));
}

function addCheck(checks: HookProductionReadinessCheck[], name: string, ok: boolean, evidence: string): void {
  checks.push({ name, result: ok ? 'pass' : 'fail', evidence });
}

function assertSafeReadinessOutPath(outPath: string): void {
  for (const root of forbiddenReadinessOutRoots) {
    if (isPathInside(root, outPath)) {
      throw new Error(`invalid production readiness output path: forbidden root ${root}`);
    }
  }
}

function normalizeMaybePath(value: unknown): string {
  return typeof value === 'string' ? normalizeForComparison(value) : '';
}

export async function createHookProductionReadiness(input: CreateHookProductionReadinessInput): Promise<HookProductionReadinessReport> {
  const releaseGate = asRecord(JSON.parse(await fs.readFile(input.releaseGatePath, 'utf8')));
  const approvalCheck = asRecord(JSON.parse(await fs.readFile(input.approvalCheckPath, 'utf8')));
  const writePreview = asRecord(JSON.parse(await fs.readFile(input.writePreviewPath, 'utf8')));
  const applyReport = asRecord(JSON.parse(await fs.readFile(input.applyReportPath, 'utf8')));
  const restoreReport = asRecord(JSON.parse(await fs.readFile(input.restoreReportPath, 'utf8')));

  const checks: HookProductionReadinessCheck[] = [];
  addCheck(
    checks,
    'release gate',
    releaseGate.schema === 'ccpanes.hook-release-gate.v1' && releaseGate.mode === 'final-preflight' && releaseGate.passed === true,
    `schema=${String(releaseGate.schema)} mode=${String(releaseGate.mode)} passed=${String(releaseGate.passed)}`
  );
  addCheck(
    checks,
    'approval check',
    approvalCheck.schema === 'ccpanes.hook-approval-check.v1' && approvalCheck.mode === 'approval-preflight' && approvalCheck.passed === true,
    `schema=${String(approvalCheck.schema)} mode=${String(approvalCheck.mode)} passed=${String(approvalCheck.passed)}`
  );
  addCheck(
    checks,
    'write preview',
    writePreview.schema === 'ccpanes.hook-write-preview.v1' && writePreview.mode === 'dry-run-write-preview' && writePreview.approvalCheckPassed === true,
    `schema=${String(writePreview.schema)} mode=${String(writePreview.mode)} approvalCheckPassed=${String(writePreview.approvalCheckPassed)}`
  );
  addCheck(
    checks,
    'synthetic apply',
    applyReport.schema === 'ccpanes.hook-write-apply.v1' && applyReport.mode === 'guarded-apply' && applyReport.passed === true,
    `schema=${String(applyReport.schema)} mode=${String(applyReport.mode)} passed=${String(applyReport.passed)}`
  );
  addCheck(
    checks,
    'synthetic restore',
    restoreReport.schema === 'ccpanes.hook-write-restore.v1' && restoreReport.mode === 'guarded-restore' && restoreReport.passed === true,
    `schema=${String(restoreReport.schema)} mode=${String(restoreReport.mode)} passed=${String(restoreReport.passed)}`
  );

  const snapshots = Array.isArray(releaseGate.configSnapshots) ? releaseGate.configSnapshots.map((snapshot) => asRecord(snapshot)) : [];
  const hashResults: string[] = [];
  let configHashesPass = snapshots.length > 0;
  for (const snapshot of snapshots) {
    const configPath = typeof snapshot.path === 'string' ? snapshot.path : '';
    const expected = typeof snapshot.sha256 === 'string' ? snapshot.sha256.toUpperCase() : '';
    let actual = '';
    try {
      actual = await sha256File(configPath);
    } catch {
      actual = '';
    }
    const matched = actual.length > 0 && expected.length > 0 && actual === expected;
    hashResults.push(`${configPath || 'missing'}=${matched ? 'match' : 'mismatch'}`);
    configHashesPass = configHashesPass && matched;
  }
  addCheck(checks, 'config current hashes', configHashesPass, hashResults.join(', ') || 'none');

  const repos = Array.isArray(releaseGate.referenceRepos) ? releaseGate.referenceRepos.map((repo) => asRecord(repo)) : [];
  const reposPass = repos.length > 0 && repos.every((repo) => repo.status === 'clean');
  addCheck(checks, 'reference repos', reposPass, repos.map((repo) => `${String(repo.path)}=${String(repo.status)}`).join(', ') || 'none');

  const chainPass =
    normalizeMaybePath(writePreview.approvalCheckPath) === normalizeForComparison(input.approvalCheckPath) &&
    Array.isArray(writePreview.entries) &&
    Array.isArray(applyReport.entries) &&
    Array.isArray(restoreReport.entries) &&
    writePreview.entries.length > 0 &&
    applyReport.entries.length > 0 &&
    restoreReport.entries.length > 0;
  addCheck(checks, 'artifact chain', chainPass, `writePreview.approvalCheckPath=${String(writePreview.approvalCheckPath)}`);

  const failures = checks.filter((check) => check.result === 'fail').map((check) => `${check.name}: ${check.evidence}`);
  return {
    schema: 'ccpanes.hook-production-readiness.v1',
    mode: 'final-readiness',
    createdAt: input.now ?? new Date().toISOString(),
    ready: failures.length === 0,
    releaseGatePath: input.releaseGatePath,
    approvalCheckPath: input.approvalCheckPath,
    writePreviewPath: input.writePreviewPath,
    applyReportPath: input.applyReportPath,
    restoreReportPath: input.restoreReportPath,
    checks,
    failures
  };
}

export async function writeHookProductionReadinessAtomic(outPath: string, report: HookProductionReadinessReport): Promise<void> {
  assertSafeReadinessOutPath(outPath);
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}

