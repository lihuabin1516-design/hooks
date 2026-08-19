# Hooks Public README and CLI Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把仓库首页改成面向推广的外部说明，把维护信息移出 README，并把 `src/cli.ts` 拆成按命令族分层的入口。

**Architecture:** `src/cli.ts` 保留入口和调度，具体命令逻辑下沉到 `src/cli/*.ts` 命令族模块，共享参数解析和路径/审计辅助函数抽到 `src/cli-shared.ts`。README 只保留对外价值、兼容边界、快速上手和支持入口；维护路径、验证命令与本地细节迁移到单独的维护文档。

**Tech Stack:** TypeScript, Vitest, Node.js 22+, existing CLI helpers and docs pipeline.

---

### Task 1: 锁定 CLI 分层契约

**Files:**
- Create: `tests/cli-router.test.ts`
- Create: `src/cli-router.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { routeCliCommand } from '../src/cli-router.js';

describe('routeCliCommand', () => {
  test('returns the first non-null handler output', async () => {
    const output = await routeCliCommand(['probe'], undefined, {}, [
      async () => null,
      async () => 'ok'
    ]);

    expect(output).toBe('ok');
  });

  test('throws when no handler accepts the command', async () => {
    await expect(
      routeCliCommand(['missing'], undefined, {}, [async () => null])
    ).rejects.toThrow('unknown command: missing');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test tests/cli-router.test.ts`

- [ ] **Step 3: Implement the minimal router**

```ts
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
```

- [ ] **Step 4: Re-run the test and confirm it passes**

Run: `npm test tests/cli-router.test.ts`

---

### Task 2: 拆分 CLI 命令族

**Files:**
- Modify: `src/cli.ts`
- Create: `src/cli-shared.ts`
- Create: `src/cli/session.ts`
- Create: `src/cli/task.ts`
- Create: `src/cli/policy.ts`
- Create: `src/cli/workflow.ts`
- Create: `src/cli/hook.ts`
- Create: `src/cli/release.ts`

- [ ] Move shared parsing, formatting, and audit-path helpers into `src/cli-shared.ts`.
- [ ] Move `codex-sessions`, `handoff generate`, and `probe` into `src/cli/session.ts`.
- [ ] Move `write-current`, `verify-task-binding`, `bootstrap-project`, `agents-install`, and `agents-validate` into `src/cli/task.ts`.
- [ ] Move policy and plan intake commands into `src/cli/policy.ts`.
- [ ] Move task-risk / workflow / host-adapter commands into `src/cli/workflow.ts`.
- [ ] Move hook enforcement, adapter, session lifecycle, and shadow commands into `src/cli/hook.ts`.
- [ ] Move release, verification, and acceptance commands into `src/cli/release.ts`.
- [ ] Keep `src/cli.ts` as the entrypoint that delegates to command-family handlers.

- [ ] **Verification**

Run: `npm test`, `npm run typecheck`

---

### Task 3: Rewrite the public README and add maintenance notes

**Files:**
- Modify: `README.md`
- Create: `MAINTENANCE.md`

- [ ] Rewrite README around:
  - what the tool does
  - why it exists
  - how it fits with CC-Panes and Codex App
  - quick start
  - support / contribution links
- [ ] Remove local hard paths and maintenance-only content from README.
- [ ] Put local paths, verification commands, repo/live sync notes, and operational checklists into `MAINTENANCE.md`.

- [ ] **Verification**

Run: `git diff --check`

---

### Task 4: Full verification

**Files:**
- None

- [ ] Run `npm run verify`
- [ ] Run `git diff --check`
- [ ] Run `git status --short`
