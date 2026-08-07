import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runHookEventDryRun, type HookRunnerResult } from './hook-runner.js';
import { isPathInside } from './paths.js';
import type { CurrentTask } from './types.js';

export interface UpstreamHookMetadata {
  path: string;
  exists: boolean;
  size: number | null;
  lastWriteUtc: string | null;
  sha256: string | null;
}

export interface HookShadowAudit {
  schema: 'ccpanes.hook-shadow-audit.v1';
  mode: 'shadow';
  createdAt: string;
  taskId: string;
  upstreamHook: UpstreamHookMetadata | null;
  runner: HookRunnerResult;
}

export interface CreateHookShadowAuditInput {
  task: CurrentTask;
  event: unknown;
  upstreamHookPath?: string | null;
  now?: string;
}

const forbiddenAuditOutRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

export async function readUpstreamHookMetadata(upstreamHookPath: string | null | undefined): Promise<UpstreamHookMetadata | null> {
  if (!upstreamHookPath) return null;
  try {
    const stat = await fs.stat(upstreamHookPath);
    const bytes = await fs.readFile(upstreamHookPath);
    return {
      path: upstreamHookPath,
      exists: true,
      size: stat.size,
      lastWriteUtc: stat.mtime.toISOString(),
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase()
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: upstreamHookPath,
        exists: false,
        size: null,
        lastWriteUtc: null,
        sha256: null
      };
    }
    throw error;
  }
}

export async function createHookShadowAudit(input: CreateHookShadowAuditInput): Promise<HookShadowAudit> {
  const runner = runHookEventDryRun(input.task, input.event);
  const upstreamHook = await readUpstreamHookMetadata(input.upstreamHookPath);
  return {
    schema: 'ccpanes.hook-shadow-audit.v1',
    mode: 'shadow',
    createdAt: input.now ?? new Date().toISOString(),
    taskId: input.task.taskId,
    upstreamHook,
    runner
  };
}

function assertSafeAuditOutPath(outPath: string): void {
  for (const root of forbiddenAuditOutRoots) {
    if (isPathInside(root, outPath)) {
      throw new Error(`invalid audit output path: forbidden root ${root}`);
    }
  }
}

export async function writeHookShadowAuditAtomic(outPath: string, audit: HookShadowAudit): Promise<void> {
  assertSafeAuditOutPath(outPath);
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${path.basename(outPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, outPath);
}
