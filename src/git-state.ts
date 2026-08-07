import { execFileSync } from 'node:child_process';
import type { GitState } from './types.js';

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function readGitState(cwd: string): GitState {
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  if (!root) {
    return { root: null, branch: null, head: null, dirty: false, statusShort: '' };
  }
  const branch = git(['branch', '--show-current'], cwd);
  const head = git(['rev-parse', 'HEAD'], cwd);
  const statusShort = git(['status', '--short'], cwd) ?? '';
  return { root, branch, head, dirty: statusShort.length > 0, statusShort };
}