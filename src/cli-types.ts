import type { CreateCodexAppServerClient } from './codex-sidebar-cli.js';

export interface RunCliOptions {
  trustedCliPath?: string | null;
  processExecPath?: string | null;
  createCodexAppServerClient?: CreateCodexAppServerClient;
}

export type CliCommandHandler = (
  args: string[],
  stdinText: string | undefined,
  options: RunCliOptions
) => Promise<string | null>;
