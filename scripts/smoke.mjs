import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildExpectedHooksConfig } from '../dist/src/installed-hooks.js';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const cli = join(root, 'dist', 'src', 'cli.js');
const fixture = join(root, '.tmp-smoke');
const project = join(fixture, 'project-alpha');
const planPreviewProject = join(fixture, 'project-plan-preview');
const currentTask = join(project, '.ccpanes-task', 'current-task.json');
const artifact = join(fixture, 'artifact.md');
const planIntakeAudit = join(fixture, 'plan-intake-audit.json');
const planLifecycleAuditRoot = join(fixture, 'plan-lifecycle-audits');
const hookEvent = join(fixture, 'hook-event.json');
const adaptedHookBatch = join(fixture, 'adapted-hook-batch.json');
const hookBatch = join(fixture, 'hook-batch.json');
const stopTranscript = join(fixture, 'stop-transcript.jsonl');
const shadowAudit = join(fixture, 'shadow-audit.json');
const installPlan = join(fixture, 'hook-install-plan.json');
const hookPackage = join(fixture, 'hook-package');
const hookPackageRehearsal = join(fixture, 'hook-package-rehearsal.json');
const releaseGate = join(fixture, 'release-gate.json');
const hookApplyPlan = join(fixture, 'hook-apply-plan');
const approval = join(fixture, 'approval.json');
const approvalCheck = join(fixture, 'approval-check.json');
const hookWritePreview = join(fixture, 'hook-write-preview');
const syntheticApplyRoot = join(fixture, 'synthetic-apply');
const syntheticApplyConfig = join(syntheticApplyRoot, 'config.toml');
const syntheticApplyPlanDir = join(syntheticApplyRoot, 'apply-plan');
const syntheticApplyPlan = join(syntheticApplyPlanDir, 'apply-plan.json');
const syntheticApplyPatch = join(syntheticApplyPlanDir, 'staged-patches', 'codex.patch');
const syntheticApprovalCheck = join(syntheticApplyRoot, 'approval-check.json');
const syntheticWritePreviewDir = join(syntheticApplyRoot, 'write-preview');
const syntheticApplyReport = join(syntheticApplyRoot, 'apply-report.json');
const syntheticRestoreReport = join(syntheticApplyRoot, 'restore-report.json');
const productionReadiness = join(fixture, 'production-readiness.json');
const goLiveApprovalPackage = join(fixture, 'go-live-approval-package');
const finalRunbook = join(fixture, 'final-runbook');
const productionToolkit = join(fixture, 'production-toolkit');
const installedHooksFixture = join(fixture, 'installed-hooks.json');
const hookEnforceAuditRoot = join(fixture, 'hook-enforce-audits');
const acceptance = join(fixture, 'acceptance.json');
const upstreamHook = 'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe';

function run(args, input) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe']
  });
}

function parseJson(output) {
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function cleanFixture() {
  rmSync(fixture, { recursive: true, force: true });
}

try {
  assert(existsSync(cli), `missing built CLI: ${cli}; run npm run build first`);
  cleanFixture();
  mkdirSync(project, { recursive: true });
  mkdirSync(planPreviewProject, { recursive: true });

  const bootstrapProject = parseJson(run(['bootstrap-project', '--root', project, '--task-id', 'task-alpha', '--phase', 'verify']));
  assert(bootstrapProject.schema === 'ccpanes.project-bootstrap-result.v1', 'bootstrap-project schema mismatch');
  assert(bootstrapProject.taskId === 'task-alpha', 'bootstrap-project did not return task-alpha');
  assert(existsSync(join(project, '.ccpanes-task', 'policy.md')), 'bootstrap-project missing policy.md');
  assert(existsSync(join(project, '.ccpanes-task', 'policy.json')), 'bootstrap-project missing policy.json');
  assert(existsSync(join(project, '.ccpanes-task', 'bootstrap-report.json')), 'bootstrap-project missing bootstrap-report.json');

  const agentsValidate = parseJson(run(['agents-validate', '--root', project]));
  assert(agentsValidate.valid === true, 'agents-validate expected valid=true');
  const agentsInstallAgain = parseJson(run(['agents-install', '--root', project]));
  assert(agentsInstallAgain.changed === false, 'second agents-install expected changed=false');

  const policyAdd = parseJson(run([
    'policy-add',
    '--root',
    project,
    '--id',
    'block-publish-smoke',
    '--effect',
    'block',
    '--reason',
    'smoke_block_publish',
    '--tool',
    'shell',
    '--command-contains',
    'publish-artifact'
  ]));
  assert(policyAdd.schema === 'ccpanes.project-policy-cli-result.v1', 'policy-add schema mismatch');
  assert(policyAdd.changed === true, 'policy-add expected changed=true');
  const policyCapture = parseJson(run([
    'policy-capture',
    '--root',
    project,
    '--id',
    'block-deploy-smoke',
    '--instruction',
    '禁止运行 deploy-artifact，除非测试显式解除。',
    '--effect',
    'block',
    '--reason',
    'smoke_block_deploy',
    '--tool',
    'shell',
    '--command-contains',
    'deploy-artifact'
  ]));
  assert(policyCapture.schema === 'ccpanes.project-policy-capture-result.v1', 'policy-capture schema mismatch');
  assert(policyCapture.policyRuleCount === 2, 'policy-capture expected two rules');
  assert(readFileSync(join(project, '.ccpanes-task', 'policy.md'), 'utf8').includes('禁止运行 deploy-artifact'), 'policy-capture ledger missing instruction');
  const planPolicyCapture = parseJson(run([
    'policy-capture-plan',
    '--root',
    project,
    '--utterance',
    '计划阶段规则：禁止运行 ship-artifact，除非测试显式解除。'
  ]));
  assert(planPolicyCapture.schema === 'ccpanes.plan-policy-capture-result.v1', 'policy-capture-plan schema mismatch');
  assert(planPolicyCapture.capturedCount === 1, 'policy-capture-plan expected one captured rule');
  assert(readFileSync(join(project, '.ccpanes-task', 'policy.md'), 'utf8').includes('禁止运行 ship-artifact'), 'policy-capture-plan ledger missing instruction');
  const planIntake = parseJson(run([
    'plan-intake',
    '--root',
    planPreviewProject,
    '--prompt',
    '进入 plan 阶段前先收敛规则',
    '--utterance',
    '计划阶段规则：禁止运行 dry-run-artifact，除非测试显式解除。',
    '--changed-path',
    'src/plan-intake.ts',
    '--audit-out',
    planIntakeAudit
  ]));
  assert(planIntake.schema === 'ccpanes.plan-intake.v1', 'plan-intake schema mismatch');
  assert(planIntake.mode === 'dry-run', 'plan-intake expected dry-run mode');
  assert(planIntake.policyPreview.wouldCaptureCount === 1, 'plan-intake expected one would-capture action');
  assert(planIntake.workflow.route.id === 'project-policy', 'plan-intake expected project-policy route');
  assert(existsSync(planIntakeAudit), 'plan-intake audit missing');
  assert(!existsSync(join(planPreviewProject, '.ccpanes-task', 'policy.json')), 'plan-intake should not write policy.json');
  const planLifecycleCwd = join(project, 'packages', 'demo');
  mkdirSync(planLifecycleCwd, { recursive: true });
  const planLifecycleIntake = parseJson(run([
    'plan-lifecycle-intake',
    '--resolve-task-from-cwd',
    '--audit-root',
    planLifecycleAuditRoot,
    '--changed-path',
    'src/cli.ts'
  ], JSON.stringify({
    schema: 'ccpanes.plan-lifecycle-event.v1',
    cwd: planLifecycleCwd,
    prompt: 'CC-Panes plan lifecycle event',
    planText: '计划阶段规则：禁止运行 lifecycle-artifact，除非测试显式解除。',
    changedPaths: ['src/plan-intake.ts'],
    source: 'cc-panes-plan'
  })));
  assert(planLifecycleIntake.schema === 'ccpanes.plan-intake.v1', 'plan-lifecycle-intake schema mismatch');
  assert(planLifecycleIntake.projectRoot === project, 'plan-lifecycle-intake project root mismatch');
  assert(planLifecycleIntake.policyPreview.wouldCaptureCount === 1, 'plan-lifecycle-intake expected one would-capture action');
  assert(existsSync(join(planLifecycleAuditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'plan-intake-audit.json')), 'plan-lifecycle-intake audit missing');
  const policyList = parseJson(run(['policy-list', '--root', project]));
  assert(policyList.ruleCount === 3, 'policy-list expected three rules');
  const policyValidate = parseJson(run(['policy-validate', '--root', project]));
  assert(policyValidate.valid === true, 'policy-validate expected valid=true');
  const policyDisable = parseJson(run(['policy-disable', '--root', project, '--id', 'block-publish-smoke']));
  assert(policyDisable.policy.rules.find((rule) => rule.id === 'block-publish-smoke').enabled === false, 'policy-disable expected disabled rule');
  const policyClear = parseJson(run(['policy-clear', '--root', project]));
  assert(policyClear.disabledRuleCount === 3, 'policy-clear expected three disabled rules');

  const probe = parseJson(run(['probe', '--utterance', '继续', '--session', 'leader-1', '--workspace-root', fixture]));
  assert(probe.schema === 'ccpanes.resume-probe.v1', 'probe schema mismatch');
  assert(probe.action === 'auto_resume', `probe expected auto_resume, got ${probe.action}`);
  assert(probe.scanErrors.length === 0, 'probe expected zero scanErrors');

  const taskRisk = parseJson(run(['classify-task-risk', '--prompt', '修改 src/foo.ts 并更新 tests/foo.test.ts', '--cwd', project]));
  assert(taskRisk.schema === 'ccpanes.task-risk.v1', 'task risk schema mismatch');
  assert(taskRisk.tier === 'standard', 'task risk expected standard tier');
  assert(taskRisk.dimensions.touchesCode === true, 'task risk expected touchesCode=true');
  const workflowProfile = parseJson(run([
    'classify-workflow',
    '--prompt',
    '扩展 hook-event-adapter 并更新测试',
    '--cwd',
    project,
    '--changed-path',
    'src/hook-event-adapter.ts',
    '--changed-path',
    'tests/hook-event-adapter.test.ts'
  ]));
  assert(workflowProfile.schema === 'ccpanes.workflow-profile.v1', 'workflow profile schema mismatch');
  assert(workflowProfile.route.id === 'hook-runtime', 'workflow profile expected hook-runtime route');
  assert(workflowProfile.closure.bucket === 'full', 'workflow profile expected full closure bucket');
  assert(workflowProfile.checks.some((check) => check.command === 'npm run smoke'), 'workflow profile missing smoke check');
  const hostRegistry = parseJson(run(['host-adapter-registry']));
  assert(hostRegistry.schema === 'ccpanes.host-adapter-registry.v1', 'host adapter registry schema mismatch');
  assert(hostRegistry.defaultHost === 'codex', 'host adapter registry expected codex default');
  const codexHost = parseJson(run(['host-adapter-registry', '--host', 'codex']));
  assert(codexHost.schema === 'ccpanes.host-adapter.v1', 'host adapter filtered schema mismatch');
  assert(codexHost.adapter.surfaces.some((surface) => surface.kind === 'hard-gate' && surface.name === 'PreToolUse'), 'codex host missing PreToolUse hard gate');

  writeFileSync(hookBatch, JSON.stringify({
    schema: 'ccpanes.hook-dry-run-batch.v1',
    task: {
      schema: 'ccpanes.task-selection.v1',
      taskId: 'task-alpha',
      workspace: 'cc-pane',
      projectPath: project,
      worktreeRoot: project,
      mainRepoRoot: null,
      branch: null,
      head: null,
      owner: { leaderSessionId: null, paneId: null, layoutId: null },
      phase: 'build',
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:01.000Z',
      source: 'manual-import',
      notes: 'smoke hook batch task'
    },
    calls: [
      { tool: 'read', targetPath: join(project, 'src', 'a.ts'), writes: false },
      { tool: 'write', targetPath: join(project, 'src', 'a.ts'), writes: true },
      { tool: 'write', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true }
    ]
  }, null, 2), 'utf8');

  const hookResult = parseJson(run(['dry-run-hook', '--input', hookBatch]));
  assert(hookResult.schema === 'ccpanes.hook-dry-run-batch-result.v1', 'hook batch schema mismatch');
  assert(hookResult.decisions.map((item) => item.action).join(',') === 'allow,allow,block', 'hook batch decisions mismatch');
  assert(hookResult.decisions[2].reason === 'forbidden_user_config_path', 'hook batch did not block user config');

  writeFileSync(hookEvent, JSON.stringify({
    event: 'tool_call',
    tool: 'apply_patch',
    arguments: {
      patch: `*** Begin Patch\n*** Update File: ${join(project, 'src', 'a.ts')}\n@@\n-old\n+new\n*** End Patch\n`
    }
  }, null, 2), 'utf8');
  const adapted = parseJson(run(['adapt-hook-event', '--task', currentTask, '--event', hookEvent]));
  assert(adapted.schema === 'ccpanes.hook-dry-run-batch.v1', 'adapt-hook-event schema mismatch');
  assert(adapted.calls.length === 1, 'adapt-hook-event expected one call');
  assert(adapted.calls[0].tool === 'apply_patch', 'adapt-hook-event tool mismatch');
  assert(adapted.calls[0].writes === true, 'adapt-hook-event writes mismatch');
  writeFileSync(adaptedHookBatch, JSON.stringify(adapted, null, 2), 'utf8');
  const adaptedHookResult = parseJson(run(['dry-run-hook', '--input', adaptedHookBatch]));
  assert(adaptedHookResult.schema === 'ccpanes.hook-dry-run-batch-result.v1', 'adapted hook batch result schema mismatch');
  assert(adaptedHookResult.decisions[0].action === 'allow', 'adapted hook batch expected allow');
  assert(adaptedHookResult.decisions[0].reason === 'verify_minimal_fix_inside_worktree', 'adapted hook batch reason mismatch');

  const hookRunner = parseJson(run(['hook-runner', '--task', currentTask], JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(project, 'src', 'a.ts') }
  })));
  assert(hookRunner.schema === 'ccpanes.hook-runner-result.v1', 'hook-runner schema mismatch');
  assert(hookRunner.mode === 'dry-run', 'hook-runner mode mismatch');
  assert(hookRunner.allowed === true, 'hook-runner expected allowed=true');
  assert(hookRunner.dryRun.decisions[0].reason === 'verify_minimal_fix_inside_worktree', 'hook-runner reason mismatch');

  const hookEnforceAllow = run(['hook-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: project,
    tool_name: 'apply_patch',
    tool_input: {
      patch: `*** Begin Patch\n*** Update File: ${join(project, 'src', 'a.ts')}\n@@\n-old\n+new\n*** End Patch\n`
    }
  }));
  assert(hookEnforceAllow.trim() === '', 'hook-enforce expected empty stdout for allowed event');
  const hookEnforceBlock = parseJson(run(['hook-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: project,
    tool_name: 'apply_patch',
    tool_input: {
      patch: '*** Begin Patch\n*** Update File: C:/Users/AI001/.codex/config.toml\n@@\n-old\n+new\n*** End Patch\n'
    }
  })));
  assert(hookEnforceBlock.hookSpecificOutput.hookEventName === 'PreToolUse', 'hook-enforce deny hook event mismatch');
  assert(hookEnforceBlock.hookSpecificOutput.permissionDecision === 'deny', 'hook-enforce expected deny');
  assert(hookEnforceBlock.hookSpecificOutput.permissionDecisionReason.includes('forbidden_user_config_path'), 'hook-enforce deny reason mismatch');
  assert(existsSync(join(hookEnforceAuditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'hook-enforce-audit.json')), 'hook-enforce dynamic audit missing');

  const hookEnforceShellBlock = parseJson(run(['hook-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: project,
    tool_name: 'Bash',
    tool_input: {
      command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x'
    }
  })));
  assert(hookEnforceShellBlock.hookSpecificOutput.permissionDecision === 'deny', 'hook-enforce shell expected deny');
  assert(hookEnforceShellBlock.hookSpecificOutput.permissionDecisionReason.includes('forbidden_user_config_path'), 'hook-enforce shell deny reason mismatch');

  const hookEnforceDestructiveBlock = parseJson(run(['hook-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: project,
    tool_name: 'functions.shell_command',
    tool_input: {
      command: 'git reset --hard HEAD'
    }
  })));
  assert(hookEnforceDestructiveBlock.hookSpecificOutput.permissionDecision === 'deny', 'hook-enforce destructive expected deny');
  assert(hookEnforceDestructiveBlock.hookSpecificOutput.permissionDecisionReason.includes('destructive_git_reset_hard'), 'hook-enforce destructive deny reason mismatch');

  const hookEnforceMcpRead = run(['hook-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: project,
    tool_name: 'mcp__fastctx__read',
    tool_input: {
      files: [
        { path: join(project, 'src', 'a.ts') },
        { path: join(project, 'src', 'b.ts') }
      ]
    }
  }));
  assert(hookEnforceMcpRead.trim() === '', 'hook-enforce MCP read expected empty stdout');

  const permissionDeny = parseJson(run(['permission-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PermissionRequest',
    cwd: project,
    tool_name: 'Bash',
    tool_input: {
      command: 'git reset --hard HEAD',
      description: 'Need approval to reset worktree'
    }
  })));
  assert(permissionDeny.hookSpecificOutput.hookEventName === 'PermissionRequest', 'permission-enforce hook event mismatch');
  assert(permissionDeny.hookSpecificOutput.decision.behavior === 'deny', 'permission-enforce expected deny');
  assert(permissionDeny.hookSpecificOutput.decision.message.includes('destructive_git_reset_hard'), 'permission-enforce deny reason mismatch');
  assert(existsSync(join(hookEnforceAuditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'permission-enforce-audit.json')), 'permission-enforce audit missing');

  const permissionNoDecision = run(['permission-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PermissionRequest',
    cwd: project,
    tool_name: 'Bash',
    tool_input: {
      command: 'npm test',
      description: 'Run tests'
    }
  }));
  assert(permissionNoDecision.trim() === '', 'permission-enforce allowed request should not auto-approve');

  const postToolUseOutput = run(['post-enforce', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'PostToolUse',
    cwd: project,
    tool_name: 'Bash',
    tool_use_id: 'toolu-smoke-post-1',
    tool_input: { command: 'npm test' },
    tool_response: { exit_code: 0, stdout: 'ok' }
  }));
  assert(postToolUseOutput.trim() === '', 'post-enforce expected empty stdout');
  const postAuditPath = join(hookEnforceAuditRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'post-tool-use-audit.jsonl');
  assert(existsSync(postAuditPath), 'post-enforce audit missing');
  const postAuditLines = readFileSync(postAuditPath, 'utf8').trim().split('\n');
  assert(postAuditLines.length === 1, 'post-enforce expected one audit line');
  const postAuditRecord = JSON.parse(postAuditLines[0]);
  assert(postAuditRecord.schema === 'ccpanes.post-tool-use-audit.v1', 'post-enforce audit schema mismatch');
  assert(postAuditRecord.toolUseId === 'toolu-smoke-post-1', 'post-enforce audit toolUseId mismatch');

  const sessionStartOutput = parseJson(run(['session-start', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'SessionStart',
    cwd: project,
    source: 'startup'
  })));
  assert(sessionStartOutput.hookSpecificOutput.hookEventName === 'SessionStart', 'session-start hook event mismatch');
  assert(sessionStartOutput.hookSpecificOutput.additionalContext.includes('taskId: task-alpha'), 'session-start missing taskId context');
  assert(sessionStartOutput.hookSpecificOutput.additionalContext.includes('post-tool-use-audit.jsonl'), 'session-start missing post audit context');

  const stopCheckOutput = parseJson(run(['stop-check', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'Stop',
    cwd: project,
    turn_id: 'turn-smoke-stop-1',
    stop_hook_active: false,
    last_assistant_message: 'done'
  })));
  assert(stopCheckOutput.continue === true, 'stop-check expected continue=true');
  assert(!Object.hasOwn(stopCheckOutput, 'decision'), 'stop-check should not emit continuation decision');
  assert(stopCheckOutput.systemMessage.includes('verify-acceptance'), 'stop-check missing acceptance reminder');

  writeFileSync(stopTranscript, [
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '修复 src/foo.ts' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: join(project, 'src', 'foo.ts') } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '已修复，测试通过。' }] } })
  ].join('\n'), 'utf8');
  const targetedStopCheckOutput = parseJson(run(['stop-check', '--resolve-task-from-cwd', '--audit-root', hookEnforceAuditRoot], JSON.stringify({
    hook_event_name: 'Stop',
    cwd: project,
    turn_id: 'turn-smoke-stop-2',
    stop_hook_active: false,
    transcript_path: stopTranscript
  })));
  assert(targetedStopCheckOutput.systemMessage.includes('targeted verification reminder'), 'stop-check missing targeted reminder');

  writeFileSync(installedHooksFixture, JSON.stringify(buildExpectedHooksConfig({ prototypeRoot: root, auditRoot: hookEnforceAuditRoot }), null, 2), 'utf8');
  const installedHooksReport = parseJson(run([
    'verify-installed-hooks',
    '--hooks-json',
    installedHooksFixture,
    '--prototype-root',
    root,
    '--audit-root',
    hookEnforceAuditRoot
  ]));
  assert(installedHooksReport.schema === 'ccpanes.installed-hooks.verify.v1', 'installed hooks verify schema mismatch');
  assert(installedHooksReport.passed === true, 'installed hooks verify expected passed=true');
  assert(installedHooksReport.discovered.length === 7, 'installed hooks verify expected seven hooks');
  assert(installedHooksReport.discovered.some((item) => item.name === 'UserPromptSubmit skills-hub'), 'installed hooks verify missing skills-hub UserPromptSubmit hook');
  assert(installedHooksReport.discovered.some((item) => item.name === 'UserPromptSubmit cc-panes prompt-before'), 'installed hooks verify missing CC-Panes UserPromptSubmit hook');

  const productionToolkitManifest = parseJson(run([
    'create-production-toolkit',
    '--out-dir',
    productionToolkit,
    '--prototype-root',
    root,
    '--audit-root',
    hookEnforceAuditRoot,
    '--hooks-json',
    installedHooksFixture,
    '--expected-upstream-hook',
    upstreamHook,
    '--expected-upstream-sha256',
    'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4'
  ]));
  assert(productionToolkitManifest.schema === 'ccpanes.production-toolkit-manifest.v1', 'production toolkit schema mismatch');
  assert(existsSync(join(productionToolkit, 'INSTALL-HOOKS.ps1')), 'production toolkit missing INSTALL-HOOKS.ps1');
  assert(existsSync(join(productionToolkit, 'VERIFY-INSTALLED.ps1')), 'production toolkit missing VERIFY-INSTALLED.ps1');
  assert(existsSync(join(productionToolkit, 'BOOTSTRAP-PROJECT.ps1')), 'production toolkit missing BOOTSTRAP-PROJECT.ps1');
  assert(existsSync(join(productionToolkit, 'ROLLBACK-HOOKS.ps1')), 'production toolkit missing ROLLBACK-HOOKS.ps1');
  assert(readFileSync(join(productionToolkit, 'PRODUCTION-README.md'), 'utf8').includes('SessionStart'), 'production toolkit README missing SessionStart');

  assert(existsSync(upstreamHook), `missing upstream hook fixture: ${upstreamHook}`);
  const hookShadow = parseJson(run([
    'hook-shadow',
    '--task',
    currentTask,
    '--upstream-hook',
    upstreamHook,
    '--out',
    shadowAudit
  ], JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(project, 'src', 'a.ts') }
  })));
  assert(hookShadow.schema === 'ccpanes.hook-shadow-audit.v1', 'hook-shadow schema mismatch');
  assert(hookShadow.mode === 'shadow', 'hook-shadow mode mismatch');
  assert(hookShadow.upstreamHook.sha256 === 'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4', 'hook-shadow upstream hash mismatch');
  assert(hookShadow.runner.allowed === true, 'hook-shadow runner expected allowed=true');
  assert(existsSync(shadowAudit), 'hook-shadow did not write audit file');

  const hookInstallPlan = parseJson(run([
    'plan-hook-install',
    '--prototype-root',
    root,
    '--task',
    currentTask,
    '--target',
    'both',
    '--upstream-hook',
    upstreamHook,
    '--out',
    installPlan
  ]));
  assert(hookInstallPlan.schema === 'ccpanes.hook-install-plan.v1', 'hook install plan schema mismatch');
  assert(hookInstallPlan.mode === 'review-only', 'hook install plan mode mismatch');
  assert(hookInstallPlan.target === 'both', 'hook install plan target mismatch');
  assert(hookInstallPlan.upstreamHook.sha256 === 'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4', 'hook install plan upstream hash mismatch');
  assert(hookInstallPlan.proposedConfigChanges.length === 2, 'hook install plan expected two proposed config changes');
  assert(hookInstallPlan.proposedConfigChanges[0].patchCandidate.includes('hook-shadow'), 'hook install plan patch candidate missing hook-shadow');
  assert(existsSync(installPlan), 'hook install plan did not write output file');

  const hookPackageManifest = parseJson(run([
    'create-hook-package',
    '--prototype-root',
    root,
    '--task',
    currentTask,
    '--target',
    'both',
    '--upstream-hook',
    upstreamHook,
    '--out-dir',
    hookPackage
  ]));
  assert(hookPackageManifest.schema === 'ccpanes.hook-package-manifest.v1', 'hook package manifest schema mismatch');
  assert(hookPackageManifest.mode === 'review-only', 'hook package mode mismatch');
  assert(hookPackageManifest.upstreamHookSha256 === 'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4', 'hook package upstream hash mismatch');
  assert(hookPackageManifest.files.some((file) => file.path.endsWith('rollback-plan.json')), 'hook package missing rollback plan');
  assert(existsSync(join(hookPackage, 'manifest.json')), 'hook package missing manifest file');
  assert(existsSync(join(hookPackage, 'patches', 'codex.patch')), 'hook package missing codex patch');
  assert(existsSync(join(hookPackage, 'patches', 'ccpanes.patch')), 'hook package missing ccpanes patch');

  const packageRehearsal = parseJson(run([
    'rehearse-hook-package',
    '--package-dir',
    hookPackage,
    '--expected-upstream-sha256',
    'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4',
    '--out',
    hookPackageRehearsal
  ]));
  assert(packageRehearsal.schema === 'ccpanes.hook-package-rehearsal.v1', 'hook package rehearsal schema mismatch');
  assert(packageRehearsal.mode === 'dry-run-rehearsal', 'hook package rehearsal mode mismatch');
  assert(packageRehearsal.passed === true, 'hook package rehearsal expected passed=true');
  assert(packageRehearsal.failures.length === 0, 'hook package rehearsal expected no failures');
  assert(packageRehearsal.checks.some((check) => check.name === 'file hashes' && check.result === 'pass'), 'hook package rehearsal file hashes did not pass');
  assert(packageRehearsal.checks.some((check) => check.name === 'upstream hash' && check.result === 'pass'), 'hook package rehearsal upstream hash did not pass');
  assert(existsSync(hookPackageRehearsal), 'hook package rehearsal did not write report');

  const releaseGateReport = parseJson(run([
    'release-gate',
    '--package-dir',
    hookPackage,
    '--expected-upstream-sha256',
    'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4',
    '--config',
    'C:/Users/AI001/.codex/config.toml',
    '--config',
    'C:/Users/AI001/.cc-panes/config.toml',
    '--repo',
    'D:/cc-pane/tool/repos/comet',
    '--repo',
    'D:/cc-pane/tool/repos/fastctx',
    '--check',
    'smoke=pass=SMOKE_PASS',
    '--out',
    releaseGate
  ]));
  assert(releaseGateReport.schema === 'ccpanes.hook-release-gate.v1', 'release gate schema mismatch');
  assert(releaseGateReport.mode === 'final-preflight', 'release gate mode mismatch');
  assert(releaseGateReport.passed === true, 'release gate expected passed=true');
  assert(releaseGateReport.configSnapshots.length === 2, 'release gate expected two config snapshots');
  assert(releaseGateReport.referenceRepos.every((repo) => repo.status === 'clean'), 'release gate expected clean reference repos');
  assert(releaseGateReport.checks.some((check) => check.name === 'verification checks' && check.result === 'pass'), 'release gate verification checks did not pass');
  assert(existsSync(releaseGate), 'release gate did not write report');

  const applyPlan = parseJson(run([
    'create-hook-apply-plan',
    '--release-gate',
    releaseGate,
    '--out-dir',
    hookApplyPlan
  ]));
  assert(applyPlan.schema === 'ccpanes.hook-apply-plan.v1', 'apply plan schema mismatch');
  assert(applyPlan.mode === 'staged-review', 'apply plan mode mismatch');
  assert(applyPlan.releaseGatePassed === true, 'apply plan expected releaseGatePassed=true');
  assert(applyPlan.artifacts.some((artifact) => artifact.kind === 'backup-script'), 'apply plan missing backup script artifact');
  assert(existsSync(join(hookApplyPlan, 'apply-plan.json')), 'apply plan missing apply-plan.json');
  assert(existsSync(join(hookApplyPlan, 'APPLY-INSTRUCTIONS.md')), 'apply plan missing instructions');
  assert(existsSync(join(hookApplyPlan, 'scripts', 'capture-prechange.ps1')), 'apply plan missing capture script');
  assert(existsSync(join(hookApplyPlan, 'staged-patches', 'codex.patch')), 'apply plan missing staged codex patch');

  const applyPlanPath = join(hookApplyPlan, 'apply-plan.json');
  const approvalJson = {
    schema: 'ccpanes.hook-approval.v1',
    approved: true,
    applyPlanSha256: sha256File(applyPlanPath),
    releaseGateSha256: sha256File(releaseGate),
    targetConfigPaths: applyPlan.targetConfigPaths,
    expectedConfigSha256ByPath: Object.fromEntries(applyPlan.targetConfigPaths.map((configPath) => [configPath, sha256File(configPath)])),
    backupDir: join(hookApplyPlan, 'backups'),
    rollbackCommand: join(hookApplyPlan, 'scripts', 'restore-from-backup.ps1'),
    writeWindow: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }
  };
  writeFileSync(approval, JSON.stringify(approvalJson, null, 2), 'utf8');
  const approvalReport = parseJson(run([
    'check-hook-approval',
    '--apply-plan',
    applyPlanPath,
    '--approval',
    approval,
    '--out',
    approvalCheck
  ]));
  assert(approvalReport.schema === 'ccpanes.hook-approval-check.v1', 'approval check schema mismatch');
  assert(approvalReport.mode === 'approval-preflight', 'approval check mode mismatch');
  assert(approvalReport.passed === true, 'approval check expected passed=true');
  assert(approvalReport.checks.some((check) => check.name === 'config hashes' && check.result === 'pass'), 'approval check config hashes did not pass');
  assert(approvalReport.checks.some((check) => check.name === 'write window' && check.result === 'pass'), 'approval check write window did not pass');
  assert(existsSync(approvalCheck), 'approval check did not write report');

  const writePreview = parseJson(run([
    'preview-hook-write',
    '--approval-check',
    approvalCheck,
    '--out-dir',
    hookWritePreview
  ]));
  assert(writePreview.schema === 'ccpanes.hook-write-preview.v1', 'hook write preview schema mismatch');
  assert(writePreview.mode === 'dry-run-write-preview', 'hook write preview mode mismatch');
  assert(writePreview.approvalCheckPassed === true, 'hook write preview expected approvalCheckPassed=true');
  assert(existsSync(join(hookWritePreview, 'write-preview.json')), 'hook write preview missing write-preview.json');
  assert(existsSync(join(hookWritePreview, 'backup-manifest.json')), 'hook write preview missing backup-manifest.json');
  assert(readdirSync(join(hookWritePreview, 'diffs')).some((file) => file.endsWith('.diff')), 'hook write preview missing diff artifact');
  assert(readdirSync(join(hookWritePreview, 'before')).some((file) => file.endsWith('.toml')), 'hook write preview missing before artifact');
  assert(readdirSync(join(hookWritePreview, 'after')).some((file) => file.endsWith('.toml')), 'hook write preview missing after artifact');

  mkdirSync(join(syntheticApplyPlanDir, 'staged-patches'), { recursive: true });
  const syntheticBefore = 'original = true\n';
  const syntheticPatch = '[hooks]\npreview = "node hook-runner.js"\n';
  const syntheticAfter = `${syntheticBefore}\n# ccpanes-hook-preview:begin\n${syntheticPatch.trimEnd()}\n# ccpanes-hook-preview:end\n`;
  writeFileSync(syntheticApplyConfig, syntheticBefore, 'utf8');
  writeFileSync(syntheticApplyPatch, syntheticPatch, 'utf8');
  writeFileSync(syntheticApplyPlan, JSON.stringify({
    schema: 'ccpanes.hook-apply-plan.v1',
    mode: 'staged-review',
    createdAt: '2026-08-06T00:00:00.000Z',
    releaseGatePath: join(syntheticApplyRoot, 'release-gate.json'),
    releaseGatePassed: true,
    packageDir: join(syntheticApplyRoot, 'package'),
    targetConfigPaths: [syntheticApplyConfig],
    artifacts: [{ kind: 'patch', path: syntheticApplyPatch, sha256: sha256Text(syntheticPatch) }],
    instructions: []
  }, null, 2), 'utf8');
  writeFileSync(syntheticApprovalCheck, JSON.stringify({
    schema: 'ccpanes.hook-approval-check.v1',
    mode: 'approval-preflight',
    createdAt: '2026-08-06T00:00:00.000Z',
    applyPlanPath: syntheticApplyPlan,
    passed: true,
    configSnapshots: [{ path: syntheticApplyConfig, exists: true, sha256: sha256Text(syntheticBefore), expectedSha256: sha256Text(syntheticBefore) }],
    checks: [],
    failures: []
  }, null, 2), 'utf8');
  const syntheticWritePreview = parseJson(run([
    'preview-hook-write',
    '--approval-check',
    syntheticApprovalCheck,
    '--out-dir',
    syntheticWritePreviewDir
  ]));
  assert(syntheticWritePreview.schema === 'ccpanes.hook-write-preview.v1', 'synthetic write preview schema mismatch');
  const applyWriteReport = parseJson(run([
    'apply-hook-write',
    '--write-preview',
    join(syntheticWritePreviewDir, 'write-preview.json'),
    '--approval-check',
    syntheticApprovalCheck,
    '--out',
    syntheticApplyReport,
    '--allow-root',
    syntheticApplyRoot
  ]));
  assert(applyWriteReport.schema === 'ccpanes.hook-write-apply.v1', 'hook write apply schema mismatch');
  assert(applyWriteReport.mode === 'guarded-apply', 'hook write apply mode mismatch');
  assert(applyWriteReport.passed === true, 'hook write apply expected passed=true');
  assert(existsSync(syntheticApplyReport), 'hook write apply did not write report');
  assert(existsSync(applyWriteReport.entries[0].backupPath), 'hook write apply missing backup');
  assert(readFileSync(syntheticApplyConfig, 'utf8') === syntheticAfter, 'hook write apply did not update synthetic config');
  const restoreWriteReport = parseJson(run([
    'restore-hook-write',
    '--apply-report',
    syntheticApplyReport,
    '--out',
    syntheticRestoreReport,
    '--allow-root',
    syntheticApplyRoot
  ]));
  assert(restoreWriteReport.schema === 'ccpanes.hook-write-restore.v1', 'hook write restore schema mismatch');
  assert(restoreWriteReport.mode === 'guarded-restore', 'hook write restore mode mismatch');
  assert(restoreWriteReport.passed === true, 'hook write restore expected passed=true');
  assert(existsSync(syntheticRestoreReport), 'hook write restore did not write report');
  assert(readFileSync(syntheticApplyConfig, 'utf8') === syntheticBefore, 'hook write restore did not restore synthetic config');
  const readiness = parseJson(run([
    'production-readiness',
    '--release-gate',
    releaseGate,
    '--approval-check',
    approvalCheck,
    '--write-preview',
    join(hookWritePreview, 'write-preview.json'),
    '--apply-report',
    syntheticApplyReport,
    '--restore-report',
    syntheticRestoreReport,
    '--out',
    productionReadiness
  ]));
  assert(readiness.schema === 'ccpanes.hook-production-readiness.v1', 'production readiness schema mismatch');
  assert(readiness.mode === 'final-readiness', 'production readiness mode mismatch');
  assert(readiness.ready === true, 'production readiness expected ready=true');
  assert(readiness.checks.every((check) => check.result === 'pass'), 'production readiness expected all checks pass');
  assert(existsSync(productionReadiness), 'production readiness did not write report');
  const goLiveApproval = parseJson(run([
    'create-go-live-approval-package',
    '--readiness',
    productionReadiness,
    '--out-dir',
    goLiveApprovalPackage,
    '--approved-by',
    'AI001',
    '--approval-note',
    'manual authorization approved',
    '--upstream-hook',
    upstreamHook
  ]));
  assert(goLiveApproval.schema === 'ccpanes.hook-go-live-approval-package.v1', 'go-live approval schema mismatch');
  assert(goLiveApproval.mode === 'manual-approval-package', 'go-live approval mode mismatch');
  assert(goLiveApproval.manualApproval.approved === true, 'go-live approval expected approved=true');
  assert(goLiveApproval.manualApproval.approvedBy === 'AI001', 'go-live approval approvedBy mismatch');
  assert(existsSync(join(goLiveApprovalPackage, 'manifest.json')), 'go-live approval missing manifest');
  assert(existsSync(join(goLiveApprovalPackage, 'GO-LIVE-APPROVAL.md')), 'go-live approval missing approval markdown');
  assert(existsSync(join(goLiveApprovalPackage, 'COMMANDS.ps1')), 'go-live approval missing commands');
  assert(existsSync(join(goLiveApprovalPackage, 'EVIDENCE-INDEX.md')), 'go-live approval missing evidence index');

  const finalRunbookManifest = parseJson(run([
    'create-final-runbook',
    '--go-live-manifest',
    join(goLiveApprovalPackage, 'manifest.json'),
    '--out-dir',
    finalRunbook
  ]));
  assert(finalRunbookManifest.schema === 'ccpanes.hook-final-runbook.v1', 'final runbook schema mismatch');
  assert(finalRunbookManifest.mode === 'manual-execution-runbook', 'final runbook mode mismatch');
  assert(existsSync(join(finalRunbook, 'manifest.json')), 'final runbook missing manifest');
  assert(existsSync(join(finalRunbook, 'FINAL-RUNBOOK.md')), 'final runbook missing runbook markdown');
  assert(existsSync(join(finalRunbook, 'PRE-FLIGHT.ps1')), 'final runbook missing pre-flight script');
  assert(existsSync(join(finalRunbook, 'POST-FLIGHT.ps1')), 'final runbook missing post-flight script');
  assert(existsSync(join(finalRunbook, 'ROLLBACK-CHECKLIST.md')), 'final runbook missing rollback checklist');
  const finalRunbookText = readFileSync(join(finalRunbook, 'FINAL-RUNBOOK.md'), 'utf8');
  assert(finalRunbookText.includes('Write pre-flight snapshot'), 'final runbook missing pre-flight step');
  assert(finalRunbookText.includes('Apply one config at a time'), 'final runbook missing config-by-config step');
  assert(finalRunbookText.includes('Rollback condition'), 'final runbook missing rollback condition');

  writeFileSync(artifact, 'smoke artifact', 'utf8');
  const acceptanceJson = run([
    'record-acceptance',
    '--task', currentTask,
    '--artifact', artifact,
    '--check', 'smoke=pass=end-to-end smoke passed'
  ]);
  writeFileSync(acceptance, acceptanceJson, 'utf8');

  const verifyMatch = parseJson(run(['verify-acceptance', '--input', acceptance]));
  assert(verifyMatch.schema === 'ccpanes.acceptance.verify.v1', 'verify schema mismatch');
  assert(verifyMatch.passed === true, 'verify expected passed=true before mutation');
  assert(verifyMatch.summary.completionAllowed === true, 'verify expected completionAllowed=true before mutation');

  writeFileSync(artifact, 'smoke artifact changed', 'utf8');
  const verifyMismatch = parseJson(run(['verify-acceptance', '--input', acceptance]));
  assert(verifyMismatch.passed === false, 'verify expected passed=false after mutation');
  assert(verifyMismatch.artifactResults[0].status === 'mismatch', 'verify expected artifact mismatch after mutation');
  assert(verifyMismatch.truthLayers.some((layer) => layer.name === 'artifact-hashes' && layer.state === 'fail'), 'verify expected artifact-hashes truth failure');

  cleanFixture();
  console.log('SMOKE_PASS');
} catch (error) {
  cleanFixture();
  console.error('SMOKE_FAIL');
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
