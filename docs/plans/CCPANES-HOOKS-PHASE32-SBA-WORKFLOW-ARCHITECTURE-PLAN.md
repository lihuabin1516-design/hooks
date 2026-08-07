# CC-Panes Hooks Phase 32 — SBA Workflow Architecture Plan

日期：2026-08-07
目标仓库：`D:\cc-pane\tool\repos\hooks`
外部参考：`https://github.com/WoJiSama/skill-based-architecture.git`

## Change Contract

Intent: 将 skill-based-architecture 的长期工作流思想本地化到 CC-Panes hooks
工具层：保留当前可执行 hook 门禁主轴，同时增加可机器读取的任务路由、渐进严格度、
闭环强度和验收检查建议。

Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、目录说明和本计划文档。
- 仅在本仓库内实现；不改真实用户级配置、不同步 live、不执行上游 hook exe。

In Scope:
- 新增 `src/workflow-profile.ts` 作为 SBA 适配 owner。
- 新增 CLI：`classify-workflow --prompt <text> --cwd <project-root> --changed-path <path>`。
- 输出 schema：`ccpanes.workflow-profile.v1`。
- 将任务分到 read-only review、project bootstrap、project policy、hook runtime、
  production gate、implementation、documentation、other。
- 将闭环强度分为 none / light / full / production，并给出本地、审计、生产检查建议。
- 更新 `templates/AGENTS.ccpanes-hooks.md`，让新项目的托管块指向 workflow profile。

Out of Scope:
- 不把外部仓库作为运行时依赖。
- 不整体迁移到 `skills/<name>/` 目录树。
- 不写 `C:\Users\AI001\.codex`、`C:\Users\AI001\.claude`、`C:\Users\AI001\.cc-panes`。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 `D:\cc-pane\tool\repos\comet` / `D:\cc-pane\tool\repos\fastctx` 内容。

Expected Behavior:
- 只读评估类 prompt 输出 Light + closure none，不要求 repo 验收命令。
- 普通 hook/runtime/source/test/template 改动输出 Standard + closure full，并推荐
  `npm test`、`typecheck`、`build`、`smoke`、`git diff --check`、`git status`。
- 真实用户配置、生产、发布、迁移、安全、破坏性接口类 prompt 输出 Heavy +
  closure production，并要求 acceptance evidence、reference repo status、用户配置
  hash snapshot 和 live verification。
- 文档-only 路径输出 light closure，只要求 diff/status。

Fatal Failures:
- workflow profile 被实现为 hard gate，绕过 `hook-enforce` / `permission-enforce`。
- 产生第二套 task scope 或 policy authority。
- 对真实用户配置、live prototype 或 reference repo 产生写入。
- 从外部仓库复制大段模板而未本地化 owner / license 语义。

Verification:
- Focused tests: `npm test -- tests/workflow-profile.test.ts tests/task-risk.test.ts tests/cli.test.ts`
- Full tests: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Smoke: `npm run smoke`
- Diff hygiene: `git diff --check`

Recovery:
- 源仓库：反向 patch 或 `git revert <commit>`。
- 本阶段未写真实用户配置，无用户配置恢复步骤。

## Architecture Decision

Decision: 不把 skill-based-architecture 全量引入为运行时或项目目录形态；先吸收
“progressive rigor / thin-shell routing / task closure / scenario testing”四个机制，
由 `workflow-profile.ts` 生成可审计建议。

Owners:
- `task-risk.ts`：prompt 级 Light / Standard / Heavy 事实信号。
- `workflow-profile.ts`：路由、闭环强度和检查建议。
- `hook-enforce` / `permission-enforce`：实际写入和权限 hard gate。
- `.ccpanes-task/current-task.json`：任务 scope authority。
- `.ccpanes-task/policy.json`：机械 policy authority。

Rejected Alternatives:
- 全量迁移到 `skills/ccpanes-hooks/`：当前工具层已有清晰 TypeScript owner 和长期
  文档，不应为了形态完整引入重复权威源。
- 只更新文档不加 CLI：长期工作流会停留在提示词层，不能被 smoke / UI / hook 输出复用。
- 把 workflow profile 变成阻断门禁：会和现有 hard gate authority 冲突。

Consequences:
- 后续 UI、SessionStart、StopCheck、计划阶段可以消费同一个 workflow profile。
- AGENTS 托管块保持薄壳，具体分类和检查由 CLI owner 生成。
- 生产级动作仍走 existing production toolkit / approval package / final runbook。
