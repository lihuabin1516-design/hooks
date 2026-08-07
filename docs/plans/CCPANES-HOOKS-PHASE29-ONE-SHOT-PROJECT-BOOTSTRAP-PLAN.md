# CC-Panes Hooks Phase 29 — One-shot Project Bootstrap Plan

日期：2026-08-07  
目标仓库：`D:\cc-pane\tool\repos\hooks`  
远端仓库：`https://github.com/lihuabin1516-design/hooks.git`

## Change Contract

Intent: 将新项目接入收敛为一个 `bootstrap-project` 命令，避免用户或 CC-Panes 分别调用多条 setup 命令。  
Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、smoke、production toolkit。
- commit 并 push 到远端 `main`。
- 通过后同步 live prototype 并实机验证。
In Scope:
- 新增 `src/project-bootstrap.ts`。
- 新增 CLI：`bootstrap-project --root <project-root> --task-id <task-id> --phase <phase>`。
- 一键写入/维护：
  - `.ccpanes-task/current-task.json`
  - `AGENTS.md` managed block
  - `.ccpanes-task/policy.md`
  - `.ccpanes-task/policy.json`
  - `.ccpanes-task/bootstrap-report.json`
- `BOOTSTRAP-PROJECT.ps1` 委托给 `bootstrap-project`。
Out of Scope:
- 不批量扫描或改写所有项目。
- 不写用户级 Codex / CC-Panes 配置。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 `fastctx` / `comet` 引用仓库。
Expected Behavior:
- 新项目一条命令完成 hook-aware 接入。
- 已有 `AGENTS.md` 和 `policy.md` 被保留，managed block 只替换自身范围。
- 已有 `policy.json` 被校验并保留；缺失时初始化为空规则集。
- 生成 `bootstrap-report.json` 作为接入验收 artifact。
Fatal Failures:
- 覆盖用户既有 `AGENTS.md` 或 `policy.md` 内容。
- 删除或重写已有 project policy rules。
- 写入项目根之外。
- toolkit bootstrap 与 CLI bootstrap 行为分叉。
Verification:
- Unit/CLI tests。
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `verify-installed-hooks`
- live prototype 实机 `bootstrap-project` + policy hook linkage。
Recovery:
- hooks repo: `git revert <commit>`。
- live prototype: 使用 Phase 28 备份 zip 还原。
