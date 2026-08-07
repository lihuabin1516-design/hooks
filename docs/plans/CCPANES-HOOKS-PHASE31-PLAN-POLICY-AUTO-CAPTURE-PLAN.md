# CC-Panes Hooks Phase 31 — Plan Policy Auto Capture Plan

日期：2026-08-07
目标仓库：`D:\cc-pane\tool\repos\hooks`
远端仓库：`https://github.com/lihuabin1516-design/hooks.git`

## Change Contract

Intent: 将 `policy-capture` 接入 plan 阶段的半自动入口，让明确的“禁止/开放/清除”项目规则可以从计划文本直接沉淀到 `.ccpanes-task/policy.md` 和 `.ccpanes-task/policy.json`，减少手工拼接命令。
Authorized Mutation:
- 修改 hooks 仓库源码、测试、模板、README、smoke 和计划文档。
- 本轮先在源仓库完成实现与验证；commit、push、live 同步按交付门禁另行执行。
In Scope:
- 新增 `src/plan-policy-capture.ts` 作为 plan 文本解析与编排 owner。
- 新增 CLI：`policy-capture-plan --root <project-root> --utterance <text>`，并支持 `--input <plan.md>`。
- 只识别明确的命令级和路径级规则：
  - `禁止/不要/阻止/限制 + 运行/执行 + <command>`
  - `允许/开放/放开 + 运行/执行 + <command>`
  - `禁止/不要/阻止/限制 + 修改/写入/编辑/改动 + <path>`
  - `允许/开放/放开 + 修改/写入/编辑/改动 + <path>`
  - `清除/清空/解除 + 所有/全部 + 限制/规则`
- 复用 `captureProjectPolicyInstruction` 写入新增 allow/block 规则。
- 清除类指令只 disable 现有 `policy.json` rules，并追加 ledger，不删除历史规则。
Out of Scope:
- 不做开放式自然语言理解或隐式推断。
- 不写用户级 Codex / CC-Panes 配置。
- 不执行 `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`。
- 不触碰 `fastctx` / `comet` 引用仓库。
Expected Behavior:
- 明确 plan 规则自动生成稳定 rule id、reason 和 matcher。
- 重复运行同一 plan 文本幂等替换同一 rule id，不复制规则。
- 未识别到规则时返回 `changed=false`，不创建 `.ccpanes-task` 文件。
- 清除类指令保留审计历史，只 disable rules。
Fatal Failures:
- plan 解析器误把普通计划文字写成机械规则。
- 产生第二套 policy 写入 authority，绕过 `project-policy` schema 校验。
- 删除历史 policy rules。
- 写入项目根之外或用户级配置。
Verification:
- Focused tests: `npm test -- tests/plan-policy-capture.test.ts tests/cli.test.ts`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `git diff --check`
Recovery:
- 源仓库：反向 patch 或 `git revert <commit>`。
- 未写用户配置，无用户配置恢复步骤。
