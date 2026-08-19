import { describe, expect, test } from 'vitest';
import { routeCliCommand, type CliCommandHandler } from '../src/cli-router.js';

describe('routeCliCommand', () => {
  test('returns the first non-null handler output', async () => {
    const handlers: CliCommandHandler[] = [
      async () => null,
      async () => 'ok'
    ];

    await expect(routeCliCommand(['probe'], undefined, {}, handlers)).resolves.toBe('ok');
  });

  test('throws when no handler accepts the command', async () => {
    await expect(
      routeCliCommand(['missing'], undefined, {}, [async () => null])
    ).rejects.toThrow('unknown command: missing');
  });
});
