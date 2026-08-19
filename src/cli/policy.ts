import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { capturePlanPolicyInstructions, readPlanPolicyCaptureText } from '../plan-policy-capture.js';
import { createPlanIntake, normalizePlanLifecycleEvent, planIntakeAuditPathFromRoot, writePlanIntakeAuditAtomic } from '../plan-intake.js';
import { captureProjectPolicyInstruction } from '../project-policy-capture.js';
import {
  addProjectPolicyRule,
  clearProjectPolicyRules,
  createProjectPolicyRule,
  disableProjectPolicyRule,
  projectPolicyPath,
  readProjectPolicyOrEmpty,
  validateProjectPolicy,
  writeProjectPolicyAtomic
} from '../project-policy.js';
import { resolveCurrentTaskBindingFromCwd, validateCurrentTask } from '../current-task.js';
import { isPathInside } from '../paths.js';
import type { RunCliOptions } from '../cli-types.js';
import {
  extractHookCwd,
  parsePhase,
  parseProjectPolicyEffect,
  parseProjectPolicyTool,
  projectPolicyCliResult,
  readStdin,
  valueAfter,
  valuesAfter
} from '../cli-shared.js';

export async function handlePolicyCommands(
  args: string[],
  stdinText: string | undefined,
  _options: RunCliOptions
): Promise<string | null> {
  const command = args[0];

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

    let task: ReturnType<typeof validateCurrentTask>;
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

  return null;
}
