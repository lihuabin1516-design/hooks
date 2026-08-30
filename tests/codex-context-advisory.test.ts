import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  appendCodexContextAdvisoryAudit,
  CODEX_CONTEXT_ADVISORY_CONTEXT_LIMIT,
  combineUserPromptSubmitAdvisories,
  createCodexContextAdvisory
} from '../src/codex-context-advisory.js';
import type { CodexContextPressureResult } from '../src/codex-context-pressure.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-context-advisory-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function task(): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-context',
    workspace: 'hooks',
    projectPath: tempRoot,
    worktreeRoot: tempRoot,
    mainRepoRoot: null,
    branch: 'main',
    head: 'fixture-head',
    owner: { leaderSessionId: 'leader-1', paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:01.000Z',
    source: 'manual-import',
    notes: 'context advisory fixture'
  };
}

function pressure(
  overrides: Partial<CodexContextPressureResult> = {}
): CodexContextPressureResult {
  return {
    schemaVersion: 'hooks.codex-context-pressure/v1',
    availability: 'available',
    source: 'codex-rollout-token-count',
    threadRef: 'sha256:1111111111111111',
    rolloutRef: 'sha256:2222222222222222',
    observedAt: '2026-08-30T01:00:00.000Z',
    tokenEventAt: '2026-08-30T00:59:59.000Z',
    freshness: 'fresh',
    ageMs: 1_000,
    contextTokens: 225_000,
    modelContextWindow: 258_400,
    remainingTokens: 33_400,
    percentUsed: 87.07,
    thresholdMode: 'absolute',
    softThresholdTokens: 220_000,
    hardThresholdTokens: 240_000,
    pressure: 'soft',
    compactionSignal: 'none',
    checkpointRequired: true,
    action: 'update-context',
    diagnostics: [],
    ...overrides
  };
}

describe('Codex context pressure UserPromptSubmit advisory', () => {
  test('injects a bounded soft-threshold checkpoint advisory', () => {
    const result = createCodexContextAdvisory({
      task: task(),
      pressure: pressure(),
      now: '2026-08-30T01:00:01.000Z'
    });

    expect(result.output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit'
      }
    });
    const context = result.output?.hookSpecificOutput.additionalContext ?? '';
    expect(context).toContain('hooks.codex-context-pressure-advisory/v1');
    expect(context).toContain('pressure: soft');
    expect(context).toContain('action: update-context');
    expect(context).toContain('checkpointRequired: true');
    expect(context).toContain('instruction: update context.md');
    expect(context.length).toBeLessThanOrEqual(
      CODEX_CONTEXT_ADVISORY_CONTEXT_LIMIT
    );
    expect(result.audit).toMatchObject({
      schema: 'ccpanes.codex-context-advisory-audit.v1',
      taskId: 'task-context',
      injected: true,
      reason: 'actionable',
      pressure: 'soft',
      action: 'update-context',
      contextTokens: 225_000
    });
  });

  test('uses the hard-threshold instruction without claiming the checkpoint happened', () => {
    const result = createCodexContextAdvisory({
      task: task(),
      pressure: pressure({
        pressure: 'hard',
        contextTokens: 245_000,
        remainingTokens: 13_400,
        percentUsed: 94.81,
        action: 'rotate-context-and-checkpoint'
      })
    });

    const context = result.output?.hookSpecificOutput.additionalContext ?? '';
    expect(context).toContain('action: rotate-context-and-checkpoint');
    expect(context).toContain(
      'instruction: stop scope expansion; rotate context.md snapshots and create a verified checkpoint'
    );
    expect(context).not.toContain('checkpointCompleted');
  });

  test('requests authority reconciliation after a heuristic token drop', () => {
    const result = createCodexContextAdvisory({
      task: task(),
      pressure: pressure({
        pressure: 'normal',
        contextTokens: 70_000,
        remainingTokens: 188_400,
        percentUsed: 27.09,
        compactionSignal: 'heuristic-token-drop',
        action: 'reconcile-after-compaction'
      })
    });

    const context = result.output?.hookSpecificOutput.additionalContext ?? '';
    expect(context).toContain('action: reconcile-after-compaction');
    expect(context).toContain(
      'instruction: reconcile system summary + context.md + Git + Goal + Workflow/Session authority before continuing'
    );
  });

  test.each([
    {
      name: 'normal pressure',
      value: pressure({
        pressure: 'normal',
        contextTokens: 100_000,
        remainingTokens: 158_400,
        percentUsed: 38.7,
        checkpointRequired: false,
        action: 'continue'
      }),
      reason: 'not-actionable'
    },
    {
      name: 'unavailable pressure',
      value: pressure({
        availability: 'unavailable',
        freshness: 'unknown',
        ageMs: null,
        contextTokens: null,
        modelContextWindow: null,
        remainingTokens: null,
        percentUsed: null,
        thresholdMode: null,
        softThresholdTokens: null,
        hardThresholdTokens: null,
        pressure: 'unknown',
        checkpointRequired: false,
        action: 'inspect',
        diagnostics: ['state-db-unavailable']
      }),
      reason: 'unavailable'
    },
    {
      name: 'stale actionable pressure',
      value: pressure({ freshness: 'stale', ageMs: 1_000_000 }),
      reason: 'stale'
    }
  ])('does not inject for $name', ({ value, reason }) => {
    const result = createCodexContextAdvisory({
      task: task(),
      pressure: value
    });

    expect(result.output).toBeNull();
    expect(result.audit).toMatchObject({
      injected: false,
      reason
    });
  });

  test('appends a privacy-bounded audit without raw paths or identities', async () => {
    const result = createCodexContextAdvisory({
      task: task(),
      pressure: pressure()
    });
    const auditPath = path.join(tempRoot, 'audits', 'context-pressure.jsonl');

    await appendCodexContextAdvisoryAudit(auditPath, result.audit);
    const text = await fs.readFile(auditPath, 'utf8');

    expect(text).toContain('sha256:1111111111111111');
    expect(text).toContain('sha256:2222222222222222');
    expect(text).not.toContain(
      'C:\\Users\\fixture\\.codex\\sessions\\secret.jsonl'
    );
    expect(text).not.toContain('thread-secret-identity');
  });

  test('retains pressure advice when an extreme workflow context cannot be compacted under the host limit', () => {
    const pressureOutput = createCodexContextAdvisory({
      task: task(),
      pressure: pressure()
    }).output;
    const combined = combineUserPromptSubmitAdvisories({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `authority: ${'x'.repeat(2_000)}`
      }
    }, pressureOutput);

    const context = combined?.hookSpecificOutput.additionalContext ?? '';
    expect(context).toContain('hooks.codex-context-pressure-advisory/v1');
    expect(context).not.toContain('x'.repeat(100));
    expect(context.length).toBeLessThanOrEqual(1800);
  });
});
