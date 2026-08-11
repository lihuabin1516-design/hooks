import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installAgentsEntry, validateAgentsEntry, type AgentsInstallResult, type AgentsValidateResult } from './agents-entry.js';
import { createCurrentTask, currentTaskPath, writeCurrentTaskAtomic } from './current-task.js';
import { emptyProjectPolicy, projectPolicyPath, readProjectPolicy, writeProjectPolicyAtomic, type ProjectPolicy } from './project-policy.js';
import { ensureProjectPolicyLedger, projectPolicyLedgerPath } from './project-policy-ledger.js';
import type { TaskPhase } from './types.js';

export interface ProjectBootstrapInput {
  projectRoot: string;
  taskId: string;
  phase: TaskPhase;
  workspace?: string | null;
  notes?: string | null;
  now?: string | null;
}

export interface ProjectBootstrapResult {
  schema: 'ccpanes.project-bootstrap-result.v1';
  projectRoot: string;
  taskId: string;
  phase: TaskPhase;
  changed: boolean;
  currentTask: {
    path: string;
    changed: boolean;
  };
  agents: AgentsInstallResult;
  agentsValidation: AgentsValidateResult;
  policyLedger: {
    path: string;
    changed: boolean;
  };
  policyJson: {
    path: string;
    changed: boolean;
    ruleCount: number;
  };
  reportPath: string;
}

function bootstrapReportPath(projectRoot: string): string {
  return path.join(projectRoot, '.ccpanes-task', 'bootstrap-report.json');
}
async function ensurePolicyJson(projectRoot: string): Promise<{ changed: boolean; policy: ProjectPolicy }> {
  const existing = await readProjectPolicy(projectRoot);
  if (existing) return { changed: false, policy: existing };
  const policy = emptyProjectPolicy();
  await writeProjectPolicyAtomic(projectRoot, policy);
  return { changed: true, policy };
}

async function writeBootstrapReport(projectRoot: string, result: Omit<ProjectBootstrapResult, 'reportPath'>): Promise<string> {
  const reportPath = bootstrapReportPath(projectRoot);
  await mkdir(path.dirname(reportPath), { recursive: true });
  const tempPath = path.join(path.dirname(reportPath), `bootstrap-report.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify({ ...result, reportPath }, null, 2)}\n`, 'utf8');
  await rename(tempPath, reportPath);
  return reportPath;
}

export async function bootstrapProject(input: ProjectBootstrapInput): Promise<ProjectBootstrapResult> {
  const requestedRoot = path.resolve(input.projectRoot);
  await mkdir(requestedRoot, { recursive: true });
  const task = createCurrentTask({
    root: requestedRoot,
    taskId: input.taskId,
    phase: input.phase,
    workspace: input.workspace,
    notes: input.notes ?? 'project bootstrapped by CC-Panes hooks',
    now: input.now
  });
  const projectRoot = task.worktreeRoot;
  await writeCurrentTaskAtomic(projectRoot, task);
  const agents = await installAgentsEntry(projectRoot);
  const agentsValidation = await validateAgentsEntry(projectRoot);
  const ledgerPath = projectPolicyLedgerPath(projectRoot);
  const policyLedgerChanged = await ensureProjectPolicyLedger(projectRoot);
  const policyJson = await ensurePolicyJson(projectRoot);

  const withoutReportPath: Omit<ProjectBootstrapResult, 'reportPath'> = {
    schema: 'ccpanes.project-bootstrap-result.v1',
    projectRoot,
    taskId: input.taskId,
    phase: input.phase,
    changed: true,
    currentTask: {
      path: currentTaskPath(projectRoot),
      changed: true
    },
    agents,
    agentsValidation,
    policyLedger: {
      path: ledgerPath,
      changed: policyLedgerChanged
    },
    policyJson: {
      path: projectPolicyPath(projectRoot),
      changed: policyJson.changed,
      ruleCount: policyJson.policy.rules.length
    }
  };
  const reportPath = await writeBootstrapReport(projectRoot, withoutReportPath);
  return { ...withoutReportPath, reportPath };
}
