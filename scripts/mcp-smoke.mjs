import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const auditRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gzl-hooks-mcp-smoke-'));
const projectRoot = path.join(auditRoot, 'project-alpha');
const taskDir = path.join(projectRoot, '.ccpanes-task');
await fs.mkdir(taskDir, { recursive: true });
await fs.writeFile(path.join(taskDir, 'current-task.json'), `${JSON.stringify({
  schema: 'ccpanes.task-selection.v1',
  taskId: 'mcp-smoke',
  workspace: 'mcp-smoke-workspace',
  projectPath: projectRoot,
  worktreeRoot: projectRoot,
  mainRepoRoot: null,
  branch: null,
  head: null,
  owner: { leaderSessionId: null, paneId: null, layoutId: null },
  phase: 'build',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  source: 'manual-import',
  notes: 'MCP lifecycle smoke fixture'
}, null, 2)}\n`, 'utf8');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/src/mcp-server.js'],
  cwd: process.cwd(),
  env: { ...process.env, GZL_HOOK_AUDIT_ROOT: auditRoot },
  stderr: 'pipe'
});
const client = new Client({ name: 'gzl-hooks-smoke', version: '1.0.0' });

async function callHook(command, event) {
  const result = await client.callTool({
    name: 'dispatch',
    arguments: { command, event }
  });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name), ['dispatch']);

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

  const fastCtxRead = await callHook('hook-enforce', {
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'mcp__fastctx__inspect_local_file',
    tool_use_id: 'mcp-smoke-read',
    tool_input: { file_path: path.join(projectRoot, 'README.md') }
  });
  assert.equal(fastCtxRead, '');

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

  const postOutput = await callHook('post-enforce', {
    hook_event_name: 'PostToolUse',
    cwd: projectRoot,
    tool_name: 'mcp__fastctx__inspect_local_file',
    tool_use_id: 'mcp-smoke-post',
    tool_input: { file_path: path.join(projectRoot, 'README.md') },
    tool_response: { content: [{ type: 'text', text: 'fixture' }] }
  });
  assert.equal(postOutput, '');
  const taskAuditDir = path.join(auditRoot, Buffer.from('mcp-smoke', 'utf8').toString('base64url'));
  const postAudit = await fs.readFile(path.join(taskAuditDir, 'post-tool-use-audit.jsonl'), 'utf8');
  assert.match(postAudit, /"toolUseId":"mcp-smoke-post"/);

  const stop = JSON.parse(await callHook('stop-check', {
    hook_event_name: 'Stop',
    cwd: projectRoot,
    turn_id: 'mcp-smoke-turn',
    stop_hook_active: false,
    last_assistant_message: 'done'
  }));
  assert.equal(stop.continue, true);
  assert.match(stop.systemMessage, /verify-acceptance/);

  process.stdout.write('MCP_SMOKE_PASS\n');
} finally {
  await client.close();
  await fs.rm(auditRoot, { recursive: true, force: true });
}
