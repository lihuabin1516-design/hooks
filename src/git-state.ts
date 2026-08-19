import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeForComparison } from './paths.js';
import type { GitState, GitTopology } from './types.js';

export class GitTopologyError extends Error {
  readonly code = 'git_topology_probe_failed';
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function hasGitMarkerAtOrAbove(cwd: string): boolean {
  const ceilings = new Set(
    (process.env.GIT_CEILING_DIRECTORIES ?? '')
      .split(path.delimiter)
      .filter((entry) => entry.length > 0)
      .map(normalizeForComparison)
  );
  let current = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    if (ceilings.has(normalizeForComparison(current))) return false;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function isBareRepository(cwd: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-bare-repository'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() === 'true';
  } catch {
    return false;
  }
}

function topologyGit(args: string[], cwd: string, allowNotGit: boolean): string | null {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!output) {
      throw new Error('empty Git topology output');
    }
    return output;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number };
    if (
      allowNotGit &&
      failure.status === 128 &&
      !hasGitMarkerAtOrAbove(cwd) &&
      !isBareRepository(cwd)
    ) {
      return null;
    }
    throw new GitTopologyError(
      'failed to read Git topology safely',
      { cause: error }
    );
  }
}

function readMainWorktreeFromInventory(cwd: string): string | null {
  const inventory = topologyGit(['worktree', 'list', '--porcelain'], cwd, false);
  const firstWorktree = inventory
    ?.split(/\r?\n/)
    .find((line) => line.startsWith('worktree '))
    ?.slice('worktree '.length);
  return firstWorktree ? path.resolve(firstWorktree) : null;
}

export function readGitTopology(cwd: string): GitTopology | null {
  const worktreeRoot = topologyGit(['rev-parse', '--show-toplevel'], cwd, true);
  if (!worktreeRoot) return null;
  const commonDir = topologyGit(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    cwd,
    false
  );
  const gitDir = topologyGit(
    ['rev-parse', '--path-format=absolute', '--git-dir'],
    cwd,
    false
  );
  if (!commonDir) {
    throw new Error('failed to read Git topology safely');
  }
  if (!gitDir) {
    throw new Error('failed to read Git topology safely');
  }

  const resolvedWorktreeRoot = path.resolve(worktreeRoot);
  const resolvedCommonDir = path.resolve(commonDir);
  const resolvedGitDir = path.resolve(gitDir);
  const inferredMainRepoRoot = path.basename(resolvedCommonDir).toLowerCase() === '.git'
    ? path.dirname(resolvedCommonDir)
    : null;
  const inventoryMainWorktree = readMainWorktreeFromInventory(cwd);
  const currentCheckoutUsesCommonDir =
    normalizeForComparison(resolvedGitDir) === normalizeForComparison(resolvedCommonDir);
  const inventoryMatchesCurrentMainCheckout =
    !currentCheckoutUsesCommonDir ||
    (
      inventoryMainWorktree !== null &&
      normalizeForComparison(inventoryMainWorktree) === normalizeForComparison(resolvedWorktreeRoot)
    );
  const mainRepoRoot = inferredMainRepoRoot &&
    inventoryMainWorktree &&
    inventoryMatchesCurrentMainCheckout &&
    normalizeForComparison(inferredMainRepoRoot) === normalizeForComparison(inventoryMainWorktree)
    ? inventoryMainWorktree
    : null;

  return {
    worktreeRoot: resolvedWorktreeRoot,
    commonDir: resolvedCommonDir,
    mainRepoRoot
  };
}

export function readGitState(cwd: string): GitState {
  const root = readGitTopology(cwd)?.worktreeRoot ?? null;
  if (!root) {
    return { root: null, branch: null, head: null, dirty: false, statusShort: '' };
  }
  const branch = git(['branch', '--show-current'], cwd);
  const head = git(['rev-parse', 'HEAD'], cwd);
  const statusShort = git(['status', '--short'], cwd) ?? '';
  return { root, branch, head, dirty: statusShort.length > 0, statusShort };
}
