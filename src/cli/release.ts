import { readFile } from 'node:fs/promises';
import { createHookInstallPlan, writeHookInstallPlanAtomic } from '../hook-install-plan.js';
import { createHookPackage } from '../hook-package.js';
import { rehearseHookPackage, writeHookPackageRehearsalAtomic } from '../hook-package-rehearsal.js';
import { createHookReleaseGate, writeHookReleaseGateAtomic, type VerificationCheckInput } from '../hook-release-gate.js';
import { createHookApplyPlan } from '../hook-apply-plan.js';
import { checkHookApproval, writeHookApprovalCheckAtomic } from '../hook-approval.js';
import { createHookWritePreview } from '../hook-write-preview.js';
import { createHookWriteApply, writeHookWriteApplyReportAtomic } from '../hook-write-apply.js';
import { createHookWriteRestore, writeHookWriteRestoreReportAtomic } from '../hook-write-restore.js';
import { createHookProductionReadiness, writeHookProductionReadinessAtomic } from '../hook-production-readiness.js';
import { createHookGoLiveApprovalPackage } from '../hook-go-live-approval.js';
import { createHookFinalRunbook } from '../hook-final-runbook.js';
import { verifyInstalledHooks } from '../installed-hooks.js';
import { verifyLiveConsistency } from '../live-consistency.js';
import { createProductionToolkit } from '../production-toolkit.js';
import { createAcceptanceEvidence } from '../acceptance.js';
import { verifyAcceptanceEvidence } from '../acceptance-verify.js';
import { CCPANES_RUNTIME_PROFILE } from '../runtime-profile.js';
import { validateCurrentTask } from '../current-task.js';
import type { RunCliOptions } from '../cli-types.js';
import {
  parseCheck,
  parseHookInstallTarget,
  parseTruthLayer,
  parseVerificationCheck,
  valueAfter,
  valuesAfter
} from '../cli-shared.js';

function parseVerificationChecks(args: string[]): VerificationCheckInput[] {
  return valuesAfter(args, '--check').map((check) => parseVerificationCheck(check));
}

export async function handleReleaseCommands(
  args: string[],
  _stdinText: string | undefined,
  _options: RunCliOptions
): Promise<string | null> {
  const command = args[0];

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
    const verificationChecks = parseVerificationChecks(args);
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
    const evidence = JSON.parse(await readFile(input, 'utf8'));
    const result = await verifyAcceptanceEvidence(evidence);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  return null;
}
