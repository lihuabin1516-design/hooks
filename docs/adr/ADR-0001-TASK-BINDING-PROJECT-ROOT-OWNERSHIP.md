# ADR-0001：Task Binding 分离 canonical project 与 active worktree

- 状态：Accepted
- 日期：2026-08-10
- 接受日期：2026-08-11
- 任务：`hooks-phase51-task-binding-isolation`
- Canonical project：`D:\cc-pane\tool\repos\hooks`
- Active worktree：`D:\cc-pane\.worktrees\hooks-phase51-task-binding`
- Branch：`codex/hooks-phase51-task-binding`
- 基线：`f6846e9156ae4c871e063f996ba4031cf0732383`

## Context

`resolveCurrentTaskFromCwd()` 当前从事件 `cwd` 一直向文件系统根目录搜索
`.ccpanes-task/current-task.json`，找到第一个合法 JSON 后立即选为当前任务。
它只校验字段类型，没有核验 task 文件、当前 Git checkout 和 canonical 项目的
拓扑关系。

2026-08-10 已确认一次真实串线：

- 当前 Hooks 项目应归属 `D:\cc-pane\tool\repos\hooks`；
- 当时 Hooks cwd 下没有项目级 task binding；
- 父级 `D:\cc-pane\.ccpanes-task\current-task.json` 指向 PaneForge task；
- 父级 binding 的 `worktreeRoot=D:\cc-pane`，范围过宽；
- ancestor search 因而把 PaneForge task 注入 Hooks 对话。

现场已拆分为两个独立任务边界：

- Hooks task binding 位于
  `D:\cc-pane\.worktrees\hooks-phase51-task-binding\.ccpanes-task\current-task.json`；
- PaneForge task binding 位于
  `D:\cc-pane\.worktrees\paneforge-foundation\.ccpanes-task\current-task.json`；
- workspace root 的 broad synthetic binding 已归档；
- PaneForge 原有 fusion 改动原地保留，未复制、重置、暂存、提交或推送。

拆分后又发现第二个语义问题：Hooks binding 曾把 `projectPath` 写成 linked
worktree。这样会把“项目是谁”与“本轮在哪里写”混为一谈。

## Architecture trigger

```text
Trigger: task scope authority and hook control-plane resolution
Affected boundary: cwd -> Git topology -> current-task resolver -> hook/session consumers
Canonical owner: src/current-task.ts
Providers: src/git-state.ts, .ccpanes-task/current-task.json
Consumers: hook-enforce, permission-enforce, post-enforce, session-start,
           stop-check, plan-lifecycle-intake
Changed contract: task binding distinguishes canonical project ownership from
                  active-worktree write ownership
Compatibility obligation: preserve project-local main-worktree and non-Git tasks;
                          linked-worktree tasks must declare their canonical project
Verification evidence: topology, resolver, CLI, lifecycle and hook integration tests
Recovery: reverse the Phase51 patch; keep archived root binding only as evidence
Review depth: Full
```

## Decision

### 1. 三个路径字段各自只有一个含义

| 字段 | 含义 | Hooks 本轮值 |
|---|---|---|
| `projectPath` | canonical 项目目录；项目身份与长期归属 | `D:\cc-pane\tool\repos\hooks` |
| `worktreeRoot` | 当前 task checkout；写入、policy、audit、acceptance 的硬边界 | `D:\cc-pane\.worktrees\hooks-phase51-task-binding` |
| `mainRepoRoot` | Git main worktree；Phase51 保留 schema 兼容 | `D:\cc-pane\tool\repos\hooks` |

在主工作树中，三个值通常相等。在 linked worktree 中，`projectPath` /
`mainRepoRoot` 与 `worktreeRoot` 必须不同。

`projectPath` 与 `mainRepoRoot` 在当前 Git 模型中暂时重复，但 Phase51 不删除或
重命名字段。后续只有完成 consumer inventory 和 schema 迁移设计后，才能决定
是否合并。

### 2. Task 文件由 active worktree 持有

task 文件必须位于：

```text
<worktreeRoot>/.ccpanes-task/current-task.json
```

因此：

- task 文件所在目录必须等于声明的 `worktreeRoot`；
- 当前 `cwd` 所属 `git rev-parse --show-toplevel` 必须等于 `worktreeRoot`；
- policy、audit、acceptance 等 task-scoped 写入继续只使用 `worktreeRoot`；
- `projectPath` 不作为当前任务的文件写入边界。

### 3. Canonical project 由 Git topology 证明

Git 项目中，`src/git-state.ts` 提供：

```ts
interface GitTopology {
  worktreeRoot: string;
  commonDir: string;
  mainRepoRoot: string | null;
}
```

推导规则：

1. `worktreeRoot` 来自 `git rev-parse --show-toplevel`；
2. `commonDir` 来自
   `git rev-parse --path-format=absolute --git-common-dir`；
3. 当 `commonDir` 以 `.git` 结尾时，先得到候选
   `dirname(commonDir)`；
4. 候选必须与 `git worktree list --porcelain` 的 main worktree 一致；
5. 当前 checkout 直接使用 common dir 时，inventory 的 main worktree 还必须
   等于当前 Git root，避免把任意 `--separate-git-dir ...\.git` 的父目录误当
   canonical project；
6. `projectPath` 必须等于验证后的 `mainRepoRoot`；
7. 非空 `mainRepoRoot` 也必须等于验证值。

`projectPath`、`worktreeRoot` 和非空 `mainRepoRoot` 必须是规范化绝对路径；
相对路径、空字符串和带未消解 `.` / `..` 的路径在 schema 边界直接拒绝。

Phase51 面向可由 common dir 与 worktree inventory 共同证明的非 bare
repository 模型。bare repository、独立 Git 数据目录、submodule
absorbed-gitdir 或无法证明 main worktree 的拓扑返回显式 mismatch，不猜测路径。

非 Git task 保留 nearest-ancestor 行为，但必须满足：

```text
taskFileRoot == worktreeRoot == projectPath
mainRepoRoot == null
```

### 4. 解析结果使用显式状态

新增 `ccpanes.task-binding-check.v1`：

```ts
type TaskBindingStatus =
  | 'matched'
  | 'missing'
  | 'stale-parent-binding'
  | 'git-topology-unavailable'
  | 'task-root-mismatch'
  | 'git-root-mismatch'
  | 'project-root-mismatch';

interface TaskBindingCheck {
  schema: 'ccpanes.task-binding-check.v1';
  status: TaskBindingStatus;
  reason: string;
  cwd: string;
  gitRoot: string | null;
  gitCommonDir: string | null;
  canonicalProjectRoot: string | null;
  taskPath: string | null;
  taskFileRoot: string | null;
  declaredProjectPath: string | null;
  declaredWorktreeRoot: string | null;
  declaredMainRepoRoot: string | null;
  taskId: string | null;
}
```

状态含义：

- `matched`：task 文件、active worktree、当前 Git root 与 canonical project
  topology 全部一致；
- `missing`：当前项目边界内没有 task，也没有越界父级 task；
- `stale-parent-binding`：当前 Git root 内没有 task，但 Git root 以上存在 task；
- `git-topology-unavailable`：存在 Git marker、bare repository 或 Git 探测异常，
  当前 topology 不可安全证明；固定 reason 为 `git_topology_probe_failed`；
- `task-root-mismatch`：task 文件所在目录不等于声明的 `worktreeRoot`；
- `git-root-mismatch`：当前 Git root 不等于声明的 `worktreeRoot`；
- `project-root-mismatch`：`projectPath` 或非空 `mainRepoRoot` 不等于 Git
  topology 推导的 canonical project。

### 5. Git root 是向上搜索的硬边界

当 cwd 位于 Git worktree：

1. 从 cwd 向上搜索到 Git root，包括 Git root；
2. Git root 内找到 task 后验证 task/worktree/project topology；
3. 不把 Git root 以上的 task 当成当前 task；
4. 可只读探测 Git root 以上的最近 task，返回 `stale-parent-binding` 诊断。

当 cwd 不位于 Git worktree：

- 保留 nearest-ancestor 搜索；
- 第一个 task candidate 必须满足非 Git task invariant；
- 不允许父级 task 通过宽泛 `worktreeRoot` 捕获另一个 Git 项目。

### 6. Consumer 行为

| Consumer | `matched` | `missing` | mismatch |
|---|---|---|---|
| `verify-task-binding` | pass JSON | missing JSON | mismatch JSON |
| `session-start` | 正常 task context | no-op | mismatch context |
| `hook-enforce` | 现有规则 | no-op | 写调用 fail-closed；只读调用 no-op；仅 `stale-parent-binding` 精确 `write-current` bootstrap 例外 |
| `permission-enforce` | 现有规则 | no-op | 涉及写入的授权请求 fail-closed；仅 `stale-parent-binding` 精确 `write-current` bootstrap 例外 |
| `post-enforce` | 现有审计 | no-op | 不向 candidate task audit dir 写入 |
| `stop-check` | 现有提醒 | no-op | 提示先修复 binding |
| `plan-lifecycle-intake` | 现有流程 | no-op | 不写 candidate task audit |

当 mismatch 没有 task candidate 时，PreToolUse / PermissionRequest 使用只存在于
当前调用内的 gate context 评估读写属性，不创建 task 文件、不路由 task audit。
即使存在 candidate，mismatch runner 也只使用固定
`taskId=unresolved-task-binding` 的中性 gate context；candidate task ID 只作为
`TaskBindingCheck` 诊断字段，不继承其 phase、worktree 或 audit 归属。

阻断原因固定为：

```text
task_binding_scope_mismatch:<TaskBindingStatus>
```

唯一放行例外用于解除 `stale-parent-binding` bootstrap deadlock。该例外不继承
candidate task authority，只验证当前 `TaskBindingCheck.gitRoot` 和当前 hook
进程入口：单条 shell command 必须是 `node` / `node.exe` / `process.execPath`
加 trusted CLI path 加 `write-current`；`--root` 等于 `gitRoot`，`--task-id`
非空，`--phase` 合法；可选参数只接受 `--workspace`、`--leader-session-id`、
`--notes`。命中时决策 reason 固定为：

```text
task_binding_bootstrap_write
```

其他 mismatch status、普通 Edit / ApplyPatch / Shell 写入、错误 root / CLI、
未知或重复参数、缺值、重定向、复合 shell 语法均保持 fail-closed。

### 7. Task writer 必须使用同一个 topology-aware factory

`write-current` 与 `bootstrap-project` 复用 `createCurrentTask()`：

- 输入 root 表示 active checkout；
- Git 环境自动填入真实 branch、HEAD、`worktreeRoot`、`projectPath` 和
  `mainRepoRoot`；
- 非 Git 环境写入
  `projectPath=worktreeRoot=root`、`mainRepoRoot=null`；
- 不接受可伪造 topology 的 `--project-path` 或 `--main-repo-root` 覆盖；
- 不再默认写入 `notes=synthetic fixture task`；
- 未知 owner 字段保持 `null`，不伪造 session/pane/layout。
- 底层原子 writer 必须拒绝写入目录与 `task.worktreeRoot` 不一致的调用。
- `.ccpanes-task` 与 `current-task.json` 必须是 worktree 内的真实目录/文件，
  不接受 symlink/junction；原子 rename 前复核目录的 realpath 和文件身份。

workspace resume 扫描也必须经过同一 binding authority：只有
`resolveCurrentTaskBindingFromCwd()` 返回 `matched` 的 task 才能成为 resume
candidate；存在直接 task 文件或 `.git` marker 的项目都要经过 resolver，
除 `missing` 外的状态进入带 `bindingStatus` 的 scan diagnostics。

### 8. 本地 task 状态不进入源码历史

`.ccpanes-task/` 是本机控制面状态，必须通过仓库本地 exclude 或项目
`.gitignore` 排除。Task binding 不进入 commit。

## Ownership model

### CurrentTask owner

```text
Name: current-task
Role: task schema, persistence and resolution owner
Owns: task JSON validation, atomic write, binding status and topology invariant
Does Not Own: Git command implementation, hook event parsing, project policy
Inputs: cwd, task JSON, GitTopology
Outputs: CurrentTask, TaskBindingCheck, matched resolution
Providers: filesystem, git-state
Consumers: CLI and lifecycle/hook entrypoints
State: worktree-local control-plane configuration
Authority: decides which task may govern the active checkout
Failure Domain: stale, malformed or cross-project task state
Observability: verify-task-binding JSON and hook deny reason
Lifecycle: create, refresh, verify, archive
```

### Git topology provider

```text
Name: git-state
Role: read-only Git facts provider
Owns: worktree root, common dir, main worktree, branch, HEAD and dirty facts
Does Not Own: task authority or hook allow/deny policy
Inputs: cwd
Outputs: GitState and GitTopology
Consumers: current-task, resume and acceptance paths
Authority: none; supplies evidence
Failure Domain: unavailable Git executable or unsupported topology
Observability: nullable facts and explicit topology mismatch
```

### Hook entrypoints

```text
Name: hook entrypoints
Role: task binding consumer and execution gate
Owns: allow/block response and task-scoped audit dispatch
Does Not Own: task selection semantics
Inputs: hook event and TaskBindingCheck
Outputs: no-op, allow, deny, lifecycle context or audit
Providers: current-task, hook-event-adapter, hook-runner
Consumers: Codex / CC-Panes hook host
State: ephemeral decision plus worktree-scoped audit output
Authority: blocks writes when binding authority is ambiguous
Failure Domain: false allow or wrong audit routing
Observability: deny reason and task-binding JSON
```

## Rejected alternatives

### `projectPath === worktreeRoot` 作为永久 invariant

否决原因：该规则只适用于主工作树和非 Git task，会把 linked worktree 错误描述成
独立项目。

### 继续允许 workspace root task 管理所有子项目

否决原因：workspace root 不是每个嵌套 Git repo 的 task authority，会重现跨项目
串线。

### 只校验路径包含关系

否决原因：`D:\cc-pane` 包含多个独立项目；ancestor/inside 关系不能证明 ownership。

### 发现 mismatch 后全部 no-op

否决原因：写调用 fail-open。只对真正 `missing` 保持兼容 no-op；已发现的
stale/mismatch 对写调用 fail-closed。

### 在 Phase51 删除 `mainRepoRoot`

否决原因：尚未完成所有 producer/consumer 和外部 task schema 的迁移调查。
Phase51 只明确语义并保持字段。

## Consequences

- canonical project 与任务写入边界不再混淆；
- parent workspace task 不再跨 Git root 接管子项目；
- linked worktree 可以证明它属于哪个 canonical repo；
- SessionStart 和 CLI 可明确报告是哪一层路径不一致；
- task writer 需要 Git topology 查询；
- 不受支持或探测失败的 Git topology 将返回显式 mismatch，而不是猜测
  canonical project 或抛出未结构化进程错误；
- 现有把 linked worktree 同时写入 `projectPath/worktreeRoot` 的 binding 需要刷新。

## Verification

必要断言：

1. Hooks 实际 binding 为：
   `projectPath=mainRepoRoot=D:\cc-pane\tool\repos\hooks`，
   `worktreeRoot=D:\cc-pane\.worktrees\hooks-phase51-task-binding`。
2. linked worktree 的 Git common dir 指向 canonical repo `.git`。
3. 子 Git repo 没有 task、父级 workspace 有 task时返回
   `stale-parent-binding`。
4. main worktree 的 project-local task 返回 `matched`。
5. linked worktree 的三路径 topology 正确时返回 `matched`。
6. task 文件目录不等于 `worktreeRoot` 时返回 `task-root-mismatch`。
7. cwd Git root 不等于 `worktreeRoot` 时返回 `git-root-mismatch`。
8. `projectPath` 或非空 `mainRepoRoot` 不等于 canonical main worktree 时返回
   `project-root-mismatch`。
9. broken gitfile / bare repository 返回 `git-topology-unavailable`，不抛出
   未结构化进程错误。
10. stale/mismatch 下写事件被阻断，只读事件不绑定错误 task；未识别 Shell
    命令以及带重定向、管道、连接符的复合命令默认视为可能写入。
11. `stale-parent-binding` 下只有精确 `write-current` bootstrap shell command
    可返回 `task_binding_bootstrap_write`；PreToolUse 与 PermissionRequest 行为一致。
12. mismatch 下不写 candidate task 的 audit。
13. 相对、空字符串或非规范声明路径在 schema 边界被拒绝。
14. `write-current` / `bootstrap-project` 对 linked worktree 写入真实 topology、
    branch 和 HEAD。
15. workspace resume 不接受 false canonical project 或其他 mismatch task。
16. separate Git dir 即使以 `.git` 结尾也不得冒充 canonical main worktree。
17. 原子 writer 不得把 task 写入不同于 `task.worktreeRoot` 的目录。
18. 现有测试、typecheck、build 和 smoke 保持通过。

## Rollback / reversal condition

如 topology 推导破坏已确认的合法工作流：

1. 停止 live 同步；
2. reverse/revert Phase51 源码变更；
3. 恢复上一版 live backup；
4. 保留 `verify-task-binding` 诊断与归档 root binding 作为证据；
5. 为该 Git topology 增加明确合同并重新评审。

不恢复 workspace root broad synthetic binding 作为长期处理。

## Owners

- `src/current-task.ts`：task binding canonical owner。
- `src/git-state.ts`：Git topology facts provider。
- `src/types.ts`：公开 task binding check 类型。
- `src/cli.ts`：参数解析与 consumer 编排。
- `src/hook-runner.ts`：mismatch write deny result 与 bootstrap allow 编排。
- `src/task-binding-bootstrap.ts`：stale-parent-binding bootstrap 命令纯解析与鉴权。
- `src/session-lifecycle.ts`：SessionStart / Stop 诊断。
- `tests/**`：边界、失败与恢复证据。
