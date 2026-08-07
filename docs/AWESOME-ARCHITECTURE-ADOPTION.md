# awesome-architecture 参考吸收记录

日期：2026-08-07
目标仓库：`D:\cc-pane\tool\repos\hooks`
外部参考：<https://github.com/study8677/awesome-architecture.git>
参考 HEAD：`d3febc75fa26bad746f6f9216bcad171b3923765`
许可：MIT

## 采纳边界

本记录只吸收 `awesome-architecture` 的架构方法和检查模型，不把它作为运行时依赖，不复制整套模板，不改变当前 hard gate 权威源。

本地采纳的核心判断：

```text
AI 编码工作台的价值不在于让 Agent 更自由，
而在于把目标、上下文、权限、执行、审计、评测和回写做成稳定结构。
```

## 本地映射

| 参考模式 | 本地 owner | 本地落点 | 不拥有 |
|---|---|---|---|
| 规格金字塔：ADR / AGENTS.md / CI gate | `PROJECT-DIRECTORY.md`、`templates/AGENTS.ccpanes-hooks.md`、测试与 smoke | 把规则分成“人读原因、Agent 常驻约束、机器强制检查”三层 | 不让文档规则替代 hard gate |
| 共享上下文：目标、规格、任务、运行、学习 | `.ccpanes-task/current-task.json`、audit dir、`ACCEPTANCE.md` | 让 task scope、policy、tool trace、验收证据组成共同事实源 | 不把旧聊天记忆当 source of truth |
| 工作流：入口 → 规格 → 执行 → 门禁 → 回写 | `plan-intake.ts`、`workflow-profile.ts`、`session-lifecycle.ts` | plan dry-run、workflow profile、StopCheck 验收提醒 | 不让 workflow profile 变成阻断器 |
| 责任治理：风险分层、权限网关、审计 | `hook-enforce`、`permission-enforce`、`post-enforce` | 写入边界、用户配置保护、项目 policy、JSONL 审计 | 不自动批准高风险权限请求 |
| eval gate：代表性输入 + 判据 + 门禁 | `examples/evals/workflow-profile-eval-cases.json`、`tests/workflow-profile-eval-fixtures.test.ts` | 用 fixture 防止风险路由、闭环强度和检查建议退化 | 不用 LLM judge 做本仓库必要检查 |

## 架构节点

```text
User / Plan text
  -> plan-intake.ts
  -> workflow-profile.ts + task-risk.ts
  -> advisory route / closure / checks
  -> hook-enforce + permission-enforce
  -> allow / block / audit
  -> StopCheck / acceptance evidence
```

### 节点职责

- `task-risk.ts`：从 prompt 中提取 Light / Standard / Heavy 风险信号。
- `workflow-profile.ts`：把风险信号和 changed paths 映射为任务路线、闭环强度和检查建议。
- `plan-intake.ts`：组合 workflow profile 与 plan policy preview；保持 dry-run。
- `hook-enforce` / `permission-enforce`：实际 hard gate，读取 task scope 与 project policy。
- `post-enforce` / acceptance：把工具执行和验收结果沉淀成可追溯证据。

## 关键决策

### ADR-AA-01：外部知识库只作为方法源，不作为运行时依赖

Context：`awesome-architecture` 是文档型知识库，适合做架构判断和模板参考；hooks 工具层是 TypeScript CLI + hook runtime。

Decision：只记录参考 HEAD、链接和本地映射；新增本地 fixture/test 固化可执行判据。

Rejected alternatives：

- 全量导入外部目录：会引入重复文档权威源。
- 把外部模板改造成运行时配置：会让 hook 边界来源变多。
- 大段复制模板：增加维护和许可标注成本，也不利于本地化。

Consequences：后续升级参考内容时，只需更新本记录的参考 HEAD 和 fixture，而不是迁移运行时。

Verification：`tests/workflow-profile-eval-fixtures.test.ts` 必须能证明关键路由和闭环强度符合本地判据。

Rollback：删除本记录、`examples/evals/workflow-profile-eval-cases.json` 和对应测试即可回到原状态。

Owners：`docs/` 记录判断，`examples/evals/` 记录样本，`tests/` 记录强制判据。

### ADR-AA-02：workflow profile 继续保持 advisory，不升级为 hard gate

Context：参考仓库强调 workflow / Golden Path / eval，但本仓库已经有明确的写入 hard gate。

Decision：`workflow-profile.ts` 只输出建议路线、闭环强度、检查项和边界提示；实际 allow/block 继续由 `hook-enforce`、`permission-enforce` 和 `.ccpanes-task/policy.json` 决定。

Rejected alternatives：

- 让 workflow profile 直接阻断工具调用：会制造第二套权限权威源。
- 让 StopCheck 根据 profile 自动宣称完成：验收证据仍必须来自实际命令和 diff/status。

Consequences：UI、SessionStart、StopCheck 可以复用 profile 做提示；权限判断仍 fail-closed 到现有 gate。

Verification：eval fixture 覆盖只读研究、policy 捕获、hook runtime、生产用户配置、文档-only 和测试 fixture 本身。

Rollback：保留现有 gate，不需要迁移状态。

Owners：`workflow-profile.ts` advisory；`hook-dry-run.ts` / `hook-runner.ts` / permission entrypoints hard gate。

## Eval fixture 设计

新增 `examples/evals/workflow-profile-eval-cases.json`：

- 每条 case 是一个“架构判断样本”，包含 prompt、changed paths、期望 route、rigor、closure 和必要检查。
- 样本只覆盖确定性分类，不调用外部模型。
- 样本来自本仓库真实工作流，不保存真实密钥、PII、生产数据或用户配置内容。

新增 `tests/workflow-profile-eval-fixtures.test.ts`：

- 读取 fixture。
- 对每条 case 调用 `classifyWorkflowProfile`。
- 核验 schema、route、rigor、closure、关键 flags 和检查项。

## 后续顺序

1. 把 `workflow-profile-eval-fixtures.test.ts` 纳入常规 `npm test`。
2. 后续若修改 task-risk / workflow-profile，先补或更新 eval case，再改实现。
3. 若要在 CC-Panes 主应用 UI 暴露这些信号，新增独立设计记录；UI 只消费 advisory profile，不承接 hard gate 权威。
4. 若要同步到 live prototype，走现有 production package / acceptance / live verification 流程。
