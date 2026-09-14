import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { routeCliCommand } from './cli-router.js';
import { handleHookCommands } from './cli/hook.js';
import { handlePolicyCommands } from './cli/policy.js';
import { handleReleaseCommands } from './cli/release.js';
import { handleSessionCommands } from './cli/session.js';
import { handleTaskCommands } from './cli/task.js';
import { handleWorkflowCommands } from './cli/workflow.js';
import type { RunCliOptions } from './cli-types.js';

export type { RunCliOptions } from './cli-types.js';

export function isCliEntrypoint(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  return importMetaUrl === pathToFileURL(argvPath).href;
}

function valueAfter(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] ?? null : null;
}

export function appendCliRuntimeError(args: string[], error: unknown): void {
  const auditRoot = valueAfter(args, '--audit-root');
  if (!auditRoot) return;
  try {
    fs.mkdirSync(auditRoot, { recursive: true });
    const record = {
      schema: 'ccpanes.hook-runtime-error.v1',
      recordedAt: new Date().toISOString(),
      command: args[0] ?? null,
      cwd: process.cwd(),
      pid: process.pid,
      error: {
        name: error instanceof Error ? error.name : null,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack ?? null : null
      }
    };
    fs.appendFileSync(
      path.join(auditRoot, 'hook-runtime-errors.jsonl'),
      `${JSON.stringify(record)}\n`,
      'utf8'
    );
  } catch {
    // Diagnostics must never replace the original hook failure.
  }
}

export async function runCli(args: string[], stdinText?: string, options: RunCliOptions = {}): Promise<string> {
  return routeCliCommand(args, stdinText, options, [
    handleSessionCommands,
    handleTaskCommands,
    handlePolicyCommands,
    handleWorkflowCommands,
    handleHookCommands,
    handleReleaseCommands
  ]);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  runCli(args)
    .then((output) => process.stdout.write(output))
    .catch((error) => {
      appendCliRuntimeError(args, error);
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
