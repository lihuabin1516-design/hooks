import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHookInstallPlan, type HookInstallPlan, type HookInstallTarget } from './hook-install-plan.js';
import { isPathInside } from './paths.js';
import type { CurrentTask } from './types.js';

export interface HookPackageFile {
  kind: 'install-plan' | 'rollback-plan' | 'patch' | 'acceptance-checklist';
  path: string;
  sha256: string;
}

export interface HookPackageManifest {
  schema: 'ccpanes.hook-package-manifest.v1';
  mode: 'review-only';
  createdAt: string;
  target: HookInstallTarget;
  taskId: string;
  outDir: string;
  upstreamHookSha256: string | null;
  files: HookPackageFile[];
}

export interface HookRollbackPlan {
  schema: 'ccpanes.hook-rollback-plan.v1';
  mode: 'manual-rollback';
  createdAt: string;
  target: HookInstallTarget;
  configPaths: string[];
  steps: string[];
  verification: string[];
}

export interface CreateHookPackageInput {
  task: CurrentTask;
  prototypeRoot: string;
  target: HookInstallTarget;
  upstreamHookPath: string;
  outDir: string;
  now?: string;
}

const forbiddenPackageOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function assertSafePackageOutDir(outDir: string): void {
  for (const root of forbiddenPackageOutRoots) {
    if (isPathInside(root, outDir)) {
      throw new Error(`invalid hook package output directory: forbidden root ${root}`);
    }
  }
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

async function writeTextFile(filePath: string, text: string, kind: HookPackageFile['kind']): Promise<HookPackageFile> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
  return { kind, path: filePath, sha256: sha256Text(text) };
}

function createRollbackPlan(installPlan: HookInstallPlan, now: string): HookRollbackPlan {
  const configPaths = installPlan.proposedConfigChanges.map((change) => change.configPath);
  return {
    schema: 'ccpanes.hook-rollback-plan.v1',
    mode: 'manual-rollback',
    createdAt: now,
    target: installPlan.target,
    configPaths,
    steps: [
      'Capture pre-change config hashes before applying any reviewed patch.',
      'Apply at most one reviewed config patch at a time.',
      'If validation fails, restore the captured pre-change config file bytes.',
      'Re-run hook-shadow with a synthetic event after restore.',
      'Confirm user config hashes match the pre-change capture.'
    ],
    verification: [
      'npm test',
      'npm run typecheck',
      'npm run build',
      'npm run smoke',
      'hook-shadow synthetic event returns ccpanes.hook-shadow-audit.v1'
    ]
  };
}

function createChecklist(installPlan: HookInstallPlan): string {
  return [
    '# Hook Package Acceptance Checklist',
    '',
    '- [ ] Confirm package manifest hashes.',
    '- [ ] Confirm upstream hook SHA-256 matches expected value.',
    `- [ ] Confirm upstream hook SHA-256: ${installPlan.upstreamHook.sha256 ?? 'missing'}.`,
    '- [ ] Review install-plan.json.',
    '- [ ] Review rollback-plan.json.',
    '- [ ] Review patch candidates under patches/.',
    '- [ ] Run npm test.',
    '- [ ] Run npm run typecheck.',
    '- [ ] Run npm run build.',
    '- [ ] Run npm run smoke.',
    '- [ ] Run hook-shadow with a synthetic event.',
    '- [ ] Capture config hashes before any real config write.',
    ''
  ].join('\n');
}

export async function createHookPackage(input: CreateHookPackageInput): Promise<HookPackageManifest> {
  assertSafePackageOutDir(input.outDir);
  const now = input.now ?? new Date().toISOString();
  const installPlan = await createHookInstallPlan({
    task: input.task,
    prototypeRoot: input.prototypeRoot,
    target: input.target,
    upstreamHookPath: input.upstreamHookPath,
    now
  });
  const rollbackPlan = createRollbackPlan(installPlan, now);

  await fs.rm(input.outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(input.outDir, 'patches'), { recursive: true });

  const files: HookPackageFile[] = [];
  files.push(await writeTextFile(path.join(input.outDir, 'install-plan.json'), `${JSON.stringify(installPlan, null, 2)}\n`, 'install-plan'));
  files.push(await writeTextFile(path.join(input.outDir, 'rollback-plan.json'), `${JSON.stringify(rollbackPlan, null, 2)}\n`, 'rollback-plan'));
  for (const change of installPlan.proposedConfigChanges) {
    files.push(await writeTextFile(path.join(input.outDir, 'patches', `${change.surface}.patch`), change.patchCandidate, 'patch'));
  }
  files.push(await writeTextFile(path.join(input.outDir, 'ACCEPTANCE-CHECKLIST.md'), createChecklist(installPlan), 'acceptance-checklist'));

  const manifest: HookPackageManifest = {
    schema: 'ccpanes.hook-package-manifest.v1',
    mode: 'review-only',
    createdAt: now,
    target: input.target,
    taskId: input.task.taskId,
    outDir: input.outDir,
    upstreamHookSha256: installPlan.upstreamHook.sha256,
    files
  };
  await fs.writeFile(path.join(input.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
