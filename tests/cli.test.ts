import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli, isCliEntrypoint } from '../src/cli.js';
import { writeCurrentTaskAtomic } from '../src/current-task.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex').toUpperCase();
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function task(root: string, taskId: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId,
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: 'leader-1', paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'synthetic cli workspace task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-cli-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('runCli', () => {
  test('prints a resume probe JSON document', async () => {
    const output = await runCli(['probe', '--utterance', '继续', '--session', 'leader-1']);
    const parsed = JSON.parse(output);
    expect(parsed.schema).toBe('ccpanes.resume-probe.v1');
    expect(parsed.action).toBe('none');
  });

  test('scans workspace-root and auto-resumes a single clean candidate', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli(['probe', '--utterance', '继续', '--session', 'leader-1', '--workspace-root', tempRoot]);
    const parsed = JSON.parse(output);

    expect(parsed.action).toBe('auto_resume');
    expect(parsed.reason).toBe('single_clean_matching_candidate');
    expect(parsed.candidates[0].taskId).toBe('task-alpha');
    expect(parsed.scanErrors).toEqual([]);
  });

  test('classifies task risk through CLI', async () => {
    const output = await runCli(['classify-task-risk', '--prompt', '修改 src/foo.ts 并更新测试', '--cwd', tempRoot]);
    const parsed = JSON.parse(output);

    expect(parsed).toMatchObject({
      schema: 'ccpanes.task-risk.v1',
      tier: 'standard',
      reason: 'standard_code_task',
      cwd: tempRoot
    });
    expect(parsed.dimensions.touchesCode).toBe(true);
  });

  test('classifies workflow profile through CLI', async () => {
    const output = await runCli([
      'classify-workflow',
      '--prompt',
      '扩展 hook-event-adapter 并更新测试',
      '--cwd',
      tempRoot,
      '--changed-path',
      'src/hook-event-adapter.ts',
      '--changed-path',
      'tests/hook-event-adapter.test.ts'
    ]);
    const parsed = JSON.parse(output);

    expect(parsed).toMatchObject({
      schema: 'ccpanes.workflow-profile.v1',
      route: { id: 'hook-runtime' },
      rigor: 'standard',
      closure: { bucket: 'full' },
      cwd: tempRoot
    });
    expect(parsed.checks.map((check: { command: string }) => check.command)).toContain('npm run smoke');
  });

  test('prints host adapter registry and filters by host', async () => {
    const registryOutput = await runCli(['host-adapter-registry']);
    const registry = JSON.parse(registryOutput);
    expect(registry.schema).toBe('ccpanes.host-adapter-registry.v1');
    expect(registry.adapters.map((adapter: { id: string }) => adapter.id)).toContain('codex');

    const codexOutput = await runCli(['host-adapter-registry', '--host', 'codex']);
    const codex = JSON.parse(codexOutput);
    expect(codex).toMatchObject({
      schema: 'ccpanes.host-adapter.v1',
      adapter: { id: 'codex', status: 'supported' }
    });
    expect(codex.adapter.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hard-gate', name: 'PreToolUse' })
    ]));
  });

  test('includes scanErrors for invalid scanned current-task files', async () => {
    const badRoot = path.join(tempRoot, 'bad-project');
    await fs.mkdir(path.join(badRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(path.join(badRoot, '.ccpanes-task', 'current-task.json'), JSON.stringify({ schema: 'wrong' }), 'utf8');

    const output = await runCli(['probe', '--utterance', '继续', '--session', 'leader-1', '--workspace-root', tempRoot]);
    const parsed = JSON.parse(output);

    expect(parsed.action).toBe('none');
    expect(parsed.scanErrors).toHaveLength(1);
    expect(parsed.scanErrors[0].reason).toContain('invalid current task: schema');
  });

  test('writes current-task.json only under the provided fixture root', async () => {
    const output = await runCli(['write-current', '--root', tempRoot, '--task-id', 'task-alpha', '--phase', 'build']);
    expect(JSON.parse(output).path).toBe(path.join(tempRoot, '.ccpanes-task', 'current-task.json'));
    await expect(fs.stat(path.join(tempRoot, '.ccpanes-task', 'current-task.json'))).resolves.toBeTruthy();
  });

  test('bootstraps a project with current task, AGENTS entry, policy files, and report', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const output = await runCli([
      'bootstrap-project',
      '--root',
      projectRoot,
      '--task-id',
      'task-alpha',
      '--phase',
      'shape'
    ]);
    const parsed = JSON.parse(output);

    expect(parsed).toMatchObject({
      schema: 'ccpanes.project-bootstrap-result.v1',
      taskId: 'task-alpha',
      phase: 'shape'
    });
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'current-task.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(projectRoot, 'AGENTS.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'bootstrap-report.json'))).resolves.toBeTruthy();
    expect(JSON.parse(await fs.readFile(path.join(projectRoot, '.ccpanes-task', 'policy.json'), 'utf8')).rules).toEqual([]);
  });

  test('installs and validates AGENTS.md hook entry through CLI', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), '# Project Rules\n\nKeep this project section.\n', 'utf8');

    const install = JSON.parse(await runCli(['agents-install', '--root', projectRoot]));
    const validate = JSON.parse(await runCli(['agents-validate', '--root', projectRoot]));
    const secondInstall = JSON.parse(await runCli(['agents-install', '--root', projectRoot]));
    const text = await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8');

    expect(install).toMatchObject({
      schema: 'ccpanes.agents-entry-result.v1',
      changed: true,
      action: 'updated'
    });
    expect(validate).toMatchObject({
      schema: 'ccpanes.agents-entry-validate.v1',
      exists: true,
      markerPresent: true,
      valid: true
    });
    expect(secondInstall.changed).toBe(false);
    expect(text).toContain('Keep this project section.');
    expect(text).toContain('<!-- ccpanes-hooks:begin -->');
  });

  test('manages project policy rules through CLI commands', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');

    const addOutput = await runCli([
      'policy-add',
      '--root',
      projectRoot,
      '--id',
      'block-publish',
      '--effect',
      'block',
      '--reason',
      'user_blocked_publish',
      '--tool',
      'shell',
      '--command-contains',
      'publish-artifact'
    ]);
    const addParsed = JSON.parse(addOutput);
    const listParsed = JSON.parse(await runCli(['policy-list', '--root', projectRoot]));
    const validateParsed = JSON.parse(await runCli(['policy-validate', '--root', projectRoot]));

    expect(addParsed.changed).toBe(true);
    expect(addParsed.policy.rules[0]).toMatchObject({
      id: 'block-publish',
      enabled: true,
      effect: 'block',
      reason: 'user_blocked_publish',
      match: { tools: ['shell'], commandContains: ['publish-artifact'] }
    });
    expect(listParsed.ruleCount).toBe(1);
    expect(validateParsed.valid).toBe(true);
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.json'))).resolves.toBeTruthy();
  });

  test('captures project policy instruction through CLI', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');

    const output = await runCli([
      'policy-capture',
      '--root',
      projectRoot,
      '--id',
      'block-publish',
      '--instruction',
      '禁止运行 publish-artifact，除非我明确解除。',
      '--effect',
      'block',
      '--reason',
      'user_blocked_publish',
      '--tool',
      'shell',
      '--command-contains',
      'publish-artifact'
    ]);
    const parsed = JSON.parse(output);
    const ledger = await fs.readFile(path.join(projectRoot, '.ccpanes-task', 'policy.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(projectRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(parsed).toMatchObject({
      schema: 'ccpanes.project-policy-capture-result.v1',
      changed: true,
      ruleId: 'block-publish',
      policyRuleCount: 1
    });
    expect(ledger).toContain('禁止运行 publish-artifact，除非我明确解除。');
    expect(policy.rules[0]).toMatchObject({
      id: 'block-publish',
      effect: 'block',
      reason: 'user_blocked_publish',
      match: { tools: ['shell'], commandContains: ['publish-artifact'] }
    });
  });

  test('captures explicit plan-stage policy instructions through CLI', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');

    const output = await runCli([
      'policy-capture-plan',
      '--root',
      projectRoot,
      '--utterance',
      '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。'
    ]);
    const parsed = JSON.parse(output);
    const ledger = await fs.readFile(path.join(projectRoot, '.ccpanes-task', 'policy.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(projectRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(parsed).toMatchObject({
      schema: 'ccpanes.plan-policy-capture-result.v1',
      changed: true,
      capturedCount: 1,
      clearedCount: 0
    });
    expect(ledger).toContain('禁止运行 deploy-artifact');
    expect(policy.rules[0]).toMatchObject({
      effect: 'block',
      reason: 'plan_block_command',
      match: { tools: ['shell'], commandContains: ['deploy-artifact'] }
    });
  });

  test('previews plan intake through CLI without writing policy files', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditOut = path.join(tempRoot, 'audits', 'plan-intake.json');

    const output = await runCli([
      'plan-intake',
      '--root',
      projectRoot,
      '--prompt',
      '进入 plan 阶段前先收敛规则',
      '--utterance',
      '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
      '--changed-path',
      'src/plan-policy-capture.ts',
      '--audit-out',
      auditOut
    ]);
    const parsed = JSON.parse(output);
    const audit = JSON.parse(await fs.readFile(auditOut, 'utf8'));

    expect(parsed).toMatchObject({
      schema: 'ccpanes.plan-intake.v1',
      mode: 'dry-run',
      changed: false,
      workflow: { route: { id: 'project-policy' } },
      policyPreview: { wouldCaptureCount: 1, wouldChangeProjectPolicy: true }
    });
    expect(audit.policyPreview.actions[0].reason).toBe('plan_block_command');
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.md'))).rejects.toThrow();
  });

  test('previews plan lifecycle intake by resolving current-task from event cwd and writing task audit', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const nestedCwd = path.join(projectRoot, 'packages', 'demo');
    const auditRoot = path.join(tempRoot, 'audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.mkdir(nestedCwd, { recursive: true });

    const output = await runCli([
      'plan-lifecycle-intake',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot,
      '--prompt',
      'CLI prompt wins',
      '--changed-path',
      'src/cli.ts'
    ], JSON.stringify({
      schema: 'ccpanes.plan-lifecycle-event.v1',
      cwd: nestedCwd,
      prompt: 'event prompt',
      planText: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
      changedPaths: ['src/plan-intake.ts'],
      source: 'cc-panes-plan'
    }));
    const parsed = JSON.parse(output);
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'plan-intake-audit.json');
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

    expect(parsed).toMatchObject({
      schema: 'ccpanes.plan-intake.v1',
      mode: 'dry-run',
      changed: false,
      projectRoot,
      workflow: { route: { id: 'project-policy' } },
      policyPreview: { wouldCaptureCount: 1, wouldChangeProjectPolicy: true }
    });
    expect(parsed.prompt).toContain('CLI prompt wins');
    expect(audit.projectRoot).toBe(projectRoot);
    expect(audit.workflow.changedPaths).toEqual(['src/plan-intake.ts', 'src/cli.ts']);
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(projectRoot, '.ccpanes-task', 'policy.md'))).rejects.toThrow();
  });

  test('plan lifecycle intake no-ops when event cwd has no current task ancestor', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan');
    const auditRoot = path.join(tempRoot, 'audits');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'plan-lifecycle-intake',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      schema: 'ccpanes.plan-lifecycle-event.v1',
      cwd: orphanCwd,
      planText: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。'
    }));

    expect(output).toBe('');
    await expect(fs.stat(auditRoot)).rejects.toThrow();
  });

  test('plan lifecycle intake resolves task before validating event schema for no-task no-op', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan');
    const auditRoot = path.join(tempRoot, 'audits');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'plan-lifecycle-intake',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      schema: 'wrong',
      cwd: orphanCwd,
      planText: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。'
    }));

    expect(output).toBe('');
    await expect(fs.stat(auditRoot)).rejects.toThrow();
  });

  test('plan lifecycle intake accepts explicit task and utterance without stdin event', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskFile = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const auditRoot = path.join(tempRoot, 'audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'plan-lifecycle-intake',
      '--task',
      currentTaskFile,
      '--audit-root',
      auditRoot,
      '--cwd',
      projectRoot,
      '--utterance',
      '允许 shape 阶段修改 docs/。'
    ]);
    const parsed = JSON.parse(output);

    expect(parsed).toMatchObject({
      schema: 'ccpanes.plan-intake.v1',
      mode: 'dry-run',
      projectRoot,
      policyPreview: { wouldCaptureCount: 1 }
    });
    await expect(fs.stat(path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'plan-intake-audit.json'))).resolves.toBeTruthy();
  });

  test('policy-disable and policy-clear preserve rules but disable enforcement', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await runCli([
      'policy-add',
      '--root',
      projectRoot,
      '--id',
      'block-generated',
      '--effect',
      'block',
      '--reason',
      'user_blocked_generated',
      '--tool',
      'apply_patch',
      '--path-contains',
      'generated/'
    ]);
    await runCli([
      'policy-add',
      '--root',
      projectRoot,
      '--id',
      'allow-docs',
      '--effect',
      'allow',
      '--reason',
      'user_opened_docs',
      '--tool',
      'apply_patch',
      '--path-contains',
      'docs/',
      '--phase',
      'shape'
    ]);
    const disabled = JSON.parse(await runCli(['policy-disable', '--root', projectRoot, '--id', 'block-generated']));
    const cleared = JSON.parse(await runCli(['policy-clear', '--root', projectRoot]));

    expect(disabled.policy.rules.find((rule: { id: string }) => rule.id === 'block-generated').enabled).toBe(false);
    expect(cleared.disabledRuleCount).toBe(2);
    expect(cleared.policy.rules.every((rule: { enabled: boolean }) => rule.enabled === false)).toBe(true);
  });

  test('prints hook dry-run decision JSON', async () => {
    const output = await runCli(['dry-run-hook', '--root', tempRoot, '--phase', 'shape', '--target', path.join(tempRoot, 'src', 'a.ts'), '--tool', 'write']);
    const parsed = JSON.parse(output);
    expect(parsed.action).toBe('block');
    expect(parsed.reason).toBe('phase_shape_blocks_implementation_write');
  });

  test('prints hook dry-run batch JSON from an input file', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const inputPath = path.join(tempRoot, 'hook-batch.json');
    await fs.writeFile(inputPath, JSON.stringify({
      schema: 'ccpanes.hook-dry-run-batch.v1',
      task: task(projectRoot, 'task-alpha'),
      calls: [
        { tool: 'read', targetPath: path.join(projectRoot, 'src', 'a.ts'), writes: false },
        { tool: 'write', targetPath: path.join(projectRoot, 'src', 'a.ts'), writes: true },
        { tool: 'write', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true }
      ]
    }), 'utf8');

    const output = await runCli(['dry-run-hook', '--input', inputPath]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-dry-run-batch-result.v1');
    expect(parsed.decisions.map((item: { action: string }) => item.action)).toEqual(['allow', 'allow', 'block']);
    expect(parsed.decisions[2].reason).toBe('forbidden_user_config_path');
  });

  test('adapts a hook event JSON file into a hook dry-run batch', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const eventPath = path.join(tempRoot, 'hook-event.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(eventPath, JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(projectRoot, 'src', 'a.ts') }
    }), 'utf8');

    const output = await runCli(['adapt-hook-event', '--task', currentTaskPath, '--event', eventPath]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-dry-run-batch.v1');
    expect(parsed.task.taskId).toBe('task-alpha');
    expect(parsed.calls).toEqual([
      { tool: 'edit', targetPath: path.join(projectRoot, 'src', 'a.ts'), writes: true }
    ]);
  });

  test('runs hook-runner from stdin and prints dry-run result JSON', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'hook-runner',
      '--task',
      currentTaskPath
    ], JSON.stringify({
      event: 'tool_call',
      tool: 'write',
      arguments: { path: path.join(projectRoot, 'src', 'a.ts') }
    }));
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-runner-result.v1');
    expect(parsed.mode).toBe('dry-run');
    expect(parsed.allowed).toBe(true);
    expect(parsed.dryRun.decisions[0].reason).toBe('build_write_inside_worktree');
  });

  test('hook-enforce emits a Codex PreToolUse deny decision for blocked writes', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const auditOut = path.join(tempRoot, 'hook-enforce-audit.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'hook-enforce',
      '--task',
      currentTaskPath,
      '--audit-out',
      auditOut
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: 'apply_patch',
      tool_input: {
        command: 'apply_patch',
        patch: '*** Begin Patch\n*** Update File: C:/Users/AI001/.codex/config.toml\n@@\n-old\n+new\n*** End Patch\n'
      }
    }));
    const parsed = JSON.parse(output);
    const audit = JSON.parse(await fs.readFile(auditOut, 'utf8'));

    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('forbidden_user_config_path');
    expect(audit.schema).toBe('ccpanes.hook-runner-result.v1');
    expect(audit.allowed).toBe(false);
  });

  test('hook-enforce no-ops when Codex cwd is outside the task worktree', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const outsideRoot = path.join(tempRoot, 'outside-project');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'hook-enforce',
      '--task',
      currentTaskPath
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: outsideRoot,
      tool_name: 'apply_patch',
      tool_input: {
        command: 'apply_patch',
        patch: '*** Begin Patch\n*** Update File: C:/Users/AI001/.codex/config.toml\n@@\n-old\n+new\n*** End Patch\n'
      }
    }));

    expect(output).toBe('');
  });

  test('hook-enforce resolves nearest current-task.json from Codex cwd and writes audit under audit-root', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const nestedCwd = path.join(projectRoot, 'packages', 'demo');
    const auditRoot = path.join(tempRoot, 'audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.mkdir(nestedCwd, { recursive: true });

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: nestedCwd,
      tool_name: 'apply_patch',
      tool_input: {
        command: '*** Begin Patch\n*** Update File: C:/Users/AI001/.codex/config.toml\n@@\n-old\n+new\n*** End Patch\n'
      }
    }));
    const parsed = JSON.parse(output);
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'hook-enforce-audit.json');
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('forbidden_user_config_path');
    expect(audit.taskId).toBe('task-alpha');
    expect(audit.batch.task.worktreeRoot).toBe(projectRoot);
  });

  test('hook-enforce blocks dynamic Bash writes into user config paths', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: 'Bash',
      tool_input: {
        command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x'
      }
    }));
    const parsed = JSON.parse(output);
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'hook-enforce-audit.json');
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('forbidden_user_config_path');
    expect(audit.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'C:/Users/AI001/.codex/config.toml',
      writes: true
    });
  });

  test('hook-enforce blocks dynamic shell destructive commands', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: 'functions.shell_command',
      tool_input: {
        command: 'git reset --hard HEAD'
      }
    }));
    const parsed = JSON.parse(output);

    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('destructive_git_reset_hard');
  });

  test('hook-enforce allows FastCtx read files from dynamic task', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: 'mcp__fastctx__read',
      tool_input: {
        files: [
          { path: path.join(projectRoot, 'src', 'a.ts') },
          { path: path.join(projectRoot, 'src', 'b.ts') }
        ]
      }
    }));

    expect(output).toBe('');
  });

  test('permission-enforce emits PermissionRequest deny shape for blocked shell escalation', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'permission-audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'permission-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PermissionRequest',
      cwd: projectRoot,
      tool_name: 'Bash',
      tool_input: {
        command: 'git reset --hard HEAD',
        description: 'Need approval to reset worktree'
      }
    }));
    const parsed = JSON.parse(output);
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'permission-enforce-audit.json');
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(parsed.hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'ccpanes-task-probe: destructive_git_reset_hard: ' + projectRoot.replace(/\\/g, '/')
    });
    expect(audit.allowed).toBe(false);
    expect(audit.dryRun.decisions[0].reason).toBe('destructive_git_reset_hard');
  });

  test('permission-enforce emits no decision for allowed project-local requests', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'permission-enforce',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'PermissionRequest',
      cwd: projectRoot,
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test',
        description: 'Run tests'
      }
    }));

    expect(output).toBe('');
  });

  test('hook-enforce applies project policy block rules from current task worktree', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(path.join(projectRoot, '.ccpanes-task', 'policy.json'), JSON.stringify({
      schema: 'ccpanes.project-policy.v1',
      rules: [{
        id: 'block-publish-probe',
        effect: 'block',
        reason: 'user_blocked_publish_probe',
        match: { tools: ['shell'], commandContains: ['publish-artifact'] }
      }]
    }), 'utf8');

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: 'Bash',
      tool_input: {
        command: 'node scripts/publish-artifact.mjs'
      }
    }));
    const parsed = JSON.parse(output);
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'hook-enforce-audit.json');
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('project_policy_block:user_blocked_publish_probe');
    expect(audit.batch.calls[0]).toMatchObject({
      policyEffect: 'block',
      policyReason: 'user_blocked_publish_probe'
    });
  });

  test('hook-enforce applies project policy allow rules without opening hard boundaries', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'audits');
    await writeCurrentTaskAtomic(projectRoot, { ...task(projectRoot, 'task-alpha'), phase: 'shape' });
    await fs.writeFile(path.join(projectRoot, '.ccpanes-task', 'policy.json'), JSON.stringify({
      schema: 'ccpanes.project-policy.v1',
      rules: [{
        id: 'allow-docs-shape',
        effect: 'allow',
        reason: 'user_opened_docs_during_shape',
        match: { tools: ['apply_patch'], pathContains: ['docs/'], phases: ['shape'] }
      }]
    }), 'utf8');

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: 'apply_patch',
      tool_input: {
        patch: `*** Begin Patch\n*** Add File: ${path.join(projectRoot, 'docs', 'plan.md')}\n+ok\n*** End Patch\n`
      }
    }));
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'hook-enforce-audit.json');
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));

    expect(output).toBe('');
    expect(audit.allowed).toBe(true);
    expect(audit.dryRun.decisions[0].reason).toBe('project_policy_allow:user_opened_docs_during_shape');
  });

  test('permission-enforce fails closed when project policy json is malformed', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(path.join(projectRoot, '.ccpanes-task', 'policy.json'), '{not-json', 'utf8');

    const output = await runCli([
      'permission-enforce',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'PermissionRequest',
      cwd: projectRoot,
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test'
      }
    }));
    const parsed = JSON.parse(output);

    expect(parsed.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(parsed.hookSpecificOutput.decision.message).toContain('project_policy_invalid');
  });

  test('permission-enforce dynamic resolver no-ops when no task exists', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'permission-enforce',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'PermissionRequest',
      cwd: orphanCwd,
      tool_name: 'Bash',
      tool_input: {
        command: 'git reset --hard HEAD'
      }
    }));

    expect(output).toBe('');
  });

  test('post-enforce appends PostToolUse audit and emits no stdout', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'post-audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'post-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PostToolUse',
      cwd: projectRoot,
      tool_name: 'Bash',
      tool_use_id: 'toolu-post-1',
      tool_input: { command: 'npm test' },
      tool_response: { exit_code: 0, stdout: 'ok' }
    }));
    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'post-tool-use-audit.jsonl');
    const lines = (await fs.readFile(auditPath, 'utf8')).trim().split('\n');
    const record = JSON.parse(lines[0]);

    expect(output).toBe('');
    expect(lines).toHaveLength(1);
    expect(record).toMatchObject({
      schema: 'ccpanes.post-tool-use-audit.v1',
      taskId: 'task-alpha',
      toolName: 'Bash',
      toolUseId: 'toolu-post-1',
      inputSummary: { command: 'npm test' },
      responseSummary: { exit_code: 0, stdout: 'ok' }
    });
  });

  test('post-enforce appends instead of overwriting audit records', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'post-audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    for (const toolUseId of ['toolu-post-1', 'toolu-post-2']) {
      await runCli([
        'post-enforce',
        '--resolve-task-from-cwd',
        '--audit-root',
        auditRoot
      ], JSON.stringify({
        hook_event_name: 'PostToolUse',
        cwd: projectRoot,
        tool_name: 'Bash',
        tool_use_id: toolUseId,
        tool_input: { command: 'npm test' },
        tool_response: { stdout: toolUseId }
      }));
    }

    const auditPath = path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'post-tool-use-audit.jsonl');
    const lines = (await fs.readFile(auditPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).toolUseId).toBe('toolu-post-1');
    expect(JSON.parse(lines[1]).toolUseId).toBe('toolu-post-2');
  });

  test('post-enforce dynamic resolver no-ops when cwd has no task', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan');
    const auditRoot = path.join(tempRoot, 'post-audits');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'post-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PostToolUse',
      cwd: orphanCwd,
      tool_name: 'Bash',
      tool_response: { stdout: 'orphan' }
    }));

    expect(output).toBe('');
    await expect(fs.stat(auditRoot)).rejects.toThrow();
  });

  test('session-start resolves current task from cwd and emits Codex additionalContext JSON', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const nestedCwd = path.join(projectRoot, 'packages', 'demo');
    const auditRoot = path.join(tempRoot, 'lifecycle-audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.mkdir(nestedCwd, { recursive: true });

    const output = await runCli([
      'session-start',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'startup',
      cwd: nestedCwd
    }));
    const parsed = JSON.parse(output);

    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('taskId: task-alpha');
    expect(parsed.hookSpecificOutput.additionalContext).toContain(path.join(projectRoot, '.ccpanes-task', 'current-task.json'));
    expect(parsed.hookSpecificOutput.additionalContext).toContain(path.join(auditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url')));
  });

  test('session-start dynamic resolver no-ops when cwd has no task', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'session-start',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'SessionStart',
      source: 'startup',
      cwd: orphanCwd
    }));

    expect(output).toBe('');
  });

  test('stop-check emits a non-blocking Stop reminder for current task', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const auditRoot = path.join(tempRoot, 'lifecycle-audits');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));

    const output = await runCli([
      'stop-check',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'Stop',
      cwd: projectRoot,
      turn_id: 'turn-1',
      stop_hook_active: false,
      last_assistant_message: 'done'
    }));
    const parsed = JSON.parse(output);

    expect(parsed.continue).toBe(true);
    expect(parsed).not.toHaveProperty('decision');
    expect(parsed.systemMessage).toContain('task-alpha');
    expect(parsed.systemMessage).toContain('verify-acceptance');
  });

  test('stop-check emits targeted reminder from transcript evidence', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const transcriptPath = path.join(tempRoot, 'transcript.jsonl');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(transcriptPath, [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '修复 src/foo.ts' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(projectRoot, 'src', 'foo.ts') } }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '已修复，测试通过。' }] } })
    ].join('\n'), 'utf8');

    const output = await runCli([
      'stop-check',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'Stop',
      cwd: projectRoot,
      stop_hook_active: false,
      transcript_path: transcriptPath
    }));
    const parsed = JSON.parse(output);

    expect(parsed.continue).toBe(true);
    expect(parsed.systemMessage).toContain('targeted verification reminder');
    expect(parsed.systemMessage).toContain('claim-specific checks');
  });

  test('stop-check dynamic resolver no-ops when cwd has no task', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'stop-check',
      '--resolve-task-from-cwd'
    ], JSON.stringify({
      hook_event_name: 'Stop',
      cwd: orphanCwd,
      stop_hook_active: false
    }));

    expect(output).toBe('');
  });

  test('verify-installed-hooks prints a read-only installed hook verification report', async () => {
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const auditRoot = path.join(tempRoot, 'audits');
    const prototypeRoot = path.join(tempRoot, 'prototype');
    await fs.writeFile(hooksJsonPath, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: '^(startup|resume|clear|compact)$', hooks: [{ type: 'command', command: `node "${path.join(prototypeRoot, 'dist', 'src', 'cli.js')}" session-start --resolve-task-from-cwd --audit-root "${auditRoot}"`, additionalContextLimit: 1200 }] }],
        PreToolUse: [{ matcher: '^(apply_patch|Edit|Write|Bash|mcp__fastctx__(read|grep|glob|replace))$', hooks: [{ type: 'command', command: `node "${path.join(prototypeRoot, 'dist', 'src', 'cli.js')}" hook-enforce --resolve-task-from-cwd --audit-root "${auditRoot}"` }] }],
        PermissionRequest: [{ matcher: '^(apply_patch|Edit|Write|Bash|mcp__fastctx__(read|grep|glob|replace))$', hooks: [{ type: 'command', command: `node "${path.join(prototypeRoot, 'dist', 'src', 'cli.js')}" permission-enforce --resolve-task-from-cwd --audit-root "${auditRoot}"` }] }],
        PostToolUse: [{ matcher: '^(apply_patch|Edit|Write|Bash|mcp__fastctx__(read|grep|glob|replace))$', hooks: [{ type: 'command', command: `node "${path.join(prototypeRoot, 'dist', 'src', 'cli.js')}" post-enforce --resolve-task-from-cwd --audit-root "${auditRoot}"` }] }],
        Stop: [{ hooks: [{ type: 'command', command: `node "${path.join(prototypeRoot, 'dist', 'src', 'cli.js')}" stop-check --resolve-task-from-cwd --audit-root "${auditRoot}"` }] }]
      }
    }), 'utf8');

    const output = await runCli([
      'verify-installed-hooks',
      '--hooks-json',
      hooksJsonPath,
      '--prototype-root',
      prototypeRoot,
      '--audit-root',
      auditRoot
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.installed-hooks.verify.v1');
    expect(parsed.passed).toBe(true);
  });

  test('create-production-toolkit writes production scripts and manifest', async () => {
    const outDir = path.join(tempRoot, 'phase23-toolkit');
    const output = await runCli([
      'create-production-toolkit',
      '--out-dir',
      outDir,
      '--prototype-root',
      path.join(tempRoot, 'prototype'),
      '--audit-root',
      path.join(tempRoot, 'audits'),
      '--hooks-json',
      path.join(tempRoot, 'hooks.json'),
      '--config',
      path.join(tempRoot, 'config.toml'),
      '--expected-upstream-hook',
      'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe',
      '--expected-upstream-sha256',
      'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4'
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.production-toolkit-manifest.v1');
    await expect(fs.stat(path.join(outDir, 'INSTALL-HOOKS.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'VERIFY-INSTALLED.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'BOOTSTRAP-PROJECT.ps1'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'ROLLBACK-HOOKS.ps1'))).resolves.toBeTruthy();
  });

  test('hook-enforce dynamic resolver no-ops when cwd has no current-task.json ancestor', async () => {
    const orphanCwd = path.join(tempRoot, 'orphan', 'nested');
    const auditRoot = path.join(tempRoot, 'audits');
    await fs.mkdir(orphanCwd, { recursive: true });

    const output = await runCli([
      'hook-enforce',
      '--resolve-task-from-cwd',
      '--audit-root',
      auditRoot
    ], JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: orphanCwd,
      tool_name: 'apply_patch',
      tool_input: {
        command: '*** Begin Patch\n*** Update File: C:/Users/AI001/.codex/config.toml\n@@\n-old\n+new\n*** End Patch\n'
      }
    }));

    expect(output).toBe('');
    await expect(fs.stat(auditRoot)).rejects.toThrow();
  });

  test('runs hook-shadow from stdin, records upstream metadata, and writes audit output', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outPath = path.join(tempRoot, 'shadow-audit.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');

    const output = await runCli([
      'hook-shadow',
      '--task',
      currentTaskPath,
      '--upstream-hook',
      upstreamHook,
      '--out',
      outPath
    ], JSON.stringify({
      event: 'tool_call',
      tool: 'write',
      arguments: { path: path.join(projectRoot, 'src', 'a.ts') }
    }));
    const parsed = JSON.parse(output);
    const written = JSON.parse(await fs.readFile(outPath, 'utf8'));

    expect(parsed.schema).toBe('ccpanes.hook-shadow-audit.v1');
    expect(parsed.mode).toBe('shadow');
    expect(parsed.upstreamHook.sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(parsed.runner.allowed).toBe(true);
    expect(written.schema).toBe('ccpanes.hook-shadow-audit.v1');
    expect(written.runner.dryRun.decisions[0].reason).toBe('build_write_inside_worktree');
  });

  test('prints review-only hook install plan and writes plan output', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outPath = path.join(tempRoot, 'hook-install-plan.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');

    const output = await runCli([
      'plan-hook-install',
      '--prototype-root',
      'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      '--task',
      currentTaskPath,
      '--target',
      'both',
      '--upstream-hook',
      upstreamHook,
      '--out',
      outPath
    ]);
    const parsed = JSON.parse(output);
    const written = JSON.parse(await fs.readFile(outPath, 'utf8'));

    expect(parsed.schema).toBe('ccpanes.hook-install-plan.v1');
    expect(parsed.mode).toBe('review-only');
    expect(parsed.target).toBe('both');
    expect(parsed.proposedConfigChanges).toHaveLength(2);
    expect(parsed.proposedConfigChanges[0].patchCandidate).toContain('hook-shadow');
    expect(written.schema).toBe('ccpanes.hook-install-plan.v1');
  });

  test('creates review-only hook package and prints manifest', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outDir = path.join(tempRoot, 'hook-package');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');

    const output = await runCli([
      'create-hook-package',
      '--prototype-root',
      'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      '--task',
      currentTaskPath,
      '--target',
      'both',
      '--upstream-hook',
      upstreamHook,
      '--out-dir',
      outDir
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-package-manifest.v1');
    expect(parsed.mode).toBe('review-only');
    expect(parsed.files.some((file: { path: string }) => file.path.endsWith('rollback-plan.json'))).toBe(true);
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'patches', 'codex.patch'))).resolves.toBeTruthy();
  });

  test('rehearses hook package and writes report', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outDir = path.join(tempRoot, 'hook-package');
    const reportPath = path.join(tempRoot, 'hook-package-rehearsal.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    const manifest = JSON.parse(await runCli([
      'create-hook-package',
      '--prototype-root',
      'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      '--task',
      currentTaskPath,
      '--target',
      'both',
      '--upstream-hook',
      upstreamHook,
      '--out-dir',
      outDir
    ]));

    const output = await runCli([
      'rehearse-hook-package',
      '--package-dir',
      outDir,
      '--expected-upstream-sha256',
      manifest.upstreamHookSha256,
      '--out',
      reportPath
    ]);
    const parsed = JSON.parse(output);
    const written = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    expect(parsed.schema).toBe('ccpanes.hook-package-rehearsal.v1');
    expect(parsed.passed).toBe(true);
    expect(parsed.failures).toEqual([]);
    expect(written.schema).toBe('ccpanes.hook-package-rehearsal.v1');
  });

  test('creates release gate report with config snapshots and repo status', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const outDir = path.join(tempRoot, 'hook-package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    const reportPath = path.join(tempRoot, 'release-gate.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    await fs.writeFile(configPath, 'config bytes', 'utf8');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
    await runCli([
      'create-hook-package',
      '--prototype-root',
      'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      '--task',
      currentTaskPath,
      '--target',
      'both',
      '--upstream-hook',
      upstreamHook,
      '--out-dir',
      outDir
    ]);
    const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));

    const output = await runCli([
      'release-gate',
      '--package-dir',
      outDir,
      '--expected-upstream-sha256',
      manifest.upstreamHookSha256,
      '--config',
      configPath,
      '--repo',
      repoPath,
      '--check',
      'smoke=pass=SMOKE_PASS',
      '--out',
      reportPath
    ]);
    const parsed = JSON.parse(output);
    const written = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    expect(parsed.schema).toBe('ccpanes.hook-release-gate.v1');
    expect(parsed.mode).toBe('final-preflight');
    expect(parsed.passed).toBe(true);
    expect(parsed.configSnapshots[0].sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(parsed.referenceRepos[0].status).toBe('clean');
    expect(written.schema).toBe('ccpanes.hook-release-gate.v1');
  });

  test('creates staged hook apply plan from release gate', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const packageDir = path.join(tempRoot, 'hook-package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const outDir = path.join(tempRoot, 'apply-plan');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    await fs.writeFile(configPath, 'config bytes', 'utf8');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
    await runCli([
      'create-hook-package',
      '--prototype-root',
      'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      '--task',
      currentTaskPath,
      '--target',
      'both',
      '--upstream-hook',
      upstreamHook,
      '--out-dir',
      packageDir
    ]);
    const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'manifest.json'), 'utf8'));
    await runCli([
      'release-gate',
      '--package-dir',
      packageDir,
      '--expected-upstream-sha256',
      manifest.upstreamHookSha256,
      '--config',
      configPath,
      '--repo',
      repoPath,
      '--check',
      'smoke=pass=SMOKE_PASS',
      '--out',
      releaseGatePath
    ]);

    const output = await runCli([
      'create-hook-apply-plan',
      '--release-gate',
      releaseGatePath,
      '--out-dir',
      outDir
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-apply-plan.v1');
    expect(parsed.mode).toBe('staged-review');
    expect(parsed.releaseGatePassed).toBe(true);
    await expect(fs.stat(path.join(outDir, 'apply-plan.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'staged-patches', 'codex.patch'))).resolves.toBeTruthy();
  });

  test('checks hook approval package and writes approval report', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const packageDir = path.join(tempRoot, 'hook-package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const applyPlanDir = path.join(tempRoot, 'apply-plan');
    const applyPlanPath = path.join(applyPlanDir, 'apply-plan.json');
    const approvalPath = path.join(tempRoot, 'approval.json');
    const reportPath = path.join(tempRoot, 'approval-check.json');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    await fs.writeFile(configPath, 'config bytes', 'utf8');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
    await runCli([
      'create-hook-package', '--prototype-root', 'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      '--task', currentTaskPath, '--target', 'both', '--upstream-hook', upstreamHook, '--out-dir', packageDir
    ]);
    const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'manifest.json'), 'utf8'));
    await runCli([
      'release-gate', '--package-dir', packageDir, '--expected-upstream-sha256', manifest.upstreamHookSha256,
      '--config', configPath, '--repo', repoPath, '--check', 'smoke=pass=SMOKE_PASS', '--out', releaseGatePath
    ]);
    await runCli(['create-hook-apply-plan', '--release-gate', releaseGatePath, '--out-dir', applyPlanDir]);
    await fs.writeFile(approvalPath, `${JSON.stringify({
      schema: 'ccpanes.hook-approval.v1',
      approved: true,
      applyPlanSha256: await sha256File(applyPlanPath),
      releaseGateSha256: await sha256File(releaseGatePath),
      targetConfigPaths: [configPath],
      expectedConfigSha256ByPath: { [configPath]: await sha256File(configPath) },
      backupDir: path.join(applyPlanDir, 'backups'),
      rollbackCommand: path.join(applyPlanDir, 'scripts', 'restore-from-backup.ps1'),
      writeWindow: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }
    }, null, 2)}\n`, 'utf8');

    const output = await runCli(['check-hook-approval', '--apply-plan', applyPlanPath, '--approval', approvalPath, '--out', reportPath]);
    const parsed = JSON.parse(output);
    const written = JSON.parse(await fs.readFile(reportPath, 'utf8'));

    expect(parsed.schema).toBe('ccpanes.hook-approval-check.v1');
    expect(parsed.passed).toBe(true);
    expect(parsed.checks.find((check: { name: string; result: string }) => check.name === 'approval intent')?.result).toBe('pass');
    expect(written.schema).toBe('ccpanes.hook-approval-check.v1');
  });

  test('creates hook write preview from approval check', async () => {
    const projectRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(projectRoot, '.ccpanes-task', 'current-task.json');
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    const packageDir = path.join(tempRoot, 'hook-package');
    const configPath = path.join(tempRoot, 'config.toml');
    const repoPath = path.join(tempRoot, 'repo');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const applyPlanDir = path.join(tempRoot, 'apply-plan');
    const applyPlanPath = path.join(applyPlanDir, 'apply-plan.json');
    const approvalPath = path.join(tempRoot, 'approval.json');
    const approvalCheckPath = path.join(tempRoot, 'approval-check.json');
    const outDir = path.join(tempRoot, 'write-preview');
    await writeCurrentTaskAtomic(projectRoot, task(projectRoot, 'task-alpha'));
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');
    await fs.writeFile(configPath, 'original = true\n', 'utf8');
    await fs.mkdir(repoPath, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
    await runCli(['create-hook-package', '--prototype-root', 'D:/cc-pane/tool/experiments/ccpanes-task-probe', '--task', currentTaskPath, '--target', 'both', '--upstream-hook', upstreamHook, '--out-dir', packageDir]);
    const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'manifest.json'), 'utf8'));
    await runCli(['release-gate', '--package-dir', packageDir, '--expected-upstream-sha256', manifest.upstreamHookSha256, '--config', configPath, '--repo', repoPath, '--check', 'smoke=pass=SMOKE_PASS', '--out', releaseGatePath]);
    await runCli(['create-hook-apply-plan', '--release-gate', releaseGatePath, '--out-dir', applyPlanDir]);
    await fs.writeFile(approvalPath, `${JSON.stringify({
      schema: 'ccpanes.hook-approval.v1',
      approved: true,
      applyPlanSha256: await sha256File(applyPlanPath),
      releaseGateSha256: await sha256File(releaseGatePath),
      targetConfigPaths: [configPath],
      expectedConfigSha256ByPath: { [configPath]: await sha256File(configPath) },
      backupDir: path.join(applyPlanDir, 'backups'),
      rollbackCommand: path.join(applyPlanDir, 'scripts', 'restore-from-backup.ps1'),
      writeWindow: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }
    }, null, 2)}\n`, 'utf8');
    await runCli(['check-hook-approval', '--apply-plan', applyPlanPath, '--approval', approvalPath, '--out', approvalCheckPath]);

    const output = await runCli(['preview-hook-write', '--approval-check', approvalCheckPath, '--out-dir', outDir]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-write-preview.v1');
    expect(parsed.mode).toBe('dry-run-write-preview');
    expect(parsed.entries[0].configPath).toBe(configPath);
    await expect(fs.stat(path.join(outDir, 'write-preview.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'backup-manifest.json'))).resolves.toBeTruthy();
  });

  test('applies hook write preview to an explicitly allowed synthetic config', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const previewFixture = path.join(tempRoot, 'preview-fixture');
    const beforePath = path.join(previewFixture, 'before.toml');
    const afterPath = path.join(previewFixture, 'after.toml');
    const diffPath = path.join(previewFixture, 'config.diff');
    const approvalCheckPath = path.join(previewFixture, 'approval-check.json');
    const writePreviewPath = path.join(previewFixture, 'write-preview.json');
    const outDir = path.join(tempRoot, 'apply-report');
    const outPath = path.join(outDir, 'apply-report.json');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.mkdir(previewFixture, { recursive: true });
    await fs.writeFile(configPath, before, 'utf8');
    await fs.writeFile(beforePath, before, 'utf8');
    await fs.writeFile(afterPath, after, 'utf8');
    await fs.writeFile(diffPath, `--- ${configPath}\n+++ ${configPath}.preview\n@@\n`, 'utf8');
    await fs.writeFile(approvalCheckPath, `${JSON.stringify({
      schema: 'ccpanes.hook-approval-check.v1',
      passed: true,
      applyPlanPath: path.join(previewFixture, 'apply-plan.json')
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(writePreviewPath, `${JSON.stringify({
      schema: 'ccpanes.hook-write-preview.v1',
      mode: 'dry-run-write-preview',
      createdAt: '2026-08-06T00:00:00.000Z',
      approvalCheckPath,
      approvalCheckPassed: true,
      entries: [{
        configPath,
        beforePreviewPath: beforePath,
        afterPreviewPath: afterPath,
        diffPreviewPath: diffPath,
        beforeSha256: sha256Text(before),
        afterSha256: sha256Text(after)
      }],
      artifacts: []
    }, null, 2)}\n`, 'utf8');

    const output = await runCli([
      'apply-hook-write',
      '--write-preview',
      writePreviewPath,
      '--approval-check',
      approvalCheckPath,
      '--out',
      outPath,
      '--allow-root',
      configRoot
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-write-apply.v1');
    expect(parsed.mode).toBe('guarded-apply');
    expect(parsed.passed).toBe(true);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(after);
    await expect(fs.stat(parsed.entries[0].backupPath)).resolves.toBeTruthy();
    await expect(fs.stat(outPath)).resolves.toBeTruthy();
  });

  test('restores hook write apply report to an explicitly allowed synthetic config', async () => {
    const configRoot = path.join(tempRoot, 'allowed-config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const backupPath = path.join(tempRoot, 'backups', 'config.bak');
    const applyReportPath = path.join(tempRoot, 'hook-write-apply.json');
    const restoreReportPath = path.join(tempRoot, 'hook-write-restore.json');
    const before = 'original = true\n';
    const after = 'changed = true\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(configPath, after, 'utf8');
    await fs.writeFile(backupPath, before, 'utf8');
    await fs.writeFile(applyReportPath, `${JSON.stringify({
      schema: 'ccpanes.hook-write-apply.v1',
      mode: 'guarded-apply',
      createdAt: '2026-08-06T00:00:00.000Z',
      approvalCheckPath: path.join(tempRoot, 'approval-check.json'),
      writePreviewPath: path.join(tempRoot, 'write-preview.json'),
      allowRoots: [configRoot],
      passed: true,
      entries: [{
        configPath,
        backupPath,
        beforeSha256: sha256Text(before),
        afterSha256: sha256Text(after),
        verifiedAfterSha256: sha256Text(after)
      }],
      failures: []
    }, null, 2)}\n`, 'utf8');

    const output = await runCli([
      'restore-hook-write',
      '--apply-report',
      applyReportPath,
      '--out',
      restoreReportPath,
      '--allow-root',
      configRoot
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-write-restore.v1');
    expect(parsed.mode).toBe('guarded-restore');
    expect(parsed.passed).toBe(true);
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(before);
    await expect(fs.stat(restoreReportPath)).resolves.toBeTruthy();
  });

  test('creates production readiness report from the five gate artifacts', async () => {
    const configRoot = path.join(tempRoot, 'config-root');
    const configPath = path.join(configRoot, 'config.toml');
    const before = 'original = true\n';
    await fs.mkdir(configRoot, { recursive: true });
    await fs.writeFile(configPath, before, 'utf8');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const approvalCheckPath = path.join(tempRoot, 'approval-check.json');
    const writePreviewPath = path.join(tempRoot, 'write-preview.json');
    const applyReportPath = path.join(tempRoot, 'apply-report.json');
    const restoreReportPath = path.join(tempRoot, 'restore-report.json');
    const readinessPath = path.join(tempRoot, 'production-readiness.json');
    await fs.writeFile(releaseGatePath, `${JSON.stringify({
      schema: 'ccpanes.hook-release-gate.v1',
      mode: 'final-preflight',
      passed: true,
      configSnapshots: [{ path: configPath, exists: true, size: before.length, lastWriteUtc: '2026-08-06T00:00:00.000Z', sha256: sha256Text(before) }],
      referenceRepos: [{ path: path.join(tempRoot, 'repo'), isGitRepo: true, head: 'HEAD', status: 'clean', statusShort: '' }],
      checks: [],
      failures: []
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(approvalCheckPath, `${JSON.stringify({
      schema: 'ccpanes.hook-approval-check.v1',
      mode: 'approval-preflight',
      passed: true,
      applyPlanPath: path.join(tempRoot, 'apply-plan.json'),
      configSnapshots: [{ path: configPath, exists: true, sha256: sha256Text(before), expectedSha256: sha256Text(before) }],
      checks: [],
      failures: []
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(writePreviewPath, `${JSON.stringify({
      schema: 'ccpanes.hook-write-preview.v1',
      mode: 'dry-run-write-preview',
      approvalCheckPath,
      approvalCheckPassed: true,
      entries: [{ configPath, beforeSha256: sha256Text(before), afterSha256: sha256Text(`${before}# preview\n`) }],
      artifacts: []
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(applyReportPath, `${JSON.stringify({
      schema: 'ccpanes.hook-write-apply.v1',
      mode: 'guarded-apply',
      passed: true,
      entries: [{ configPath, beforeSha256: sha256Text(before), afterSha256: sha256Text(`${before}# preview\n`), verifiedAfterSha256: sha256Text(`${before}# preview\n`) }],
      failures: []
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(restoreReportPath, `${JSON.stringify({
      schema: 'ccpanes.hook-write-restore.v1',
      mode: 'guarded-restore',
      passed: true,
      entries: [{ configPath, beforeSha256: sha256Text(before), afterSha256: sha256Text(`${before}# preview\n`), restoredSha256: sha256Text(before) }],
      failures: []
    }, null, 2)}\n`, 'utf8');

    const output = await runCli([
      'production-readiness',
      '--release-gate',
      releaseGatePath,
      '--approval-check',
      approvalCheckPath,
      '--write-preview',
      writePreviewPath,
      '--apply-report',
      applyReportPath,
      '--restore-report',
      restoreReportPath,
      '--out',
      readinessPath
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-production-readiness.v1');
    expect(parsed.mode).toBe('final-readiness');
    expect(parsed.ready).toBe(true);
    await expect(fs.stat(readinessPath)).resolves.toBeTruthy();
  });

  test('creates go-live approval package from a ready report', async () => {
    const configPath = path.join(tempRoot, 'config.toml');
    const configText = 'original = true\n';
    await fs.writeFile(configPath, configText, 'utf8');
    const releaseGatePath = path.join(tempRoot, 'release-gate.json');
    const approvalCheckPath = path.join(tempRoot, 'approval-check.json');
    const writePreviewPath = path.join(tempRoot, 'write-preview.json');
    const applyReportPath = path.join(tempRoot, 'apply-report.json');
    const restoreReportPath = path.join(tempRoot, 'restore-report.json');
    const readinessPath = path.join(tempRoot, 'production-readiness.json');
    const outDir = path.join(tempRoot, 'go-live-approval-package');
    await fs.writeFile(releaseGatePath, `${JSON.stringify({
      schema: 'ccpanes.hook-release-gate.v1',
      mode: 'final-preflight',
      passed: true,
      configSnapshots: [{ path: configPath, exists: true, size: configText.length, lastWriteUtc: '2026-08-06T00:00:00.000Z', sha256: sha256Text(configText) }],
      referenceRepos: [{ path: path.join(tempRoot, 'repo'), isGitRepo: true, head: 'HEAD', status: 'clean', statusShort: '' }],
      checks: [],
      failures: []
    }, null, 2)}\n`, 'utf8');
    for (const filePath of [approvalCheckPath, writePreviewPath, applyReportPath, restoreReportPath]) {
      await fs.writeFile(filePath, '{}\n', 'utf8');
    }
    await fs.writeFile(readinessPath, `${JSON.stringify({
      schema: 'ccpanes.hook-production-readiness.v1',
      mode: 'final-readiness',
      ready: true,
      releaseGatePath,
      approvalCheckPath,
      writePreviewPath,
      applyReportPath,
      restoreReportPath,
      checks: [],
      failures: []
    }, null, 2)}\n`, 'utf8');

    const output = await runCli([
      'create-go-live-approval-package',
      '--readiness',
      readinessPath,
      '--out-dir',
      outDir,
      '--approved-by',
      'AI001',
      '--approval-note',
      'manual authorization approved',
      '--upstream-hook',
      'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe'
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-go-live-approval-package.v1');
    expect(parsed.manualApproval.approvedBy).toBe('AI001');
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'GO-LIVE-APPROVAL.md'))).resolves.toBeTruthy();
  });

  test('creates final runbook from a go-live manifest', async () => {
    const goLiveDir = path.join(tempRoot, 'go-live-approval-package');
    const goLiveManifestPath = path.join(goLiveDir, 'manifest.json');
    const outDir = path.join(tempRoot, 'final-runbook');
    await fs.mkdir(goLiveDir, { recursive: true });
    await fs.writeFile(goLiveManifestPath, `${JSON.stringify({
      schema: 'ccpanes.hook-go-live-approval-package.v1',
      mode: 'manual-approval-package',
      createdAt: '2026-08-06T00:00:00.000Z',
      outDir: goLiveDir,
      readiness: { path: path.join(tempRoot, 'production-readiness.json'), sha256: 'R'.repeat(64), ready: true },
      upstreamHook: { path: 'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe', sha256: 'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4' },
      manualApproval: { approved: true, approvedBy: 'AI001', approvedAt: '2026-08-06T00:00:00.000Z', note: 'manual authorization approved' },
      targetConfigSnapshots: [{ path: path.join(tempRoot, 'config.toml'), sha256: 'C'.repeat(64), size: 10 }],
      evidencePaths: {},
      files: []
    }, null, 2)}\n`, 'utf8');

    const output = await runCli([
      'create-final-runbook',
      '--go-live-manifest',
      goLiveManifestPath,
      '--out-dir',
      outDir
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.hook-final-runbook.v1');
    expect(parsed.mode).toBe('manual-execution-runbook');
    await expect(fs.stat(path.join(outDir, 'manifest.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outDir, 'FINAL-RUNBOOK.md'))).resolves.toBeTruthy();
  });

  test('prints acceptance evidence JSON for a task and artifact', async () => {
    const taskRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(taskRoot, '.ccpanes-task', 'current-task.json');
    const artifactPath = path.join(tempRoot, 'artifact.md');
    await writeCurrentTaskAtomic(taskRoot, task(taskRoot, 'task-alpha'));
    await fs.writeFile(artifactPath, 'artifact content', 'utf8');

    const output = await runCli([
      'record-acceptance',
      '--task', currentTaskPath,
      '--artifact', artifactPath,
      '--check', 'unit tests=pass=34 tests passed',
      '--truth', 'reference-repos=pass=comet clean; fastctx clean'
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.schema).toBe('ccpanes.acceptance.v1');
    expect(parsed.taskId).toBe('task-alpha');
    expect(parsed.artifactHashes[0].path).toBe(artifactPath);
    expect(parsed.artifactHashes[0].sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(parsed.checks[0]).toEqual({ name: 'unit tests', command: 'unit tests', result: 'pass', evidence: '34 tests passed' });
    expect(parsed.truthLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'reference-repos', state: 'pass', required: true }),
      expect.objectContaining({ name: 'completion', state: 'pass' })
    ]));
    expect(parsed.summary.completionAllowed).toBe(true);
  });
  test('prints acceptance verify JSON from an input file', async () => {
    const taskRoot = path.join(tempRoot, 'project-alpha');
    const currentTaskPath = path.join(taskRoot, '.ccpanes-task', 'current-task.json');
    const artifactPath = path.join(tempRoot, 'artifact.md');
    const acceptancePath = path.join(tempRoot, 'acceptance.json');
    await writeCurrentTaskAtomic(taskRoot, task(taskRoot, 'task-alpha'));
    await fs.writeFile(artifactPath, 'artifact content', 'utf8');

    const acceptanceOutput = await runCli([
      'record-acceptance',
      '--task', currentTaskPath,
      '--artifact', artifactPath,
      '--check', 'unit tests=pass=37 tests passed'
    ]);
    await fs.writeFile(acceptancePath, acceptanceOutput, 'utf8');

    const verifyOutput = await runCli(['verify-acceptance', '--input', acceptancePath]);
    const parsed = JSON.parse(verifyOutput);

    expect(parsed.schema).toBe('ccpanes.acceptance.verify.v1');
    expect(parsed.taskId).toBe('task-alpha');
    expect(parsed.passed).toBe(true);
    expect(parsed.artifactResults[0].status).toBe('match');
    expect(parsed.failures).toEqual([]);
  });
});

describe('isCliEntrypoint', () => {
  test('matches Windows paths using file URL conversion', () => {
    const argvPath = 'D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe\\dist\\src\\cli.js';
    expect(isCliEntrypoint(pathToFileURL(argvPath).href, argvPath)).toBe(true);
  });

  test('does not match a different entrypoint', () => {
    const cliPath = 'D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe\\dist\\src\\cli.js';
    const otherPath = 'D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe\\dist\\src\\other.js';
    expect(isCliEntrypoint(pathToFileURL(cliPath).href, otherPath)).toBe(false);
  });
});
