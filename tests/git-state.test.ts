import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readGitTopology } from '../src/git-state.js';

let tempRoot: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function withoutParentGit<T>(root: string, action: () => T): T {
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = root;
  try {
    return action();
  } finally {
    if (previous === undefined) {
      delete process.env.GIT_CEILING_DIRECTORIES;
    } else {
      process.env.GIT_CEILING_DIRECTORIES = previous;
    }
  }
}

async function initGitRepo(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Phase51 Fixture'], root);
  git(['config', 'user.email', 'phase51@example.invalid'], root);
  await fs.writeFile(path.join(root, 'README.md'), '# fixture\n', 'utf8');
  git(['add', 'README.md'], root);
  git(['commit', '-m', 'fixture'], root);
}

async function initSeparateGitDirRepo(root: string, gitDir: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  git(['init', '--separate-git-dir', gitDir, root], tempRoot);
  git(['config', 'user.name', 'Phase51 Fixture'], root);
  git(['config', 'user.email', 'phase51@example.invalid'], root);
  await fs.writeFile(path.join(root, 'README.md'), '# separate fixture\n', 'utf8');
  git(['add', 'README.md'], root);
  git(['commit', '-m', 'separate fixture'], root);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-git-state-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('readGitTopology', () => {
  test('derives the main worktree from a linked worktree common dir', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    const linkedRoot = path.join(tempRoot, 'hooks-linked');
    await initGitRepo(mainRoot);
    git(['worktree', 'add', '-b', 'phase51-linked', linkedRoot], mainRoot);

    expect(readGitTopology(linkedRoot)).toEqual({
      worktreeRoot: linkedRoot,
      commonDir: path.join(mainRoot, '.git'),
      mainRepoRoot: mainRoot
    });
  });

  test('uses the main worktree as the canonical project', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    await initGitRepo(mainRoot);

    expect(readGitTopology(mainRoot)).toEqual({
      worktreeRoot: mainRoot,
      commonDir: path.join(mainRoot, '.git'),
      mainRepoRoot: mainRoot
    });
  });

  test('returns null outside Git', () => {
    expect(withoutParentGit(os.tmpdir(), () => readGitTopology(tempRoot))).toBeNull();
  });

  test('preserves a Git root when the main worktree cannot be derived', async () => {
    const worktreeRoot = path.join(tempRoot, 'separate-worktree');
    const gitDir = path.join(tempRoot, 'separate-git-dir');
    await initSeparateGitDirRepo(worktreeRoot, gitDir);

    expect(readGitTopology(worktreeRoot)).toEqual({
      worktreeRoot,
      commonDir: gitDir,
      mainRepoRoot: null
    });
  });

  test('does not infer a canonical worktree from an arbitrary separate git dir named .git', async () => {
    const worktreeRoot = path.join(tempRoot, 'separate-worktree');
    const gitStorageRoot = path.join(tempRoot, 'git-storage');
    const gitDir = path.join(gitStorageRoot, '.git');
    await fs.mkdir(gitStorageRoot, { recursive: true });
    await initSeparateGitDirRepo(worktreeRoot, gitDir);

    expect(readGitTopology(worktreeRoot)).toEqual({
      worktreeRoot,
      commonDir: gitDir,
      mainRepoRoot: null
    });
  });

  test('fails explicitly when a Git marker exists but topology cannot be read', async () => {
    const brokenRoot = path.join(tempRoot, 'broken-worktree');
    await fs.mkdir(brokenRoot, { recursive: true });
    await fs.writeFile(path.join(brokenRoot, '.git'), 'gitdir: missing-git-dir\n', 'utf8');

    expect(() => readGitTopology(brokenRoot))
      .toThrow('failed to read Git topology safely');
  });

  test('fails explicitly for a bare repository instead of treating it as non-Git', () => {
    const bareRoot = path.join(tempRoot, 'bare.git');
    git(['init', '--bare', bareRoot], tempRoot);

    expect(() => readGitTopology(bareRoot))
      .toThrow('failed to read Git topology safely');
  });
});
