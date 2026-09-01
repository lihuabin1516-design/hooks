import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveBootstrap } from '../src/global-bootstrap.js';
import { writeTaskBindingRegistry } from '../src/task-binding-registry.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-global-bootstrap-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function createProject(name: string): Promise<string> {
  const project = path.join(root, name);
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'HANDOFF.md'), '# handoff\n', 'utf8');
  await fs.writeFile(path.join(project, 'context.md'), '# context\n', 'utf8');
  return project;
}

describe('resolveBootstrap', () => {
  test('resolves the exact worktree registration and local handoff files', async () => {
    const project = await createProject('project-alpha');
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: 'task-alpha',
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'alpha'
    }]);

    const result = await resolveBootstrap({
      cwd: path.join(project, 'nested'),
      registryPath: registry
    });

    expect(result.schema).toBe('ccpanes.bootstrap.v1');
    expect(result.status).toBe('READY');
    expect(result.taskId).toBe('task-alpha');
    expect(result.worktreeRoot).toBe(project);
    expect(result.handoff).toMatchObject({ exists: true, path: path.join(project, 'HANDOFF.md') });
    expect(result.context).toMatchObject({ exists: true, path: path.join(project, 'context.md') });
    expect(result.coordinatorNamespace).toBe('alpha');
  });

  test('does not match a registration from a sibling or parent project', async () => {
    const project = await createProject('project-alpha');
    const sibling = path.join(root, 'project-beta');
    await fs.mkdir(sibling, { recursive: true });
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: 'task-alpha',
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'alpha'
    }]);

    const result = await resolveBootstrap({
      cwd: sibling,
      registryPath: registry
    });

    expect(result.status).toBe('MISSING_TASK_BINDING');
    expect(result.taskId).toBeNull();
    expect(result.coordinatorNamespace).toBeNull();
  });

  test('reports missing context without claiming readiness', async () => {
    const project = path.join(root, 'project-alpha');
    await fs.mkdir(project, { recursive: true });
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: 'task-alpha',
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'alpha'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('CONTEXT_MISSING');
    expect(result.handoff.exists).toBe(false);
    expect(result.context.exists).toBe(false);
  });

  test('uses a matched local current-task when the user registry is not installed', async () => {
    const project = await createProject('project-local');
    await fs.mkdir(path.join(project, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(
      path.join(project, '.ccpanes-task', 'current-task.json'),
      JSON.stringify({
        schema: 'ccpanes.task-selection.v1',
        taskId: 'local-task',
        workspace: 'fixture',
        projectPath: project,
        worktreeRoot: project,
        mainRepoRoot: null,
        branch: null,
        head: null,
        owner: { leaderSessionId: null, paneId: null, layoutId: null },
        phase: 'build',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        source: 'manual-import',
        notes: 'fixture'
      }),
      'utf8'
    );

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: path.join(root, 'not-installed.json')
    });

    expect(result.status).toBe('READY');
    expect(result.taskId).toBe('local-task');
    expect(result.reason).toBe('local_current_task_binding_resolved');
  });

  test('discovers a registry committed at the current worktree boundary', async () => {
    const project = await createProject('project-discovered');
    const registry = path.join(project, '.ccpanes-task', 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: 'discovered-task',
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'discovered'
    }]);

    const result = await resolveBootstrap({ cwd: project });

    expect(result.status).toBe('READY');
    expect(result.taskId).toBe('discovered-task');
    expect(result.coordinatorNamespace).toBe('discovered');
  });
});
