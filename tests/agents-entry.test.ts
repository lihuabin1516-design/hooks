import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AGENTS_BEGIN_MARKER, AGENTS_END_MARKER, installAgentsEntry, validateAgentsEntry } from '../src/agents-entry.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-agents-entry-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('agents entry installer', () => {
  test('creates AGENTS.md with managed hook block', async () => {
    const result = await installAgentsEntry(tempRoot);
    const text = await fs.readFile(path.join(tempRoot, 'AGENTS.md'), 'utf8');
    const validation = await validateAgentsEntry(tempRoot);

    expect(result).toMatchObject({
      schema: 'ccpanes.agents-entry-result.v1',
      changed: true,
      action: 'created'
    });
    expect(text).toContain(AGENTS_BEGIN_MARKER);
    expect(text).toContain('CC-Panes Hooks Project Entry');
    expect(text).toContain(AGENTS_END_MARKER);
    expect(validation).toMatchObject({ exists: true, markerPresent: true, valid: true });
  });

  test('appends managed block while preserving existing project instructions', async () => {
    const agentsPath = path.join(tempRoot, 'AGENTS.md');
    await fs.writeFile(agentsPath, '# Existing Project Rules\n\nKeep this line.\n', 'utf8');

    const result = await installAgentsEntry(tempRoot);
    const text = await fs.readFile(agentsPath, 'utf8');

    expect(result.action).toBe('updated');
    expect(text).toContain('# Existing Project Rules');
    expect(text).toContain('Keep this line.');
    expect(text).toContain(AGENTS_BEGIN_MARKER);
  });

  test('replaces existing managed block idempotently', async () => {
    const agentsPath = path.join(tempRoot, 'AGENTS.md');
    await fs.writeFile(agentsPath, [
      '# Existing',
      '',
      AGENTS_BEGIN_MARKER,
      'old managed content',
      AGENTS_END_MARKER,
      '',
      'tail'
    ].join('\n'), 'utf8');

    const first = await installAgentsEntry(tempRoot);
    const second = await installAgentsEntry(tempRoot);
    const text = await fs.readFile(agentsPath, 'utf8');

    expect(first).toMatchObject({ changed: true, action: 'updated', markerPresent: true });
    expect(second).toMatchObject({ changed: false, action: 'unchanged', markerPresent: true });
    expect(text).not.toContain('old managed content');
    expect(text).toContain('tail');
  });

  test('validates missing AGENTS.md as not ready', async () => {
    await expect(validateAgentsEntry(tempRoot)).resolves.toMatchObject({
      exists: false,
      markerPresent: false,
      valid: false
    });
  });
});
