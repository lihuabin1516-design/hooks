# CC-Panes Hook Host Adapter Matrix

参考来源固定到 do-it `main`：

- commit: `7c2f60896fe6391f6cb364917351325f0aca85aa`
- README: <https://github.com/tdwhere123/do-it/blob/7c2f60896fe6391f6cb364917351325f0aca85aa/README.zh-CN.md>
- routing matrix: <https://github.com/tdwhere123/do-it/blob/7c2f60896fe6391f6cb364917351325f0aca85aa/docs/routing-matrix.md>
- harness matrix: <https://github.com/tdwhere123/do-it/blob/7c2f60896fe6391f6cb364917351325f0aca85aa/docs/harness-adapter-matrix.md>

本仓库吸收的是“同一 workflow kernel，按宿主能力适配”的形状；实际执行边界仍由
CC-Panes task probe 的 TypeScript 模块负责。

机器可读 owner：

```text
src/host-adapter-registry.ts
```

查看当前 registry：

```powershell
node dist/src/cli.js host-adapter-registry
node dist/src/cli.js host-adapter-registry --host codex
```

## Shared Kernel

```text
Codex / Claude / Cursor / Gemini / Kimi / OpenCode events
  -> host adapter
  -> hook-event-adapter.ts
  -> HookCall / HookDryRunBatch
  -> hook-runner.ts + project-policy.ts
  -> allow / deny / audit / lifecycle reminder
```

共同规则：

- `current-task.json` 是 task scope 的权威来源。
- `.ccpanes-task/policy.json` 是项目级机械规则来源。
- PreToolUse / PermissionRequest 是硬门禁面；SessionStart / Stop / PostToolUse
  是上下文和证据面。
- task risk 分级只做路由和提示信号，永远不替代 hard gate。

## Host Matrix

| Host | Current integration | Hard gate surface | Advisory surface | State / audit | Verification |
|---|---|---|---|---|---|
| Codex | 全局 hook 指向 live `dist/src/cli.js`；`UserPromptSubmit` 依次保留 skills-hub、CC-Panes prompt-before 和 `workflow-advisory` | `PreToolUse`、`PermissionRequest` 经 `hook-enforce` / `permission-enforce` | `UserPromptSubmit` workflow advisory、`SessionStart`、`Stop` | `<project>/.ccpanes-task` + `live/dynamic-audits/<task>` | `verify-installed-hooks` + repo/live full gates + fresh Codex prompt canary |
| Claude / CC-Panes | CC-Panes 自有 `cc-panes-cli-hook.exe` 已覆盖多事件 | 未来优先作为子步骤接入 `tool-before` dry-run | CC-Panes lifecycle +本工具层 `session-start` / `stop-check` | CC-Panes profile + task audit dir | 先 dry-run artifact，再进入真实配置授权包 |
| Cursor | 仅作为未来桌面宿主候选记录 | 依赖 Cursor 原生 hook 能力和配置策略 | 可复用 risk tier / stop reminder | Cursor plugin data 或项目 task dir | 需要单独的 Windows hook runner smoke |
| Gemini | CLI 启动由 CC-Panes 管理，hook surface 待确认 | 由 CC-Panes 外层 hook 管线承接 | 可消费 `classify-task-risk` JSON | CC-Panes project/task state | 先做 launch-profile 层 dry-run |
| Kimi | README 层支持 Kimi CLI；本工具层尚未接入 Kimi hook payload | 由 CC-Panes 外层 hook 管线承接 | 可消费 risk tier 和 lifecycle 文案 | CC-Panes project/task state | 需要采集真实 Kimi event fixture |
| OpenCode | README 层支持 OpenCode CLI；本工具层尚未接入 OpenCode plugin payload | 由 CC-Panes 外层 hook 管线承接 | 可消费 risk tier 和 lifecycle 文案 | CC-Panes project/task state | 需要采集真实 OpenCode event fixture |

## Boundary Policy

- 本仓库的 hard gate 以 task worktree、用户配置目录、reference repo、phase 和
  project policy 为准。
- SBA / do-it 风格的 Light / Standard / Heavy 进入 `task-risk.ts`、
  `workflow-profile.ts` 和 `plan-intake.ts`，用于后续 UI 标签、启动策略、计划强度、
  闭环检查、plan dry-run 审计和提示文案。
- 新宿主先添加 synthetic event fixture 和 adapter 测试，再考虑真实配置接入。
- 涉及用户配置的接入按 production toolkit / approval package / rollback runbook
  流程推进。
- `host-adapter-registry` 是可读能力目录；只有被 `hook-enforce` /
  `permission-enforce` 消费的规则才是 hard gate。

## Host Adapter Acceptance

新增或调整任一宿主适配时至少覆盖：

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

真实配置接入前还要生成 dry-run artifact，记录配置文件 exists / bytes / mtime /
SHA-256 / backup path / exact diff / rollback command。
