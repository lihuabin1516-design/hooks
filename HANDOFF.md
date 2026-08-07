# 接手交接文件

## 一句话状态

`hooks` 是 CC-Panes / Codex 的项目上下文与 Hook 治理工具层，当前远端主仓库固定为 `https://github.com/lihuabin1516-design/hooks.git`，本机维护仓库位于 `D:\cc-pane\tool\repos\hooks`，live 验证路径位于 `D:\cc-pane\tool\experiments\ccpanes-task-probe`。

## 先决必读

1. `README.md`：中文主说明和日常命令。
2. `PROJECT-DIRECTORY.md`：长期目录职责、边界和放置规则。
3. `REMOTE.md`：远端仓库、本地维护路径、live 路径明文记录。
4. `docs/plans/`：Phase 24 到 Phase 31 的分阶段设计与实施计划。
5. `templates/AGENTS.ccpanes-hooks.md`：注入项目 `AGENTS.md` 的托管块模板。

## 当前基线

```text
仓库根：D:\cc-pane\tool\repos\hooks
分支：main
远端：origin https://github.com/lihuabin1516-design/hooks.git
live：D:\cc-pane\tool\experiments\ccpanes-task-probe
Node：>=22
测试：vitest
构建：tsc -p tsconfig.json
```

当前核心能力：

```text
bootstrap-project      一键初始化项目上下文
policy-capture         对话规则同时落 policy.md + policy.json
policy-capture-plan    从 plan 文本识别明确规则并编排 policy-capture
hook-enforce           PreToolUse 执行前拦截
permission-enforce     PermissionRequest 高风险授权拦截
post-enforce           PostToolUse 审计 JSONL
session-start          注入当前任务上下文
stop-check             停止阶段验收提醒
verify-installed-hooks 已安装 hooks 只读自检
```

## 维护目标

本仓库长期只做“工具层”能力：项目上下文、AGENTS 注入、策略捕获、Hook 事件适配、执行边界、审计、生产打包和验收。业务项目代码、用户全局配置、参考仓库内容不混入本仓库。

## 精确授权与禁止项

日常可改：

```text
README.md
HANDOFF.md
PROJECT-DIRECTORY.md
REMOTE.md
docs/**
examples/**
scripts/**
src/**
templates/**
tests/**
package.json / package-lock.json / tsconfig.json / vitest.config.ts
```

发布或同步前要做：

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

用户级配置路径只做读取、验证和哈希记录：

```text
C:\Users\AI001\.codex\hooks.json
C:\Users\AI001\.codex\config.toml
C:\Users\AI001\.cc-panes\config.toml
```

上游 hook exe 只做哈希记录：

```text
C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
C:\Users\AI001\.fastctx\bin\fastctx.exe
```

参考仓库只做 status / remote / HEAD 检查：

```text
D:\cc-pane\tool\repos\comet    origin https://github.com/rpamis/comet.git
D:\cc-pane\tool\repos\fastctx  origin https://github.com/yc-duan/fastctx.git
```

当前只读基线：

```text
comet HEAD:   07c5b64b02dc00fffa6d66da70014bfb0f9ebca0
fastctx HEAD: 86dac0c99efae7859ed2be468f68c16e58f5e16a
fastctx exe SHA256: C94A7504FEA51CABDCD15BDBCFC95F494EF113AA11AE93A562E13492BAFA8579
```

## 标准执行顺序

1. 记录当前仓库状态：root、branch、HEAD、status、remote。
2. 明确本轮唯一目标和文件范围。
3. 先写或更新测试；纯文档任务至少执行 `git diff --check`。
4. 修改源码、测试、文档。
5. 在 repo 路径跑完整门禁。
6. 提交并 push 到 `origin/main`。
7. 备份 live 目录对应内容。
8. 同步 repo 到 live。
9. 在 live 路径跑完整门禁和实机 fixture。
10. 最终记录远端 HEAD、repo/live 一致性、用户配置哈希。

## 必要检查

repo 路径：

```powershell
cd D:\cc-pane\tool\repos\hooks
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short
```

live 路径：

```powershell
cd D:\cc-pane\tool\experiments\ccpanes-task-probe
npm test
npm run typecheck
npm run build
npm run smoke
node dist/src/cli.js verify-installed-hooks --hooks-json C:\Users\AI001\.codex\hooks.json --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits --config C:\Users\AI001\.codex\config.toml
```

## 停止条件

- 工作树出现与本轮目标无关的既存改动。
- 需要写用户全局配置但本轮授权只覆盖仓库文档/代码。
- `npm test`、`typecheck`、`build`、`smoke` 任一失败且无法在本轮范围内解释或修复。
- repo/live 文件哈希对比出现缺失、额外文件或 hash mismatch。
- 远端 push 目标不是 `https://github.com/lihuabin1516-design/hooks.git`。

## 交付要求

每次交付报告至少包含：

```text
变更范围
远端 HEAD
repo 验证结果
live 验证结果
用户配置 / 上游 exe 哈希
残留风险
下一步建议
```

## 下一步建议

后续可继续做 Phase 32：在 CC-Panes plan 事件侧调用 `policy-capture-plan`，把工具层能力接入真实 plan 生命周期；继续保持用户级配置只读，先做 dry-run / audit 再发布。
