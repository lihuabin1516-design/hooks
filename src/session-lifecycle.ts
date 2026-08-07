import path from 'node:path';
import type { CurrentTask } from './types.js';

export interface LifecycleOutputInput {
  task: CurrentTask;
  taskPath: string;
  auditRoot?: string | null;
}

export interface SessionStartHookOutput {
  hookSpecificOutput: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

export interface StopCheckHookOutput {
  continue: true;
  systemMessage: string;
}

function safeName(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function auditDir(auditRoot: string | null | undefined, task: CurrentTask): string | null {
  return auditRoot ? path.join(auditRoot, safeName(task.taskId)) : null;
}

function formatOptional(value: string | null): string {
  return value && value.length > 0 ? value : 'null';
}

function lifecycleLines(input: LifecycleOutputInput): string[] {
  const auditDirectory = auditDir(input.auditRoot, input.task);
  return [
    'ccpanes-task-probe lifecycle context',
    `taskId: ${input.task.taskId}`,
    `workspace: ${input.task.workspace}`,
    `phase: ${input.task.phase}`,
    `worktreeRoot: ${input.task.worktreeRoot}`,
    `projectPath: ${input.task.projectPath}`,
    `branch: ${formatOptional(input.task.branch)}`,
    `head: ${formatOptional(input.task.head)}`,
    `currentTaskPath: ${input.taskPath}`,
    auditDirectory ? `auditDir: ${auditDirectory}` : 'auditDir: null',
    auditDirectory ? `preToolUseAudit: ${path.join(auditDirectory, 'hook-enforce-audit.json')}` : 'preToolUseAudit: null',
    auditDirectory ? `permissionAudit: ${path.join(auditDirectory, 'permission-enforce-audit.json')}` : 'permissionAudit: null',
    auditDirectory ? `postToolUseAudit: ${path.join(auditDirectory, 'post-tool-use-audit.jsonl')}` : 'postToolUseAudit: null',
    'productionGates: preserve task scope; before completion run targeted checks, inspect diff/status, keep reference repos clean, then record and verify acceptance evidence.'
  ];
}

export function createSessionStartHookOutput(input: LifecycleOutputInput): SessionStartHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lifecycleLines(input).join('\n')
    }
  };
}

export function createStopCheckHookOutput(input: LifecycleOutputInput): StopCheckHookOutput {
  const auditDirectory = auditDir(input.auditRoot, input.task);
  return {
    continue: true,
    systemMessage: [
      `ccpanes-task-probe ${input.task.taskId} (${input.task.phase}): before claiming completion, run applicable checks such as npm test, npm run typecheck, npm run build, npm run smoke; inspect diff/status and reference repos; then record-acceptance and verify-acceptance.`,
      `currentTaskPath=${input.taskPath}`,
      auditDirectory ? `auditDir=${auditDirectory}` : 'auditDir=null'
    ].join(' ')
  };
}
