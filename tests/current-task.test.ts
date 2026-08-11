import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createCurrentTask,
  currentTaskPath,
  inspectCurrentTaskBindingFromCwd,
  readCurrentTask,
  resolveCurrentTaskFromCwd,
  validateCurrentTask,
  writeCurrentTaskAtomic
} from '../src/current-task.js';
import type { CurrentTask } from '../src/types.js';

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

async function writeTaskFileUnchecked(root: string, task: CurrentTask): Promise<void> {
  await fs.mkdir(path.join(root, '.ccpanes-task'), { recursive: true });
  await fs.writeFile(currentTaskPath(root), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
}

function validTask(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: { leaderSessionId: 'leader-1', paneId: 'pane-1', layoutId: 'layout-1' },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'leader',
    notes: 'synthetic fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-task-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('current-task persistence', () => {
  test('uses .ccpanes-task/current-task.json below the worktree root', () => {
    expect(currentTaskPath(tempRoot)).toBe(path.join(tempRoot, '.ccpanes-task', 'current-task.json'));
  });

  test('writes and reads a valid current task atomically', async () => {
    const task = validTask(tempRoot);
    await writeCurrentTaskAtomic(tempRoot, task);
    await expect(readCurrentTask(tempRoot)).resolves.toEqual(task);
  });

  test('returns null when current-task.json is absent', async () => {
    await expect(readCurrentTask(tempRoot)).resolves.toBeNull();
  });

  test('rejects oversized current-task.json files', async () => {
    await fs.mkdir(path.join(tempRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(currentTaskPath(tempRoot), 'x'.repeat(17 * 1024), 'utf8');
    await expect(readCurrentTask(tempRoot)).rejects.toThrow('current-task.json exceeds 16384 bytes');
  });

  test('rejects invalid schema values', async () => {
    await fs.mkdir(path.join(tempRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(currentTaskPath(tempRoot), JSON.stringify({ schema: 'wrong' }), 'utf8');
    await expect(readCurrentTask(tempRoot)).rejects.toThrow('invalid current task: schema');
  });

  test.each([
    ['projectPath', { projectPath: '.' }],
    ['worktreeRoot', { worktreeRoot: '.' }],
    ['mainRepoRoot', { mainRepoRoot: '' }],
    ['mainRepoRoot', { mainRepoRoot: '.' }],
    ['projectPath', { projectPath: `${tempRoot}${path.sep}nested${path.sep}..` }]
  ])('rejects non-canonical task binding path in %s', (field, override) => {
    expect(() => validateCurrentTask({
      ...validTask(tempRoot),
      ...override
    })).toThrow(`invalid current task: ${field} must be a canonical absolute path`);
  });

  test('creates linked-worktree metadata with a canonical project root', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    const linkedRoot = path.join(tempRoot, 'hooks-linked');
    await initGitRepo(mainRoot);
    git(['worktree', 'add', '-b', 'phase51-linked', linkedRoot], mainRoot);

    const task = createCurrentTask({
      root: linkedRoot,
      taskId: 'phase51',
      phase: 'shape',
      now: '2026-08-10T00:00:00.000Z'
    });

    expect(task.projectPath).toBe(mainRoot);
    expect(task.mainRepoRoot).toBe(mainRoot);
    expect(task.worktreeRoot).toBe(linkedRoot);
    expect(task.branch).toBe('phase51-linked');
    expect(task.head).toBe(git(['rev-parse', 'HEAD'], linkedRoot));
  });

  test('creates non-Git metadata without inventing a main repo', () => {
    const task = withoutParentGit(os.tmpdir(), () => createCurrentTask({
        root: tempRoot,
        taskId: 'phase51',
        phase: 'shape',
        now: '2026-08-10T00:00:00.000Z'
      }));

    expect(task.projectPath).toBe(tempRoot);
    expect(task.worktreeRoot).toBe(tempRoot);
    expect(task.mainRepoRoot).toBeNull();
  });

  test('matches a linked-worktree task whose project is the main worktree', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    const linkedRoot = path.join(tempRoot, 'hooks-linked');
    await initGitRepo(mainRoot);
    git(['worktree', 'add', '-b', 'phase51-linked', linkedRoot], mainRoot);
    await writeCurrentTaskAtomic(linkedRoot, {
      ...validTask(linkedRoot),
      projectPath: mainRoot,
      mainRepoRoot: mainRoot,
      worktreeRoot: linkedRoot
    });

    const check = await inspectCurrentTaskBindingFromCwd(linkedRoot);

    expect(check).toMatchObject({
      status: 'matched',
      gitRoot: linkedRoot,
      canonicalProjectRoot: mainRoot,
      taskFileRoot: linkedRoot,
      declaredProjectPath: mainRoot,
      declaredWorktreeRoot: linkedRoot,
      declaredMainRepoRoot: mainRoot
    });
  });

  test('matches a task owned by its Git main worktree', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    await initGitRepo(mainRoot);
    await writeCurrentTaskAtomic(mainRoot, {
      ...validTask(mainRoot),
      projectPath: mainRoot,
      mainRepoRoot: mainRoot,
      worktreeRoot: mainRoot
    });

    const check = await inspectCurrentTaskBindingFromCwd(mainRoot);

    expect(check).toMatchObject({
      status: 'matched',
      gitRoot: mainRoot,
      canonicalProjectRoot: mainRoot,
      taskFileRoot: mainRoot,
      declaredProjectPath: mainRoot,
      declaredWorktreeRoot: mainRoot,
      declaredMainRepoRoot: mainRoot
    });
  });

  test('preserves nearest-ancestor resolution for a valid non-Git task', async () => {
    const nestedRoot = path.join(tempRoot, 'packages', 'demo');
    await fs.mkdir(nestedRoot, { recursive: true });
    await writeCurrentTaskAtomic(tempRoot, validTask(tempRoot));

    const check = await inspectCurrentTaskBindingFromCwd(nestedRoot);
    const resolved = await resolveCurrentTaskFromCwd(nestedRoot);

    expect(check.status).toBe('matched');
    expect(check.reason).toBe('task_binding_matches_non_git_project');
    expect(resolved?.task.taskId).toBe('task-alpha');
    expect(resolved?.projectRoot).toBe(tempRoot);
  });

  test('reports stale-parent-binding when a parent task crosses a nested Git root', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await writeCurrentTaskAtomic(tempRoot, validTask(tempRoot));
    await initGitRepo(projectRoot);

    const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

    expect(check.status).toBe('stale-parent-binding');
    await expect(resolveCurrentTaskFromCwd(projectRoot)).resolves.toBeNull();
  });

  test('reports task-root-mismatch when the file owner differs from worktreeRoot', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await initGitRepo(projectRoot);
    await writeTaskFileUnchecked(projectRoot, {
      ...validTask(projectRoot),
      projectPath: projectRoot,
      mainRepoRoot: projectRoot,
      worktreeRoot: path.join(tempRoot, 'other')
    });

    const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

    expect(check.status).toBe('task-root-mismatch');
  });

  test('refuses to persist a task below a different declared worktree root', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');

    await expect(writeCurrentTaskAtomic(projectRoot, {
      ...validTask(projectRoot),
      worktreeRoot: path.join(tempRoot, 'other')
    })).rejects.toThrow('current task write root does not match task.worktreeRoot');
  });

  test('reports git-root-mismatch when the declared worktree is not the current Git root', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const nestedRoot = path.join(projectRoot, 'packages', 'demo');
    await initGitRepo(projectRoot);
    await fs.mkdir(nestedRoot, { recursive: true });
    await writeCurrentTaskAtomic(nestedRoot, {
      ...validTask(nestedRoot),
      projectPath: projectRoot,
      mainRepoRoot: projectRoot,
      worktreeRoot: nestedRoot
    });

    const check = await inspectCurrentTaskBindingFromCwd(nestedRoot);

    expect(check.status).toBe('git-root-mismatch');
  });

  test('reports project-root-mismatch for a false linked-worktree project path', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    const linkedRoot = path.join(tempRoot, 'hooks-linked');
    await initGitRepo(mainRoot);
    git(['worktree', 'add', '-b', 'phase51-linked', linkedRoot], mainRoot);
    await writeCurrentTaskAtomic(linkedRoot, {
      ...validTask(linkedRoot),
      projectPath: linkedRoot,
      mainRepoRoot: linkedRoot,
      worktreeRoot: linkedRoot
    });

    const check = await inspectCurrentTaskBindingFromCwd(linkedRoot);

    expect(check.status).toBe('project-root-mismatch');
    expect(check.canonicalProjectRoot).toBe(mainRoot);
  });

  test('does not resolve a parent task through an unsupported Git topology', async () => {
    const projectRoot = path.join(tempRoot, 'separate-worktree');
    const gitDir = path.join(tempRoot, 'separate-git-dir');
    await writeCurrentTaskAtomic(tempRoot, validTask(tempRoot));
    await initSeparateGitDirRepo(projectRoot, gitDir);

    const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

    expect(check.status).toBe('stale-parent-binding');
    expect(check.gitRoot).toBe(projectRoot);
    expect(check.gitCommonDir).toBe(gitDir);
    expect(check.canonicalProjectRoot).toBeNull();
    await expect(resolveCurrentTaskFromCwd(projectRoot)).resolves.toBeNull();
  });

  test('reports project-root-mismatch for a local task with unsupported Git topology', async () => {
    const projectRoot = path.join(tempRoot, 'separate-worktree');
    const gitDir = path.join(tempRoot, 'separate-git-dir');
    await initSeparateGitDirRepo(projectRoot, gitDir);
    await writeCurrentTaskAtomic(projectRoot, {
      ...validTask(projectRoot),
      projectPath: projectRoot,
      worktreeRoot: projectRoot,
      mainRepoRoot: null
    });

    const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

    expect(check.status).toBe('project-root-mismatch');
    expect(check.reason).toBe('unsupported_git_topology_cannot_derive_canonical_project');
    await expect(resolveCurrentTaskFromCwd(projectRoot)).resolves.toBeNull();
  });

  test('reports unsupported Git topology even when no task candidate exists', async () => {
    const projectRoot = path.join(tempRoot, 'separate-worktree');
    const gitDir = path.join(tempRoot, 'separate-git-dir');
    await initSeparateGitDirRepo(projectRoot, gitDir);

    const check = await inspectCurrentTaskBindingFromCwd(projectRoot);

    expect(check.status).toBe('project-root-mismatch');
    expect(check.reason).toBe('unsupported_git_topology_cannot_derive_canonical_project');
    expect(check.taskId).toBeNull();
    await expect(resolveCurrentTaskFromCwd(projectRoot)).resolves.toBeNull();
  });

  test('rejects a task directory junction that escapes the declared worktree', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const externalTaskDir = path.join(tempRoot, 'external-task-state');
    const taskDir = path.join(projectRoot, '.ccpanes-task');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(externalTaskDir, { recursive: true });
    await fs.writeFile(
      path.join(externalTaskDir, 'current-task.json'),
      `${JSON.stringify(validTask(projectRoot), null, 2)}\n`,
      'utf8'
    );
    await fs.symlink(
      externalTaskDir,
      taskDir,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(readCurrentTask(projectRoot))
      .rejects.toThrow('current task directory must not be a symbolic link');
    await expect(writeCurrentTaskAtomic(projectRoot, validTask(projectRoot)))
      .rejects.toThrow('current task directory must not be a symbolic link');
  });

  test('rejects a current task path junction that escapes the declared worktree', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const externalTaskPath = path.join(tempRoot, 'external-current-task');
    const taskDir = path.join(projectRoot, '.ccpanes-task');
    const taskFile = path.join(taskDir, 'current-task.json');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(externalTaskPath, { recursive: true });
    await fs.symlink(
      externalTaskPath,
      taskFile,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(readCurrentTask(projectRoot))
      .rejects.toThrow('current task file must not be a symbolic link');
    await expect(writeCurrentTaskAtomic(projectRoot, validTask(projectRoot)))
      .rejects.toThrow('current task file must not be a symbolic link');
  });

  test('task factory rejects unsupported Git topology instead of inventing a project', async () => {
    const projectRoot = path.join(tempRoot, 'separate-worktree');
    const gitDir = path.join(tempRoot, 'separate-git-dir');
    await initSeparateGitDirRepo(projectRoot, gitDir);

    expect(() => createCurrentTask({
      root: projectRoot,
      taskId: 'phase51',
      phase: 'shape'
    })).toThrow('unsupported Git topology: canonical project root is unavailable');
  });

  test('reports an explicit mismatch when Git topology probing fails', async () => {
    const brokenRoot = path.join(tempRoot, 'broken-worktree');
    await writeCurrentTaskAtomic(tempRoot, validTask(tempRoot));
    await fs.mkdir(brokenRoot, { recursive: true });
    await fs.writeFile(path.join(brokenRoot, '.git'), 'gitdir: missing-git-dir\n', 'utf8');

    const check = await inspectCurrentTaskBindingFromCwd(brokenRoot);

    expect(check.status).toBe('git-topology-unavailable');
    expect(check.reason).toBe('git_topology_probe_failed');
    expect(check.taskId).toBe('task-alpha');
    await expect(resolveCurrentTaskFromCwd(brokenRoot)).resolves.toBeNull();
    expect(() => createCurrentTask({
      root: brokenRoot,
      taskId: 'phase51',
      phase: 'shape'
    })).toThrow('failed to read Git topology safely');
  });

  test('does not treat a bare repository as a non-Git task root', async () => {
    const bareRoot = path.join(tempRoot, 'bare.git');
    await writeCurrentTaskAtomic(tempRoot, validTask(tempRoot));
    git(['init', '--bare', bareRoot], tempRoot);

    const check = await inspectCurrentTaskBindingFromCwd(bareRoot);

    expect(check.status).toBe('git-topology-unavailable');
    expect(check.reason).toBe('git_topology_probe_failed');
    expect(check.taskId).toBe('task-alpha');
    await expect(resolveCurrentTaskFromCwd(bareRoot)).resolves.toBeNull();
    expect(() => createCurrentTask({
      root: bareRoot,
      taskId: 'phase51',
      phase: 'shape'
    })).toThrow('failed to read Git topology safely');
  });
});
