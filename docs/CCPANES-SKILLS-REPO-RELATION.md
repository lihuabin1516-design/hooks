# hooks 与 ccpanes-skills 双线并行关系

日期：2026-08-14

本仓库：`D:\cc-pane\tool\repos\hooks`

行为层仓库：`D:\cc-pane\tool\repos\ccpanes-skills`

## 一句话判断

`hooks` 保持机器权威层；`ccpanes-skills` 承载 agent 行为层。外部参考项目先在
`hooks` 当前项目新会话评估，再决定进入 `hooks`、进入 `ccpanes-skills`、
新建仓库，或只记录参考。

## 权威边界

| 领域 | Owner | 说明 |
|---|---|---|
| task scope | `hooks` | `.ccpanes-task/current-task.json` |
| project policy | `hooks` | `.ccpanes-task/policy.json` 机械规则，`policy.md` 人读 ledger |
| hook hard gate | `hooks` | `hook-enforce` / `permission-enforce` |
| audit / acceptance | `hooks` | PostToolUse JSONL、acceptance artifact、live consistency |
| workflow profile | `hooks` | advisory schema，可被 prompts 消费，不拥有权限 |
| skills / prompts / handoff / review 方法 | `ccpanes-skills` | agent 行为指导，不拥有 allow/block/complete 权限 |
| 外部参考 intake 判断 | `hooks` | 先判断归属，再写目标仓库 |

## 依赖方向

```text
ccpanes-skills
  -> 可以引用 hooks 的 CLI、schema、docs、workflow-profile 输出
  -> 不反向成为 hooks runtime 的必要依赖

hooks
  -> 可以记录 ccpanes-skills 的存在和路由规则
  -> hard gate 运行不依赖 ccpanes-skills
```

## 外部项目路由规则

| 评估结论 | 写入位置 | 判定条件 |
|---|---|---|
| 吸收到 `hooks` | 本仓库 | 影响 hook runtime、policy、permission、audit、acceptance、CLI schema、live verification |
| 吸收到 `ccpanes-skills` | `D:\cc-pane\tool\repos\ccpanes-skills` | 价值是 prompt、skill、agent workflow、review、triage、handoff、domain glossary、协作方法 |
| 新建仓库 | `D:\cc-pane\tool\repos\<new-repo>` | 独立运行时、benchmark、数据集、UI、插件、服务、可单独发布工具 |
| 只记录参考 | 评估报告 | 当前只作方法参考，无明确 owner 或采纳收益不足 |

## 新项目评估入口

用户发现新的外部项目时，默认在当前 `hooks` 项目中新开会话，使用：

```text
D:\cc-pane\tool\repos\hooks\docs\EXTERNAL-PROJECT-INTAKE-ROUTER.md
```

`D:\cc-pane\tool\repos\hooks\docs\EXTERNAL-PROJECT-EVALUATION-PROMPT.md`
保留为可复制提示词入口；权威分流规则以
`EXTERNAL-PROJECT-INTAKE-ROUTER.md` 为准。该会话的唯一目标是给出归属判断和
证据，写入动作由后续 owner 仓库任务承接。

## 采纳记录位置

- 进入 `hooks`：继续使用 `docs/*-ADOPTION.md`、`docs/adr/`、
  `examples/evals/`、`tests/` 等现有模式。
- 进入 `ccpanes-skills`：优先使用 `docs/adoptions/<PROJECT>.md`；
  `docs/adoption-records/` 只保留旧提示词兼容入口。
- 新建仓库：新仓库必须先写 README / AGENTS / PROJECT-DIRECTORY，并说明为何
  不是前两个仓库的 owner。

## 当前落地状态

`D:\cc-pane\tool\repos\ccpanes-skills` 已作为独立 Git 仓库初始化在 `main`
分支，当前还没有提交。`hooks` 侧保留本关系说明和 intake router；新仓库侧维护
prompts、adoptions、templates、sidecar specs。
