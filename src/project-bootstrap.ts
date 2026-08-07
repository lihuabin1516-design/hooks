import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installAgentsEntry, validateAgentsEntry, type AgentsInstallResult, type AgentsValidateResult } from './agents-entry.js';
import { currentTaskPath, validateCurrentTask, writeCurrentTaskAtomic } from './current-task.js';
import { emptyProjectPolicy, projectPolicyPath, readProjectPolicy, writeProjectPolicyAtomic, type ProjectPolicy } from './project-policy.js';
import { ensureProjectPolicyLedger, projectPolicyLedgerPath } from './project-policy-ledger.js';
import type { CurrentTask, TaskPhase } from './types.js';

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

function makeTask(input: ProjectBootstrapInput): CurrentTask {
  const root = path.resolve(input.projectRoot);
  const now = input.now ?? new Date().toISOString();
  return validateCurrentTask({
    schema: 'ccpanes.task-selection.v1',
    taskId: input.taskId,
    workspace: input.workspace ?? 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: input.phase,
    createdAt: now,
    updatedAt: now,
    source: 'manual-import',
    notes: input.notes ?? 'project bootstrapped by CC-Panes hooks'
  });
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
  const projectRoot = path.resolve(input.projectRoot);
  const task = makeTask({ ...input, projectRoot });
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
