import { addProjectPolicyRule, createProjectPolicyRule, projectPolicyPath, readProjectPolicyOrEmpty, writeProjectPolicyAtomic, type ProjectPolicyRuleInput } from './project-policy.js';
import { appendProjectPolicyLedgerEntry, projectPolicyLedgerPath } from './project-policy-ledger.js';
import type { HookCall, TaskPhase } from './types.js';

export interface ProjectPolicyCaptureInput {
  projectRoot: string;
  id: string;
  instruction: string;
  effect: 'allow' | 'block';
  reason: string;
  match?: Partial<{
    tools: HookCall['tool'][];
    pathContains: string[];
    commandContains: string[];
    phases: TaskPhase[];
    reasons: string[];
  }>;
  replace?: boolean;
  notes?: string | null;
  now?: string | null;
}

export interface ProjectPolicyCaptureResult {
  schema: 'ccpanes.project-policy-capture-result.v1';
  projectRoot: string;
  changed: boolean;
  ruleId: string;
  policyPath: string;
  ledgerPath: string;
  policyChanged: boolean;
  ledgerChanged: boolean;
  policyRuleCount: number;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} must be non-empty`);
}

function summarizeMatch(match: ProjectPolicyRuleInput['match']): string {
  const parts = [
    ...(match?.tools ?? []).map((tool) => `tool:${tool}`),
    ...(match?.pathContains ?? []).map((fragment) => `path:${fragment}`),
    ...(match?.commandContains ?? []).map((fragment) => `command:${fragment}`),
    ...(match?.phases ?? []).map((phase) => `phase:${phase}`),
    ...(match?.reasons ?? []).map((reason) => `reason:${reason}`)
  ];
  return parts.length === 0 ? 'match=*' : `match=${parts.join(', ')}`;
}

export async function captureProjectPolicyInstruction(input: ProjectPolicyCaptureInput): Promise<ProjectPolicyCaptureResult> {
  requireNonEmpty(input.id, 'id');
  requireNonEmpty(input.instruction, 'instruction');
  requireNonEmpty(input.reason, 'reason');

  const rule = createProjectPolicyRule({
    id: input.id,
    effect: input.effect,
    reason: input.reason,
    match: input.match
  });
  const policy = addProjectPolicyRule(await readProjectPolicyOrEmpty(input.projectRoot), rule, { replace: input.replace });
  await writeProjectPolicyAtomic(input.projectRoot, policy);

  const ledgerChanged = await appendProjectPolicyLedgerEntry(input.projectRoot, {
    time: input.now ?? new Date().toISOString(),
    instruction: input.instruction,
    effectiveAction: `${input.effect}:${input.reason}`,
    notes: input.notes ?? `id=${input.id}; ${summarizeMatch(input.match)}`
  });

  return {
    schema: 'ccpanes.project-policy-capture-result.v1',
    projectRoot: input.projectRoot,
    changed: true,
    ruleId: input.id,
    policyPath: projectPolicyPath(input.projectRoot),
    ledgerPath: projectPolicyLedgerPath(input.projectRoot),
    policyChanged: true,
    ledgerChanged,
    policyRuleCount: policy.rules.length
  };
}
