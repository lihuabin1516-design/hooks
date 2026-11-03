import path from 'node:path';
import { readCurrentTask } from '../current-task.js';
import {
  DEFAULT_SESSION_SCOPE_TTL_MINUTES,
  grantSessionScopeAuthorization,
  listSessionScopeAuthorizations,
  readSessionScopeAuthorizations,
  revokeSessionScopeAuthorization,
  type SessionScopeGrant
} from '../session-scope-authorization.js';
import { normalizeForComparison } from '../paths.js';
import type { RunCliOptions } from '../cli-types.js';
import { valueAfter, valuesAfter } from '../cli-shared.js';

function parseTool(value: string): SessionScopeGrant['tools'][number] {
  if (value === 'edit' || value === 'write' || value === 'apply_patch') return value;
  throw new Error(`unsupported session scope tool: ${value}; expected edit, write, or apply_patch`);
}

async function taskAtRoot(root: string) {
  const task = await readCurrentTask(root);
  if (!task) throw new Error(`current task is missing under ${root}`);
  if (normalizeForComparison(path.resolve(root)) !== normalizeForComparison(task.worktreeRoot)) {
    throw new Error('current task worktreeRoot does not match --root');
  }
  return task;
}

export async function handleSessionScopeCommands(
  args: string[],
  stdinText: string | undefined,
  _options: RunCliOptions
): Promise<string | null> {
  const command = args[0];
  if (!['session-scope-grant', 'session-scope-list', 'session-scope-revoke'].includes(command ?? '')) return null;

  const root = valueAfter(args, '--root');
  if (!root) throw new Error('missing --root');
  const task = await taskAtRoot(root);

  if (command === 'session-scope-grant') {
    const instruction = valueAfter(args, '--instruction') ?? stdinText?.trim();
    if (!instruction) throw new Error('missing --instruction or stdin');
    const paths = valuesAfter(args, '--path').map((candidate) => ({
      path: candidate,
      recursive: args.includes('--recursive')
    }));
    const grant = await grantSessionScopeAuthorization(task, {
      paths,
      tools: valuesAfter(args, '--tool').map(parseTool),
      ttlMinutes: Number(valueAfter(args, '--ttl-minutes') ?? DEFAULT_SESSION_SCOPE_TTL_MINUTES),
      reason: valueAfter(args, '--reason') ?? instruction,
      instruction
    });
    return `${JSON.stringify({ schema: 'paneforge.session-scope-grant-result.v1', changed: true, taskId: task.taskId, grant }, null, 2)}\n`;
  }

  if (command === 'session-scope-list') {
    const [grants, authorizations] = await Promise.all([
      listSessionScopeAuthorizations(task),
      readSessionScopeAuthorizations(task.worktreeRoot)
    ]);
    const intents = authorizations.intents.map((intent) => ({
      ...intent,
      status: Date.parse(intent.expiresAt) > Date.now() ? 'active' : 'expired'
    }));
    return `${JSON.stringify({ schema: 'paneforge.session-scope-list-result.v1', changed: false, taskId: task.taskId, grants, intents }, null, 2)}\n`;
  }

  const id = valueAfter(args, '--id');
  if (!id) throw new Error('missing --id');
  const wasAlreadyRevoked = (await listSessionScopeAuthorizations(task)).find((grant) => grant.id === id)?.status === 'revoked';
  const grant = await revokeSessionScopeAuthorization(task, id);
  return `${JSON.stringify({ schema: 'paneforge.session-scope-revoke-result.v1', changed: !wasAlreadyRevoked, taskId: task.taskId, grant }, null, 2)}\n`;
}
