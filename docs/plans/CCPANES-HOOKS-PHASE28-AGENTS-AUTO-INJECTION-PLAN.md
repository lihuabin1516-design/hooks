# CC-Panes Hooks Phase 28 — AGENTS Auto Injection Plan

日期：2026-08-07  
目标仓库：`D:\cc-pane\tool\repos\hooks`  
远端仓库：`https://github.com/lihuabin1516-design/hooks.git`

## Change Contract

Intent: 将项目接入从“复制 AGENTS 模板”升级为稳定的 `AGENTS.md` 自动注入/合并命令。  
Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、smoke、production toolkit。
- commit 并 push 到远端 `main`。
- 通过后同步 live prototype 并实机验证。
In Scope:
- 新增 `src/agents-entry.ts`。
- 新增 CLI：
  - `agents-install --root <project-root>`
  - `agents-validate --root <project-root>`
- `agents-install` 使用 marker 只管理 CC-Panes hook block：
  - `<!-- ccpanes-hooks:begin -->`
  - `<!-- ccpanes-hooks:end -->`
- `BOOTSTRAP-PROJECT.ps1` 同时执行 `write-current`、`agents-install`、`agents-validate`。
Out of Scope:
- 不自动扫描或批量改写所有项目。
- 不写用户级 Codex / CC-Panes 配置。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 `fastctx` / `comet` 引用仓库。
Expected Behavior:
- 项目无 `AGENTS.md`：创建并写入 managed block。
- 已有 `AGENTS.md` 无 marker：保留原内容并追加 managed block。
- 已有 managed block：只替换 block 内内容，block 外原内容保持。
- 重复运行幂等。
- `agents-validate` 可检查项目是否已接入 managed block。
Fatal Failures:
- 覆盖或删除项目既有 AGENTS 内容。
- 写入项目根之外。
- 重复注入多个 managed blocks。
- bootstrap 只写 current-task 而不注入 AGENTS。
Verification:
- Unit/CLI tests。
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `verify-installed-hooks`
- live prototype 实机 `agents-install` / hook linkage。
Recovery:
- hooks repo: `git revert <commit>`。
- live prototype: 使用 Phase 27 备份 zip 还原。
