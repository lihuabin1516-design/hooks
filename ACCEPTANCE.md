# CC-Panes Task Probe Prototype Acceptance

验收日期：2026-08-06  
原型目录：`D:\cc-pane\tool\experiments\ccpanes-task-probe`  
计划文件：`D:\cc-pane\tool\plans\CCPANES-TASK-OWNERSHIP-RESUME-PROBE-PROTOTYPE-PLAN.md`  
设计文件：`D:\cc-pane\tool\designs\CCPANES-TASK-OWNERSHIP-RESUME-PROBE.md`

## 1. 验收范围

本轮验收覆盖 isolated prototype：

- `current-task.json` schema 校验、读取上限和原子写入。
- `resume-probe` 四类动作：`none`、`auto_resume`、`ask_user`、`out_of_scope`。
- Hook dry-run 写入门禁：用户配置目录、参考仓库、task worktree 边界、phase 策略。
- CLI smoke：`probe`、`write-current`、`dry-run-hook`。

本轮未安装 Comet，未接入真实 Hook，未写入用户级 Codex / Claude / CC-Panes 配置。

## 2. 本地 Hook 参考元数据

`skills-hub-hook.exe` 作为后续 Hook 接入研究对象记录，本轮未执行该二进制。

```text
path: C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
size: 2779136
lastWriteUtc: 2026-07-16T07:04:10.3614061Z
sha256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
```

## 3. 已实现文件

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\package.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\package-lock.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\README.md
D:\cc-pane\tool\experiments\ccpanes-task-probe\tsconfig.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\vitest.config.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\cli.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\current-task.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\git-state.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\hook-dry-run.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\paths.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\resume-probe.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\types.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\tests\cli.test.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\tests\current-task.test.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\tests\hook-dry-run.test.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\tests\resume-probe.test.ts
```

## 4. 必要检查

| Check | Command | Expected | Status |
|---|---|---|---|
| Unit tests | `npm test` | 4 files / 23 tests pass | pass |
| Typecheck | `npm run typecheck` | exit code 0 | pass |
| Build | `npm run build` | exit code 0 and `dist/src/cli.js` exists | pass |
| CLI probe | `node dist/src/cli.js probe --utterance '继续' --session leader-1` | emits `ccpanes.resume-probe.v1` JSON | pass |
| CLI dry-run | `node dist/src/cli.js dry-run-hook ... --phase shape ... --tool write` | emits `block` with `phase_shape_blocks_implementation_write` | pass |
| Comet repo isolation | `git -C D:\cc-pane\tool\repos\comet status --short` | clean | pass |
| FastCtx repo isolation | `git -C D:\cc-pane\tool\repos\fastctx status --short` | clean | pass |
| User config isolation | recent writes under `~/.codex`, `~/.claude`, `~/.cc-panes` | 0 during execution window | pass |

## 5. Fresh verification evidence

Latest full verification output from the prototype root:

```text
npm test
Test Files  4 passed (4)
Tests       23 passed (23)

npm run typecheck
exit code 0

npm run build
exit code 0
DIST_CLI_EXISTS=True
```

CLI smoke evidence:

```json
{
  "schema": "ccpanes.resume-probe.v1",
  "action": "none",
  "reason": "no_candidates",
  "candidates": []
}
```

```json
{
  "action": "block",
  "reason": "phase_shape_blocks_implementation_write",
  "targetInsideWorktree": true,
  "phase": "shape"
}
```

## 6. Reference repo baseline

```text
comet path: D:\cc-pane\tool\repos\comet
comet HEAD: 07c5b64b02dc00fffa6d66da70014bfb0f9ebca0
comet status: clean

fastctx path: D:\cc-pane\tool\repos\fastctx
fastctx HEAD: 86dac0c99efae7859ed2be468f68c16e58f5e16a
fastctx status: clean
```

## 7. Artifact hashes from implementation run

```text
D8E26508B958D22D778870F0F802EBCAF7D911718A5987C6B34103CE5D5B8196  package.json
47BB6554F89D19C5691D0C844A1D7A65ABFC120FD8B534E2B7F91A955361173F  package-lock.json
14BD669D56497A7F8D6C9899EA7465CD79F9FCBD9738C370CC04C69998829EDF  README.md
2B5EC736526A001763CD14C1A688683567BADC278C97D5F6D0423C29CF7E08B4  tsconfig.json
888535057051B2B4073C7D7752244B1617830CC2A39AE6A0266CD4044D2EA13A  vitest.config.ts
690FE22567070882E06542F660D910221976726722AE795AF13FB6213CC25543  src/cli.ts
0E9B908EBF56667AF45136FD9E6B44027B488B2F068DA6FBCBCF5BB6328DDA38  src/current-task.ts
6C8256B40566666A4618CCB332117D14553735931F5BD928630935C3B1249313  src/git-state.ts
DF7C3CDB2EEFDCC60DB8C65228C450CE1BC851492DCCF2786BA8D51B52767066  src/hook-dry-run.ts
A504C60EA2E3DBB61DE92C8F419D1B396F5F1CCE5E7B36A4B0A577996D1645C1  src/paths.ts
6FB38AC7BD75DB255D4ADB8403EBAADD4DF12B7F2E87843DB862CFDFBD1C3B6A  src/resume-probe.ts
9399A9779AAEA44E8AE85A2124F74E4594BB8C2C056773500CB45F775202FDF1  src/types.ts
4840C20F89A5713CB695EB5B3BCA0EFA0F0CBA3E8125353F1A81799397AE76FE  tests/cli.test.ts
C2EC1EB32A7513DA582A2279E0953ADF7AB467F054F2D096342D82C766A43686  tests/current-task.test.ts
F354B9E4E1D325A075CDE105C70DBB8FF86A2DCE546451B11CF3DDE602F211B3  tests/hook-dry-run.test.ts
DEF35D2F9F3F2C6B930604EF7F1570468CF06865A870A098898A4EBE8431C877  tests/resume-probe.test.ts
```

## 8. 验收判断

该 prototype 已满足本轮目标：在隔离目录内验证 CC-Panes task ownership / resume-probe / hook dry-run 的最小闭环。

后续建议：基于本 prototype 做第二轮设计，把 `resume-probe` 的候选任务发现从测试输入升级为扫描 synthetic workspace 的只读 CLI；仍保持 dry-run，不接入真实 Hook。
## 9. Round 2: Workspace scan acceptance

第二轮目标：把候选任务从测试输入升级为扫描 synthetic workspace 下真实 `.ccpanes-task/current-task.json` 文件。

新增能力：

- `src/workspace-scan.ts`
  - 扫描 `<workspaceRoot>/*/.ccpanes-task/current-task.json`。
  - 复用 `readCurrentTask` 做 bounded read 和 schema 校验。
  - 忽略无 current-task 的普通目录。
  - 对 invalid current-task 返回 `scanErrors[]`，不中断整体扫描。
  - 跳过 `.git`、`node_modules`、`dist`。
- `probe --workspace-root <dir>`
  - 读取扫描得到的候选任务。
  - 为每个任务构造 GitState。
  - synthetic 非 Git worktree 视为 clean；真实 Git root 必须等于 `task.worktreeRoot` 才采用 Git 状态。
  - 输出 JSON 追加 `scanErrors`。

Round 2 fresh verification：

```text
npm test
Test Files  5 passed (5)
Tests       29 passed (29)

npm run typecheck
exit code 0

npm run build
exit code 0
```

Round 2 CLI smoke：

```powershell
node dist/src/cli.js write-current --root <fixture>\project-alpha --task-id task-alpha --phase build
node dist/src/cli.js probe --utterance '继续' --session leader-1 --workspace-root <fixture>
```

Observed probe result：

```json
{
  "schema": "ccpanes.resume-probe.v1",
  "action": "auto_resume",
  "reason": "single_clean_matching_candidate",
  "candidates": [
    {
      "taskId": "task-alpha",
      "status": "clean",
      "ownerMatches": true
    }
  ],
  "scanErrors": []
}
```

Round 2 判断：通过。CLI 已能从 synthetic workspace 只读发现 task candidates，并驱动 resume-probe 给出 `auto_resume`。

## 10. Round 3: Hook batch dry-run acceptance

第三轮目标：让 `dry-run-hook` 支持从 JSON 文件读取 synthetic tool calls，并批量输出 `allow/block/reason`。

新增能力：

- `src/hook-batch.ts`
  - 输入 schema：`ccpanes.hook-dry-run-batch.v1`。
  - 输出 schema：`ccpanes.hook-dry-run-batch-result.v1`。
  - 复用 `decideHookDryRun`。
  - 每条 decision 包含 `index`、`tool`、`targetPath`、`action`、`reason`、`targetInsideWorktree`、`phase`。
  - 对 invalid schema、invalid task、calls 非数组、call 字段类型错误直接报错。
- `dry-run-hook --input <json-file>`
  - 读取 batch JSON。
  - 输出 batch result JSON。
  - 保持单次 `dry-run-hook --root ... --phase ... --target ... --tool ...` 行为。

Round 3 fresh verification：

```text
npm test
Test Files  6 passed (6)
Tests       34 passed (34)

npm run typecheck
exit code 0

npm run build
exit code 0
```

Round 3 CLI smoke：

```powershell
node dist/src/cli.js dry-run-hook --input <fixture>\hook-batch.json
```

Observed decision summary：

```text
index 0: read  -> allow / non_write_call
index 1: write -> allow / build_write_inside_worktree
index 2: write -> block / forbidden_user_config_path
```

Round 3 判断：通过。原型已能将 synthetic hook/tool-call JSON 批量转换为可审计的 allow/block/reason 决策结果。

## 11. Round 4: Acceptance evidence JSON acceptance

第四轮目标：把验收证据从 Markdown 记录升级为机器可读 `ccpanes.acceptance.v1` JSON，绑定 task、artifact hashes、checks。

新增能力：

- `src/acceptance.ts`
  - 输出 schema：`ccpanes.acceptance.v1`。
  - 记录 `taskId`、`worktreeRoot`、`branch`、`head`。
  - 对 artifacts 计算 SHA-256。
  - 记录 checks，result 限定为 `pass|fail|blocked|not-run`。
- `record-acceptance`
  - 参数：`--task <current-task.json>`。
  - 参数：可重复 `--artifact <file>`。
  - 参数：可重复 `--check <name=result=evidence>`。
  - 输出 acceptance JSON 到 stdout，不默认写文件。

Round 4 fresh verification：

```text
npm test
Test Files  7 passed (7)
Tests       37 passed (37)

npm run typecheck
exit code 0

npm run build
exit code 0
```

Round 4 CLI smoke：

```powershell
node dist/src/cli.js write-current --root <fixture>\project-alpha --task-id task-alpha --phase verify
node dist/src/cli.js record-acceptance --task <fixture>\project-alpha\.ccpanes-task\current-task.json --artifact <fixture>\artifact.md --check "unit tests=pass=37 tests passed"
```

Observed evidence summary：

```text
schema: ccpanes.acceptance.v1
taskId: task-alpha
artifactHashes[0].sha256: 604D0789249BBFB3FD63DD5FD410B47C6C6EE3ECD7A325E3DCFA64406A8CBA97
checks[0].result: pass
```

Round 4 判断：通过。原型已能生成可机器读取的验收证据，并把 artifact hash 与 check result 绑定到当前任务。

## 12. Round 5: Acceptance verification acceptance

第五轮目标：让 `ccpanes.acceptance.v1` 证据可被重新校验，判断 artifact hash 是否仍匹配、checks 是否仍全部为 pass。

新增能力：

- `src/acceptance-verify.ts`
  - 输出 schema：`ccpanes.acceptance.verify.v1`。
  - 重新计算每个 artifact 的 SHA-256。
  - 输出 `artifactResults[]`：`match|mismatch|missing`。
  - 输出 `checkResults[]`。
  - 任一 artifact mismatch/missing 或任一 check 非 pass 时 `passed=false`。
- `verify-acceptance --input <acceptance.json>`
  - 读取 acceptance JSON。
  - 输出 verify result JSON 到 stdout。

Round 5 fresh verification：

```text
npm test
Test Files  8 passed (8)
Tests       42 passed (42)

npm run typecheck
exit code 0

npm run build
exit code 0
```

Round 5 CLI smoke：

```powershell
node dist/src/cli.js record-acceptance --task <current-task.json> --artifact <artifact.md> --check "unit tests=pass=42 tests passed"
node dist/src/cli.js verify-acceptance --input <acceptance.json>
```

Observed verify result before artifact mutation：

```text
schema: ccpanes.acceptance.verify.v1
passed: true
artifactResults[0].status: match
failures: []
```

Observed verify result after artifact mutation：

```text
schema: ccpanes.acceptance.verify.v1
passed: false
artifactResults[0].status: mismatch
failures[0]: artifact hash mismatch
```

Round 5 判断：通过。原型已能检测验收证据是否 stale，并能作为发布/交接前的机器门禁基础。

## 13. Round 6: Production smoke and examples acceptance

第六轮目标：把 isolated prototype 打磨成可复现工具包，增加 examples、one-command smoke、README 使用说明和生产门禁。

新增能力：

- `scripts/smoke.mjs`
  - 端到端覆盖 `write-current`、`probe --workspace-root`、`dry-run-hook --input`、`record-acceptance`、`verify-acceptance`。
  - 使用 `.tmp-smoke` synthetic fixture。
  - smoke 成功输出 `SMOKE_PASS`。
  - 失败或成功后都会清理 `.tmp-smoke`。
- `npm run smoke`
  - 固定执行 `node scripts/smoke.mjs`。
- `examples/`
  - `examples/README.md`
  - `examples/hook-batch.json`
  - `examples/artifact.md`
- `README.md`
  - 增加 Quick Start、Commands、Examples、Safety Boundaries、Production Gate。

Round 6 fresh verification：

```text
npm test
Test Files  9 passed (9)
Tests       45 passed (45)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Examples verification：

```powershell
node dist/src/cli.js dry-run-hook --input examples/hook-batch.json
```

Observed examples decision summary：

```text
index 0: read  -> allow / non_write_call
index 1: write -> allow / build_write_inside_worktree
index 2: write -> block / forbidden_user_config_path
```

Round 6 判断：通过。原型现在可通过 `npm run smoke` 一键复现完整链路，并提供 examples 作为手工 dry-run 输入。

## 14. Phase 1: Hook event adapter acceptance

Phase 1 目标：在继续不接入真实 Hook 的前提下，把 generic / Claude-like / Codex-like hook event JSON 适配成现有 `ccpanes.hook-dry-run-batch.v1`，让后续真实 Hook 接入前可以先做事件格式归一化和 dry-run 门禁。

新增能力：

- `src/hook-event-adapter.ts`
  - 支持 synthetic generic event：`ccpanes.hook-event.v1` + `calls[]`。
  - 支持 Claude-like event：`hook_event_name` + `tool_name` + `tool_input`。
  - 支持 Codex-like event：`event` + `tool` + `arguments`。
  - 提取 `targetPath`：`targetPath|path|file_path|filePath|cwd`。
  - `apply_patch` 可从 patch 文本中的 `*** Update File:` / `*** Add File:` / `*** Delete File:` 提取目标文件。
  - `read|grep|glob` 判定 `writes=false`；`edit|write|apply_patch|shell` 判定 `writes=true`。
- `adapt-hook-event --task <current-task.json> --event <hook-event.json>`
  - 校验 `current-task.json`。
  - 读取 hook event JSON。
  - 输出 `ccpanes.hook-dry-run-batch.v1`，可继续送入 `dry-run-hook --input`。
- `scripts/smoke.mjs`
  - 新增 adapter 覆盖：Codex-like `apply_patch` event -> batch -> `dry-run-hook`。
- `examples/hook-events/`
  - `generic-write.json`
  - `claude-edit.json`
  - `codex-apply-patch.json`

Phase 1 fresh verification：

```text
npm test
Test Files  10 passed (10)
Tests       51 passed (51)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed adapter smoke summary：

```text
adapt-hook-event: ccpanes.hook-dry-run-batch.v1
call[0]: apply_patch / writes=true
dry-run adapted batch: allow / verify_minimal_fix_inside_worktree
```

Phase 1 判断：通过。原型已经具备 Hook 事件格式适配层，可作为后续真实 Hook 接入前的稳定 dry-run 前置层；仍未修改用户配置、未执行或注册真实 Hook 二进制。

## 15. Phase 2: Hook runner dry-run stdin acceptance

Phase 2 目标：新增只读 `hook-runner` 入口，支持从 stdin 接收 hook event JSON，并复用 Phase 1 adapter 与既有 hook dry-run 门禁直接输出最终决策；仍不写真实 Hook 配置。

新增能力：

- `src/hook-runner.ts`
  - 输入：`CurrentTask` + hook event JSON。
  - 处理链路：`adaptHookEventToBatch` -> `validateHookDryRunBatch` -> `runHookDryRunBatch`。
  - 输出 schema：`ccpanes.hook-runner-result.v1`。
  - 输出字段：`mode: dry-run`、`taskId`、`allowed`、`batch`、`dryRun`。
  - `allowed=false` 表示至少一条 dry-run decision 为 `block`。
- `hook-runner --task <current-task.json> [--event <event.json>]`
  - 有 `--event` 时读取文件。
  - 无 `--event` 时读取 stdin。
  - 输出完整 hook-runner result JSON。
- `scripts/smoke.mjs`
  - 新增 stdin 覆盖：Claude-like `Edit` event -> `hook-runner --task` -> dry-run allow。
- `examples/hook-runner-event.json`
  - 提供 hook-runner stdin fixture。

Phase 2 fresh verification：

```text
npm test
Test Files  11 passed (11)
Tests       54 passed (54)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed hook-runner smoke summary：

```text
schema: ccpanes.hook-runner-result.v1
mode: dry-run
allowed: true
dryRun.decisions[0].reason: verify_minimal_fix_inside_worktree
```

Phase 2 判断：通过。prototype 已具备可被真实 Hook 管道调用前验证的 stdin dry-run runner；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 16. Phase 3: Hook shadow audit acceptance

Phase 3 目标：新增 shadow wrapper/audit 入口，在真实 Hook 接入前只做审计模拟：读取 event、读取 task、可选读取 upstream hook 二进制元数据，运行 dry-run runner，并输出/可选落盘审计 JSON；不替换、不注册、不执行真实 Hook。

新增能力：

- `src/hook-shadow.ts`
  - 输出 schema：`ccpanes.hook-shadow-audit.v1`。
  - 字段：`mode: shadow`、`createdAt`、`taskId`、`upstreamHook`、`runner`。
  - `upstreamHook` 只记录 `path`、`exists`、`size`、`lastWriteUtc`、`sha256`。
  - upstream hook 元数据读取只使用 stat/read/hash，不执行二进制。
  - `writeHookShadowAuditAtomic` 支持显式 `--out` 原子落盘，并阻止写入用户配置目录和 reference repos。
- `hook-shadow --task <current-task.json> [--event <event.json>] [--upstream-hook <exe>] [--out <audit.json>]`
  - 有 `--event` 时读取文件。
  - 无 `--event` 时读取 stdin。
  - stdout 总是输出 audit JSON。
  - 有 `--out` 时写入同一份 audit JSON。
- `scripts/smoke.mjs`
  - 新增 shadow 覆盖：stdin event -> `hook-shadow --task ... --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out <fixture>\shadow-audit.json`。
  - 断言 upstream SHA-256 与已登记值一致。
- `examples/hook-shadow-event.json`
  - 提供 hook-shadow stdin fixture。

Phase 3 fresh verification：

```text
npm test
Test Files  12 passed (12)
Tests       56 passed (56)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed hook-shadow smoke summary：

```text
schema: ccpanes.hook-shadow-audit.v1
mode: shadow
upstreamHook.sha256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
runner.allowed: true
audit out file: written inside prototype .tmp-smoke fixture
```

Phase 3 判断：通过。prototype 已具备 shadow audit 入口，可先用于真实 Hook 接入前的审计演练；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 17. Phase 4: Review-only hook install plan acceptance

Phase 4 目标：新增真实配置接入前的 install-plan 生成器，只输出待人工审阅的 JSON 计划和 patch candidate 文本；不写入真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-install-plan.ts`
  - 输出 schema：`ccpanes.hook-install-plan.v1`。
  - `mode: review-only`。
  - `target` 支持 `codex|ccpanes|both`。
  - 记录 `prototypeRoot`、`taskId`、`upstreamHook` 元数据、`shadowCommand`。
  - `proposedConfigChanges[]` 只包含 `review_patch_only` patch candidate 文本。
  - `manualChecks[]` 固定列出接入前人工核验项。
  - `writeHookInstallPlanAtomic` 支持显式 `--out` 原子写入，并阻止写入用户配置目录和 reference repos。
- `plan-hook-install --prototype-root <dir> --task <current-task.json> --target <codex|ccpanes|both> --upstream-hook <exe> [--out <plan.json>]`
  - stdout 总是输出 install plan JSON。
  - 有 `--out` 时写入同一份 install plan JSON。
- `scripts/smoke.mjs`
  - 新增 install-plan 覆盖：`--target both` + `skills-hub-hook.exe` + fixture out。
  - 断言 schema、mode、target、upstream SHA-256、proposed changes 数量和 patch candidate 内容。
- `examples/hook-install-plan-request.json`
  - 提供 flag-level request fixture。

Phase 4 fresh verification：

```text
npm test
Test Files  13 passed (13)
Tests       58 passed (58)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed install-plan smoke summary：

```text
schema: ccpanes.hook-install-plan.v1
mode: review-only
target: both
upstreamHook.sha256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
proposedConfigChanges.length: 2
patchCandidate includes: hook-shadow
```

Phase 4 判断：通过。prototype 现在可以生成真实 Hook 接入前的审阅计划，但仍没有写入 `~/.codex`、`~/.claude`、`~/.cc-panes`，也没有执行或注册 `skills-hub-hook.exe`。

## 18. Phase 5: Review-only rollback package acceptance

Phase 5 目标：新增可回滚接入包生成器，基于 Phase 4 install plan 生成完整离线包：manifest、install-plan、rollback-plan、patch candidates、acceptance checklist；仍只写入显式 package 输出目录，不写真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-package.ts`
  - 输出 manifest schema：`ccpanes.hook-package-manifest.v1`。
  - `mode: review-only`。
  - 生成文件：
    - `manifest.json`
    - `install-plan.json`
    - `rollback-plan.json`
    - `patches/codex.patch`
    - `patches/ccpanes.patch`
    - `ACCEPTANCE-CHECKLIST.md`
  - rollback plan schema：`ccpanes.hook-rollback-plan.v1`。
  - rollback plan 记录 config paths、manual rollback steps、verification commands。
  - package 输出目录禁止位于 `~/.codex`、`~/.claude`、`~/.cc-panes` 和 reference repos。
- `create-hook-package --prototype-root <dir> --task <current-task.json> --target <codex|ccpanes|both> --upstream-hook <exe> --out-dir <dir>`
  - stdout 输出 package manifest JSON。
  - 文件全部写入 `--out-dir`。
- `scripts/smoke.mjs`
  - 新增 package 覆盖：`--target both` + `skills-hub-hook.exe` + fixture package dir。
  - 断言 manifest schema、mode、upstream SHA-256、rollback plan、patch 文件存在。
- `examples/hook-package-request.json`
  - 提供 flag-level request fixture。

Phase 5 fresh verification：

```text
npm test
Test Files  14 passed (14)
Tests       60 passed (60)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed package smoke summary：

```text
schema: ccpanes.hook-package-manifest.v1
mode: review-only
upstreamHookSha256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
files include: rollback-plan.json
files exist: manifest.json, patches/codex.patch, patches/ccpanes.patch
```

Phase 5 判断：通过。prototype 现在可以生成可审阅、可回滚的 Hook 接入包；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 19. Phase 6: Hook package dry-run rehearsal acceptance

Phase 6 目标：新增本机 dry-run 接入包验收演练，读取 Phase 5 package，校验 manifest、文件 SHA-256、install-plan、rollback-plan、patch candidates、upstream hook SHA-256，并输出机器可读 rehearsal report；仍不写真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-package-rehearsal.ts`
  - 输出 schema：`ccpanes.hook-package-rehearsal.v1`。
  - `mode: dry-run-rehearsal`。
  - 校验项：
    - `manifest schema`
    - `file hashes`
    - `install plan schema`
    - `rollback plan schema`
    - `patch candidates`
    - `upstream hash`
  - 输出 `passed`、`checks[]`、`failures[]`。
  - `writeHookPackageRehearsalAtomic` 支持显式 `--out` 原子写入，并阻止写入用户配置目录和 reference repos。
- `rehearse-hook-package --package-dir <dir> [--expected-upstream-sha256 <hash>] [--out <report.json>]`
  - stdout 输出 rehearsal report JSON。
  - 有 `--out` 时写入同一份 report JSON。
- `scripts/smoke.mjs`
  - 新增 rehearsal 覆盖：先生成 package，再校验 package。
  - 断言 schema、mode、`passed=true`、`failures=[]`、file hashes/upstream hash pass。
- `examples/hook-package-rehearsal-request.json`
  - 提供 flag-level request fixture。

Phase 6 fresh verification：

```text
npm test
Test Files  15 passed (15)
Tests       62 passed (62)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed rehearsal smoke summary：

```text
schema: ccpanes.hook-package-rehearsal.v1
mode: dry-run-rehearsal
passed: true
failures: []
checks[file hashes]: pass
checks[upstream hash]: pass
```

Phase 6 判断：通过。prototype 现在可以对可回滚接入包做本机 dry-run 验收演练；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 20. Phase 7: Hook release gate acceptance

Phase 7 目标：新增真实接入前最终门禁报告生成器，聚合 package rehearsal、用户配置文件快照、reference repo clean 状态、显式 verification checks，并输出 `release-gate.json`；仍不写真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-release-gate.ts`
  - 输出 schema：`ccpanes.hook-release-gate.v1`。
  - `mode: final-preflight`。
  - 聚合：
    - `packageRehearsal`
    - `configSnapshots[]`
    - `referenceRepos[]`
    - `verificationChecks[]`
    - `checks[]`
    - `failures[]`
  - 门禁检查：
    - package rehearsal must pass
    - config snapshots must exist and have SHA-256
    - reference repos must be clean
    - verification checks must all be `pass`
  - `writeHookReleaseGateAtomic` 支持显式 `--out` 原子写入，并阻止写入用户配置目录和 reference repos。
- `release-gate --package-dir <dir> --expected-upstream-sha256 <hash> --config <path> --repo <path> --check <name=result=evidence> [--out <release-gate.json>]`
  - `--config`、`--repo`、`--check` 可重复。
  - stdout 输出 release gate JSON。
- `scripts/smoke.mjs`
  - 新增 release-gate 覆盖：使用真实 config path 快照、真实 reference repos、显式 smoke check。
  - 断言 schema、mode、`passed=true`、config snapshots、repo clean、verification checks pass。
- `examples/hook-release-gate-request.json`
  - 提供 flag-level request fixture。

Phase 7 fresh verification：

```text
npm test
Test Files  16 passed (16)
Tests       64 passed (64)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed release gate smoke summary：

```text
schema: ccpanes.hook-release-gate.v1
mode: final-preflight
passed: true
configSnapshots.length: 2
referenceRepos: comet=clean, fastctx=clean
checks[verification checks]: pass
```

Phase 7 判断：通过。prototype 现在可以生成真实接入前最终门禁报告；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 21. Phase 8: Staged hook apply-plan acceptance

Phase 8 目标：新增 staged apply-plan 生成器，读取已通过的 `release-gate.json`，在显式输出目录生成待人工审阅/执行的 apply instructions、backup script、rollback script、patch candidates 副本和 apply-plan JSON；仍不写真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-apply-plan.ts`
  - 输出 schema：`ccpanes.hook-apply-plan.v1`。
  - `mode: staged-review`。
  - 前置要求：release gate schema 为 `ccpanes.hook-release-gate.v1` 且 `passed=true`。
  - 生成文件：
    - `apply-plan.json`
    - `APPLY-INSTRUCTIONS.md`
    - `scripts/capture-prechange.ps1`
    - `scripts/restore-from-backup.ps1`
    - `staged-patches/*.patch`
  - artifacts 记录 SHA-256。
  - 输出目录禁止位于 `~/.codex`、`~/.claude`、`~/.cc-panes` 和 reference repos。
- `create-hook-apply-plan --release-gate <release-gate.json> --out-dir <dir>`
  - stdout 输出 apply-plan JSON。
- `scripts/smoke.mjs`
  - 新增 apply-plan 覆盖：先生成 release gate，再生成 staged apply-plan。
  - 断言 schema、mode、releaseGatePassed、backup script artifact、instructions、capture script、staged patch 存在。
- `examples/hook-apply-plan-request.json`
  - 提供 flag-level request fixture。

Phase 8 fresh verification：

```text
npm test
Test Files  17 passed (17)
Tests       66 passed (66)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed apply-plan smoke summary：

```text
schema: ccpanes.hook-apply-plan.v1
mode: staged-review
releaseGatePassed: true
artifacts include: backup-script
files exist: apply-plan.json, APPLY-INSTRUCTIONS.md, scripts/capture-prechange.ps1, staged-patches/codex.patch
```

Phase 8 判断：通过。prototype 现在可以生成真实写配置前的 staged apply-plan；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 22. Phase 9: Hook approval preflight acceptance

Phase 9 目标：新增人工批准包检查器，读取 staged apply-plan 和用户提供的 approval JSON，校验目标 config path、当前 config hash、备份目录、rollback 命令、允许写入窗口、release gate/apply-plan 指纹是否匹配，并输出 approval-check report；仍不写真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-approval.ts`
  - approval schema：`ccpanes.hook-approval.v1`。
  - report schema：`ccpanes.hook-approval-check.v1`。
  - `mode: approval-preflight`。
  - 校验项：
    - `approval schema`
    - `approval intent`
    - `apply plan hash`
    - `release gate hash`
    - `target config paths`
    - `config hashes`
    - `backup directory`
    - `rollback command`
    - `write window`
  - 输出 `passed`、`checks[]`、`failures[]`、`configSnapshots[]`。
  - `writeHookApprovalCheckAtomic` 支持显式 `--out` 原子写入，并阻止写入用户配置目录和 reference repos。
- `check-hook-approval --apply-plan <apply-plan.json> --approval <approval.json> [--out <approval-check.json>]`
  - stdout 输出 approval-check JSON。
- `scripts/smoke.mjs`
  - 新增 approval-check 覆盖：基于 apply-plan 和当前 config hash 生成 synthetic approval fixture，再校验。
  - 断言 schema、mode、`passed=true`、config hashes/write window pass。
- `examples/hook-approval-request.json`
  - 提供 approval JSON shape 和 flag-level request fixture。

Phase 9 fresh verification：

```text
npm test
Test Files  18 passed (18)
Tests       68 passed (68)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed approval-check smoke summary：

```text
schema: ccpanes.hook-approval-check.v1
mode: approval-preflight
passed: true
checks[config hashes]: pass
checks[write window]: pass
```

Phase 9 判断：通过。prototype 现在可以校验人工批准包是否满足真实写配置前置条件；当前仍未修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，也未执行或注册 `skills-hub-hook.exe`。

## 23. Phase 10: Hook write preview dry-run acceptance

Phase 10 目标：新增 dry-run 写入预览器，读取已通过的 approval-check 和 staged apply-plan，生成真实写配置前的 preview artifacts；仍只写入显式 preview 输出目录，不修改 `~/.codex`、`~/.claude`、`~/.cc-panes`，不执行或注册上游 hook。

新增能力：

- `src/hook-write-preview.ts`
  - report schema：`ccpanes.hook-write-preview.v1`。
  - `mode: dry-run-write-preview`。
  - 输入要求：approval-check schema 为 `ccpanes.hook-approval-check.v1` 且 `passed=true`。
  - 读取 apply-plan 的 staged patches 和 target config snapshots。
  - 输出：
    - `write-preview.json`
    - `backup-manifest.json`
    - `before/*.toml`
    - `after/*.toml`
    - `diffs/*.diff`
  - preview 输出目录阻止落入用户配置目录和 reference repos。
- `preview-hook-write --approval-check <approval-check.json> --out-dir <write-preview-dir>`
  - stdout 输出 write-preview JSON。
- `scripts/smoke.mjs`
  - 在 approval-check 之后新增 write-preview 覆盖。
  - 断言 schema、mode、`approvalCheckPassed=true`，并校验 preview、backup、before、after、diff artifacts 存在。
- `examples/hook-write-preview-request.json`
  - 提供 dry-run write preview 的 flag-level request fixture。

Phase 10 验收命令：

```text
npm test
npm run typecheck
npm run build
npm run smoke
```

Phase 10 fresh verification：

```text
npm test
Test Files  19 passed (19)
Tests       70 passed (70)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed write-preview smoke summary：

```text
schema: ccpanes.hook-write-preview.v1
mode: dry-run-write-preview
approvalCheckPassed: true
files exist: write-preview.json, backup-manifest.json, before/*.toml, after/*.toml, diffs/*.diff
```

Isolation evidence：

```text
comet status --short: clean
fastctx status --short: clean
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
```

Phase 10 判断：通过。prototype 现在可以在人工批准通过后生成真实写配置前的 dry-run write preview；当前仅在显式 preview 输出目录生成 artifacts，用户配置内容哈希和大小保持基线一致，reference repos 保持 clean，也未执行或注册 `skills-hub-hook.exe`。

## 24. Phase 11: Hook guarded write apply acceptance

Phase 11 目标：新增受保护的 config 写入执行器，读取 approval-check 与 write-preview，在显式 `--allow-root` 覆盖目标 config 且写前/写后哈希可校验时执行备份、原子写入和写后验证。本阶段 smoke 只写 `.tmp-smoke` synthetic config，不写真实 `~/.codex`、`~/.claude`、`~/.cc-panes`，不执行或注册上游 hook。

新增能力：

- `src/hook-write-apply.ts`
  - report schema：`ccpanes.hook-write-apply.v1`。
  - `mode: guarded-apply`。
  - 输入要求：approval-check schema 为 `ccpanes.hook-approval-check.v1` 且 `passed=true`；write-preview schema 为 `ccpanes.hook-write-preview.v1` 且 `mode=dry-run-write-preview`。
  - `write-preview.approvalCheckPath` 必须匹配传入 approval-check。
  - 目标 config 必须在至少一个显式 `--allow-root` 内。
  - 写入前验证当前 config SHA-256 等于 preview `beforeSha256`。
  - 写入前验证 after preview SHA-256 等于 preview `afterSha256`。
  - 写入顺序：backup -> same-dir temp file -> atomic rename -> readback hash verify。
- `apply-hook-write --write-preview <write-preview.json> --approval-check <approval-check.json> --out <apply-report.json> --allow-root <dir>`
  - stdout 输出 write-apply JSON。
  - `--out` 写 report；backup artifacts 写到 `<apply-report.json>.artifacts/backups/`。
- `scripts/smoke.mjs`
  - 保留真实 config write-preview dry-run 覆盖。
  - 新增 synthetic apply fixture，只写 `.tmp-smoke/synthetic-apply/config.toml`。
- `examples/hook-write-apply-request.json`
  - 提供 guarded synthetic apply 的 flag-level request fixture。

Phase 11 验收命令：

```text
npm test
npm run typecheck
npm run build
npm run smoke
```

Phase 11 fresh verification：

```text
npm test
Test Files  20 passed (20)
Tests       74 passed (74)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed guarded apply smoke summary：

```text
schema: ccpanes.hook-write-apply.v1
mode: guarded-apply
passed: true
target written: .tmp-smoke/synthetic-apply/config.toml
backup exists: true
real user configs written: no
```

Isolation evidence：

```text
comet status --short: clean
fastctx status --short: clean
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
```

Phase 11 判断：通过。prototype 现在具备 guarded apply executor，可在显式 allow-root、approval-check、write-preview、写前哈希和写后哈希全部满足时写入 synthetic config；当前真实用户配置内容哈希和大小保持基线一致，reference repos 保持 clean，也未执行或注册 `skills-hub-hook.exe`。

## 25. Phase 12: Hook guarded restore acceptance

Phase 12 目标：新增受保护的 config 回滚恢复执行器，读取 Phase 11 apply report，在显式 `--allow-root` 覆盖目标 config、当前 config 仍是 apply 后内容、backup 仍匹配 apply 前哈希时，原子恢复 synthetic config 并验证恢复后哈希。本阶段 smoke 只写 `.tmp-smoke` synthetic config，不写真实 `~/.codex`、`~/.claude`、`~/.cc-panes`，不执行或注册上游 hook。

新增能力：

- `src/hook-write-restore.ts`
  - report schema：`ccpanes.hook-write-restore.v1`。
  - `mode: guarded-restore`。
  - 输入要求：apply report schema 为 `ccpanes.hook-write-apply.v1`、`mode=guarded-apply` 且 `passed=true`。
  - 目标 config 必须在至少一个显式 `--allow-root` 内。
  - 恢复前验证当前 config SHA-256 等于 apply report `afterSha256`。
  - 恢复前验证 backup SHA-256 等于 apply report `beforeSha256`。
  - 恢复顺序：read current -> read backup -> same-dir temp file -> atomic rename -> readback hash verify。
- `restore-hook-write --apply-report <hook-write-apply.json> --out <restore-report.json> --allow-root <dir>`
  - stdout 输出 write-restore JSON。
- `scripts/smoke.mjs`
  - synthetic apply 后立即 restore。
  - 断言 schema、mode、`passed=true`，并验证 synthetic config 内容恢复到 before。
- `examples/hook-write-restore-request.json`
  - 提供 guarded synthetic restore 的 flag-level request fixture。

Phase 12 验收命令：

```text
npm test
npm run typecheck
npm run build
npm run smoke
```

Phase 12 fresh verification：

```text
npm test
Test Files  21 passed (21)
Tests       79 passed (79)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed guarded restore smoke summary：

```text
schema: ccpanes.hook-write-restore.v1
mode: guarded-restore
passed: true
target restored: .tmp-smoke/synthetic-apply/config.toml
real user configs written: no
```

Isolation evidence：

```text
comet status --short: clean
fastctx status --short: clean
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
```

Phase 12 判断：通过。prototype 现在具备 guarded restore executor，可在显式 allow-root、apply report、当前 after hash、backup before hash 全部满足时恢复 synthetic config；当前真实用户配置内容哈希和大小保持基线一致，reference repos 保持 clean，也未执行或注册 `skills-hub-hook.exe`。

## 26. Phase 13: Hook production readiness acceptance

Phase 13 目标：新增最终生产就绪门禁聚合器，读取 release-gate、approval-check、write-preview、synthetic apply report、synthetic restore report 五段 evidence，复核 schema、mode、pass 状态、artifact chain、真实 config 当前哈希、reference repos clean、synthetic apply/restore 闭环，并输出唯一判定 artifact：`production-readiness.json`。

新增能力：

- `src/hook-production-readiness.ts`
  - report schema：`ccpanes.hook-production-readiness.v1`。
  - `mode: final-readiness`。
  - 检查项：
    - `release gate`
    - `approval check`
    - `write preview`
    - `synthetic apply`
    - `synthetic restore`
    - `config current hashes`
    - `reference repos`
    - `artifact chain`
  - `ready=true` 仅在所有 checks 为 pass 时成立。
- `production-readiness --release-gate <release-gate.json> --approval-check <approval-check.json> --write-preview <write-preview.json> --apply-report <apply-report.json> --restore-report <restore-report.json> --out <production-readiness.json>`
  - stdout 输出 readiness JSON。
  - `--out` 写入 readiness report。
- `scripts/smoke.mjs`
  - 在真实 config 只读 release/approval/preview 与 synthetic apply/restore 后生成 readiness。
  - 断言 schema、mode、`ready=true`、所有 checks pass。
- `examples/hook-production-readiness-request.json`
  - 提供 final readiness 的 flag-level request fixture。

Phase 13 验收命令：

```text
npm test
npm run typecheck
npm run build
npm run smoke
```

Phase 13 fresh verification：

```text
npm test
Test Files  22 passed (22)
Tests       84 passed (84)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed production readiness smoke summary：

```text
schema: ccpanes.hook-production-readiness.v1
mode: final-readiness
ready: true
checks: all pass
```

Isolation evidence：

```text
comet status --short: clean
fastctx status --short: clean
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
```

Phase 13 判断：通过。prototype 现在具备 final production readiness aggregator，可把 release-gate、approval-check、write-preview、synthetic apply、synthetic restore 五段 evidence 聚合成唯一 readiness artifact；当前真实用户配置内容哈希和大小保持基线一致，reference repos 保持 clean，`skills-hub-hook.exe` 保持哈希基线。

## 27. Phase 14: Go-live approval package acceptance

Phase 14 目标：新增人工授权批准包生成器，读取 `production-readiness.json`，在 `ready=true` 时生成 `go-live-approval-package/`，包含人工批准记录、执行命令清单、证据索引和 manifest。本阶段只生成 package，不执行真实 config 写入、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-go-live-approval.ts`
  - manifest schema：`ccpanes.hook-go-live-approval-package.v1`。
  - `mode: manual-approval-package`。
  - 输入要求：readiness schema 为 `ccpanes.hook-production-readiness.v1`、`mode=final-readiness` 且 `ready=true`。
  - 生成文件：
    - `manifest.json`
    - `GO-LIVE-APPROVAL.md`
    - `COMMANDS.ps1`
    - `EVIDENCE-INDEX.md`
  - `files[]` 只登记可直接校验的派生文件，避免 manifest 自引用哈希。
- `create-go-live-approval-package --readiness <production-readiness.json> --out-dir <dir> --approved-by <name> [--approval-note <note>] [--upstream-hook <path>]`
  - stdout 输出 manifest JSON。
- `scripts/smoke.mjs`
  - 在 production-readiness 后生成 go-live approval package。
  - 断言 schema、mode、manual approval、四个 package 文件存在。
- `examples/hook-go-live-approval-package-request.json`
  - 提供 manual approval package 的 flag-level request fixture。

Phase 14 验收命令：

```text
npm test
npm run typecheck
npm run build
npm run smoke
```

Phase 14 fresh verification：

```text
npm test
Test Files  23 passed (23)
Tests       87 passed (87)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed go-live approval package smoke summary：

```text
schema: ccpanes.hook-go-live-approval-package.v1
mode: manual-approval-package
manualApproval.approved: true
manualApproval.approvedBy: AI001
files exist: manifest.json, GO-LIVE-APPROVAL.md, COMMANDS.ps1, EVIDENCE-INDEX.md
```

Isolation evidence：

```text
comet status --short: clean
fastctx status --short: clean
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
```

Phase 14 判断：通过。prototype 现在具备 go-live approval package generator，可将人工授权批准固化为可审计 package；当前真实用户配置内容哈希和大小保持基线一致，reference repos 保持 clean，`skills-hub-hook.exe` 保持哈希基线且未执行。

## 28. Phase 15: Final manual runbook acceptance

Phase 15 目标：新增最终人工执行 runbook 生成器，读取已经人工批准的 `go-live-approval-package/manifest.json`，生成人工执行前后的只读检查脚本、逐配置写入顺序、回滚条件和回滚 checklist。本阶段只生成 runbook artifacts，不执行 pre/post-flight 脚本、不写真实用户配置、不注册 Hook、不执行上游 hook。

新增能力：

- `src/hook-final-runbook.ts`
  - manifest schema：`ccpanes.hook-final-runbook.v1`。
  - `mode: manual-execution-runbook`。
  - 输入要求：go-live manifest schema 为 `ccpanes.hook-go-live-approval-package.v1`、`mode=manual-approval-package`、`manualApproval.approved=true` 且 readiness ready。
  - 输出目录防护：拒绝写入用户配置根和参考仓库根。
  - 生成文件：
    - `manifest.json`
    - `FINAL-RUNBOOK.md`
    - `PRE-FLIGHT.ps1`
    - `POST-FLIGHT.ps1`
    - `ROLLBACK-CHECKLIST.md`
- `create-final-runbook --go-live-manifest <go-live-approval-package/manifest.json> --out-dir <final-runbook-dir>`
  - stdout 输出 final runbook manifest JSON。
- `scripts/smoke.mjs`
  - 在 go-live approval package 后生成 final runbook。
  - 断言 schema、mode、五个 runbook 文件存在。
  - 断言 `FINAL-RUNBOOK.md` 包含 `Write pre-flight snapshot`、`Apply one config at a time`、`Rollback condition`。
- `examples/hook-final-runbook-request.json`
  - 提供 final manual runbook 的 flag-level request fixture。
- 文档更新：
  - `README.md`
  - `examples/README.md`

Phase 15 验收命令：

```text
npm test
npm run typecheck
npm run build
npm run smoke
```

Phase 15 fresh verification：

```text
npm test
Test Files  24 passed (24)
Tests       90 passed (90)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Observed final runbook smoke summary：

```text
schema: ccpanes.hook-final-runbook.v1
mode: manual-execution-runbook
files exist: manifest.json, FINAL-RUNBOOK.md, PRE-FLIGHT.ps1, POST-FLIGHT.ps1, ROLLBACK-CHECKLIST.md
FINAL-RUNBOOK.md contains: Write pre-flight snapshot, Apply one config at a time, Rollback condition
```

Isolation evidence：

```text
comet status --short: clean
fastctx status --short: clean
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
.tmp-smoke exists after smoke: false
```

Phase 15 判断：通过。prototype 现在具备 final manual runbook generator，可把已批准 go-live package 转换成可人工执行、可回滚、可复核的最终 runbook；当前真实用户配置内容哈希和大小保持基线一致，reference repos 保持 clean，`skills-hub-hook.exe` 保持哈希基线且未执行。

## 29. Phase 16: Codex live hook go-live acceptance

Phase 16 目标：在用户明确给出“人工授权批准”后，把任务边界检查以 Codex 官方 hook 形态接入真实 Codex 用户 hooks 层。接入点选择 `C:\Users\AI001\.codex\hooks.json`，保留既有 `UserPromptSubmit` skills-hub hook，只新增 `PreToolUse` / `^apply_patch$` 的 `hook-enforce` 命令。未写入 `C:\Users\AI001\.codex\config.toml`，未写入 `C:\Users\AI001\.cc-panes\config.toml`，未执行 `skills-hub-hook.exe`。

官方 Codex hook 依据：

```text
Codex manual fetched: C:\Users\AI001\AppData\Local\Temp\openai-docs-cache\codex-manual.md
Relevant section: Hooks
Config sources: ~/.codex/hooks.json and ~/.codex/config.toml
PreToolUse deny output: hookSpecificOutput.hookEventName=PreToolUse, permissionDecision=deny
```

新增能力：

- `src/hook-event-adapter.ts`
  - 支持 Codex `tool_name: "Bash"` 映射到内部 `shell`。
- `src/cli.ts`
  - 新增 `hook-enforce --task <current-task.json> [--event <event.json>] [--audit-out <audit.json>]`。
  - 如果 hook event 的 `cwd` 不在当前 task worktree 内，直接 no-op，避免全局用户 hook 影响其它工作区。
  - 允许时 stdout 为空。
  - 阻断时 stdout 输出 Codex `PreToolUse` deny JSON。
  - 可选写入 audit artifact，便于 post-flight 复核。
- `tests/cli.test.ts`
  - 覆盖 blocked write 输出 deny JSON。
  - 覆盖 cwd outside task worktree 时 no-op。
- 文档更新：
  - `README.md`
  - `examples/README.md`

真实接入写入：

```text
Modified: C:\Users\AI001\.codex\hooks.json
Added event: hooks.PreToolUse
Matcher: ^apply_patch$
Command:
node "D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js" hook-enforce --task "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\current-task.json" --audit-out "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\hook-enforce-audit.json"
Status message: CC-Panes task boundary check
```

Go-live artifacts：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\preflight-snapshot.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\postflight-snapshot.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\hooks.json.before.bak
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\hooks.json.after
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\current-task.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\verify-allowed-audit.json
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\verify-blocked-audit.json
```

Focused live-entry verification：

```text
npm test -- tests/cli.test.ts tests/hook-event-adapter.test.ts
Test Files  2 passed (2)
Tests       32 passed (32)

npm run typecheck
exit code 0

npm run build
exit code 0

Direct hook-enforce verification:
allowed event inside D:\cc-pane: stdout length 0, audit written
blocked config write inside D:\cc-pane: deny JSON emitted, reason contains forbidden_user_config_path, audit written
outside cwd event: stdout length 0, audit not written

Full post-go-live verification:
npm test
Test Files  24 passed (24)
Tests       92 passed (92)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Post-write config evidence：

```text
C:\Users\AI001\.codex\hooks.json size: 1381, SHA-256: 443514CE6AF876F08F50856AF1BD5CE1834FDC88D3779B26492A92351031C4F0
C:\Users\AI001\.codex\config.toml size: 16128, SHA-256: C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61
C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256: A9EE049462C99C8B6DFC5642DB24E594B1876B8A6461D0A55221D532BE721280
skills-hub-hook.exe SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
comet status --short: clean
fastctx status --short: clean
.tmp-smoke exists after smoke: false
```

Phase 16 判断：通过。真实 Codex 用户 hooks 层已经接入 `hook-enforce`，适用于 Codex CLI 和 Codex app 读取同一 `~/.codex/hooks.json` 的场景；新 hook 限定为 `PreToolUse` / `apply_patch`，且事件 cwd 不在 `D:\cc-pane` 时 no-op，降低全局用户 hook 的外溢影响。Codex 仍会按官方机制要求通过 `/hooks` 复核并信任新增 hook 定义后才持续运行。

## 30. Phase 17: New Codex CLI live execution verification

Phase 17 目标：按用户要求新开一个 Codex CLI 会话，从真实 Codex CLI hook discovery、trust、`PreToolUse` 执行链路验证 Phase 16 接入，不只调用本地 CLI 函数。

新开 Codex CLI 会话：

```text
sessionId: 46d0e26a-a063-4ac4-949d-5d6cb050366c
projectPath: D:\cc-pane
runtimeKind: local
Codex version observed: v0.146.1
model observed: gpt-5.5 high
permissions observed: YOLO mode
```

Hook discovery / trust 验证：

```text
Initial Codex CLI output:
Hooks need review
1 hook is new or changed

/hooks screen before trust:
PreToolUse Installed=1 Active=0 Review=1
UserPromptSubmit Installed=1 Active=1 Review=0

After pressing trust-all:
PreToolUse Installed=1 Active=1
UserPromptSubmit Installed=1 Active=1
UserPromptSubmit hook completed with context:
C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
```

第一次真实执行探针发现的问题：

```text
allowed apply_patch was blocked with:
ccpanes-task-probe: write_without_target_path

blocked user config probe was also blocked with:
ccpanes-task-probe: write_without_target_path
```

根因：Codex `PreToolUse` 对 `apply_patch` 的实际 payload 使用 `tool_input.command` 承载 patch text；原 adapter 只读取 `tool_input.patch`。

修复：

```text
src/hook-event-adapter.ts
- apply_patch now extracts patch text from input.patch ?? input.command

tests/hook-event-adapter.test.ts
- added Codex apply_patch command-field fixture
```

修复后重新 build 并在同一新 Codex CLI 会话复测：

```text
Allowed probe:
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\codex-cli-allowed-probe.txt
Result: success
Content: allowed probe

Blocked probe:
C:\Users\AI001\.codex\__ccpanes_hook_probe_should_be_blocked.tmp
Result: blocked by PreToolUse hook
Reason: ccpanes-task-probe: forbidden_user_config_path
File exists after probe: false
```

Final hook audit artifact:

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\codex-hook-go-live\hook-enforce-audit.json
schema: ccpanes.hook-runner-result.v1
allowed: false
targetPath: C:\Users\AI001\.codex\__ccpanes_hook_probe_should_be_blocked.tmp
decision.action: block
decision.reason: forbidden_user_config_path
```

Final verification：

```text
npm test
Test Files  24 passed (24)
Tests       93 passed (93)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Final isolation / config evidence：

```text
comet status --short: clean
fastctx status --short: clean

C:\Users\AI001\.codex\hooks.json SHA-256:
443514CE6AF876F08F50856AF1BD5CE1834FDC88D3779B26492A92351031C4F0

C:\Users\AI001\.codex\config.toml size: 16284, SHA-256:
C11144BC931A85FBA44B5036B088B5206E4CAC20EB6E76AB1241A96F21945E34

C:\Users\AI001\.cc-panes\config.toml size: 3660, SHA-256:
1DA33C211890827883D2311BF968A5F2C5CBB07B0372820917EB6C569B752C04

C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe SHA-256:
F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
```

Config hash note：

```text
C:\Users\AI001\.codex\config.toml changed during Codex CLI trust flow because Codex recorded:
[hooks.state.'C:\Users\AI001\.codex\hooks.json:pre_tool_use:0:0']
trusted_hash = "sha256:f8cd360afc69c96f9e5f7cc719076e055c02f8df961ec262c4b8b959b7e77034"

C:\Users\AI001\.cc-panes\config.toml hash also changed while using CC-Panes to launch/drive the verification session. No hook write was applied to that file in the task-probe path.
```

Phase 17 判断：通过。新开的 Codex CLI 真实识别并信任了新增 `PreToolUse` hook；真实 `apply_patch` allowed probe 成功写入 task worktree 内 artifact，真实 forbidden 用户配置 probe 被 hook 拒绝且目标文件未生成。当前 hook 可用于 Codex CLI 实际执行链路；由于配置在用户级 `~/.codex/hooks.json`，Codex app 使用同一 Codex 用户配置层时也会加载同一 hook。

## 31. Phase 18: Dynamic task resolver / multi-project bootstrap acceptance

Phase 18 目标：把 Phase 17 的固定 `--task <live/current-task.json>` hook 升级为方案 B：用户级 Codex hook 只作为 dispatcher，运行时根据 hook event 的 `cwd` 向上查找最近的 `<project>\.ccpanes-task\current-task.json`。每个项目在启动、接手或 plan 阶段写入自己的 `current-task.json` 后即可自动启用边界检查；没有 task 文件的项目自动 no-op。

架构决策：

```text
State authority:
<project>\.ccpanes-task\current-task.json

Runtime resolver:
hook event cwd -> parent walk -> nearest .ccpanes-task/current-task.json

No task found:
stdout empty, no audit, no hook decision

Task found:
use task.worktreeRoot as write boundary, emit Codex deny JSON only for blocked calls
```

新增/变更能力：

- `src/current-task.ts`
  - 新增 `resolveCurrentTaskFromCwd(cwd)`。
  - 从 `cwd` 向上查找 `.ccpanes-task/current-task.json`，复用现有 16KB 上限和 schema 校验。
- `src/cli.ts`
  - `hook-enforce` 新增：
    - `--resolve-task-from-cwd`
    - `--audit-root <dir>`
  - `--task` 仍保留，用于固定 task / 测试模式。
  - `--audit-root` 会输出到 `<audit-root>/<base64url(taskId)>/hook-enforce-audit.json`。
- `tests/cli.test.ts`
  - 覆盖 nested cwd 向上找到项目 current-task。
  - 覆盖无 current-task ancestor 时 no-op 且不写 audit。
- `scripts/smoke.mjs`
  - smoke 改用 `--resolve-task-from-cwd --audit-root` 覆盖动态 resolver。
- `D:\cc-pane\AGENTS.md`
  - 新增项目启动/规划时写入 `.ccpanes-task/current-task.json` 的规则和命令。
- `README.md` / `examples/README.md`
  - 增加多项目 hook bootstrap 文档。

真实配置变更：

```text
Modified:
C:\Users\AI001\.codex\hooks.json

PreToolUse command:
node "D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js" hook-enforce --resolve-task-from-cwd --audit-root "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits"

Initialized:
D:\cc-pane\.ccpanes-task\current-task.json
taskId: cc-pane-dynamic-hook-root
phase: build
```

Direct dynamic resolver verification：

```text
allowed event cwd=D:\cc-pane:
stdout length 0

blocked event cwd=D:\cc-pane target=C:\Users\AI001\.codex\config.toml:
deny JSON emitted
reason contains forbidden_user_config_path

orphan event cwd=D:\:
stdout length 0
```

New Codex CLI live verification：

```text
sessionId: 9ff9948b-984b-4f14-9794-537ef50dc321
projectPath: D:\cc-pane

Initial:
Hooks need review
PreToolUse Installed=1 Active=0 Review=1

After trust:
PreToolUse Installed=1 Active=1
UserPromptSubmit Installed=1 Active=1
```

Live dynamic resolver probes：

```text
Allowed probe:
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-hook-go-live\dynamic-codex-cli-allowed.txt
Result: apply_patch success
Content: dynamic allowed

Blocked probe:
C:\Users\AI001\.codex\__dynamic_hook_block_probe.tmp
Result: blocked by PreToolUse hook
Reason: ccpanes-task-probe: forbidden_user_config_path
File exists after probe: false
```

Final verification：

```text
npm test
Test Files  24 passed (24)
Tests       95 passed (95)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS
```

Final isolation / hash evidence：

```text
comet status --short: clean
fastctx status --short: clean

C:\Users\AI001\.codex\hooks.json size: 1159
SHA-256: E674A62FC567E03BAAB5F277BA6E8532F5D5510BD3B1194477472F25AF9261BE

C:\Users\AI001\.codex\config.toml size: 16284
SHA-256: A6497D7FB573DCBFA839A05ADFAE40241F6613517D0AABC63F0EA56581AC6450

C:\Users\AI001\.cc-panes\config.toml size: 3660
SHA-256: 40432662D0905E4443CCDA5B90D21D079E32AABD8983863A13ABF0E37B7F0836

C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4

D:\cc-pane\.ccpanes-task\current-task.json
SHA-256: 302A0118493F06F2C732FEF28DF87356B5CDD959BBE97CECB51242B7BD786464
```

Phase 18 判断：通过。现在其它项目要使用 hook 的完整边界能力，不需要改全局 hook；只要在项目根写入 `.ccpanes-task/current-task.json`，Codex 在该项目 `cwd` 下触发 `apply_patch` 时会自动使用该项目的任务边界。没有初始化 current-task 的项目保持 no-op。

## Phase 19 — PreToolUse 多工具覆盖与实机验收

日期：2026-08-07  
计划文件：`D:\cc-pane\tool\plans\CCPANES-TASK-PROBE-PHASE19-PRETOOLUSE-FULL-COVERAGE-PLAN.md`

Phase 19 目标：把动态 `PreToolUse` dispatcher 从 `apply_patch` 单点扩展为多工具覆盖，并保持项目级 `.ccpanes-task/current-task.json` 自动解析。

新增/变更能力：

```text
hook matcher:
^(apply_patch|Edit|Write|Bash|shell|shell_command|functions\.shell_command|mcp__fastctx__(read|grep|glob|replace))$

event adapter:
- 支持 Codex/Claude-like Edit、Write、apply_patch。
- 支持 Bash / shell / shell_command / functions.shell_command。
- 支持 FastCtx MCP read/grep/glob/replace。
- 支持 files=[{path: ...}] 多目标展开。

shell analyzer:
- 识别常见只读验证命令：npm test、typecheck/lint/check、git status/diff/log/show、Get-FileHash 等。
- 提取 PowerShell Set-Content/Add-Content/Out-File/New-Item/Move-Item/Copy-Item/Remove-Item 等目标路径。
- 提取 shell redirection 目标路径。
- 阻断 destructive git reset/clean、rm -rf、Remove-Item -Recurse、global install、git push。
- 阻断 node/python inline filesystem mutation。
```

第一轮真实 Codex CLI 验证暴露的问题：

```text
sessionId: 455281ae-cbbd-4abb-84c1-4ece5ef3c884
PreToolUse Installed=1 Active=0 Review=1

Result:
- apply_patch allowed path: pass
- shell allowed path: pass
- shell write to C:\Users\AI001\.codex\__phase19_hook_block_probe.tmp: fail; hook was not trusted, file was created
- git reset --hard HEAD: fail; hook was not active, git itself returned "not a git repository"

Recovery:
- C:\Users\AI001\.codex\__phase19_hook_block_probe.tmp was removed after exact-path verification.
- Analyzer was extended with interpreter_filesystem_mutation detection.
```

第二轮真实 Codex CLI 验证：

```text
sessionId: 455281ae-cbbd-4abb-84c1-4ece5ef3c884
PreToolUse Installed=1 Active=1

Allowed:
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\phase19-real-validation\codex-apply-patch-active.txt
content: phase19 apply_patch active allowed

D:\cc-pane\tool\experiments\ccpanes-task-probe\live\phase19-real-validation\shell-active-allowed.txt
content: phase19 shell active allowed

Blocked:
C:\Users\AI001\.codex\__phase19_hook_block_probe.tmp
Reason: ccpanes-task-probe: forbidden_user_config_path
File exists after probe: false

Blocked:
git reset --hard HEAD
Reason: ccpanes-task-probe: destructive_git_reset_hard

Blocked:
node -e require('fs').writeFileSync(...)
Reason: ccpanes-task-probe: interpreter_filesystem_mutation
C:\Users\AI001\.codex\__phase19_node_bypass_probe.tmp exists after probe: false
```

Phase 19 判断：通过。当前全局 Codex hook 已从单一 `apply_patch` 扩展到常用写入工具、shell 命令和 FastCtx MCP 文件工具；未初始化 `.ccpanes-task/current-task.json` 的项目仍 no-op，已初始化项目按 task worktree 边界执行门禁。

Final Phase 19 verification：

```text
npm test
Test Files  25 passed (25)
Tests       112 passed (112)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS

record-acceptance / verify-acceptance
passed: true
failures: []
```

Final Phase 19 isolation / hash evidence：

```text
comet status --short: clean
fastctx status --short: clean

C:\Users\AI001\.codex\hooks.json size: 1262
SHA-256: B9E741ADB79F4FFBF85F415CE3767E4FCD3F4ED7BE1DAF395EA0A100B9C6DA6E

C:\Users\AI001\.codex\config.toml size: 16284
SHA-256: B4B41CA3E3EFA82D4BD4915C1600DE33D412DE310230937CE1C2A8E3E0B39EC0

C:\Users\AI001\.cc-panes\config.toml size: 3660
SHA-256: 40432662D0905E4443CCDA5B90D21D079E32AABD8983863A13ABF0E37B7F0836

C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4

Forbidden probes:
C:\Users\AI001\.codex\__phase19_hook_block_probe.tmp exists: false
C:\Users\AI001\.codex\__phase19_node_bypass_probe.tmp exists: false
```

## 21. Phase 22: SessionStart / Stop lifecycle acceptance

第二十二阶段目标：补齐 Codex lifecycle 起止上下文。`SessionStart` 在新会话、恢复、清空和压缩后注入当前任务与审计路径；`Stop` 在一轮结束前给出非阻塞验收提醒，不创建 continuation prompt。

计划文件：

```text
D:\cc-pane\tool\plans\CCPANES-TASK-PROBE-PHASE22-SESSIONSTART-STOP-PLAN.md
```

新增/变更能力：

```text
CLI:
session-start --resolve-task-from-cwd --audit-root <audit-root>
stop-check --resolve-task-from-cwd --audit-root <audit-root>

SessionStart behavior:
- dynamic resolver 复用 <project>\.ccpanes-task\current-task.json。
- 输出 hookSpecificOutput.hookEventName = "SessionStart"。
- 输出 hookSpecificOutput.additionalContext，包含 taskId、phase、worktreeRoot、currentTaskPath、auditDir、post-tool-use-audit.jsonl 和生产验收门禁。
- 无 current-task 时 stdout empty。

Stop behavior:
- dynamic resolver 复用 <project>\.ccpanes-task\current-task.json。
- 输出 JSON systemMessage 和 continue=true。
- 不输出 decision:block，不触发自动 continuation prompt。
- 无 current-task 时 stdout empty。
```

Codex hooks.json 新增：

```text
Event: SessionStart
Matcher:
^(startup|resume|clear|compact)$

Command:
node "D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js" session-start --resolve-task-from-cwd --audit-root "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits"

statusMessage:
CC-Panes task lifecycle context

additionalContextLimit:
1200

Event: Stop
Command:
node "D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js" stop-check --resolve-task-from-cwd --audit-root "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits"

statusMessage:
CC-Panes completion gate reminder
```

官方 Codex manual 依据：

```text
C:\Users\AI001\AppData\Local\Temp\openai-docs-cache\codex-manual.md
Hooks section:
- SessionStart matcher applies to source: startup, resume, clear, compact.
- SessionStart JSON supports hookSpecificOutput.additionalContext.
- Stop matcher is not supported.
- Stop expects JSON stdout when non-empty.
- Stop JSON supports common output fields; decision:block would create a continuation prompt, so Phase 22 intentionally uses continue=true + systemMessage only.
```

真实 Codex CLI 验证：

```text
sessionId: 5e077c34-f6f3-4160-96fd-6b6fa9b341af

Hook discovery/trust:
- SessionStart Installed=1, Active=1
- Stop Installed=1, Active=1
- PreToolUse Installed=1, Active=1
- PermissionRequest Installed=1, Active=1
- PostToolUse Installed=1, Active=1

Stop runtime evidence:
Running Stop hook: CC-Panes completion gate reminder
Stop (completed) says:
ccpanes-task-probe cc-pane-dynamic-hook-root (build): before claiming completion,
run applicable checks such as npm test, npm run typecheck, npm run build,
npm run smoke; inspect diff/status and reference repos; then record-acceptance
and verify-acceptance.
```

Direct lifecycle fixture：

```text
SessionHook: SessionStart
SessionHasTaskId: true
SessionHasPostAudit: true
StopContinue: true
StopHasDecision: false
StopHasAcceptance: true
```

Phase 22 final verification：

```text
npm test
Test Files  27 passed (27)
Tests       127 passed (127)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS

record-acceptance / verify-acceptance
passed: true
failures: []
```

Phase 22 acceptance artifact：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\phase22-acceptance\acceptance.json
SHA-256: CBF65912CA648E18341D656B2ED718F980B13BB8676D52FB4E1833FC25C7FA0A
```

Phase 22 isolation / hash evidence：

```text
comet status --short: clean
fastctx status --short: clean

C:\Users\AI001\.codex\hooks.json
before size: 2968
before SHA-256: 8E665E6C7E64F823DEC7AD31D6278CBB6E8464654E7D06BDC161333EE73AC213
after size: 4380
after SHA-256: B1091E063DAAEE64121A7BE52DCC39AD304D91CAD39C562FEB8E9CF41D05E4AC

C:\Users\AI001\.codex\config.toml
before size: 16603
before SHA-256: AF0BA56A49D3065618E2C3CF394411A41F6D4C57EB53693EFBC26477D24A1116
after size: 16908
after SHA-256: B9CD8EE35BBCF98282531541170C67D3E1B160032FDB1E078E03F62480E9A50A
note: config.toml changed during Codex hook trust; added trusted hashes for session_start and stop.

C:\Users\AI001\.cc-panes\config.toml
size: 3660
SHA-256: 40432662D0905E4443CCDA5B90D21D079E32AABD8983863A13ABF0E37B7F0836

C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
size: 2779136
SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
```

Phase 22 判断：通过。当前工具层已覆盖 `SessionStart`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`Stop` 五个关键 Hook 点；任意已写入 `<project>\.ccpanes-task\current-task.json` 的项目会自动获得任务上下文、执行前门禁、权限请求门禁、执行后审计和结束前验收提醒。

## 22. Phase 23: Production toolkit acceptance

第二十三阶段目标：把 Phase 18–22 的原型能力收敛成可重复交付的生产工具包，新增只读安装自检、可审查安装脚本、项目 bootstrap 脚本、回滚脚本和工具包 manifest。

计划文件：

```text
D:\cc-pane\tool\plans\CCPANES-TASK-PROBE-PHASE23-PRODUCTION-TOOLKIT-PLAN.md
```

新增能力：

```text
CLI:
verify-installed-hooks --hooks-json <hooks.json> --prototype-root <root> --audit-root <audit-root> [--config <config.toml>]
create-production-toolkit --out-dir <dir> --prototype-root <root> --audit-root <audit-root> --hooks-json <hooks.json> [--config <config.toml>]

Generated toolkit:
INSTALL-HOOKS.ps1
VERIFY-INSTALLED.ps1
BOOTSTRAP-PROJECT.ps1
ROLLBACK-HOOKS.ps1
PRODUCTION-README.md
manifest.json
```

真实安装只读自检：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\phase23-installed-hooks-verify.json
schema: ccpanes.installed-hooks.verify.v1
passed: true
discovered: 5
failures: 0
SHA-256: AF6B7B40290483CBC882F59BA961BC82FFAB57CA78300D681557F396C97AEF48
```

生产工具包 artifact：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\phase23-production-toolkit\manifest.json
schema: ccpanes.production-toolkit-manifest.v1
files: 5
file hashes match: true
SHA-256: 44FAF3A5C4BB2DA467E584529699A22776D9BB415FF95BB06BC11D0FBF6805C1

INSTALL-HOOKS.ps1
SHA-256: B7C4EC4E1B72E85C2F16097039D1BDF896B7AF950A02AEB708DBD6382AE04185

VERIFY-INSTALLED.ps1
SHA-256: FF42302E9F5051F68C6B7E2100F84DCE2078F9A5A874CD689C57499E1B119DA1

BOOTSTRAP-PROJECT.ps1
SHA-256: FC0E9080B5D3D38DA2E1269517563FD216A719602207F793A39C3A2F9FE6942C

ROLLBACK-HOOKS.ps1
SHA-256: 1046FE40020D76E27072686DA10F50A964065934EDBFD75CE8192BBF2A7E57C4

PRODUCTION-README.md
SHA-256: 2800BC52B68B8D1FEEF2A54BEBD084FEAE65F17A3291685D6FB2B54FD1AAEFD5
```

Phase 23 final verification：

```text
npm test
Test Files  29 passed (29)
Tests       134 passed (134)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS

record-acceptance / verify-acceptance
passed: true
failures: []
```

Phase 23 acceptance artifact：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\phase23-acceptance\acceptance.json
SHA-256: 0F5D2C686B231A2ED4E9873E043AD7C8B6ACF3CEC9CCF9DE1DC4C0A29F2E5872
```

Phase 23 isolation / hash evidence：

```text
comet status --short: clean
fastctx status --short: clean

C:\Users\AI001\.codex\hooks.json
size: 4380
SHA-256: B1091E063DAAEE64121A7BE52DCC39AD304D91CAD39C562FEB8E9CF41D05E4AC

C:\Users\AI001\.codex\config.toml
size: 16908
SHA-256: B9CD8EE35BBCF98282531541170C67D3E1B160032FDB1E078E03F62480E9A50A

C:\Users\AI001\.cc-panes\config.toml
size: 3660
SHA-256: 40432662D0905E4443CCDA5B90D21D079E32AABD8983863A13ABF0E37B7F0836

C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
size: 2779136
SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
```

Phase 23 判断：通过。当前交付物已从“已上线原型”升级为“可重复安装/自检/回滚/项目 bootstrap 的生产工具包”。本阶段未执行 `skills-hub-hook.exe`，未写用户级配置，未触碰引用仓库。

## Phase 21 — PostToolUse 执行后审计

日期：2026-08-07  
计划文件：`D:\cc-pane\tool\plans\CCPANES-TASK-PROBE-PHASE21-POSTTOOLUSE-AUDIT-PLAN.md`

Phase 21 目标：为 Codex `PostToolUse` 增加执行后审计。该 hook 只追加 JSONL 证据，不输出 stdout，不阻断、不改写 Codex 原工具结果。

新增/变更能力：

```text
CLI:
post-enforce --resolve-task-from-cwd --audit-root <audit-root>

Behavior:
- dynamic resolver 复用 <project>\.ccpanes-task\current-task.json。
- 有 task 的 cwd：追加审计记录。
- 无 task / cwd 不在 task worktree：no-op。
- stdout empty，保持 Codex 原 tool result 流。
- tool_input / tool_response 进行摘要裁剪。

Audit path:
<audit-root>/<base64url(taskId)>/post-tool-use-audit.jsonl
```

Codex hooks.json 新增：

```text
Event: PostToolUse
Matcher:
^(apply_patch|Edit|Write|Bash|shell|shell_command|functions\.shell_command|mcp__fastctx__(read|grep|glob|replace))$

Command:
node "D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js" post-enforce --resolve-task-from-cwd --audit-root "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits"

statusMessage:
CC-Panes post tool audit
```

真实 Codex CLI 验证：

```text
sessionId: 751dad37-d4d2-4ab1-913f-60d51faa0340

Hook trust:
- startup showed "Hooks need review"
- trusted changed hook set

Observed audit:
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits\Y2MtcGFuZS1keW5hbWljLWhvb2stcm9vdA\post-tool-use-audit.jsonl

LineCount: 6
Last record:
schema: ccpanes.post-tool-use-audit.v1
taskId: cc-pane-dynamic-hook-root
cwd: D:\cc-pane
toolName: mcp__fastctx__read
toolUseId: call_XDjtrGU92fl6zsQ4mycWWPLz
observedAt: 2026-08-06T17:13:47.127Z
responseSummary: string summary present
```

Note: worker terminal output entered a repeated "Working" rendering loop after the audit evidence was produced, so it was interrupted with Ctrl+C. The acceptance evidence for Phase 21 is the actual JSONL audit file and parsed last-record fields above.

Phase 21 判断：通过。当前工具已具备三层生产能力：`PreToolUse` 执行前阻断、`PermissionRequest` 权限请求二阶段 deny/no-decision、`PostToolUse` 执行后 append-only 审计。

## Phase 20 — PermissionRequest 二阶段门禁

日期：2026-08-07  
计划文件：`D:\cc-pane\tool\plans\CCPANES-TASK-PROBE-PHASE20-PERMISSIONREQUEST-GATE-PLAN.md`

Phase 20 目标：在 Phase 19 `PreToolUse` 预执行阻断之外，新增 Codex `PermissionRequest` 二阶段门禁。该门禁只对 dry-run 判定为 blocked 的权限请求输出官方 deny shape；对允许类请求输出空字符串，让 Codex 保持默认审批流，不自动批准提权。

官方协议核验来源：

```text
C:\Users\AI001\AppData\Local\Temp\openai-docs-cache\codex-manual.md
Hooks section:
- PermissionRequest matcher applies to tool_name and aliases.
- PermissionRequest deny shape:
  hookSpecificOutput.hookEventName = "PermissionRequest"
  hookSpecificOutput.decision.behavior = "deny"
  hookSpecificOutput.decision.message = "<reason>"
- If no hook decides, Codex uses the normal approval flow.
```

新增/变更能力：

```text
CLI:
permission-enforce --resolve-task-from-cwd --audit-root <audit-root>

Behavior:
- dynamic resolver 复用 <project>\.ccpanes-task\current-task.json。
- blocked decision -> PermissionRequest deny JSON。
- allowed decision -> stdout empty，不自动 allow。
- audit:
  <audit-root>/<base64url(taskId)>/permission-enforce-audit.json
```

Codex hooks.json 新增：

```text
Event: PermissionRequest
Matcher:
^(apply_patch|Edit|Write|Bash|shell|shell_command|functions\.shell_command|mcp__fastctx__(read|grep|glob|replace))$

Command:
node "D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js" permission-enforce --resolve-task-from-cwd --audit-root "D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits"

statusMessage:
CC-Panes permission request boundary check
```

真实 Codex CLI 验证：

```text
sessionId: 6c23bf4d-0665-4eb3-9b89-c8660c9536db

Hook discovery/trust:
- PermissionRequest Installed=1, Active=1, Review=0 after trust
- PreToolUse Installed=1, Active=1

deny fixture:
hook_event_name: PermissionRequest
tool_name: Bash
tool_input.command: git reset --hard HEAD
Result: pass
Output:
hookSpecificOutput.hookEventName = "PermissionRequest"
decision.behavior = "deny"
message contains destructive_git_reset_hard

no-decision fixture:
hook_event_name: PermissionRequest
tool_name: Bash
tool_input.command: npm test
Result: pass
stdout: empty
No automatic allow decision emitted

Audit:
D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits\Y2MtcGFuZS1keW5hbWljLWhvb2stcm9vdA\permission-enforce-audit.json
```

Phase 20 判断：通过。当前工具已经具备双层门禁：`PreToolUse` 在工具执行前阻断已识别风险；`PermissionRequest` 在 Codex 即将请求权限审批时再次 fail-closed，并且不会自动批准可通过请求。

Final Phase 20 verification：

```text
npm test
Test Files  25 passed (25)
Tests       115 passed (115)

npm run typecheck
exit code 0

npm run build
exit code 0

npm run smoke
SMOKE_PASS

record-acceptance / verify-acceptance
passed: true
failures: []
```

Final Phase 20 isolation / hash evidence：

```text
comet status --short: clean
fastctx status --short: clean

C:\Users\AI001\.codex\hooks.json size: 2133
SHA-256: E0AD3C8C7042E6A1311BB47EC69DDB49F4CF9D9FFA75C3640E9009A5F2315CF0

C:\Users\AI001\.codex\config.toml size: 16446
SHA-256: B8C85B6627915FB3B115B14A6541EC1D7BE7205F4EF2F3B80B3CBCC0016862B6

C:\Users\AI001\.cc-panes\config.toml size: 3660
SHA-256: 40432662D0905E4443CCDA5B90D21D079E32AABD8983863A13ABF0E37B7F0836

C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
SHA-256: F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4

D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits\Y2MtcGFuZS1keW5hbWljLWhvb2stcm9vdA\permission-enforce-audit.json
SHA-256: EB10D803B85234DAEE3BDD3B206099BA75AA0B708471A52D52A45C6E6920D4F1

Forbidden probes:
C:\Users\AI001\.codex\__phase19_hook_block_probe.tmp exists: false
C:\Users\AI001\.codex\__phase19_node_bypass_probe.tmp exists: false
```
