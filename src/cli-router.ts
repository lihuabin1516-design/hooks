import type { CliCommandHandler, RunCliOptions } from './cli-types.js';

export type { CliCommandHandler, RunCliOptions } from './cli-types.js';

export async function routeCliCommand(
  args: string[],
  stdinText: string | undefined,
  options: RunCliOptions,
  handlers: CliCommandHandler[]
): Promise<string> {
  for (const handler of handlers) {
    const output = await handler(args, stdinText, options);
    if (output !== null) return output;
  }
  throw new Error(`unknown command: ${args[0]}`);
}
