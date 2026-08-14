# Ponytail 参考吸收记录

日期：2026-08-14
目标仓库：`D:\cc-pane\tool\repos\hooks`
外部参考：`https://github.com/DietrichGebert/ponytail.git`
参考 HEAD：`2ed6c52c9d7e5e56942508591085fd45dea277d3`
参考版本：`v4.9.0`
许可：MIT

## 采纳判断

本仓库吸收 Ponytail 的实现经济性方法、薄宿主适配思路和 agentic benchmark
隔离方法，不导入它的 runtime，不复制其多宿主插件，不把提示词规则提升为
权限或完成状态的权威来源。

本地原则：

```text
最小化不必要复杂度，不最小化生产能力。
选择满足完整生产契约的最小设计，不交付只够演示的最小实现。
```

## 本地架构映射

| 参考思想 | 本地 owner | 本地用途 | 明确不拥有 |
|---|---|---|---|
| 先复用、再标准库、再平台能力、最后新增实现 | `src/implementation-standard.ts` | 形成机器可读的 production-grade implementation advisory | 不决定工具调用权限 |
| 删除重复实现、投机抽象、无证据依赖和无语义样板 | `src/implementation-standard.ts` | 限定 complexity-removal target | 不削减生产保障 |
| 根据任务路线注入工程指导 | `src/workflow-profile.ts` | 代码类 route 输出 `implementationStandard` | 不改变 task risk 或 closure |
| 场景 fixture 固化行为 | `examples/evals/`、`tests/` | 防止“最小实现”降级生产门禁 | 不使用 LLM judge 作为必要门禁 |
| 每个宿主只保留薄适配 | `src/host-adapter-registry.ts` | 延续 shared kernel + host adapter 结构 | 不复制 Ponytail runtime |
| 隔离 benchmark treatment 与 baseline | 本文 benchmark 规范 | 防止全局 Hook、插件和配置污染对照组 | 不把 LOC 当首要生产指标 |

## 生产级不变量

以下能力是必要生产成本，不属于简化或删除目标：

- 正确性和明确的边界条件。
- trust boundary 输入校验。
- 认证、授权、安全和隐私。
- 数据完整性、幂等、顺序和一致性。
- 错误契约、未知结果、恢复和 reconciliation。
- 兼容、迁移、灰度、部署和回滚。
- 日志、审计、指标、trace 和故障诊断。
- 有目标和证据的性能与容量要求。
- 测试、类型检查、构建、smoke 和验收证据。
- 产品明确承担的支持和维护要求。

只有下列对象进入实现经济性优化：

- 已存在 canonical owner 时的重复实现。
- 没有当前消费者的投机抽象。
- 没有运维需求的配置和开关。
- 现有能力已满足完整契约时仍新增的依赖。
- 不改善 ownership、contract、testability、observability、recovery 或
  compatibility 的 wrapper 和层级。
- 不携带必要语义的样板代码。

当更短的实现削弱任一生产不变量时，该实现不符合本仓库标准。

## 采纳内容

### 1. 实现经济性阶梯

在理解完整需求和真实调用链后，按顺序判断：

```text
需求是否真实存在
  -> 是否已有 canonical owner
  -> 标准库是否满足完整生产契约
  -> 平台原生能力是否满足完整生产契约
  -> 已安装依赖是否满足完整生产契约
  -> 新增最小的 production-grade implementation
```

“完整生产契约”包括成功语义、错误语义、安全、兼容、恢复、观测、性能目标和
验收证据。任何一项缺失都不能因为代码更短而提前停止。

### 2. 根因级修改

优先修改语义 owner，而不是在多个 consumer 上重复打补丁。该原则只在 owner
和调用链已被核实时适用；小 diff 不能代替完整调查。

### 3. 薄宿主适配

宿主适配器只负责 payload、lifecycle 和输出形状转换。task scope、policy、
hard gate 和 audit 继续由本仓库的 canonical owner 管理。

### 4. 可证伪评测

评测应能推翻预设结论，而不是只展示最有利样本。必须同时报告：

- 收益明显的任务。
- 已经足够精简、收益接近零的任务。
- 错误、失败和 blocked 运行。
- 方法限制和不能外推的范围。

## 明确拒绝

- 不导入 `lite`、`full`、`ultra`、`off` mode state。
- 不让外部插件写入用户目录、status line 或全局配置。
- 不让 prompt/skill 成为 hard-gate authority。
- 不把 LOC、token、成本或耗时作为 production readiness 的首要指标。
- 不采用“复杂逻辑只保留一个测试”的通用策略。
- 不用删测试、弱化校验、吞错误或移除恢复路径换取更小 diff。
- 不 fork 或 vendor Ponytail；如需独立用户体验层，优先消费上游或编写薄适配器。

## 权威边界

```text
current-task.json
  = task scope authority

.ccpanes-task/policy.json
  = executable project-policy authority

hook-enforce / permission-enforce
  = allow/block hard-gate authority

implementation-standard.ts / workflow-profile.ts
  = advisory engineering guidance

acceptance artifact
  = completion evidence
```

advisory 不得独立执行 allow、block、approve、complete、deploy 或配置写入。

## Agentic benchmark 隔离规范

### 固定输入

- 固定目标仓库 URL、commit、task fixture 和 scorer 版本。
- 每个 arm 使用独立、clean、可丢弃的 workspace。
- 每次运行使用独立进程和 conversation context。
- 记录操作系统、runtime、模型、CLI、依赖和环境前置条件。

### 隔离全局状态

baseline 必须排除：

- 用户级和全局 plugins。
- 全局 Hook。
- 用户级 AGENTS、CLAUDE、skills 和 prompt 注入。
- 用户配置中的 mode、status line、provider 和 launch profile 差异。
- 前一次运行遗留的缓存、状态文件和对话历史。

每个 treatment arm 只加载该 arm 明确登记的插件、规则和配置。不能从
`SessionStart`、`UserPromptSubmit`、subagent hook 或父进程环境继承未登记处理。

### 结果证据

每个 cell 至少保存：

- 最终 `git diff` 和 `git status`。
- 执行命令、exit code、stdout/stderr 摘要和 duration。
- 变更文件列表和工作区路径。
- correctness、security、scope 和生产契约检查结果。
- token、成本、时间和 LOC 等次级指标。
- scorer 输出和可离线重算所需原始 artifact。

生产属性先评分：

```text
correctness
  -> security and data integrity
  -> required behavior and scope
  -> recovery and operability
  -> verification evidence
  -> LOC / tokens / cost / time
```

前置依赖缺失、runner 不可用或环境不兼容应记录为 `blocked`，不得混入 product
pass/fail，也不得静默从统计中删除。

### 污染检测

在正式运行前至少设置一个 canary：

- baseline 输出不得包含 treatment schema、mode marker 或专属指令。
- treatment 输出必须包含唯一 treatment marker。
- 每个 arm 的配置来源和加载插件清单必须写入 artifact。
- 同一输入重复运行时，隔离状态不得跨 cell 延续。

检测到污染后，该批结果全部作废并重新运行，不能只修正汇总数字。

## 本地验证

本地实现通过以下证据约束：

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short --branch
```

`implementationStandard` 是 `ccpanes.workflow-profile.v1` 的 additive field。
代码类 route 返回 `ccpanes.implementation-standard.v1`；read-only、
documentation 和 other route 返回 `null`。现有 hard gate、closure 和验收语义
保持不变。

### 嵌套消费者兼容性

`WorkflowProfileResult` 还被 `ccpanes.plan-intake.v1` 的 `workflow` 字段直接
嵌入，因此新增字段同时出现在：

- `classify-workflow` CLI 输出。
- `plan-intake` CLI 输出。
- `plan-lifecycle-intake` 输出。
- task-scoped plan-intake audit artifact。

本仓库内消费者均通过 TypeScript 类型、CLI 测试、plan-intake 测试和 smoke
验证新增字段。字段是 additive，现有字段和语义不变，schema 保持 `v1`。
仓库外严格拒绝未知字段的消费者在 live 同步前必须更新；live 发布必须通过
repo/live consistency、installed hooks 和真实 Codex prompt canary，不能把
repo 测试外推为外部消费者兼容证据。

### Codex App 消费链路

Codex `UserPromptSubmit` 通过独立 `workflow-advisory` 命令读取当前 prompt，
解析最近的 task binding，并只对代码类 route 注入有界
`ccpanes.workflow-advisory.v1` additional context。skills-hub 与 CC-Panes
prompt-before 保持原顺序和职责。advisory 失败时不阻断 prompt；PreToolUse、
PermissionRequest、project policy 与 acceptance 继续拥有原有权威。

task-scoped `workflow-advisory-audit.jsonl` 只记录 prompt SHA-256、长度、
route、注入决策和上下文长度，不记录原始 prompt。

## 回退

本次吸收是无状态 additive change。回退时删除 implementation-standard owner
和对应测试，并从 workflow profile、fixture、CLI/smoke 断言中移除新增字段即可。
已发布 `workflow-advisory` 时，还要恢复发布前 `hooks.json` 快照并把 live
runtime 回滚到对应仓库提交。不涉及数据库 migration 或数据 reconciliation。
