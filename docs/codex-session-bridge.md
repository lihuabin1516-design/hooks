# Codex 外部会话桥接

本工具把 Codex App、Codex CLI 与显式提供的 CC-Panes 会话事实整理成可重建的只读投影。
投影用于检索、解释、留存检查、关系图和轻量交接，不是 Codex 或 CC-Panes 的 authority。
它不修改 Codex rollout、SQLite、用户配置、历史 rollout/sqlite 或官方程序。

## 归因模型

v2 将运行位置事实与项目语义归因拆成两个独立字段：

- `runtimeScope`：`exact`、`descendant`、`ancestor`、`unrelated`、`unknown`。它只描述
  会话 cwd 与目标项目路径的运行位置关系。
- `projectRelation`：`owned`、`supporting`、`mentioned`、`ambient`、`unrelated`、
  `unknown`。它综合 task binding、显式 CC-Panes 关联、主目标路径、cwd 和 prompt
  mention 等证据，描述会话与项目的语义关系。

旧 `scopeMatch` 仅作为迁移兼容字段保留，不再是默认筛选、handoff 摘要或项目所有权
判断的主契约。尤其是 `ancestor` 只说明会话从父目录或 workspace 启动，不证明项目
ownership；`prompt-mention` 也只对应兼容表示，v2 主字段是
`projectRelation: mentioned`。

下表是 **2026-08-15 的历史 evidence snapshot**。当时观察到的“67 App / 75 CLI”
是过宽的 relation count，不是 hooks ownership，也不是 2026-08-16 的当前 live count。

| 来源 | exact | ancestor | prompt-mention | 旧 relation count |
| --- | ---: | ---: | ---: | ---: |
| Codex App | 30 | 33 | 4 | 67 |
| Codex CLI | 1 | 73 | 1 | 75 |

在该 2026-08-15 snapshot 中，进一步限定为 active、non-archived、user、exact-cwd 后，
子集是 5 条 App + 1 条 CLI。这个子集仍只说明存储、来源和运行位置事实，不是所有权
证明。任何 broad related view 的行数都只表示该筛选下的关系投影规模，不能直接当作
真实会话数、当前活跃会话数或 hooks ownership 数；当前数量必须重新执行
`scan` / `resolve` 获取，并按用途使用窄筛选解释。

## 默认解析与显式扩展

`codex-sessions resolve` 默认只显示：

- `storageState: active`
- `threadSource: user`
- `projectRelation: owned | supporting`

四个显式 flag 分别扩展：

- `--include-archived`：允许 `storageState: archived`
- `--include-subagents`：允许 `threadSource: subagent`
- `--include-related`：允许 `projectRelation: mentioned`
- `--include-ambient`：允许 `projectRelation: ambient`

`projectRelation: unrelated | unknown` 始终排除。`storageState: missing` 以及
`threadSource: automation | unknown` 没有对应 broad flag，不会因上述选项进入结果。

handoff 调用 resolver 的 canonical 默认筛选，即使上游 resolution 将来包含 broad views，
也只使用 active、user、owned/supporting 会话。归因摘要沿用 `resolution.sessions` 的既有
顺序，最多取前三条，显示 `projectRelation` 而不是旧 `scopeMatch`。

## Schema 与重建

- 索引 schema：`hooks.codex-session-index/v2`
- 解析 schema：`hooks.codex-session-resolution/v2`

v1 文件应通过新的 `scan` / `resolve` 重新生成，不与 v2 混用，也不作为 v2 输入解释。
升级只重建派生投影，不迁移、不回写也不清理历史 rollout 或 SQLite。

采用 side-by-side 迁移：

1. 先用 versioned v2 文件名并行生成，例如 `codex-session-index-v2.json` 和
   `codex-session-resolution-v2.json`，保留仍被 consumer 使用的 v1 artifact。
2. 逐个迁移 consumer，并验证其读取 schema、默认筛选、输出和失败行为。
3. consumer 验证完成后，再按单独批准和留存策略退休旧 artifact。

旧 artifact 的退休是后续独立动作，需要单独批准；上述重建和 consumer 迁移步骤不授予
删除、移动或覆盖仍在使用的 v1 artifact 的权限。

2026-08-16 的当前 hooks workspace reconciliation 已把 `live` 中现存的 legacy
index/resolution aliases 显式同步为 sanitized v2 内容。这是当前 workspace 的一次性
reconciliation 事实，不表示 CLI 会自动覆盖其他 workspace、任意旧文件或所有 legacy
artifact；通用迁移仍遵循上述 side-by-side、consumer 验证和单独退休门禁。

## Privacy artifact 边界

rollout 与 SQLite 中的 raw prompt、summary、primary target，以及 developer lifecycle
中的 raw task binding，只在内存中用于路径 normalize、prompt mention 和 relation
classification。任何 prompt-derived 值进入 index、resolution 或 federation artifact
前，都通过同一个 bounded privacy redaction core；覆盖显式敏感赋值、URL
credential/query、Authorization/Bearer、JWT、private key block，以及已知 OpenAI、
GitHub、Slack、AWS、GitLab、npm、Hugging Face、Google 和 Stripe secret prefix。

- 每个输入值严格只扫描 raw 前 64 KiB UTF-8 bytes；边界按完整 Unicode scalar
  截取，孤立 surrogate 会被替换，避免半个 UTF-8 字符或无效字符串进入投影。
- `firstUserPrompt` 与 `lastSummary` 在 redaction 后折叠空白，并生成最长 512
  characters 的 excerpt。
- 所有可持久化 prompt-derived string projection 最长 512 characters。语义 ID
  最长 256 characters，并在 secret scan 前先执行长度拒绝；redaction、截断或其他
  清洗改变原值时置为 `null`。embedded provider-family 检查使用单次有界匹配，
  不再逐字符重复扫描。
- primary target 先用 64 KiB 内的 raw normalized target 完成归因。path identity
  只要发生 redaction、截断、trim 或无法保持有效有界路径，
  `primaryTargetRaw`、`primaryTargetNorm` 和对应 evidence 都为空；不会持久化
  `[REDACTED]` 伪路径，但 raw classification 结果保留。
- lifecycle `taskId`、`projectPathRaw` 与 `worktreeRootRaw` 使用同一 projection。
  task ID 或任一路径发生 redaction/截断、形态不安全或无法 normalize 时，整个
  `taskBinding` 为空，也不生成 task-binding evidence/node/edge；不会保留
  redacted task/path identity。
- `delegatedFromThreadId` 只有在未发生清洗且满足安全 ID 形态时才写入；否则为
  `null`，也不生成 delegation node/evidence。
- lifecycle parser、delegation parser、primary-target parser 与 prompt mention
  matcher 都在 split/regex 前复用同一个 UTF-8 64 KiB owner；边界后的 marker、
  target、delegation 或 project mention 不参与归因或 artifact。
- federation builder 对直接传入的外部 `CodexSessionRecord` 再次调用同一公开
  sanitizer/validator，不信任外部 delegation/task-binding projection。

## CC-Panes snapshot

`hooks.ccpanes-session-snapshot/v1` 是显式输入，不会自动发现 CC-Panes。输入在读取
Codex 数据和写出目标文件前经过严格 schema、字段、时间戳、路径与唯一 ID validation。

snapshot 只持久化关联所需的 IDs、project path、status、task/launch 引用及有限显示
元数据等字段；工具不发现、不读取、不保存 CC-Panes HTTP token 或动态端口。

snapshot 归因必须同时提供非空 project；缺少 project 时不执行 snapshot-to-project
归因。输入资源边界包括：

- `launches` 与 `sessions` 各最多 10,000 条。
- identity/reference ID 最长 256 characters，project path 最长 4096，
  workspace name 最长 256，`cliTool` 最长 64，status 最长 128，title 最长 512。
- timestamp 必须带 timezone、可规范化为四位年份 ISO 时间；trim 后最长 35
  characters、raw 最长 99，fractional seconds 最多 9 位。
- 未知字段、无效路径、重复 launch/session ID 和越界值直接使 snapshot validation
  失败。

structural validation 后，launch/session 的 identity、reference 与 project path
还必须通过统一 privacy/identity owner。任一 relationship 字段需要 redaction、
截断或无法保持原 identity/path 时，`attachCcPanesAttribution` 忽略整条 relationship：
不生成 evidence/reason，也不提升或降低 Codex session relation。federation builder
直接消费外部 snapshot 时对同一问题以
`CODEX_SESSION_FEDERATION_INVARIANT` 失败；两处不维护第二套 secret/path 规则。

未提供 snapshot 时，命令使用 Codex-only projection。`scan` 的 `warnings` 会包含
`CC-Panes snapshot not supplied`，graph 会给出 `ccpanes-snapshot-missing`
diagnostic；这不把 Codex 投影提升为 CC-Panes authority。

`scan`、`resolve`、`retention`、`graph` 均可消费 `--ccpanes-snapshot`。snapshot JSON
不合法、schema 不匹配或文件不可读时，命令在创建或覆盖 `--out` 之前失败。

## Federation graph

`codex-sessions graph` 生成 `hooks.session-federation/v1` derived graph。

`diagnostics` 记录 snapshot freshness：

- `ccpanes-snapshot-missing`：未提供 CC-Panes snapshot。
- `ccpanes-snapshot-stale`：包含 `ageMs` 与 `maxAgeMs`。
- `ccpanes-snapshot-future`：snapshot 超出允许的未来时钟偏差，包含
  `futureByMs` 与 `maxFutureSkewMs`。

默认 freshness threshold 是 24 小时，默认 future clock skew 是 5 分钟。stale 或
超过 5 分钟未来偏差的 snapshot 仍会生成 graph，但结果必须视为带对应 diagnostic 的
derived projection，不作为新鲜运行事实使用。

节点类型：

- `codex-thread`
- `ccpanes-launch`
- `ccpanes-session`
- `ccpanes-task`

边类型：

- `resumed-from`
- `hosts`
- `launched`
- `belongs-to-task`
- `delegated-from`
- `controller-for`

graph 只连接 typed evidence 或 snapshot 中的显式 ID 引用，不按 title 或时间接近程度
猜测 join。它不替代 Codex 的 thread/state authority，也不替代 CC-Panes 的
Pane/Session/PTY 与任务 authority。

graph boundary 会重新验证外部 Codex thread ID、snapshot identity/reference ID
与 project path；不安全 identity/path 以
`CODEX_SESSION_FEDERATION_INVARIANT` typed error 失败，显示属性则只保留统一
redaction/excerpt 后的值。内部 node/edge key 使用结构化 tuple，公开 ID 对外部
identity 与 edge endpoint 做确定性 percent encoding，避免 `:`、`->` 等 delimiter
造成碰撞；输入顺序不影响最终 graph。

federation 顶层 `project` 必须是未被 privacy projection 改写的安全 absolute path；
`generatedAt` 必须是带 timezone、可规范化的 canonical timestamp。失败 reason
分别是 `unsafe-project` 与 `unsafe-timestamp`，typed error 不回显原始输入。
`codex-sessions graph --project` 以及带 snapshot 的 scan/resolve/retention 在任何
snapshot/index/output I/O 前使用同一 project contract。

未指定 `--out` 时，graph 默认写入当前工作目录下的 `live/session-federation.json`。

## Sidebar projection

Sidebar projection 把 federation graph 中满足窄条件的 Codex CLI thread 规划为 Codex
App sidebar 动作。默认候选必须是 concrete、active、user、`owned | supporting`、
App Server 可读、当前未 listed，并且关联 live/recent launch；`--thread-id` 可以显式
选择同样满足前述项目与可读性边界、但没有 launch link 的 thread。inferred graph node
不会进入计划。

Codex 0.147.0 adapter 先用 `thread/list(useStateDbOnly:true)` 获取项目线程；显式
`--thread-id` 若未出现在 list 中，再用 `thread/read(includeTurns:false)` 按 ID
确认可读性、当前 name 与 preview。apply 的初始 before-state 和写后核验也使用同一
按 ID read fallback，因此隐藏但仍可读取的 CLI thread 不会被误判为不存在。App
Server 返回的 preview 是显示投影：先走统一 privacy redaction/excerpt，超长 preview
会截断到边界，而不会让同页其他 thread 的计划失败。

`--rename-thread-id` 是比选择 thread 更窄的授权：只有用户明确允许覆盖该 thread
已有的 customized name 时才传入，而且必须同时存在同值的 `--thread-id`。未给这个
参数时，非空 customized name 保持不变，计划仍可只处理 pin。

### Artifact 流程

| 阶段 | 输入 artifact | 输出 artifact |
| --- | --- | --- |
| `sidebar-plan` | `hooks.session-federation/v1` graph；`hooks.codex-app-sidebar-snapshot/v1` before snapshot | `hooks.codex-sidebar-plan/v1`，含 SHA-256 `digest` |
| `sidebar-apply` | sidebar plan；与 `plan.digest` 完全相同的 `--confirm-digest` | `hooks.codex-sidebar-apply/v1`，含 `planDigest`、`executionDigest`、`entries`、`pendingHostActions` |
| Codex App host pin | apply 的 `pendingHostActions` | `hooks.codex-sidebar-host-receipt/v1` |
| `sidebar-reconcile` | 原 plan；host receipt；pin 后重新采集的 fresh App sidebar snapshot | `hooks.codex-sidebar-reconciliation/v1`；plan-bound，并记录 `receiptExecutionDigest` 供审计 |
| `sidebar-rollback-plan` | apply result；与该 execution 对应的 host receipt | 严格校验 apply/receipt `executionDigest` 后输出 `hooks.codex-sidebar-rollback-plan/v1`，含 `sourceExecutionDigest`、逆序 `actions` 和自身 `digest` |

下面四条命令均从仓库根 `D:\cc-pane\tool\repos\hooks` 执行。plan 示例只显式选择一个
可用 `--thread-id`；应把示例 ID 替换为当前 concrete federation graph 中实际要处理的
thread ID。

```powershell
node dist/src/cli.js codex-sessions sidebar-plan `
  --graph live/session-federation.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.before.json `
  --thread-id 01a00490-90c0-7dc2-9fac-fbdb4d7baa0f `
  --out live/codex-sidebar-plan.json
```

如果且仅如果同一 thread 的 customized name 已获明确覆盖授权，在上面的命令中追加
`--rename-thread-id 01a00490-90c0-7dc2-9fac-fbdb4d7baa0f`；它不能脱离匹配的
`--thread-id` 单独使用。

```powershell
node dist/src/cli.js codex-sessions sidebar-apply `
  --plan live/codex-sidebar-plan.json `
  --confirm-digest $((Get-Content -Raw -LiteralPath live/codex-sidebar-plan.json |
    ConvertFrom-Json).digest) `
  --out live/codex-sidebar-apply.json
```

```powershell
node dist/src/cli.js codex-sessions sidebar-reconcile `
  --plan live/codex-sidebar-plan.json `
  --host-receipt live/codex-sidebar-host-receipt.json `
  --app-sidebar-snapshot live/codex-app-sidebar-snapshot.after.json `
  --out live/codex-sidebar-reconcile.json
```

```powershell
node dist/src/cli.js codex-sessions sidebar-rollback-plan `
  --apply live/codex-sidebar-apply.json `
  --host-receipt live/codex-sidebar-host-receipt.json `
  --out live/codex-sidebar-rollback-plan.json
```

### 两阶段 side effect 与 authority

`sidebar-apply` 的唯一 native write 是通过 Codex 0.147.0 App Server
`thread/name/set` 设置非空 string name。它不执行 pin；命名结果确认后生成
`executionDigest`，并为 `unchanged` 或 `name-applied` entry 输出
`pendingHostActions`。每条 pending host action 同时绑定同一个 `planDigest` 和
`executionDigest`；host receipt 应原样携带这两个 digest，作为后续 plan 绑定和
execution 审计信息。

Codex App sidebar 的 pin/unpin authority 属于 App host operation
`set_thread_pinned`，不是 Codex 0.147.0 App Server 字段。用户或宿主逐条执行
`pendingHostActions` 后，应按原顺序写入 typed receipt；成功 entry 使用
`status: "applied"`、`error: null`，失败 entry 使用 `status: "failed"`、
`error: "host-write-failed"`。下面的 PowerShell 必须在最后一条 host pin 操作完成后
才执行；按实际 host 结果填写 `$receiptEntries`，然后调用
`(Get-Date).ToUniversalTime().ToString('o')` 记录真实完成时间：

```powershell
$apply = Get-Content -Raw -LiteralPath live/codex-sidebar-apply.json |
  ConvertFrom-Json

$receiptEntries = @(
  [ordered]@{
    threadId = '01a00490-90c0-7dc2-9fac-fbdb4d7baa0f'
    pinned   = $true
    status   = 'applied'
    error    = $null
  }
)

$receiptGeneratedAt = (Get-Date).ToUniversalTime().ToString('o')
$receipt = [ordered]@{
  schemaVersion   = 'hooks.codex-sidebar-host-receipt/v1'
  generatedAt     = $receiptGeneratedAt
  planDigest      = $apply.planDigest
  executionDigest = $apply.executionDigest
  entries         = $receiptEntries
}
$receipt |
  ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath live/codex-sidebar-host-receipt.json -Encoding utf8
```

receipt 的 `planDigest` 与 `executionDigest` 都必须直接复制自对应 apply artifact。
随后重新采集 `hooks.codex-app-sidebar-snapshot/v1`；用于 reconcile 的 snapshot
必须在 `$receiptGeneratedAt` 之后采集，其 `generatedAt` 不早于 receipt。
`sidebar-reconcile` 根据 plan、receipt 和 fresh snapshot 输出 `visible`、
`not-visible`、`host-failed` 或 `digest-mismatch`。它校验
`plan.digest === receipt.planDigest` 和 snapshot freshness，并把 receipt 中的
`executionDigest` 记录为 `receiptExecutionDigest`；由于 reconcile 不读取 apply
artifact，这属于 plan-bound / executionDigest-audited 结果，不证明 receipt 与某一
apply execution 已严格配对。

`sidebar-rollback-plan` 只根据 apply 捕获的 `previousName`、`previousPinned` 和匹配
receipt 生成逆序 rollback plan，不调用 App Server，也不执行 host pin/unpin。生成的
plan 前会同时读取 apply 与 receipt，严格校验两者的 `planDigest` 和
`executionDigest`，再以 `sourceExecutionDigest` 绑定原 apply execution；后续执行
仍需分别由 App Server 恢复 name、由 Codex App host 恢复 pin state，并另行
reconcile。

Codex 0.147.0 的 `thread/name/set` 只接受非空 string，没有公开 clear-name 操作。
因此当 `previousName: null` 时，rollback action 固定为
`nameAdapter: "unsupported-clear-name-on-codex-0.147.0"`，rollback 根
`executable: false`。此时不能用空字符串猜测清名语义，也不能把该计划描述为可完整
自动执行。

这些命令和 artifact 描述当前 repo 中的实现契约；native sidebar acceptance 属于后续
受控验收，不因生成 plan、apply、receipt、reconciliation 或 rollback artifact 而自动
成立。

## PowerShell 命令

以下命令从仓库根执行：

```powershell
cd D:\cc-pane\tool\repos\hooks
npm run build
```

生成 v2 索引：

```powershell
node dist/src/cli.js codex-sessions scan `
  --project D:\cc-pane\tool\repos\hooks `
  --out live/codex-session-index-v2.json
```

可选地显式加入 CC-Panes snapshot：

```powershell
node dist/src/cli.js codex-sessions scan `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --out live/codex-session-index-v2.json
```

默认 human resolve 与 JSON resolve：

```powershell
node dist/src/cli.js codex-sessions resolve `
  --project D:\cc-pane\tool\repos\hooks

node dist/src/cli.js codex-sessions resolve `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --json
```

把当前 CLI 的 JSON stdout 写成 versioned resolution artifact：

```powershell
New-Item -ItemType Directory -Force -Path live | Out-Null
node dist/src/cli.js codex-sessions resolve `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --json | Set-Content -LiteralPath live/codex-session-resolution-v2.json -Encoding utf8
```

显式打开四类 broad view：

```powershell
node dist/src/cli.js codex-sessions resolve `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --include-archived `
  --include-subagents `
  --include-related `
  --include-ambient `
  --json
```

生成留存风险清单；该命令只写 manifest，不删除或移动会话：

```powershell
node dist/src/cli.js codex-sessions retention `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --out live/session-retention-manifest.json
```

生成 federation graph。省略 `--out` 时使用默认路径 `live/session-federation.json`：

```powershell
node dist/src/cli.js codex-sessions graph `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json
```

也可以显式指定 graph 输出：

```powershell
node dist/src/cli.js codex-sessions graph `
  --project D:\cc-pane\tool\repos\hooks `
  --ccpanes-snapshot live/ccpanes-session-snapshot.json `
  --out live/session-federation.json
```

生成两种 handoff：

```powershell
node dist/src/cli.js handoff generate `
  --mode ccpanes-worker `
  --project D:\cc-pane\tool\repos\hooks `
  --index live/codex-session-index-v2.json

node dist/src/cli.js handoff generate `
  --mode codex-app-visual `
  --project D:\cc-pane\tool\repos\hooks `
  --index live/codex-session-index-v2.json
```

显式提供 `--task-context` 时，canonical current-task reader 最多读取 16 KiB + 1
byte，并拒绝超限、不可读、JSON 错误、未知字段、字段越界、非 absolute canonical
path 或其他 schema 错误。这些失败以 `CODEX_HANDOFF_TASK_CONTEXT_INVALID` typed
error 传播，metadata 只包含稳定 `code`、`field`、`reason`，不包含或回显 raw path。
显式空字符串也是 invalid；只有调用方真正未提供 task context 且默认 current-task
不存在时，handoff 才使用明确的 `taskId/phase: unknown` absent state。

读取到 current task 后，`task.projectPath` 或非空 `task.mainRepoRoot` 只要与
`--project` 的 normalized path 不一致，handoff 就抛出
`CODEX_HANDOFF_TASK_CONTEXT_INVALID`，对应 `field` 为 `task.projectPath` 或
`task.mainRepoRoot`，`reason` 固定为 `project-mismatch`。该错误不会降级为 unknown
task，也不会改用不匹配的 task authority。

handoff 输出中的 task ID、project/task-context path、index path 与 resolution
thread/cwd 同样经过统一 identity/path projection。任务 authority 字段不安全时
typed fail；仅显示用的 index/thread/cwd 不安全时显示 `unknown`，不会输出
`[REDACTED]` 伪 identity/path。

默认只读来源是 `~/.codex/sessions`、`state_5.sqlite` 和 `thread_history_1.sqlite`。
SQLite 使用只读连接；JSONL 仅读取有界首段和尾段，坏行与缺失来源进入 projection
warnings。

`ccpanes-worker` 面向终端、测试和批量工程改动；`codex-app-visual` 面向浏览器、截图和
前端视觉验证。两种模式共享相同的窄 session scope、项目边界与验证文案。
