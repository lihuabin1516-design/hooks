import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CCPANES_RUNTIME_PROFILE,
  DEFAULT_LIVE_CONSISTENCY_ROOT_FILES,
  DEFAULT_LIVE_CONSISTENCY_SOURCE_PREFIXES
} from './runtime-profile.js';

export type LiveConsistencyStatus = 'match' | 'mismatch' | 'missing-live' | 'missing-repo';

export interface GitSnapshot {
  path: string;
  isGitRepo: boolean;
  branch: string | null;
  head: string | null;
  statusShort: string;
  trackedFileCount: number;
}

export interface LiveConsistencyFileResult {
  group: 'repo-tracked' | 'dist';
  relativePath: string;
  repoPath: string;
  livePath: string;
  repoSha256: string | null;
  liveSha256: string | null;
  status: LiveConsistencyStatus;
}

export interface LiveConsistencyCheck {
  name: string;
  status: 'pass' | 'fail';
  evidence: string;
}

export interface LiveConsistencySummary {
  sourceCompared: number;
  distCompared: number;
  matches: number;
  mismatches: number;
  missingLive: number;
  missingRepo: number;
}

export interface LiveConsistencyReport {
  schema: 'ccpanes.live-consistency.verify.v1';
  mode: 'read-only';
  checkedAt: string;
  repoRoot: string;
  liveRoot: string;
  sourcePrefixes: string[];
  rootFiles: string[];
  distPrefix: string;
  repoGit: GitSnapshot;
  sourceFiles: LiveConsistencyFileResult[];
  distFiles: LiveConsistencyFileResult[];
  checks: LiveConsistencyCheck[];
  summary: LiveConsistencySummary;
  passed: boolean;
  failures: string[];
}

export interface VerifyLiveConsistencyInput {
  repoRoot?: string | null;
  liveRoot?: string | null;
  sourcePrefixes?: string[];
  rootFiles?: string[];
  distPrefix?: string;
  now?: string;
}

function normalizeRelPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function localPath(root: string, relativePath: string): string {
  return path.join(root, ...normalizeRelPath(relativePath).split('/'));
}

function gitRaw(args: string[], cwd?: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

function gitText(args: string[], cwd?: string): string | null {
  return gitRaw(args, cwd)?.trim() ?? null;
}

function gitListTracked(repoRoot: string): string[] {
  const output = gitRaw(['-C', repoRoot, 'ls-files', '-z']);
  if (output === null) return [];
  return output.split('\0').map((item) => normalizeRelPath(item)).filter(Boolean).sort();
}

function gitSnapshot(repoRoot: string, trackedFileCount: number): GitSnapshot {
  const isGitRepo = gitText(['-C', repoRoot, 'rev-parse', '--is-inside-work-tree']) === 'true';
  return {
    path: repoRoot,
    isGitRepo,
    branch: gitText(['-C', repoRoot, 'branch', '--show-current']),
    head: gitText(['-C', repoRoot, 'rev-parse', 'HEAD']),
    statusShort: gitText(['-C', repoRoot, 'status', '--short']) ?? '',
    trackedFileCount
  };
}

async function sha256FileOrNull(filePath: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await fs.readFile(filePath)).digest('hex').toUpperCase();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function shouldCompareTrackedFile(relativePath: string, sourcePrefixes: string[], rootFiles: string[]): boolean {
  const normalized = normalizeRelPath(relativePath);
  return rootFiles.includes(normalized) || sourcePrefixes.some((prefix) => normalized.startsWith(normalizeRelPath(prefix)));
}

async function collectFilesUnder(root: string, relativePrefix: string): Promise<string[]> {
  const base = localPath(root, relativePrefix);
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        results.push(normalizeRelPath(path.relative(root, absolute)));
      }
    }
  }

  await walk(base);
  return results.sort();
}

async function collectLiveSourceFiles(liveRoot: string, sourcePrefixes: string[], rootFiles: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const prefix of sourcePrefixes) {
    for (const relativePath of await collectFilesUnder(liveRoot, prefix)) files.add(relativePath);
  }
  for (const relativePath of rootFiles) {
    try {
      const stat = await fs.stat(localPath(liveRoot, relativePath));
      if (stat.isFile()) files.add(normalizeRelPath(relativePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return [...files].sort();
}

async function compareRelativeFile(group: LiveConsistencyFileResult['group'], repoRoot: string, liveRoot: string, relativePath: string): Promise<LiveConsistencyFileResult> {
  const repoPath = localPath(repoRoot, relativePath);
  const livePath = localPath(liveRoot, relativePath);
  const [repoSha256, liveSha256] = await Promise.all([sha256FileOrNull(repoPath), sha256FileOrNull(livePath)]);
  let status: LiveConsistencyStatus = 'match';
  if (repoSha256 === null && liveSha256 !== null) status = 'missing-repo';
  else if (repoSha256 !== null && liveSha256 === null) status = 'missing-live';
  else if (repoSha256 !== liveSha256) status = 'mismatch';
  return {
    group,
    relativePath: normalizeRelPath(relativePath),
    repoPath,
    livePath,
    repoSha256,
    liveSha256,
    status
  };
}

async function compareFileSet(group: LiveConsistencyFileResult['group'], repoRoot: string, liveRoot: string, relativePaths: string[]): Promise<LiveConsistencyFileResult[]> {
  const unique = [...new Set(relativePaths.map((item) => normalizeRelPath(item)))].sort();
  return Promise.all(unique.map((relativePath) => compareRelativeFile(group, repoRoot, liveRoot, relativePath)));
}

function addCheck(checks: LiveConsistencyCheck[], failures: string[], name: string, ok: boolean, evidence: string): void {
  checks.push({ name, status: ok ? 'pass' : 'fail', evidence });
  if (!ok) failures.push(`${name}: ${evidence}`);
}

function summarize(files: LiveConsistencyFileResult[]): Omit<LiveConsistencySummary, 'sourceCompared' | 'distCompared'> {
  return {
    matches: files.filter((file) => file.status === 'match').length,
    mismatches: files.filter((file) => file.status === 'mismatch').length,
    missingLive: files.filter((file) => file.status === 'missing-live').length,
    missingRepo: files.filter((file) => file.status === 'missing-repo').length
  };
}

export async function verifyLiveConsistency(input: VerifyLiveConsistencyInput = {}): Promise<LiveConsistencyReport> {
  const repoRoot = input.repoRoot ?? CCPANES_RUNTIME_PROFILE.repoRoot;
  const liveRoot = input.liveRoot ?? CCPANES_RUNTIME_PROFILE.liveRoot;
  const sourcePrefixes = input.sourcePrefixes ?? DEFAULT_LIVE_CONSISTENCY_SOURCE_PREFIXES;
  const rootFiles = input.rootFiles ?? DEFAULT_LIVE_CONSISTENCY_ROOT_FILES;
  const distPrefix = normalizeRelPath(input.distPrefix ?? 'dist/');

  const trackedFiles = gitListTracked(repoRoot);
  const repoGit = gitSnapshot(repoRoot, trackedFiles.length);
  const trackedSourceFiles = trackedFiles.filter((relativePath) => shouldCompareTrackedFile(relativePath, sourcePrefixes, rootFiles));
  const liveSourceFiles = await collectLiveSourceFiles(liveRoot, sourcePrefixes, rootFiles);
  const sourceFiles = await compareFileSet('repo-tracked', repoRoot, liveRoot, [...trackedSourceFiles, ...liveSourceFiles]);

  const [repoDistFiles, liveDistFiles] = await Promise.all([
    collectFilesUnder(repoRoot, distPrefix),
    collectFilesUnder(liveRoot, distPrefix)
  ]);
  const distFiles = await compareFileSet('dist', repoRoot, liveRoot, [...repoDistFiles, ...liveDistFiles]);

  const checks: LiveConsistencyCheck[] = [];
  const failures: string[] = [];
  const sourceSummary = summarize(sourceFiles);
  const distSummary = summarize(distFiles);
  const sourceOk = sourceFiles.length > 0 && sourceSummary.mismatches === 0 && sourceSummary.missingLive === 0 && sourceSummary.missingRepo === 0;
  const distOk = distFiles.length > 0 && distSummary.mismatches === 0 && distSummary.missingLive === 0 && distSummary.missingRepo === 0;

  addCheck(checks, failures, 'repo git readable', repoGit.isGitRepo && trackedFiles.length > 0, `tracked=${trackedFiles.length} head=${repoGit.head ?? 'null'}`);
  addCheck(checks, failures, 'source files match live', sourceOk, `compared=${sourceFiles.length} mismatches=${sourceSummary.mismatches} missingLive=${sourceSummary.missingLive} missingRepo=${sourceSummary.missingRepo}`);
  addCheck(checks, failures, 'dist files match live', distOk, `compared=${distFiles.length} mismatches=${distSummary.mismatches} missingLive=${distSummary.missingLive} missingRepo=${distSummary.missingRepo}`);

  const summary: LiveConsistencySummary = {
    sourceCompared: sourceFiles.length,
    distCompared: distFiles.length,
    matches: sourceSummary.matches + distSummary.matches,
    mismatches: sourceSummary.mismatches + distSummary.mismatches,
    missingLive: sourceSummary.missingLive + distSummary.missingLive,
    missingRepo: sourceSummary.missingRepo + distSummary.missingRepo
  };

  return {
    schema: 'ccpanes.live-consistency.verify.v1',
    mode: 'read-only',
    checkedAt: input.now ?? new Date().toISOString(),
    repoRoot,
    liveRoot,
    sourcePrefixes,
    rootFiles,
    distPrefix,
    repoGit,
    sourceFiles,
    distFiles,
    checks,
    summary,
    passed: failures.length === 0,
    failures
  };
}
