# CC-Panes Hooks Phase 25 — Project Policy Enforcement Plan

日期：2026-08-07  
目标仓库：`D:\cc-pane\tool\repos\hooks`  
远端仓库：`https://github.com/lihuabin1516-design/hooks.git`

## Change Contract

Intent: 将项目本地 `.ccpanes-task/policy.json` 从“模型可读 ledger”升级为 `PreToolUse` / `PermissionRequest` 可机械执行的 allow/block 规则源。  
Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、smoke。
- commit 并 push 到远端 `main`。
In Scope:
- 新增 `src/project-policy.ts`，读取/校验 `<worktreeRoot>/.ccpanes-task/policy.json`。
- 支持 `block` / `allow` 两类规则，按顺序或优先级可预测执行。
- 初版匹配维度：`tool`、`pathContains`、`commandContains`、`phase`、`reason`、`enabled`。
- `hook-enforce` / `permission-enforce` 在原有边界决策后叠加 policy 决策。
- `policy.json` 缺失时保持 Phase 24 行为。
- malformed policy fail closed，阻断并给出 `project_policy_invalid`。
Out of Scope:
- 不写用户级 config / hooks。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 `fastctx` / `comet` 引用仓库。
- 不把自然语言 policy.md 自动解析成机械规则；本阶段只执行 JSON。
No-Touch:
- `D:\cc-pane\tool\repos\fastctx`
- `D:\cc-pane\tool\repos\comet`
- 用户级配置文件，除只读 hash/status 检查外不写。
Expected Behavior:
- 无 `policy.json`：既有 134 tests 行为不回退。
- block rule 命中 tool/path/command/phase 时，`hook-enforce` 输出 Codex deny JSON。
- allow rule 可放行被 policy block 的后续较宽规则，但不覆盖 hard boundary（用户配置、引用仓库、危险命令等原有 block）。
- malformed policy 在 hook 阶段 fail closed。
- README/AGENTS 模板说明：对话里的“禁止/开放/清除”应写入 `policy.md`；需要机械执行时同步生成 `policy.json`。
Fatal Failures:
- allow rule 覆盖用户配置/引用仓库/危险命令 hard block。
- policy 文件越界读取。
- malformed policy 被静默忽略。
- 破坏现有 live hook verifier / production toolkit。
Verification:
- Unit/CLI tests。
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `verify-installed-hooks` 对当前 live hooks 仍通过。
- `git ls-remote` 远端 HEAD 等于本次提交。
Recovery:
- 本地 `git reset --hard HEAD~1`。
- 远端 `git revert <commit>`。
