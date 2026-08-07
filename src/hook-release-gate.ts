import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rehearseHookPackage, type HookPackageRehearsalReport } from './hook-package-rehearsal.js';
import { isPathInside } from './paths.js';

export interface ReleaseGateCheck {
  name: string;
  result: 'pass' | 'fail';
  evidence: string;
}

export interface ConfigSnapshot {
  path: string;
  exists: boolean;
  size: number | null;
  lastWriteUtc: string | null;
  sha256: string | null;
}

export interface ReferenceRepoStatus {
  path: string;
  isGitRepo: boolean;
  head: string | null;
  status: 'clean' | 'dirty' | 'missing' | 'not-git';
  statusShort: string;
}

export interface VerificationCheckInput {
  name: string;
  result: 'pass' | 'fail' | 'blocked' | 'not-run';
  evidence: string;
}

export interface HookReleaseGateReport {
  schema: 'ccpanes.hook-release-gate.v1';
  mode: 'final-preflight';
  createdAt: string;
  packageDir: string;
  passed: boolean;
  packageRehearsal: HookPackageRehearsalReport;
  configSnapshots: ConfigSnapshot[];
  referenceRepos: ReferenceRepoStatus[];
  verificationChecks: VerificationCheckInput[];
  checks: ReleaseGateCheck[];
  failures: string[];
}

export interface CreateHookReleaseGateInput {
  packageDir: string;
  expectedUpstreamSha256?: string | null;
  configPaths: string[];
  referenceRepoPaths: string[];
  verificationChecks: VerificationCheckInput[];
  now?: string;
}

const forbiddenReleaseGateOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function addCheck(checks: ReleaseGateCheck[], name: string, ok: boolean, evidence: string): void {
  checks.push({ name, result: ok ? 'pass' : 'fail', evidence });
}

async function readConfigSnapshot(configPath: string): Promise<ConfigSnapshot> {
  try {
    const stat = await fs.stat(configPath);
    const bytes = await fs.readFile(configPath);
    return {
      path: configPath,
      exists: true,
      size: stat.size,
      lastWriteUtc: stat.mtime.toISOString(),
      sha256: sha256Buffer(bytes)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: configPath, exists: false, size: null, lastWriteUtc: null, sha256: null };
    }
    throw error;
  }
}

function readReferenceRepoStatus(repoPath: string): ReferenceRepoStatus {
  try {
    const statusShort = execFileSync('git', ['-C', repoPath, 'status', '--short'], { encoding: 'utf8' }).trim();
    let head: string | null = null;
    try {
      head = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      head = null;
    }
    return {
      path: repoPath,
      isGitRepo: true,
      head,
      status: statusShort.length === 0 ? 'clean' : 'dirty',
      statusShort
    };
  } catch (error) {
    return {
      path: repoPath,
      isGitRepo: false,
      head: null,
      status: 'not-git',
      statusShort: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function createHookReleaseGate(input: CreateHookReleaseGateInput): Promise<HookReleaseGateReport> {
  const packageRehearsal = await rehearseHookPackage({
    packageDir: input.packageDir,
    expectedUpstreamSha256: input.expectedUpstreamSha256,
    now: input.now
  });
  const configSnapshots = await Promise.all(input.configPaths.map((configPath) => readConfigSnapshot(configPath)));
  const referenceRepos = input.referenceRepoPaths.map((repoPath) => readReferenceRepoStatus(repoPath));

  const checks: ReleaseGateCheck[] = [];
  addCheck(checks, 'package rehearsal', packageRehearsal.passed, `failures=${packageRehearsal.failures.length}`);
  addCheck(checks, 'config snapshots', configSnapshots.every((snapshot) => snapshot.exists && Boolean(snapshot.sha256)), `count=${configSnapshots.length}`);
  addCheck(checks, 'reference repos clean', referenceRepos.every((repo) => repo.status === 'clean'), referenceRepos.map((repo) => `${repo.path}=${repo.status}`).join(', '));
  addCheck(checks, 'verification checks', input.verificationChecks.length > 0 && input.verificationChecks.every((check) => check.result === 'pass'), input.verificationChecks.map((check) => `${check.name}=${check.result}`).join(', ') || 'none');

  const failures: string[] = [...packageRehearsal.failures];
  for (const check of checks) {
    if (check.result === 'fail') failures.push(`${check.name}: ${check.evidence}`);
  }

  return {
    schema: 'ccpanes.hook-release-gate.v1',
    mode: 'final-preflight',
    createdAt: input.now ?? new Date().toISOString(),
    packageDir: input.packageDir,
    passed: failures.length === 0,
    packageRehearsal,
    configSnapshots,
    referenceRepos,
    verificationChecks: input.verificationChecks,
    checks,
    failures
  };
}

function assertSafeReleaseGateOutPath(outPath: string): void {
  for (const root of forbiddenReleaseGateOutRoots) {
    if (isPathInside(root, outPath)) {
      throw new Error(`invalid hook release gate output path: forbidden root ${root}`);
    }
  }
}

export async function writeHookReleaseGateAtomic(outPath: string, report: HookReleaseGateReport): Promise<void> {
  assertSafeReleaseGateOutPath(outPath);
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}
