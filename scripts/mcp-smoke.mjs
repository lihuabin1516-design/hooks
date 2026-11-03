import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { deployRuntime } from '../dist/src/runtime-deployment.js';

const auditRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gzl-hooks-mcp-smoke-'));
const projectRoot = path.join(auditRoot, 'project-alpha');
const taskDir = path.join(projectRoot, '.paneforge-task');
const currentTaskPath = path.join(taskDir, 'current-task.json');
const acceptancePath = path.join(taskDir, 'acceptance.json');
const trustedCliPath = path.resolve('dist/src/cli.js');
const runtimeIdentity = JSON.parse(await fs.readFile(path.resolve('dist/src/runtime-identity.json'), 'utf8'));
const taskAuditDir = path.join(auditRoot, Buffer.from('mcp-smoke', 'utf8').toString('base64url'));
const task = {
  schema: 'paneforge.task-selection.v1',
  taskId: 'mcp-smoke',
  workspace: 'mcp-smoke-workspace',
  projectPath: projectRoot,
  worktreeRoot: projectRoot,
  mainRepoRoot: null,
  branch: null,
  head: runtimeIdentity.gitCommit,
  owner: { leaderSessionId: null, paneId: null, layoutId: null },
  phase: 'build',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  source: 'manual-import',
  notes: 'MCP lifecycle smoke fixture'
};
await fs.mkdir(taskDir, { recursive: true });
await fs.writeFile(currentTaskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/src/mcp-server.js'],
  cwd: process.cwd(),
  env: { ...process.env, GZL_HOOK_AUDIT_ROOT: auditRoot },
  stderr: 'pipe'
});
const client = new Client({ name: 'gzl-hooks-smoke', version: '1.0.0' });

async function callHook(command, event) {
  return callHookWith(client, command, event);
}

async function callHookWith(targetClient, command, event) {
  const result = await targetClient.callTool({
    name: 'dispatch',
    arguments: { command, event }
  });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

async function copyFixtureProductionDependencies(targetRoot) {
  const lock = JSON.parse(await fs.readFile(path.resolve('package-lock.json'), 'utf8'));
  const packagePaths = Object.entries(lock.packages ?? {})
    .filter(([packagePath, metadata]) => packagePath.startsWith('node_modules/') && metadata?.dev !== true)
    .map(([packagePath]) => packagePath)
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
  for (const packagePath of packagePaths) {
    const source = path.resolve(packagePath);
    try {
      if (!(await fs.stat(source)).isDirectory()) continue;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const target = path.join(targetRoot, ...packagePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (sourcePath) => {
        const relative = path.relative(source, sourcePath);
        return relative !== 'node_modules' && !relative.startsWith(`node_modules${path.sep}`);
      }
    });
  }
}

async function smokeIsolatedDeployment() {
  const packageRoot = path.join(auditRoot, 'isolated-package');
  const runtimeRoot = path.join(auditRoot, 'isolated-runtime');
  const packageJson = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.cp(path.resolve('dist'), path.join(packageRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(packageRoot, '.gitignore'), 'dist/\nnode_modules/\n', 'utf8');
  await copyFixtureProductionDependencies(packageRoot);
  execFileSync('git', ['init'], { cwd: packageRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'MCP Smoke'], { cwd: packageRoot });
  execFileSync('git', ['config', 'user.email', 'mcp-smoke@example.invalid'], { cwd: packageRoot });
  execFileSync('git', ['add', 'package.json', '.gitignore'], { cwd: packageRoot });
  execFileSync('git', ['commit', '-m', 'isolated runtime fixture'], { cwd: packageRoot, stdio: 'ignore' });
  const fixtureCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).trim();
  const fixtureIdentityPath = path.join(packageRoot, 'dist', 'src', 'runtime-identity.json');
  const fixtureIdentity = JSON.parse(await fs.readFile(fixtureIdentityPath, 'utf8'));
  fixtureIdentity.gitCommit = fixtureCommit;
  fixtureIdentity.gitDirty = false;
  await fs.writeFile(fixtureIdentityPath, `${JSON.stringify(fixtureIdentity, null, 2)}\n`, 'utf8');

  const deployment = await deployRuntime({ sourceDir: packageRoot, runtimeRoot, allowRoots: [auditRoot] });
  const isolatedTransport = new StdioClientTransport({
    command: process.execPath,
    args: [deployment.launcherPaths.mcpServer],
    cwd: runtimeRoot,
    env: { ...process.env, GZL_HOOK_AUDIT_ROOT: path.join(auditRoot, 'isolated-audits') },
    stderr: 'pipe'
  });
  const isolatedClient = new Client({ name: 'gzl-hooks-isolated-smoke', version: '1.0.0' });
  try {
    await isolatedClient.connect(isolatedTransport);
    const result = await isolatedClient.callTool({ name: 'runtime_identity', arguments: { expectedTaskHead: fixtureCommit } });
    const report = JSON.parse(result.content[0].text);
    assert.equal(report.runtimeIdentity.gitCommit, fixtureCommit);
    assert.equal(report.taskHeadComparison.status, 'match');
  } finally {
    await isolatedClient.close();
  }
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), ['dispatch', 'runtime_identity']);

  const identityResult = await client.callTool({
    name: 'runtime_identity',
    arguments: { expectedTaskHead: task.head }
  });
  const identityReport = JSON.parse(identityResult.content[0].text);
  assert.equal(identityReport.runtimeIdentity.source, 'build-manifest');
  assert.equal(identityReport.runtimeIdentity.buildSha256, runtimeIdentity.buildSha256);
  assert.equal(identityReport.taskHeadComparison.status, 'match');

  const sessionStart = JSON.parse(await callHook('session-start', {
    hook_event_name: 'SessionStart',
    session_id: 'mcp-smoke',
    transcript_path: null,
    cwd: projectRoot,
    model: 'smoke',
    permission_mode: 'bypassPermissions',
    source: 'startup'
  }));
  assert.equal(sessionStart.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(sessionStart.hookSpecificOutput.additionalContext, /taskId: mcp-smoke/);
  assert.match(sessionStart.hookSpecificOutput.additionalContext, /runtimeTaskHeadStatus: match/);

  const fastCtxRead = await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'mcp__fastctx__inspect_local_file',
    tool_use_id: 'mcp-smoke-read',
    tool_input: { file_path: path.join(projectRoot, 'README.md') }
  });
  assert.equal(fastCtxRead, '');

  for (const [toolName, toolInput] of [
    ['mcp__fastctx__run', { command: 'git status --short' }],
    ['mcp__fastctx__run_background', { command: 'git status --short' }],
    ['mcp__fastctx__job_output', { job_id: 'fixture-job' }],
    ['mcp__fastctx__job_list', {}],
    ['mcp__fastctx__job_kill', { job_id: 'fixture-job' }]
  ]) {
    const fastCtxLifecycle = await callHook('hook-enforce', {
      hook_event_name: 'PreToolUse',
      cwd: projectRoot,
      tool_name: toolName,
      tool_use_id: `mcp-smoke-${toolName}`,
      tool_input: toolInput
    });
    assert.equal(fastCtxLifecycle, '');
  }

  const blockedWrite = JSON.parse(await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'apply_patch',
    tool_use_id: 'mcp-smoke-block',
    tool_input: { command: '*** Begin Patch\n*** Update File: C:/Users/AI001/.codex/config.toml\n@@\n-old\n+new\n*** End Patch\n' }
  }));
  assert.equal(blockedWrite.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(blockedWrite.hookSpecificOutput.permissionDecisionReason, /forbidden_user_config_path/);

  const permission = JSON.parse(await callHook('permission-enforce', {
    hook_event_name: 'PermissionRequest',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: { command: 'git reset --hard HEAD', description: 'destructive smoke request' }
  }));
  assert.equal(permission.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(permission.hookSpecificOutput.decision.message, /destructive_git_reset_hard/);
  const preHistory = await fs.readFile(path.join(taskAuditDir, 'hook-enforce-audit.jsonl'), 'utf8');
  const permissionHistory = await fs.readFile(path.join(taskAuditDir, 'permission-enforce-audit.jsonl'), 'utf8');
  assert.match(preHistory, new RegExp(runtimeIdentity.buildSha256));
  assert.match(permissionHistory, new RegExp(runtimeIdentity.buildSha256));

  const secondTransport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/src/mcp-server.js'],
    cwd: process.cwd(),
    env: { ...process.env, GZL_HOOK_AUDIT_ROOT: auditRoot },
    stderr: 'pipe'
  });
  const secondClient = new Client({ name: 'gzl-hooks-concurrent-smoke', version: '1.0.0' });
  const concurrentIds = Array.from({ length: 12 }, (_, index) => `mcp-concurrent-${index}`);
  try {
    await secondClient.connect(secondTransport);
    const outputs = await Promise.all(concurrentIds.map((toolUseId, index) => callHookWith(index % 2 === 0 ? client : secondClient, 'hook-enforce', {
      hook_event_name: 'PreToolUse',
      session_id: 'mcp-concurrent',
      cwd: projectRoot,
      tool_name: 'mcp__fastctx__inspect_local_file',
      tool_use_id: toolUseId,
      tool_input: { file_path: path.join(projectRoot, 'README.md') }
    })));
    assert.ok(outputs.every((output) => output === ''));
  } finally {
    await secondClient.close();
  }
  const concurrentHistory = (await fs.readFile(path.join(taskAuditDir, 'hook-enforce-audit.jsonl'), 'utf8'))
    .trim().split('\n').map((line) => JSON.parse(line))
    .filter((record) => concurrentIds.includes(record.toolUseId));
  assert.equal(concurrentHistory.length, concurrentIds.length);

  await fs.writeFile(currentTaskPath, `${JSON.stringify({ ...task, phase: 'archive' }, null, 2)}\n`, 'utf8');
  const verifyAcceptance = await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: {
      command: `node "${trustedCliPath}" verify-acceptance --input "${acceptancePath}"`
    }
  });
  assert.equal(verifyAcceptance, '');
  const verifyAcceptanceAudit = JSON.parse(await fs.readFile(path.join(taskAuditDir, 'hook-enforce-audit.json'), 'utf8'));
  assert.equal(verifyAcceptanceAudit.dryRun.decisions[0].reason, 'project_policy_allow:trusted_task_lifecycle_verify_acceptance');

  const phaseTransition = await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: {
      command: `node "${trustedCliPath}" write-current --root "${projectRoot}" --task-id mcp-smoke --phase verify --workspace mcp-smoke-workspace`
    }
  });
  assert.equal(phaseTransition, '');
  const phaseTransitionAudit = JSON.parse(await fs.readFile(path.join(taskAuditDir, 'hook-enforce-audit.json'), 'utf8'));
  assert.equal(phaseTransitionAudit.dryRun.decisions[0].reason, 'project_policy_allow:trusted_task_lifecycle_phase_transition');

  const recordAcceptance = await callHook('permission-enforce', {
    hook_event_name: 'PermissionRequest',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: {
      command: `node "${trustedCliPath}" record-acceptance --task "${currentTaskPath}" --artifact "${path.join(projectRoot, 'README.md')}" > "${acceptancePath}"`
    }
  });
  assert.equal(recordAcceptance, '');
  const recordAcceptanceAudit = JSON.parse(await fs.readFile(path.join(taskAuditDir, 'permission-enforce-audit.json'), 'utf8'));
  assert.equal(recordAcceptanceAudit.dryRun.decisions[0].reason, 'project_policy_allow:trusted_task_lifecycle_record_acceptance');

  const appendAcceptance = JSON.parse(await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: {
      command: `node "${trustedCliPath}" record-acceptance --task "${currentTaskPath}" --artifact "${path.join(projectRoot, 'README.md')}" >> "${acceptancePath}"`
    }
  }));
  assert.equal(appendAcceptance.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(appendAcceptance.hookSpecificOutput.permissionDecisionReason, /phase_archive_blocks_implementation_write/);

  const archiveSourceWrite = JSON.parse(await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'Edit',
    tool_input: { file_path: path.join(projectRoot, 'src', 'a.ts') }
  }));
  assert.equal(archiveSourceWrite.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(archiveSourceWrite.hookSpecificOutput.permissionDecisionReason, /phase_archive_blocks_implementation_write/);

  const postOutput = await callHook('post-enforce', {
    hook_event_name: 'PostToolUse',
    cwd: projectRoot,
    tool_name: 'mcp__fastctx__inspect_local_file',
    tool_use_id: 'mcp-smoke-post',
    tool_input: { file_path: path.join(projectRoot, 'README.md') },
    tool_response: { content: [{ type: 'image', data: 'A'.repeat(4096), mimeType: 'image/png' }] }
  });
  assert.equal(postOutput, '');
  const postAudit = await fs.readFile(path.join(taskAuditDir, 'post-tool-use-audit.jsonl'), 'utf8');
  assert.match(postAudit, /"toolUseId":"mcp-smoke-post"/);
  assert.match(postAudit, /omitted image data: 4096 chars/);
  assert.doesNotMatch(postAudit, /AAAA/);
  assert.match(postAudit, new RegExp(runtimeIdentity.buildSha256));

  const stop = JSON.parse(await callHook('stop-check', {
    hook_event_name: 'Stop',
    cwd: projectRoot,
    turn_id: 'mcp-smoke-turn',
    stop_hook_active: false,
    last_assistant_message: 'done'
  }));
  assert.equal(stop.continue, true);
  assert.match(stop.systemMessage, /verify-acceptance/);

  await smokeIsolatedDeployment();

  process.stdout.write('MCP_SMOKE_PASS\n');
} finally {
  await client.close();
  await fs.rm(auditRoot, { recursive: true, force: true });
}
