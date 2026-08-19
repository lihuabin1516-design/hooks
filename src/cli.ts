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
  runCli(process.argv.slice(2))
    .then((output) => process.stdout.write(output))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
