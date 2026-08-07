import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';

export interface HookApproval {
  schema: 'ccpanes.hook-approval.v1';
  approved: boolean;
  applyPlanSha256: string;
  releaseGateSha256: string;
  targetConfigPaths: string[];
  expectedConfigSha256ByPath: Record<string, string>;
  backupDir: string;
  rollbackCommand: string;
  writeWindow: {
    startsAt: string;
    endsAt: string;
  };
}

export interface HookApprovalCheck {
  name: string;
  result: 'pass' | 'fail';
  evidence: string;
}

export interface HookApprovalConfigSnapshot {
  path: string;
  exists: boolean;
  sha256: string | null;
  expectedSha256: string | null;
}

export interface HookApprovalCheckReport {
  schema: 'ccpanes.hook-approval-check.v1';
  mode: 'approval-preflight';
  createdAt: string;
  applyPlanPath: string;
  passed: boolean;
  configSnapshots: HookApprovalConfigSnapshot[];
  checks: HookApprovalCheck[];
  failures: string[];
}

export interface CheckHookApprovalInput {
  applyPlanPath: string;
  approval: unknown;
  now?: string;
}

const forbiddenApprovalOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await fs.readFile(filePath));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function readApproval(value: unknown): HookApproval {
  const record = asRecord(value);
  const window = asRecord(record.writeWindow);
  return {
    schema: record.schema as HookApproval['schema'],
    approved: record.approved === true,
    applyPlanSha256: typeof record.applyPlanSha256 === 'string' ? record.applyPlanSha256 : '',
    releaseGateSha256: typeof record.releaseGateSha256 === 'string' ? record.releaseGateSha256 : '',
    targetConfigPaths: Array.isArray(record.targetConfigPaths) ? record.targetConfigPaths.filter((item): item is string => typeof item === 'string') : [],
    expectedConfigSha256ByPath: asRecord(record.expectedConfigSha256ByPath) as Record<string, string>,
    backupDir: typeof record.backupDir === 'string' ? record.backupDir : '',
    rollbackCommand: typeof record.rollbackCommand === 'string' ? record.rollbackCommand : '',
    writeWindow: {
      startsAt: typeof window.startsAt === 'string' ? window.startsAt : '',
      endsAt: typeof window.endsAt === 'string' ? window.endsAt : ''
    }
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function addCheck(checks: HookApprovalCheck[], name: string, ok: boolean, evidence: string): void {
  checks.push({ name, result: ok ? 'pass' : 'fail', evidence });
}

function isNowInWindow(now: string, startsAt: string, endsAt: string): boolean {
  const current = Date.parse(now);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return Number.isFinite(current) && Number.isFinite(start) && Number.isFinite(end) && start <= current && current <= end;
}

export async function checkHookApproval(input: CheckHookApprovalInput): Promise<HookApprovalCheckReport> {
  const now = input.now ?? new Date().toISOString();
  const approval = readApproval(input.approval);
  const applyPlanText = await fs.readFile(input.applyPlanPath, 'utf8');
  const applyPlan = asRecord(JSON.parse(applyPlanText));
  const checks: HookApprovalCheck[] = [];
  const failures: string[] = [];

  addCheck(checks, 'approval schema', approval.schema === 'ccpanes.hook-approval.v1', `schema=${approval.schema}`);
  addCheck(checks, 'approval intent', approval.approved === true, `approved=${approval.approved}`);

  const actualApplyPlanSha256 = sha256Buffer(Buffer.from(applyPlanText, 'utf8'));
  addCheck(checks, 'apply plan hash', actualApplyPlanSha256 === approval.applyPlanSha256.toUpperCase(), `actual=${actualApplyPlanSha256} expected=${approval.applyPlanSha256}`);

  const releaseGatePath = typeof applyPlan.releaseGatePath === 'string' ? applyPlan.releaseGatePath : '';
  let actualReleaseGateSha256 = '';
  try {
    actualReleaseGateSha256 = await sha256File(releaseGatePath);
  } catch {
    actualReleaseGateSha256 = '';
  }
  addCheck(checks, 'release gate hash', actualReleaseGateSha256 === approval.releaseGateSha256.toUpperCase(), `actual=${actualReleaseGateSha256 || 'missing'} expected=${approval.releaseGateSha256}`);

  const applyPlanTargets = Array.isArray(applyPlan.targetConfigPaths) ? applyPlan.targetConfigPaths.filter((item): item is string => typeof item === 'string') : [];
  addCheck(checks, 'target config paths', sameStringSet(applyPlanTargets, approval.targetConfigPaths), `applyPlan=${applyPlanTargets.join(',')} approval=${approval.targetConfigPaths.join(',')}`);

  const configSnapshots: HookApprovalConfigSnapshot[] = [];
  let configHashesPass = approval.targetConfigPaths.length > 0;
  for (const configPath of approval.targetConfigPaths) {
    const expected = approval.expectedConfigSha256ByPath[configPath] ?? null;
    let actual: string | null = null;
    let exists = false;
    try {
      actual = await sha256File(configPath);
      exists = true;
    } catch {
      exists = false;
    }
    configSnapshots.push({ path: configPath, exists, sha256: actual, expectedSha256: expected });
    configHashesPass = configHashesPass && Boolean(actual && expected && actual === expected.toUpperCase());
  }
  addCheck(checks, 'config hashes', configHashesPass, configSnapshots.map((snapshot) => `${snapshot.path}=${snapshot.sha256 === snapshot.expectedSha256 ? 'match' : 'mismatch'}`).join(', '));

  addCheck(checks, 'backup directory', approval.backupDir.length > 0, approval.backupDir || 'missing');
  const artifacts = Array.isArray(applyPlan.artifacts) ? applyPlan.artifacts.map((artifact) => asRecord(artifact)) : [];
  const rollbackArtifact = artifacts.find((artifact) => artifact.kind === 'rollback-script' && typeof artifact.path === 'string');
  const rollbackExpected = typeof rollbackArtifact?.path === 'string' ? rollbackArtifact.path : '';
  addCheck(checks, 'rollback command', approval.rollbackCommand === rollbackExpected, `approval=${approval.rollbackCommand} expected=${rollbackExpected}`);
  addCheck(checks, 'write window', isNowInWindow(now, approval.writeWindow.startsAt, approval.writeWindow.endsAt), `${approval.writeWindow.startsAt}..${approval.writeWindow.endsAt} now=${now}`);

  for (const check of checks) {
    if (check.result === 'fail') failures.push(`${check.name}: ${check.evidence}`);
  }

  return {
    schema: 'ccpanes.hook-approval-check.v1',
    mode: 'approval-preflight',
    createdAt: now,
    applyPlanPath: input.applyPlanPath,
    passed: failures.length === 0,
    configSnapshots,
    checks,
    failures
  };
}

function assertSafeApprovalOutPath(outPath: string): void {
  for (const root of forbiddenApprovalOutRoots) {
    if (isPathInside(root, outPath)) {
      throw new Error(`invalid hook approval check output path: forbidden root ${root}`);
    }
  }
}

export async function writeHookApprovalCheckAtomic(outPath: string, report: HookApprovalCheckReport): Promise<void> {
  assertSafeApprovalOutPath(outPath);
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}
