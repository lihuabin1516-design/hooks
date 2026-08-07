# CC-Panes Hooks Phase 24 — Remote Publish + AGENTS Entry Plan

日期：2026-08-07  
远端仓库：`https://github.com/lihuabin1516-design/hooks.git`  
本地发布仓库：`D:\cc-pane\tool\repos\hooks`

## Change Contract

Intent: 将当前 hook 工具层整理为独立开源仓库并推送到远端，同时把使用入口从“手工运行 bootstrap 脚本”调整为“项目 AGENTS.md 约定 + 全局 hooks 自动读取项目 `.ccpanes-task` 状态”的无感模式。  
Authorized Mutation:
- 修改 `D:\cc-pane\tool\experiments\ccpanes-task-probe` 内文档/模板/测试所需源码。
- 新建或更新独立 Git 仓库 `D:\cc-pane\tool\repos\hooks`。
- commit 并 push 到 `https://github.com/lihuabin1516-design/hooks.git` 的 `main`。
In Scope:
- 增加 AGENTS.md 模板，说明导入新项目后 Codex 读取 AGENTS.md 时应自动维护 `.ccpanes-task/current-task.json`。
- 说明对话中的临时禁止/开放策略如何落到项目本地 `.ccpanes-task/policy.md` / 后续 policy JSON，而不是写入全局配置。
- 整理 README，使“日常使用入口”优先是 CC-Panes 导入项目 + AGENTS.md，而不是用户手工记命令。
- 发布源码、测试、脚本、模板、计划和验收摘要到独立远端仓库。
Out of Scope:
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不修改当前已上线的用户级 hooks/config。
- 不触碰 `fastctx` / `comet` 引用仓库。
- 不把 `node_modules`、`dist`、`live` 审计目录作为源码发布。
No-Touch:
- `D:\cc-pane\tool\repos\fastctx`
- `D:\cc-pane\tool\repos\comet`
- 用户级配置文件，除只读 hash/status 检查外不写。
Active Hypothesis: 全局 hooks 已经安装并按 cwd 自动查找 `.ccpanes-task/current-task.json`；因此项目级无感入口的正确职责是由 AGENTS.md 指示 Codex 在 plan/需求阶段维护该项目本地状态文件，而不是每个项目重复安装 hook。
Expected Behavior:
- 新仓库包含可运行源码与测试。
- README 明确：全局 hook 安装一次；每个项目由 AGENTS.md 自动维护 `.ccpanes-task/current-task.json`。
- `templates/AGENTS.ccpanes-hooks.md` 可复制/注入到项目 AGENTS.md。
- 本地测试/构建/smoke 通过。
- 远端 `main` HEAD 更新到本次提交。
Fatal Failures:
- 把 live 审计、node_modules、用户配置、密钥、引用仓库内容推送到远端。
- push 到错误远端或错误分支。
- 发布仓库缺少 package.json / src / tests / README。
- 发布文档继续把手工 bootstrap 作为主入口。
Verification:
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- 发布仓库 `git status --short`、`git remote -v`、`git log -1`
- `git ls-remote` 验证远端 HEAD。
Recovery:
- 本地可 `git reset --hard HEAD~1` 回退发布仓库。
- 远端可通过 `git revert <commit>` 回退。
- 因本阶段不写用户配置，无需配置文件恢复。
