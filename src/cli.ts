import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAcceptanceEvidence, type AcceptanceEvidence, type AcceptanceTruthLayerInput, type AcceptanceTruthLayerName } from './acceptance.js';
import { installAgentsEntry, validateAgentsEntry } from './agents-entry.js';
import { verifyAcceptanceEvidence } from './acceptance-verify.js';
import {
  createCurrentTask,
  currentTaskPath,
  inspectCurrentTaskBindingFromCwd,
  resolveCurrentTaskBindingFromCwd,
  validateCurrentTask,
  writeCurrentTaskAtomic
} from './current-task.js';
import { readGitState } from './git-state.js';
import { decideHookDryRun } from './hook-dry-run.js';
import { adaptHookEventToBatch } from './hook-event-adapter.js';
import { runHookDryRunBatch, validateHookDryRunBatch } from './hook-batch.js';
import {
  createTaskBindingMismatchGateTask,
  runHookEventDryRunWithProjectPolicy,
  runHookEventWithTaskBindingMismatch,
  type HookRunnerResult
} from './hook-runner.js';
import { createHookShadowAudit, writeHookShadowAuditAtomic } from './hook-shadow.js';
import { createHookInstallPlan, writeHookInstallPlanAtomic, type HookInstallTarget } from './hook-install-plan.js';
import { createHookPackage } from './hook-package.js';
import { rehearseHookPackage, writeHookPackageRehearsalAtomic } from './hook-package-rehearsal.js';
import { createHookReleaseGate, writeHookReleaseGateAtomic, type VerificationCheckInput } from './hook-release-gate.js';
import { createHookApplyPlan } from './hook-apply-plan.js';
import { checkHookApproval, writeHookApprovalCheckAtomic } from './hook-approval.js';
import { createHookWritePreview } from './hook-write-preview.js';
import { createHookWriteApply, writeHookWriteApplyReportAtomic } from './hook-write-apply.js';
import { createHookWriteRestore, writeHookWriteRestoreReportAtomic } from './hook-write-restore.js';
import { createHookProductionReadiness, writeHookProductionReadinessAtomic } from './hook-production-readiness.js';
import { createHookGoLiveApprovalPackage } from './hook-go-live-approval.js';
import { createHookFinalRunbook } from './hook-final-runbook.js';
import { createHostAdapterRegistry, getHostAdapter } from './host-adapter-registry.js';
import { verifyInstalledHooks } from './installed-hooks.js';
import { verifyLiveConsistency } from './live-consistency.js';
import { isPathInside, normalizeForComparison } from './paths.js';
import { appendPostToolUseAudit, createPostToolUseAuditRecord } from './post-tool-audit.js';
import { createPlanIntake, normalizePlanLifecycleEvent, planIntakeAuditPathFromRoot, writePlanIntakeAuditAtomic } from './plan-intake.js';
import { capturePlanPolicyInstructions, readPlanPolicyCaptureText } from './plan-policy-capture.js';
import { createProductionToolkit } from './production-toolkit.js';
import { bootstrapProject } from './project-bootstrap.js';
import { captureProjectPolicyInstruction } from './project-policy-capture.js';
import {
  addProjectPolicyRule,
  clearProjectPolicyRules,
  createProjectPolicyRule,
  disableProjectPolicyRule,
  projectPolicyPath,
  readProjectPolicyOrEmpty,
  validateProjectPolicy,
  writeProjectPolicyAtomic,
  type ProjectPolicyRuleInput
} from './project-policy.js';
import { probeResume } from './resume-probe.js';
import { CCPANES_RUNTIME_PROFILE } from './runtime-profile.js';
import {
  analyzeStopCheckEvent,
  createSessionStartHookOutput,
  createStopCheckHookOutput,
  createTaskBindingMismatchSessionStartOutput,
  createTaskBindingMismatchStopOutput
} from './session-lifecycle.js';
import { classifyTaskRisk } from './task-risk.js';
import type { CurrentTask, GitState, HookCall, TaskBindingStatus, TaskPhase } from './types.js';
import { classifyWorkflowProfile } from './workflow-profile.js';
import { scanWorkspaceTasks } from './workspace-scan.js';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function valuesAfter(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function parsePhase(value: string | null): TaskPhase {
  if (value === 'shape' || value === 'build' || value === 'verify' || value === 'archive') return value;
  throw new Error(`invalid phase: ${value}`);
}

function parseCheck(value: string): { name: string; command: string; result: string; evidence: string } {
  const [name, result, ...evidenceParts] = value.split('=');
  if (!name || !result || evidenceParts.length === 0) throw new Error(`invalid check: ${value}`);
  return { name, command: name, result, evidence: evidenceParts.join('=') };
}

function parseTruthLayer(value: string): AcceptanceTruthLayerInput {
  const [name, state, ...evidenceParts] = value.split('=');
  if (!name || !state || evidenceParts.length === 0) throw new Error(`invalid truth layer: ${value}`);
  const required = !name.endsWith('?');
  const normalizedName = (required ? name : name.slice(0, -1)) as AcceptanceTruthLayerName;
  return { name: normalizedName, state, required, evidence: evidenceParts.join('=') };
}

function gitStateForTask(task: CurrentTask): GitState {
  const exists = fs.existsSync(task.worktreeRoot);
  const hasGitMarker = fs.existsSync(`${task.worktreeRoot}/.git`);
  if (hasGitMarker) {
    const gitState = readGitState(task.worktreeRoot);
    if (gitState.root !== null && normalizeForComparison(gitState.root) === normalizeForComparison(task.worktreeRoot)) {
      return gitState;
    }
  }
  return {
    root: exists ? task.worktreeRoot : null,
    branch: task.branch,
    head: task.head,
    dirty: false,
    statusShort: ''
  };
}

export function isCliEntrypoint(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  return importMetaUrl === pathToFileURL(argvPath).href;
}

function parseVerificationCheck(value: string): VerificationCheckInput {
  const parsed = parseCheck(value);
  if (parsed.result === 'pass' || parsed.result === 'fail' || parsed.result === 'blocked' || parsed.result === 'not-run') {
    return { name: parsed.name, result: parsed.result, evidence: parsed.evidence };
  }
  throw new Error(`invalid verification check result: ${parsed.result}`);
}

function parseHookInstallTarget(value: string | null): HookInstallTarget {
  if (value === 'codex' || value === 'ccpanes' || value === 'both') return value;
  throw new Error(`invalid hook install target: ${value}`);
}

function parseProjectPolicyEffect(value: string | null): ProjectPolicyRuleInput['effect'] {
  if (value === 'allow' || value === 'block') return value;
  throw new Error(`invalid policy effect: ${value}`);
}

function parseProjectPolicyTool(value: string): HookCall['tool'] {
  if (value === 'read' || value === 'grep' || value === 'glob' || value === 'edit' || value === 'write' || value === 'apply_patch' || value === 'shell') return value;
  throw new Error(`invalid policy tool: ${value}`);
}

function extractHookCwd(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const record = event as Record<string, unknown>;
  return typeof record.cwd === 'string' && record.cwd.length > 0 ? record.cwd : null;
}

function formatPreToolUseDeny(result: HookRunnerResult): string {
  const blocked = result.dryRun.decisions.find((decision) => decision.action === 'block');
  const reason = blocked
    ? `${blocked.reason}${blocked.targetPath ? `: ${blocked.targetPath}` : ''}`
    : 'blocked by ccpanes task probe';
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `ccpanes-task-probe: ${reason}`
    }
  }, null, 2)}\n`;
}

function formatPermissionRequestDeny(result: HookRunnerResult): string {
  const blocked = result.dryRun.decisions.find((decision) => decision.action === 'block');
  const reason = blocked
    ? `${blocked.reason}${blocked.targetPath ? `: ${blocked.targetPath}` : ''}`
    : 'blocked by ccpanes task probe';
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: `ccpanes-task-probe: ${reason}`
      }
    }
  }, null, 2)}\n`;
}

function safeName(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function auditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'hook-enforce-audit.json');
}

function permissionAuditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'permission-enforce-audit.json');
}

function postToolUseAuditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'post-tool-use-audit.jsonl');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function projectPolicyCliResult(command: string, root: string, changed: boolean, policy: unknown, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema: 'ccpanes.project-policy-cli-result.v1',
    command,
    path: projectPolicyPath(root),
    changed,
    policy,
    ...extra
  }, null, 2)}\n`;
}

export async function runCli(args: string[], stdinText?: string): Promise<string> {
  const command = args[0];

  if (command === 'probe') {
    const utterance = valueAfter(args, '--utterance') ?? '';
    const session = valueAfter(args, '--session');
    const workspaceRoot = valueAfter(args, '--workspace-root');
    if (workspaceRoot) {
      const scan = await scanWorkspaceTasks(workspaceRoot);
      const tasks = scan.tasks.map((item) => item.task);
      const gitStates = new Map<string, GitState>();
      for (const task of tasks) {
        gitStates.set(task.worktreeRoot, gitStateForTask(task));
      }
      const result = probeResume({ utterance, currentSessionId: session, tasks, gitStates });
      return `${JSON.stringify({ ...result, scanErrors: scan.errors }, null, 2)}\n`;
    }
    const result = probeResume({ utterance, currentSessionId: session, tasks: [], gitStates: new Map() });
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'classify-task-risk') {
    const prompt = valueAfter(args, '--prompt');
    const cwd = valueAfter(args, '--cwd');
    if (prompt === null) throw new Error('missing --prompt');
    return `${JSON.stringify(classifyTaskRisk({ prompt, cwd }), null, 2)}\n`;
  }

  if (command === 'classify-workflow') {
    const prompt = valueAfter(args, '--prompt');
    const cwd = valueAfter(args, '--cwd');
    if (prompt === null) throw new Error('missing --prompt');
    return `${JSON.stringify(classifyWorkflowProfile({
      prompt,
      cwd,
      changedPaths: valuesAfter(args, '--changed-path')
    }), null, 2)}\n`;
  }

  if (command === 'host-adapter-registry') {
    const host = valueAfter(args, '--host');
    if (host) {
      const adapter = getHostAdapter(host);
      if (!adapter) throw new Error(`unknown host adapter: ${host}`);
      return `${JSON.stringify({ schema: 'ccpanes.host-adapter.v1', adapter }, null, 2)}\n`;
    }
    return `${JSON.stringify(createHostAdapterRegistry(), null, 2)}\n`;
  }

  if (command === 'write-current') {
    const root = valueAfter(args, '--root');
    const taskId = valueAfter(args, '--task-id');
    const phase = parsePhase(valueAfter(args, '--phase'));
    if (!root) throw new Error('missing --root');
    if (!taskId) throw new Error('missing --task-id');
    const requestedRoot = path.resolve(root);
    fs.mkdirSync(requestedRoot, { recursive: true });
    const leaderSessionId = valueAfter(args, '--leader-session-id');
    const task = createCurrentTask({
      root: requestedRoot,
      taskId,
      phase,
      workspace: valueAfter(args, '--workspace'),
      owner: { leaderSessionId, paneId: null, layoutId: null },
      source: leaderSessionId ? 'leader' : 'manual-import',
      notes: valueAfter(args, '--notes')
    });
    await writeCurrentTaskAtomic(task.worktreeRoot, task);
    return `${JSON.stringify({ path: currentTaskPath(task.worktreeRoot), taskId, phase }, null, 2)}\n`;
  }

  if (command === 'verify-task-binding') {
    const cwd = valueAfter(args, '--cwd') ?? process.cwd();
    return `${JSON.stringify(await inspectCurrentTaskBindingFromCwd(cwd), null, 2)}\n`;
  }

  if (command === 'bootstrap-project') {
    const root = valueAfter(args, '--root');
    const taskId = valueAfter(args, '--task-id');
    const phase = parsePhase(valueAfter(args, '--phase') ?? 'shape');
    const workspace = valueAfter(args, '--workspace');
    const notes = valueAfter(args, '--notes');
    if (!root) throw new Error('missing --root');
    if (!taskId) throw new Error('missing --task-id');
    return `${JSON.stringify(await bootstrapProject({ projectRoot: root, taskId, phase, workspace, notes }), null, 2)}\n`;
  }

  if (command === 'agents-install') {
    const root = valueAfter(args, '--root');
    const templatePath = valueAfter(args, '--template');
    if (!root) throw new Error('missing --root');
    return `${JSON.stringify(await installAgentsEntry(root, templatePath), null, 2)}\n`;
  }

  if (command === 'agents-validate') {
    const root = valueAfter(args, '--root');
    if (!root) throw new Error('missing --root');
    return `${JSON.stringify(await validateAgentsEntry(root), null, 2)}\n`;
  }

  if (command === 'policy-validate') {
    const root = valueAfter(args, '--root');
    if (!root) throw new Error('missing --root');
    const exists = fs.existsSync(projectPolicyPath(root));
    const policy = await readProjectPolicyOrEmpty(root);
    validateProjectPolicy(policy);
    return projectPolicyCliResult(command, root, false, policy, { valid: true, exists, ruleCount: policy.rules.length });
  }

  if (command === 'policy-list') {
    const root = valueAfter(args, '--root');
    if (!root) throw new Error('missing --root');
    const exists = fs.existsSync(projectPolicyPath(root));
    const policy = await readProjectPolicyOrEmpty(root);
    return projectPolicyCliResult(command, root, false, policy, { exists, ruleCount: policy.rules.length });
  }

  if (command === 'policy-capture') {
    const root = valueAfter(args, '--root');
    const id = valueAfter(args, '--id');
    const instruction = valueAfter(args, '--instruction');
    const reason = valueAfter(args, '--reason');
    const notes = valueAfter(args, '--notes');
    if (!root) throw new Error('missing --root');
    if (!id) throw new Error('missing --id');
    if (!instruction) throw new Error('missing --instruction');
    if (!reason) throw new Error('missing --reason');
    return `${JSON.stringify(await captureProjectPolicyInstruction({
      projectRoot: root,
      id,
      instruction,
      effect: parseProjectPolicyEffect(valueAfter(args, '--effect')),
      reason,
      match: {
        tools: valuesAfter(args, '--tool').map((tool) => parseProjectPolicyTool(tool)),
        pathContains: valuesAfter(args, '--path-contains'),
        commandContains: valuesAfter(args, '--command-contains'),
        phases: valuesAfter(args, '--phase').map((phase) => parsePhase(phase)),
        reasons: valuesAfter(args, '--match-reason')
      },
      replace: args.includes('--replace'),
      notes
    }), null, 2)}\n`;
  }

  if (command === 'policy-capture-plan') {
    const root = valueAfter(args, '--root');
    const utterance = valueAfter(args, '--utterance');
    const inputPath = valueAfter(args, '--input');
    if (!root) throw new Error('missing --root');
    if (!utterance && !inputPath) throw new Error('missing --utterance or --input');
    const text = inputPath ? await readPlanPolicyCaptureText(inputPath) : utterance;
    return `${JSON.stringify(await capturePlanPolicyInstructions({ projectRoot: root, text: text ?? '' }), null, 2)}\n`;
  }

  if (command === 'plan-intake') {
    const root = valueAfter(args, '--root');
    const utterance = valueAfter(args, '--utterance');
    const prompt = valueAfter(args, '--prompt');
    const inputPath = valueAfter(args, '--input');
    const auditOut = valueAfter(args, '--audit-out');
    if (!root) throw new Error('missing --root');
    if (!utterance && !inputPath) throw new Error('missing --utterance or --input');
    const text = inputPath ? await readPlanPolicyCaptureText(inputPath) : (utterance ?? '');
    const result = createPlanIntake({
      projectRoot: root,
      text,
      prompt,
      changedPaths: valuesAfter(args, '--changed-path')
    });
    if (auditOut) await writePlanIntakeAuditAtomic(auditOut, result);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'plan-lifecycle-intake') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const inputPath = valueAfter(args, '--input');
    const utterance = valueAfter(args, '--utterance');
    const planText = valueAfter(args, '--plan-text');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    if (!auditRoot) throw new Error('missing --audit-root');

    let event: unknown = null;
    let rawStdinText: string | null = null;
    if (eventPath) {
      event = JSON.parse(await readFile(eventPath, 'utf8'));
    } else if (stdinText !== undefined || (!inputPath && !utterance && !planText)) {
      const eventText = stdinText ?? await readStdin();
      if (eventText.trim().length > 0) {
        try {
          event = JSON.parse(eventText);
        } catch {
          rawStdinText = eventText;
        }
      }
    }

    const fallbackCwd = valueAfter(args, '--cwd');
    const eventCwd = extractHookCwd(event) ?? fallbackCwd;

    let task: CurrentTask;
    if (resolveTaskFromCwd) {
      const binding = await resolveCurrentTaskBindingFromCwd(eventCwd ?? process.cwd());
      if (binding.check.status !== 'matched' || !binding.candidate) return '';
      task = binding.candidate.task;
    } else {
      if (!taskPath) throw new Error('missing --task or --resolve-task-from-cwd');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (eventCwd && !isPathInside(task.worktreeRoot, eventCwd)) return '';

    const explicitText = inputPath
      ? await readPlanPolicyCaptureText(inputPath)
      : (utterance ?? planText ?? rawStdinText);
    const lifecycleEvent = normalizePlanLifecycleEvent({
      event,
      fallbackCwd,
      fallbackPrompt: valueAfter(args, '--prompt'),
      fallbackText: explicitText,
      fallbackChangedPaths: valuesAfter(args, '--changed-path')
    });
    if (lifecycleEvent.text.trim().length === 0) throw new Error('missing plan lifecycle text');

    const result = createPlanIntake({
      projectRoot: task.worktreeRoot,
      text: lifecycleEvent.text,
      prompt: lifecycleEvent.prompt,
      changedPaths: lifecycleEvent.changedPaths
    });
    await writePlanIntakeAuditAtomic(planIntakeAuditPathFromRoot(auditRoot, task.taskId), result);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'policy-add') {
    const root = valueAfter(args, '--root');
    const id = valueAfter(args, '--id');
    const reason = valueAfter(args, '--reason');
    if (!root) throw new Error('missing --root');
    if (!id) throw new Error('missing --id');
    if (!reason) throw new Error('missing --reason');
    const rule = createProjectPolicyRule({
      id,
      enabled: !args.includes('--disabled'),
      effect: parseProjectPolicyEffect(valueAfter(args, '--effect')),
      reason,
      match: {
        tools: valuesAfter(args, '--tool').map((tool) => parseProjectPolicyTool(tool)),
        pathContains: valuesAfter(args, '--path-contains'),
        commandContains: valuesAfter(args, '--command-contains'),
        phases: valuesAfter(args, '--phase').map((phase) => parsePhase(phase)),
        reasons: valuesAfter(args, '--match-reason')
      }
    });
    const policy = addProjectPolicyRule(await readProjectPolicyOrEmpty(root), rule, { replace: args.includes('--replace') });
    await writeProjectPolicyAtomic(root, policy);
    return projectPolicyCliResult(command, root, true, policy, { ruleId: id });
  }

  if (command === 'policy-disable') {
    const root = valueAfter(args, '--root');
    const id = valueAfter(args, '--id');
    if (!root) throw new Error('missing --root');
    if (!id) throw new Error('missing --id');
    const policy = disableProjectPolicyRule(await readProjectPolicyOrEmpty(root), id);
    await writeProjectPolicyAtomic(root, policy);
    return projectPolicyCliResult(command, root, true, policy, { ruleId: id });
  }

  if (command === 'policy-clear') {
    const root = valueAfter(args, '--root');
    if (!root) throw new Error('missing --root');
    const policy = clearProjectPolicyRules(await readProjectPolicyOrEmpty(root));
    await writeProjectPolicyAtomic(root, policy);
    return projectPolicyCliResult(command, root, true, policy, { disabledRuleCount: policy.rules.length });
  }

  if (command === 'dry-run-hook') {
    const input = valueAfter(args, '--input');
    if (input) {
      const batch = JSON.parse(await readFile(input, 'utf8'));
      return `${JSON.stringify(runHookDryRunBatch(batch), null, 2)}\n`;
    }
    const root = valueAfter(args, '--root');
    const phase = parsePhase(valueAfter(args, '--phase'));
    const target = valueAfter(args, '--target');
    const tool = valueAfter(args, '--tool') as HookCall['tool'] | null;
    if (!root) throw new Error('missing --root');
    if (!target) throw new Error('missing --target');
    if (!tool) throw new Error('missing --tool');
    const task = createCurrentTask({
      root,
      taskId: 'synthetic-task',
      phase,
      notes: 'synthetic dry-run task'
    });
    const call: HookCall = { tool, targetPath: target, writes: ['edit', 'write', 'apply_patch', 'shell'].includes(tool) };
    return `${JSON.stringify(decideHookDryRun(task, call), null, 2)}\n`;
  }

  if (command === 'adapt-hook-event') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    if (!taskPath) throw new Error('missing --task');
    if (!eventPath) throw new Error('missing --event');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    const batch = validateHookDryRunBatch(adaptHookEventToBatch(task, event));
    return `${JSON.stringify(batch, null, 2)}\n`;
  }

  if (command === 'hook-runner') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    if (!taskPath) throw new Error('missing --task');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const result = await runHookEventDryRunWithProjectPolicy(task, event);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'hook-enforce') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditOut = valueAfter(args, '--audit-out');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let mismatchStatus: TaskBindingStatus | null = null;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        mismatchStatus = binding.check.status;
        task = createTaskBindingMismatchGateTask(binding.check);
      } else {
        if (!binding.candidate) return '';
        task = binding.candidate.task;
      }
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (!mismatchStatus && cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    const result = mismatchStatus
      ? runHookEventWithTaskBindingMismatch(task, event, mismatchStatus)
      : await runHookEventDryRunWithProjectPolicy(task, event);
    const resolvedAuditOut = mismatchStatus
      ? auditOut
      : auditOut ?? (auditRoot ? auditPathFromRoot(auditRoot, task) : null);
    if (resolvedAuditOut) {
      fs.mkdirSync(path.dirname(resolvedAuditOut), { recursive: true });
      fs.writeFileSync(resolvedAuditOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    return result.allowed ? '' : formatPreToolUseDeny(result);
  }

  if (command === 'permission-enforce') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditOut = valueAfter(args, '--audit-out');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let mismatchStatus: TaskBindingStatus | null = null;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        mismatchStatus = binding.check.status;
        task = createTaskBindingMismatchGateTask(binding.check);
      } else {
        if (!binding.candidate) return '';
        task = binding.candidate.task;
      }
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (!mismatchStatus && cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    const result = mismatchStatus
      ? runHookEventWithTaskBindingMismatch(task, event, mismatchStatus)
      : await runHookEventDryRunWithProjectPolicy(task, event);
    const resolvedAuditOut = mismatchStatus
      ? auditOut
      : auditOut ?? (auditRoot ? permissionAuditPathFromRoot(auditRoot, task) : null);
    if (resolvedAuditOut) {
      fs.mkdirSync(path.dirname(resolvedAuditOut), { recursive: true });
      fs.writeFileSync(resolvedAuditOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    return result.allowed ? '' : formatPermissionRequestDeny(result);
  }

  if (command === 'post-enforce') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditOut = valueAfter(args, '--audit-out');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status !== 'matched' || !binding.candidate) return '';
      task = binding.candidate.task;
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    const resolvedAuditOut = auditOut ?? (auditRoot ? postToolUseAuditPathFromRoot(auditRoot, task) : null);
    if (resolvedAuditOut) {
      await appendPostToolUseAudit(resolvedAuditOut, createPostToolUseAuditRecord(task, event));
    }
    return '';
  }

  if (command === 'session-start') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let resolvedTaskPath: string;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        return `${JSON.stringify(createTaskBindingMismatchSessionStartOutput(binding.check), null, 2)}\n`;
      }
      if (!binding.candidate) return '';
      task = binding.candidate.task;
      resolvedTaskPath = binding.candidate.taskPath;
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
      resolvedTaskPath = taskPath;
    }
    if (cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    return `${JSON.stringify(createSessionStartHookOutput({ task, taskPath: resolvedTaskPath, auditRoot }), null, 2)}\n`;
  }

  if (command === 'stop-check') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let resolvedTaskPath: string;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        return `${JSON.stringify(createTaskBindingMismatchStopOutput(binding.check), null, 2)}\n`;
      }
      if (!binding.candidate) return '';
      task = binding.candidate.task;
      resolvedTaskPath = binding.candidate.taskPath;
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
      resolvedTaskPath = taskPath;
    }
    if (cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    return `${JSON.stringify(createStopCheckHookOutput({ task, taskPath: resolvedTaskPath, auditRoot, stopAnalysis: analyzeStopCheckEvent(event) }), null, 2)}\n`;
  }

  if (command === 'hook-shadow') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const upstreamHookPath = valueAfter(args, '--upstream-hook');
    const outPath = valueAfter(args, '--out');
    if (!taskPath) throw new Error('missing --task');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const audit = await createHookShadowAudit({ task, event, upstreamHookPath });
    if (outPath) await writeHookShadowAuditAtomic(outPath, audit);
    return `${JSON.stringify(audit, null, 2)}\n`;
  }

  if (command === 'plan-hook-install') {
    const prototypeRoot = valueAfter(args, '--prototype-root');
    const taskPath = valueAfter(args, '--task');
    const target = parseHookInstallTarget(valueAfter(args, '--target'));
    const upstreamHookPath = valueAfter(args, '--upstream-hook');
    const outPath = valueAfter(args, '--out');
    if (!prototypeRoot) throw new Error('missing --prototype-root');
    if (!taskPath) throw new Error('missing --task');
    if (!upstreamHookPath) throw new Error('missing --upstream-hook');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const plan = await createHookInstallPlan({ task, prototypeRoot, target, upstreamHookPath });
    if (outPath) await writeHookInstallPlanAtomic(outPath, plan);
    return `${JSON.stringify(plan, null, 2)}\n`;
  }

  if (command === 'create-hook-package') {
    const prototypeRoot = valueAfter(args, '--prototype-root');
    const taskPath = valueAfter(args, '--task');
    const target = parseHookInstallTarget(valueAfter(args, '--target'));
    const upstreamHookPath = valueAfter(args, '--upstream-hook');
    const outDir = valueAfter(args, '--out-dir');
    if (!prototypeRoot) throw new Error('missing --prototype-root');
    if (!taskPath) throw new Error('missing --task');
    if (!upstreamHookPath) throw new Error('missing --upstream-hook');
    if (!outDir) throw new Error('missing --out-dir');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const manifest = await createHookPackage({ task, prototypeRoot, target, upstreamHookPath, outDir });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (command === 'rehearse-hook-package') {
    const packageDir = valueAfter(args, '--package-dir');
    const expectedUpstreamSha256 = valueAfter(args, '--expected-upstream-sha256');
    const outPath = valueAfter(args, '--out');
    if (!packageDir) throw new Error('missing --package-dir');
    const report = await rehearseHookPackage({ packageDir, expectedUpstreamSha256 });
    if (outPath) await writeHookPackageRehearsalAtomic(outPath, report);
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'release-gate') {
    const packageDir = valueAfter(args, '--package-dir');
    const expectedUpstreamSha256 = valueAfter(args, '--expected-upstream-sha256');
    const configPaths = valuesAfter(args, '--config');
    const referenceRepoPaths = valuesAfter(args, '--repo');
    const verificationChecks = valuesAfter(args, '--check').map((check) => parseVerificationCheck(check));
    const outPath = valueAfter(args, '--out');
    if (!packageDir) throw new Error('missing --package-dir');
    const report = await createHookReleaseGate({ packageDir, expectedUpstreamSha256, configPaths, referenceRepoPaths, verificationChecks });
    if (outPath) await writeHookReleaseGateAtomic(outPath, report);
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'create-hook-apply-plan') {
    const releaseGatePath = valueAfter(args, '--release-gate');
    const outDir = valueAfter(args, '--out-dir');
    if (!releaseGatePath) throw new Error('missing --release-gate');
    if (!outDir) throw new Error('missing --out-dir');
    const plan = await createHookApplyPlan({ releaseGatePath, outDir });
    return `${JSON.stringify(plan, null, 2)}\n`;
  }

  if (command === 'check-hook-approval') {
    const applyPlanPath = valueAfter(args, '--apply-plan');
    const approvalPath = valueAfter(args, '--approval');
    const outPath = valueAfter(args, '--out');
    if (!applyPlanPath) throw new Error('missing --apply-plan');
    if (!approvalPath) throw new Error('missing --approval');
    const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
    const report = await checkHookApproval({ applyPlanPath, approval });
    if (outPath) await writeHookApprovalCheckAtomic(outPath, report);
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'preview-hook-write') {
    const approvalCheckPath = valueAfter(args, '--approval-check');
    const outDir = valueAfter(args, '--out-dir');
    if (!approvalCheckPath) throw new Error('missing --approval-check');
    if (!outDir) throw new Error('missing --out-dir');
    const preview = await createHookWritePreview({ approvalCheckPath, outDir });
    return `${JSON.stringify(preview, null, 2)}\n`;
  }

  if (command === 'apply-hook-write') {
    const writePreviewPath = valueAfter(args, '--write-preview');
    const approvalCheckPath = valueAfter(args, '--approval-check');
    const outPath = valueAfter(args, '--out');
    const allowRoots = valuesAfter(args, '--allow-root');
    if (!writePreviewPath) throw new Error('missing --write-preview');
    if (!approvalCheckPath) throw new Error('missing --approval-check');
    if (!outPath) throw new Error('missing --out');
    if (allowRoots.length === 0) throw new Error('missing --allow-root');
    const report = await createHookWriteApply({ writePreviewPath, approvalCheckPath, outDir: `${outPath}.artifacts`, allowRoots });
    await writeHookWriteApplyReportAtomic(outPath, report);
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'restore-hook-write') {
    const applyReportPath = valueAfter(args, '--apply-report');
    const outPath = valueAfter(args, '--out');
    const allowRoots = valuesAfter(args, '--allow-root');
    if (!applyReportPath) throw new Error('missing --apply-report');
    if (!outPath) throw new Error('missing --out');
    if (allowRoots.length === 0) throw new Error('missing --allow-root');
    const report = await createHookWriteRestore({ applyReportPath, outDir: `${outPath}.artifacts`, allowRoots });
    await writeHookWriteRestoreReportAtomic(outPath, report);
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'production-readiness') {
    const releaseGatePath = valueAfter(args, '--release-gate');
    const approvalCheckPath = valueAfter(args, '--approval-check');
    const writePreviewPath = valueAfter(args, '--write-preview');
    const applyReportPath = valueAfter(args, '--apply-report');
    const restoreReportPath = valueAfter(args, '--restore-report');
    const outPath = valueAfter(args, '--out');
    if (!releaseGatePath) throw new Error('missing --release-gate');
    if (!approvalCheckPath) throw new Error('missing --approval-check');
    if (!writePreviewPath) throw new Error('missing --write-preview');
    if (!applyReportPath) throw new Error('missing --apply-report');
    if (!restoreReportPath) throw new Error('missing --restore-report');
    if (!outPath) throw new Error('missing --out');
    const report = await createHookProductionReadiness({ releaseGatePath, approvalCheckPath, writePreviewPath, applyReportPath, restoreReportPath });
    await writeHookProductionReadinessAtomic(outPath, report);
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'create-go-live-approval-package') {
    const readinessPath = valueAfter(args, '--readiness');
    const outDir = valueAfter(args, '--out-dir');
    const approvedBy = valueAfter(args, '--approved-by');
    const approvalNote = valueAfter(args, '--approval-note') ?? '';
    const upstreamHookPath = valueAfter(args, '--upstream-hook') ?? CCPANES_RUNTIME_PROFILE.skillsHubHookPath;
    if (!readinessPath) throw new Error('missing --readiness');
    if (!outDir) throw new Error('missing --out-dir');
    if (!approvedBy) throw new Error('missing --approved-by');
    const manifest = await createHookGoLiveApprovalPackage({ readinessPath, outDir, approvedBy, approvalNote, upstreamHookPath });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (command === 'create-final-runbook') {
    const goLiveManifestPath = valueAfter(args, '--go-live-manifest');
    const outDir = valueAfter(args, '--out-dir');
    if (!goLiveManifestPath) throw new Error('missing --go-live-manifest');
    if (!outDir) throw new Error('missing --out-dir');
    const manifest = await createHookFinalRunbook({ goLiveManifestPath, outDir });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (command === 'verify-installed-hooks') {
    const hooksJsonPath = valueAfter(args, '--hooks-json');
    const prototypeRoot = valueAfter(args, '--prototype-root');
    const auditRoot = valueAfter(args, '--audit-root');
    const configTomlPath = valueAfter(args, '--config');
    if (!hooksJsonPath) throw new Error('missing --hooks-json');
    if (!prototypeRoot) throw new Error('missing --prototype-root');
    if (!auditRoot) throw new Error('missing --audit-root');
    const report = await verifyInstalledHooks({ hooksJsonPath, prototypeRoot, auditRoot, configTomlPath });
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'verify-live-consistency') {
    const sourcePrefixes = valuesAfter(args, '--source-prefix');
    const rootFiles = valuesAfter(args, '--root-file');
    const report = await verifyLiveConsistency({
      repoRoot: valueAfter(args, '--repo-root'),
      liveRoot: valueAfter(args, '--live-root'),
      sourcePrefixes: sourcePrefixes.length > 0 ? sourcePrefixes : undefined,
      rootFiles: rootFiles.length > 0 ? rootFiles : undefined,
      distPrefix: valueAfter(args, '--dist-prefix') ?? undefined
    });
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'create-production-toolkit') {
    const outDir = valueAfter(args, '--out-dir');
    const prototypeRoot = valueAfter(args, '--prototype-root');
    const auditRoot = valueAfter(args, '--audit-root');
    const hooksJsonPath = valueAfter(args, '--hooks-json');
    const configTomlPath = valueAfter(args, '--config');
    const expectedUpstreamHookPath = valueAfter(args, '--expected-upstream-hook');
    const expectedUpstreamSha256 = valueAfter(args, '--expected-upstream-sha256');
    if (!outDir) throw new Error('missing --out-dir');
    if (!prototypeRoot) throw new Error('missing --prototype-root');
    if (!auditRoot) throw new Error('missing --audit-root');
    if (!hooksJsonPath) throw new Error('missing --hooks-json');
    const manifest = await createProductionToolkit({
      outDir,
      prototypeRoot,
      auditRoot,
      hooksJsonPath,
      configTomlPath,
      expectedUpstreamHookPath,
      expectedUpstreamSha256
    });
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  if (command === 'record-acceptance') {
    const taskPath = valueAfter(args, '--task');
    if (!taskPath) throw new Error('missing --task');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const artifacts = valuesAfter(args, '--artifact');
    const checks = valuesAfter(args, '--check').map((check) => parseCheck(check));
    const truthLayers = valuesAfter(args, '--truth').map((truth) => parseTruthLayer(truth));
    const evidence = await createAcceptanceEvidence({ task, artifacts, checks, truthLayers });
    return `${JSON.stringify(evidence, null, 2)}\n`;
  }


  if (command === 'verify-acceptance') {
    const input = valueAfter(args, '--input');
    if (!input) throw new Error('missing --input');
    const evidence = JSON.parse(await readFile(input, 'utf8')) as AcceptanceEvidence;
    const result = await verifyAcceptanceEvidence(evidence);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  throw new Error(`unknown command: ${command}`);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  runCli(process.argv.slice(2))
    .then((output) => process.stdout.write(output))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
