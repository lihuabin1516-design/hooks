import type { CreateCodexAppServerClient } from './codex-sidebar-cli.js';
import type { RuntimeIdentity } from './runtime-identity.js';

export interface RunCliOptions {
  trustedCliPath?: string | null;
  processExecPath?: string | null;
  runtimeIdentity?: RuntimeIdentity;
  createCodexAppServerClient?: CreateCodexAppServerClient;
}

export type CliCommandHandler = (
  args: string[],
  stdinText: string | undefined,
  options: RunCliOptions
) => Promise<string | null>;
