# CC-Panes Hooks Phase 27 — Project Policy CLI Plan

日期：2026-08-07  
目标仓库：`D:\cc-pane\tool\repos\hooks`  
远端仓库：`https://github.com/lihuabin1516-design/hooks.git`

## Change Contract

Intent: 给 Phase 25 的 `.ccpanes-task/policy.json` 增加稳定命令式管理入口，降低手写 JSON 的使用成本。  
Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、smoke。
- commit 并 push 到远端 `main`。
- Phase 27 通过后同步到 live prototype 并实机验证。
In Scope:
- 新增/扩展 `src/project-policy.ts` 的读写与规则管理函数。
- CLI 命令：
  - `policy-validate`
  - `policy-list`
  - `policy-add`
  - `policy-disable`
  - `policy-clear`
- `policy-add` 支持 `--tool`、`--path-contains`、`--command-contains`、`--phase`、`--match-reason`、`--disabled`、`--replace`。
- smoke 覆盖构建后的真实 policy 管理命令。
Out of Scope:
- 不做自然语言解析器。
- 不写用户级 Codex / CC-Panes 配置。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 `fastctx` / `comet` 引用仓库。
Expected Behavior:
- `policy-add` 原子创建或更新 `<project>/.ccpanes-task/policy.json`。
- 默认拒绝重复 rule id；显式 `--replace` 才替换。
- `policy-disable` 保留 rule 但关闭 `enabled`。
- `policy-clear` 保留全部 rules 但关闭 `enabled`，便于审计。
- `policy-validate` 对 malformed policy 失败。
Fatal Failures:
- 写入项目外路径。
- 隐式修改用户级配置。
- 清除命令删除历史规则导致不可审计。
- policy 管理命令绕过 schema 校验。
Verification:
- Focused tests。
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `verify-installed-hooks`
- live prototype 实机 policy CLI + hook enforcement。
Recovery:
- hooks repo: `git revert <commit>`。
- live prototype: 使用 Phase 26 备份 zip 还原。
