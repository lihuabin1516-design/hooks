import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface RuntimeIdentity {
  schema: 'paneforge.runtime-identity.v1';
  packageName: string;
  packageVersion: string;
  gitCommit: string | null;
  gitDirty: boolean | null;
  buildSha256: string | null;
  builtAt: string | null;
  source: 'build-manifest' | 'unavailable';
}

export interface RuntimeTaskHeadComparison {
  expectedTaskHead: string | null;
  runtimeGitCommit: string | null;
  status: 'match' | 'mismatch' | 'unknown';
  reason: 'runtime_commit_matches_task_head' | 'runtime_commit_does_not_match_task_head' | 'runtime_commit_unavailable' | 'task_head_unavailable';
}

export interface RuntimeIdentityReport {
  schema: 'paneforge.runtime-identity-report.v1';
  runtimeIdentity: RuntimeIdentity;
  taskHeadComparison: RuntimeTaskHeadComparison;
  process: {
    pid: number;
    execPath: string;
    startedAt: string;
  };
}

const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const defaultManifestPath = fileURLToPath(new URL('./runtime-identity.json', import.meta.url));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid runtime identity: ${key}`);
  return value;
}

export function validateRuntimeIdentity(value: unknown): RuntimeIdentity {
  const record = asRecord(value);
  if (record.schema !== 'paneforge.runtime-identity.v1') throw new Error('invalid runtime identity: schema');
  if (typeof record.packageName !== 'string' || record.packageName.length === 0) throw new Error('invalid runtime identity: packageName');
  if (typeof record.packageVersion !== 'string' || record.packageVersion.length === 0) throw new Error('invalid runtime identity: packageVersion');
  const gitCommit = nullableString(record, 'gitCommit');
  const buildSha256 = nullableString(record, 'buildSha256');
  const builtAt = nullableString(record, 'builtAt');
  if (record.gitDirty !== null && typeof record.gitDirty !== 'boolean') throw new Error('invalid runtime identity: gitDirty');
  if (record.source !== 'build-manifest' && record.source !== 'unavailable') throw new Error('invalid runtime identity: source');
  if (buildSha256 !== null && !/^[A-Fa-f0-9]{64}$/.test(buildSha256)) throw new Error('invalid runtime identity: buildSha256');
  if (gitCommit !== null && !/^[A-Fa-f0-9]{6,64}$/.test(gitCommit)) throw new Error('invalid runtime identity: gitCommit');
  return {
    schema: 'paneforge.runtime-identity.v1',
    packageName: record.packageName,
    packageVersion: record.packageVersion,
    gitCommit,
    gitDirty: record.gitDirty,
    buildSha256: buildSha256?.toUpperCase() ?? null,
    builtAt,
    source: record.source
  };
}

export async function loadRuntimeIdentity(manifestPath = defaultManifestPath): Promise<RuntimeIdentity> {
  return validateRuntimeIdentity(JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')));
}

export function unavailableRuntimeIdentity(): RuntimeIdentity {
  return {
    schema: 'paneforge.runtime-identity.v1',
    packageName: 'paneforge-hooks-tooling',
    packageVersion: '0.1.0',
    gitCommit: null,
    gitDirty: null,
    buildSha256: null,
    builtAt: null,
    source: 'unavailable'
  };
}

export function getRuntimeIdentity(manifestPath = defaultManifestPath): RuntimeIdentity {
  try {
    return validateRuntimeIdentity(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch {
    return unavailableRuntimeIdentity();
  }
}

export function compareRuntimeIdentityToTaskHead(identity: RuntimeIdentity, taskHead: string | null): RuntimeTaskHeadComparison {
  if (!identity.gitCommit) {
    return { expectedTaskHead: taskHead, runtimeGitCommit: null, status: 'unknown', reason: 'runtime_commit_unavailable' };
  }
  if (!taskHead) {
    return { expectedTaskHead: null, runtimeGitCommit: identity.gitCommit, status: 'unknown', reason: 'task_head_unavailable' };
  }
  const matches = identity.gitCommit.toLowerCase() === taskHead.toLowerCase();
  return {
    expectedTaskHead: taskHead,
    runtimeGitCommit: identity.gitCommit,
    status: matches ? 'match' : 'mismatch',
    reason: matches ? 'runtime_commit_matches_task_head' : 'runtime_commit_does_not_match_task_head'
  };
}

export function createRuntimeIdentityReport(identity = getRuntimeIdentity(), expectedTaskHead: string | null = null): RuntimeIdentityReport {
  return {
    schema: 'paneforge.runtime-identity-report.v1',
    runtimeIdentity: identity,
    taskHeadComparison: compareRuntimeIdentityToTaskHead(identity, expectedTaskHead),
    process: { pid: process.pid, execPath: process.execPath, startedAt: processStartedAt }
  };
}
