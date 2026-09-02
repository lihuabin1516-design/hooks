import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveBootstrap } from '../src/global-bootstrap.js';
import { writeTaskBindingRegistry } from '../src/task-binding-registry.js';
import type { CurrentTask } from '../src/types.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-global-bootstrap-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function createTask(worktreeRoot: string, taskId = 'task-alpha'): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId,
    workspace: 'fixture',
    projectPath: worktreeRoot,
    worktreeRoot,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    source: 'manual-import',
    notes: `${taskId} objective`
  };
}

async function writeContextGeneration(
  filePath: string,
  task: CurrentTask,
  generation: number,
  options: {
    auditDir?: string | null;
    gitClaim?: string;
    blockers?: string[];
    progress?: string[];
    nextSteps?: string[];
    increments?: string[];
    evidence?: string[];
  } = {}
): Promise<string> {
  const timestamp = `2026-09-0${generation}T00:00:00.000Z`;
  const currentProgress = options.progress ?? [
    `Goal: ${task.notes}`,
    'Workflow: RUNNING',
    'Worker: WAITING_RESULT',
    `Git: ${options.gitClaim ?? 'clean (historical claim only)'}`
  ];
  const blockers = options.blockers ?? ['none'];
  const nextSteps = options.nextSteps ?? ['inspect the current worktree binding before continuing'];
  const increments = options.increments ?? [`generation-${generation}`];
  const evidence = options.evidence ?? [`evidence-${generation}`];
  const content = [
    '# 上下文压缩后先读 `context.md`',
    '',
    '## 0. 快照元信息',
    '',
    '```yaml',
    'schema: ccpanes.context.v1',
    `snapshotGeneration: ${generation}`,
    'retentionPolicy: current-plus-two-previous',
    'source: authoritative-projection',
    `updatedAt: ${timestamp}`,
    '```',
    '',
    '## 1. 当前任务',
    `- taskId: ${task.taskId}`,
    `- workspace: ${task.workspace}`,
    `- projectPath: ${task.projectPath}`,
    `- worktreeRoot: ${task.worktreeRoot}`,
    options.auditDir ? `- auditDir: ${options.auditDir}` : null,
    `- phase: ${task.phase}`,
    `- objective: ${task.notes}`,
    '',
    '## 2. 当前进度',
    ...currentProgress.map((line) => `- ${line}`),
    '',
    '## 3. 当前卡点',
    ...blockers.map((line) => `- ${line}`),
    '',
    '## 4. 下一步',
    ...nextSteps.map((line) => `- ${line}`),
    '',
    '## 5. 上下文快照保留策略',
    '- Keep only context.md, context.prev.md, and context.prev2.md.',
    '- Rotate with the transaction-safe snapshot command; context.md is the commit point.',
    '- Treat this file as a recovery projection, not as Goal/Workflow/Session authority.',
    '',
    '## 6. 避坑点',
    '- Do not write the main worktree or absorb unrelated tracked/untracked changes.',
    '- Do not copy tokens, prompts, rollout paths, raw Session IDs, or sensitive data into this file.',
    '',
    '## 7. 上下文压缩后的恢复步骤',
    '1. Read this file, then compare with the system-compressed context.',
    '2. Re-read AGENTS.md and the project handoff.',
    '3. Resolve conflicts in favor of the authority owner.',
    '4. Run the listed verification checks before continuing or claiming completion.',
    '',
    '## 8. 本轮增量',
    ...increments.map((line) => `- ${line}`),
    '',
    '## 9. 更新检查清单',
    '- [ ] Task binding and worktree are still correct.',
    '- [ ] Git status, diff, and required checks were verified.',
    '- [ ] Acceptance evidence was written with real command output.',
    '',
    '## 10. 验证证据',
    ...evidence.map((line) => `- ${line}`),
    ''
  ]
    .filter((line) => line !== null)
    .join('\n');

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return content;
}

async function createProject(name: string): Promise<string> {
  const project = path.join(root, name);
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'HANDOFF.md'), '# handoff\n', 'utf8');
  return project;
}

describe('resolveBootstrap', () => {
  test('preserves registry invalid status and records real three-generation observations', async () => {
    const project = await createProject('project-registry-invalid');
    const task = createTask(project, 'task-invalid');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['invalid-registry-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 2, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['invalid-registry-prev']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['invalid-registry-prev2']
    });
    const registry = path.join(root, 'registry-invalid.json');
    await fs.writeFile(registry, '{"schema":"broken"}', 'utf8');

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('REGISTRY_INVALID');
    expect(result.contextGenerations.map((generation) => generation.path)).toEqual([
      path.join(project, 'context.md'),
      path.join(project, 'context.prev.md'),
      path.join(project, 'context.prev2.md')
    ]);
    expect(result.contextGenerations[0]).toEqual(expect.objectContaining({
      exists: true,
      parseStatus: 'parsed',
      sha256: sha256(await fs.readFile(path.join(project, 'context.md'), 'utf8'))
    }));
    expect(result.contextGenerations[1]).toEqual(expect.objectContaining({
      exists: true,
      parseStatus: 'parsed'
    }));
    expect(result.contextGenerations[2]).toEqual(expect.objectContaining({
      exists: true,
      parseStatus: 'parsed'
    }));
  });

  test('preserves registry missing status and records real three-generation observations', async () => {
    const project = await createProject('project-registry-missing');
    const task = createTask(project, 'task-missing');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      evidence: ['missing-registry-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 2, {
      evidence: ['missing-registry-prev']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      evidence: ['missing-registry-prev2']
    });
    const registry = path.join(root, 'registry-missing.json');

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('REGISTRY_MISSING');
    expect(result.contextGenerations.map((generation) => generation.path)).toEqual([
      path.join(project, 'context.md'),
      path.join(project, 'context.prev.md'),
      path.join(project, 'context.prev2.md')
    ]);
    expect(result.contextGenerations.every((generation) => generation.exists)).toBe(true);
    expect(result.contextGenerations.every((generation) => generation.parseStatus === 'parsed')).toBe(true);
  });

  test('preserves no-exact-binding status and still records the real three generations from cwd', async () => {
    const project = await createProject('project-binding-miss');
    const sibling = await createProject('project-binding-miss-sibling');
    const task = createTask(project, 'task-binding-miss');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      evidence: ['binding-miss-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 2, {
      evidence: ['binding-miss-prev']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      evidence: ['binding-miss-prev2']
    });
    const registry = path.join(root, 'registry-binding-miss.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'binding-miss'
    }]);

    const result = await resolveBootstrap({
      cwd: sibling,
      registryPath: registry
    });

    expect(result.status).toBe('MISSING_TASK_BINDING');
    expect(result.contextGenerations.map((generation) => generation.path)).toEqual([
      path.join(sibling, 'context.md'),
      path.join(sibling, 'context.prev.md'),
      path.join(sibling, 'context.prev2.md')
    ]);
    expect(result.contextGenerations[0]).toEqual(expect.objectContaining({
      exists: false,
      parseStatus: 'missing',
      sha256: null
    }));
  });

  test('fails closed when context.prev.md is missing but context.prev2.md exists', async () => {
    const project = await createProject('project-prev2-without-prev');
    const task = createTask(project, 'task-prev2-conflict');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      evidence: ['prev2-conflict-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      evidence: ['prev2-conflict-prev2']
    });
    const registry = path.join(root, 'registry-prev2-conflict.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'prev2-conflict'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('CONTEXT_MISSING');
    expect(result.reason).toBe('context_generation_conflict');
    expect(result.contextGenerations[0]).toEqual(expect.objectContaining({ path: path.join(project, 'context.md'), parseStatus: 'parsed' }));
    expect(result.contextGenerations[1]).toEqual(expect.objectContaining({ path: path.join(project, 'context.prev.md'), parseStatus: 'missing' }));
    expect(result.contextGenerations[2]).toEqual(expect.objectContaining({ path: path.join(project, 'context.prev2.md'), parseStatus: 'parsed' }));
  });

  test('fails closed when HANDOFF.md is missing after binding resolves', async () => {
    const project = await createProject('project-handoff-missing');
    await fs.rm(path.join(project, 'HANDOFF.md'));
    const task = createTask(project, 'task-handoff-missing');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      evidence: ['handoff-missing-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 2, {
      evidence: ['handoff-missing-prev']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      evidence: ['handoff-missing-prev2']
    });
    const registry = path.join(root, 'registry-handoff-missing.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'handoff-missing'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('CONTEXT_MISSING');
    expect(result.reason).toBe('handoff_missing');
    expect(result.handoff.exists).toBe(false);
    expect(result.contextGenerations.map((generation) => generation.path)).toEqual([
      path.join(project, 'context.md'),
      path.join(project, 'context.prev.md'),
      path.join(project, 'context.prev2.md')
    ]);
  });

  test('classifies a current context read failure as read_error and fail-closes', async () => {
    const project = await createProject('project-read-error');
    const task = createTask(project, 'task-read-error');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      evidence: ['read-error-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 2, {
      evidence: ['read-error-prev']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      evidence: ['read-error-prev2']
    });
    const registry = path.join(root, 'registry-read-error.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'read-error'
    }]);

    const originalReadFile = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args: any[]) => {
      const [filePath, ...rest] = args;
      if (filePath === path.join(project, 'context.md')) {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return originalReadFile(filePath, ...rest);
    });

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('CONTEXT_MISSING');
    expect(result.reason).toBe('current_context_read_error');
    expect(result.context).toEqual(expect.objectContaining({
      path: path.join(project, 'context.md'),
      exists: true,
      parseStatus: 'read_error',
      parseReason: 'EACCES'
    }));
    expect(result.contextGenerations[0]).toEqual(expect.objectContaining({
      path: path.join(project, 'context.md'),
      exists: true,
      parseStatus: 'read_error',
      parseReason: 'EACCES'
    }));
  });

  test('records three generations independently and keeps the current context layered above history', async () => {
    const project = await createProject('project-alpha');
    const task = createTask(project);
    const currentContext = await writeContextGeneration(
      path.join(project, 'context.md'),
      task,
      3,
      {
        auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
        blockers: ['current blocker'],
        evidence: ['current acceptance evidence']
      }
    );
    const previousContext = await writeContextGeneration(
      path.join(project, 'context.prev.md'),
      task,
      2,
      {
        auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
        blockers: ['historical blocker'],
        evidence: ['historical acceptance evidence']
      }
    );
    const previous2Context = await writeContextGeneration(
      path.join(project, 'context.prev2.md'),
      task,
      1,
      {
        auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
        blockers: ['older blocker'],
        evidence: ['older historical evidence']
      }
    );
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'alpha'
    }]);

    const result = await resolveBootstrap({
      cwd: path.join(project, 'nested', 'child'),
      registryPath: registry
    });

    expect(result.schema).toBe('ccpanes.bootstrap.v1');
    expect(result.status).toBe('READY');
    expect(result.taskId).toBe(task.taskId);
    expect(result.nextGate).toBe('MCP_DISCOVERY');
    expect(result.contextGenerations).toHaveLength(3);
    expect(result.contextGenerations).toEqual([
      expect.objectContaining({
        path: path.join(project, 'context.md'),
        exists: true,
        parseStatus: 'parsed',
        sha256: sha256(currentContext),
        observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      }),
      expect.objectContaining({
        path: path.join(project, 'context.prev.md'),
        exists: true,
        parseStatus: 'parsed',
        sha256: sha256(previousContext)
      }),
      expect.objectContaining({
        path: path.join(project, 'context.prev2.md'),
        exists: true,
        parseStatus: 'parsed',
        sha256: sha256(previous2Context)
      })
    ]);
    expect(result.taskScope).toMatchObject({
      taskId: task.taskId,
      projectPath: project,
      worktreeRoot: project,
      phase: 'build',
      objective: 'task-alpha objective',
      auditDir: path.join(project, '.ccpanes-task', 'audit-current')
    });
    expect(result.verifiedFacts).toEqual(expect.arrayContaining([
      `binding.taskId matches current context.md: ${task.taskId}`,
      `binding.worktreeRoot matches current context.md: ${project}`,
      `binding.projectPath matches current context.md: ${project}`
    ]));
    expect(result.unverifiedAssumptions).toEqual(expect.arrayContaining([
      'historical acceptance evidence',
      'older historical evidence'
    ]));
    expect(result.currentBlockers).toEqual(['current blocker']);
    expect(result.recentAcceptanceEvidence).toEqual(['current acceptance evidence']);
    expect(result.taskBinding).toMatchObject({
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      contextPath: path.join(project, 'context.md')
    });
    expect(result.worktree).toMatchObject({
      root: null,
      cwd: path.resolve(project, 'nested', 'child')
    });
    expect(result.auditDir).toBe(path.join(project, '.ccpanes-task', 'audit-current'));
  });

  test('tolerates a missing context.prev2.md without failing the binding', async () => {
    const project = await createProject('project-beta');
    const task = createTask(project, 'task-beta');
    await writeContextGeneration(path.join(project, 'context.md'), task, 2, {
      blockers: [],
      evidence: ['beta current evidence']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 1, {
      evidence: ['beta historical evidence']
    });
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'beta'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('READY');
    expect(result.contextGenerations).toHaveLength(3);
    expect(result.contextGenerations[2]).toEqual(expect.objectContaining({
      path: path.join(project, 'context.prev2.md'),
      exists: false,
      parseStatus: 'missing',
      sha256: null
    }));
    expect(result.recentAcceptanceEvidence).toEqual(['beta current evidence']);
  });

  test('fails closed when the three-generation task scope or auditDir diverges', async () => {
    const project = await createProject('project-gamma');
    const task = createTask(project, 'task-gamma');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['gamma current evidence']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), createTask(path.join(root, 'other-worktree'), 'task-gamma'), 2, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['historical evidence from another worktree']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-legacy'),
      evidence: ['older evidence with mismatched auditDir']
    });
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'gamma'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).not.toBe('READY');
    expect(result.reason).toMatch(/context.*conflict/i);
  });

  test('fails closed when auditDir is present in one generation and missing in another', async () => {
    const project = await createProject('project-auditdir-conflict');
    const task = createTask(project, 'task-auditdir-conflict');
    await writeContextGeneration(path.join(project, 'context.md'), task, 3, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['auditdir-current']
    });
    await writeContextGeneration(path.join(project, 'context.prev.md'), task, 2, {
      evidence: ['auditdir-prev-without-path']
    });
    await writeContextGeneration(path.join(project, 'context.prev2.md'), task, 1, {
      auditDir: path.join(project, '.ccpanes-task', 'audit-current'),
      evidence: ['auditdir-prev2']
    });
    const registry = path.join(root, 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'auditdir-conflict'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('CONTEXT_MISSING');
    expect(result.reason).toBe('context_generation_conflict');
    expect(result.contextGenerations).toEqual([
      expect.objectContaining({ path: path.join(project, 'context.md'), parseStatus: 'parsed' }),
      expect.objectContaining({ path: path.join(project, 'context.prev.md'), parseStatus: 'parsed' }),
      expect.objectContaining({ path: path.join(project, 'context.prev2.md'), parseStatus: 'parsed' })
    ]);
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
    await writeContextGeneration(path.join(project, 'context.md'), createTask(project, 'local-task'), 1, {
      evidence: ['local current-task evidence']
    });

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: path.join(root, 'not-installed.json')
    });

    expect(result.status).toBe('READY');
    expect(result.taskId).toBe('local-task');
    expect(result.reason).toBe('local_current_task_binding_resolved');
    expect(result.nextGate).toBe('MCP_DISCOVERY');
  });

  test('discovers a registry committed at the current worktree boundary', async () => {
    const project = await createProject('project-discovered');
    const task = createTask(project, 'discovered-task');
    await writeContextGeneration(path.join(project, 'context.md'), task, 1, {
      evidence: ['discovered current evidence']
    });
    const registry = path.join(project, '.ccpanes-task', 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'discovered'
    }]);

    const result = await resolveBootstrap({
      cwd: project,
      registryPath: registry
    });

    expect(result.status).toBe('READY');
    expect(result.taskId).toBe('discovered-task');
    expect(result.coordinatorNamespace).toBe('discovered');
    expect(result.nextGate).toBe('MCP_DISCOVERY');
  });

  test('discovers a registry committed at the current worktree boundary without an explicit registryPath', async () => {
    const project = await createProject('project-discovered-default');
    const task = createTask(project, 'discovered-default-task');
    await writeContextGeneration(path.join(project, 'context.md'), task, 1, {
      evidence: ['discovered-default-current']
    });
    const registry = path.join(project, '.ccpanes-task', 'task-bindings.json');
    await writeTaskBindingRegistry(registry, [{
      taskId: task.taskId,
      worktreeRoot: project,
      projectPath: project,
      handoffPath: path.join(project, 'HANDOFF.md'),
      contextPath: path.join(project, 'context.md'),
      coordinatorNamespace: 'discovered-default'
    }]);

    const home = path.join(root, 'fake-home');
    await fs.mkdir(home, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(home);

    const result = await resolveBootstrap({ cwd: project });

    expect(result.status).toBe('READY');
    expect(result.taskId).toBe('discovered-default-task');
    expect(result.reason).toBe('exact_worktree_binding_and_context_chain_resolved');
    expect(result.taskBinding).toMatchObject({
      source: 'registry',
      taskId: 'discovered-default-task',
      worktreeRoot: project
    });
    expect(result.nextGate).toBe('MCP_DISCOVERY');
  });
});
