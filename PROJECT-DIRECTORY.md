# 长期项目目录说明

## 目录总览

```text
D:\cc-pane\tool\repos\hooks
├── README.md                         中文主说明，远端仓库首页
├── HANDOFF.md                        接手交接文件
├── PROJECT-DIRECTORY.md              长期目录说明和维护约定
├── REMOTE.md                         远端仓库与本地路径明文记录
├── ACCEPTANCE.md                     历史验收记录和证据汇总
├── HOOK-INTEGRATION-PREFLIGHT.md     Hook 集成前置检查记录
├── package.json                      npm 脚本和 Node 运行约束
├── tsconfig.json                     TypeScript 编译配置
├── vitest.config.ts                  Vitest 配置
├── src/                              TypeScript 源码
├── tests/                            Vitest 测试
├── scripts/                          smoke 与维护脚本
├── examples/                         合成输入示例
├── templates/                        项目注入模板
├── docs/                             计划、设计和长期记录
└── dist/                             构建产物，本仓库忽略
```

## 源码目录职责

`src/` 按能力边界拆分，每个文件只拥有一个明确概念：

```text
cli.ts                       CLI 路由和参数解析薄层
current-task.ts              .ccpanes-task/current-task.json 的读写校验
workspace-scan.ts            在 workspace 中扫描 current-task
resume-probe.ts              “继续”等会话恢复判断
agents-entry.ts              AGENTS.md 托管块安装和校验
project-bootstrap.ts         一键项目初始化编排
project-policy.ts            policy.json 机械规则模型、校验、匹配
project-policy-ledger.ts     policy.md 人类可读规则台账
project-policy-capture.ts    policy.md + policy.json 双写入口
plan-policy-capture.ts       plan 文本规则识别并编排 policy-capture
plan-intake.ts               plan 阶段 workflow/profile/policy 预览、lifecycle event 归一化和审计
hook-event-adapter.ts        Codex/Claude/泛化 tool event 到 HookCall 的适配
hook-shell-analyzer.ts       shell 命令读写目标和高风险分类
task-risk.ts                 prompt 级 Light/Standard/Heavy 风险分类
workflow-profile.ts          SBA 风格任务路由、闭环强度和必要检查建议
host-adapter-registry.ts     宿主适配能力、surface、验证和边界的机器可读 registry
runtime-profile.ts           本机运行路径、live/root/user config/reference repo 集中声明
hook-dry-run.ts              单次 HookCall allow/block 决策
hook-batch.ts                批量 dry-run 输入输出模型
hook-runner.ts               Hook 事件 + project policy 的 dry-run 执行器
post-tool-audit.ts           PostToolUse JSONL 审计
session-lifecycle.ts         SessionStart / Stop 输出
installed-hooks.ts           已安装 hooks 只读自检
live-consistency.ts          repo/live 源码与 dist 哈希一致性只读自检
production-toolkit.ts        生产工具包生成
hook-*-*.ts                  Hook 发布、审批、写入预览、恢复、runbook 相关 artifact 生成
acceptance*.ts               验收证据记录与校验
paths.ts                     路径归一化和边界判断
```

新增能力放置规则：

1. CLI 参数解析放在 `cli.ts`，业务语义放在独立 `src/<capability>.ts`。
2. 新的持久文件格式要有独立 owner，例如 `project-policy.ts` / `project-policy-ledger.ts`。
3. Hook 事件适配只放 `hook-event-adapter.ts`，决策只放 `hook-dry-run.ts`。
4. 涉及生产发布、审批、写入、恢复的 artifact 生成保持在 `hook-*` 独立模块。
5. 公共路径判断统一走 `paths.ts`。

## 测试目录职责

`tests/` 与 `src/` 能力保持对应：

```text
project-bootstrap.test.ts         bootstrap-project 行为
project-policy.test.ts            policy.json 规则校验和匹配
project-policy-capture.test.ts    policy-capture 双写行为
plan-policy-capture.test.ts       plan 阶段规则自动识别和沉淀
plan-intake.test.ts               plan 阶段 dry-run 预览、lifecycle event 归一化和审计
hook-event-adapter.test.ts        Hook 事件适配
hook-dry-run.test.ts              allow/block 决策
hook-runner.test.ts               Hook runner 与项目策略集成
installed-hooks.test.ts           已安装 hooks 自检
live-consistency.test.ts          repo/live 一致性自检
smoke-script.test.ts              smoke 脚本存在性和基本行为
workflow-profile.test.ts          SBA 风格工作流路由和闭环强度
host-adapter-registry.test.ts     宿主适配 registry 契约
```

新增源码时优先新增对应测试文件。已有能力扩展时优先扩展对应测试文件。

## 文档目录职责

```text
docs/plans/       分阶段实施计划；每个 Phase 一个文件
docs/CCPANES-HOOK-HOST-ADAPTER-MATRIX.md  宿主 hook 能力和适配边界
docs/CODEX-PLUGIN-DISTRIBUTION-NOTES.md   Codex plugin 分发后续设计记录
README.md         当前远端仓库默认中文说明
HANDOFF.md        接手和运行交接
PROJECT-DIRECTORY.md  目录职责和长期维护约定
REMOTE.md         远端与本地路径明文记录
```

建议后续长期文档命名：

```text
docs/plans/CCPANES-HOOKS-PHASEXX-<TOPIC>-PLAN.md
docs/adr/ADR-XXXX-<TOPIC>.md        # 仅在出现长期架构决策时新增
```

## examples 目录职责

`examples/` 只放合成输入和请求样例，供测试、文档、人工排查参考。真实项目数据、真实密钥、生产配置样本放入该目录前要脱敏。

## templates 目录职责

`templates/` 放可被 CLI 写入其它项目的模板：

```text
AGENTS.ccpanes-hooks.md  注入项目 AGENTS.md 的托管块
policy.example.md        policy.md 示例
policy.example.json      policy.json 示例
```

模板内容代表对外行为，修改模板要配套测试 `agents-entry.test.ts` 或相关 policy 测试。

## scripts 目录职责

`scripts/smoke.mjs` 是端到端合成验收脚本，覆盖主链路。新增对外命令后，若能在隔离 fixture 中稳定运行，应补 smoke 覆盖。

## dist 与 live 的关系

`dist/` 是 `npm run build` 生成产物，本仓库 `.gitignore` 已忽略。

live 路径：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe
```

Codex 全局 hooks 指向 live 的 `dist/src/cli.js`。仓库修改完成、测试通过、提交并 push 后，需要同步 repo 到 live，再在 live 路径重复完整验收。

## 维护边界

长期保持三层分离：

```text
repo 源仓库：D:\cc-pane\tool\repos\hooks
live 运行副本：D:\cc-pane\tool\experiments\ccpanes-task-probe
项目接入状态：<project>\.ccpanes-task + <project>\AGENTS.md
```

不要把业务项目、参考仓库、用户全局配置混入 repo。用户全局配置的修改只通过已审批生产工具包或人工明确授权流程进行。

## 推荐新增功能流程

1. 在 `docs/plans/` 写 Phase 计划。
2. 增加或更新 Vitest 测试，先确认失败。
3. 修改 `src/` owner 模块。
4. 更新 CLI 薄层。
5. 更新 README / HANDOFF / PROJECT-DIRECTORY 中受影响的说明。
6. 跑 `npm test && npm run typecheck && npm run build && npm run smoke`。
7. `git diff --check`。
8. commit + push。
9. 同步 live。
10. 运行 `verify-live-consistency`。
11. live 重跑完整验收。
