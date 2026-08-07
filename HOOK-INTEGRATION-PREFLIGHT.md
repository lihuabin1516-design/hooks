# Hook Integration Preflight

日期：2026-08-06  
范围：只读预检；不写入用户配置；不执行 hook；不接入真实 Hook。  
目标 hook：`C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe`  
原型目录：`D:\cc-pane\tool\experiments\ccpanes-task-probe`

## 1. 当前判断

当前环境已经有两套 hook 相关机制：

1. Codex 用户级 `UserPromptSubmit` 已指向 `skills-hub-hook.exe`，用于 cold skill routing。
2. CC-Panes 的 Claude 本地配置已经有 `PreToolUse`、`PostToolUse`、`UserPromptSubmit` 等 hook，指向 `cc-panes-cli-hook.exe`。

因此下一步不应直接把 task-probe prototype 接进真实用户配置。更稳的路径是：

- 保留现有 `skills-hub-hook.exe` 作为 Codex prompt routing hook。
- 保留现有 CC-Panes Claude hook 管线。
- 先给 prototype 增加真实 hook event stdin adapter，并继续 dry-run。
- 再评估是否由 CC-Panes 现有 `cc-panes-cli-hook.exe` 调用该 adapter，而不是额外并联多个用户级 hook。

## 2. 只读采集对象与哈希

| Path | State | Bytes | SHA-256 |
|---|---:|---:|---|
| `C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe` | exists | 2779136 | `F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4` |
| `C:\Users\AI001\.codex\hooks.json` | exists | 407 | `C68FE99AC5D4E8FA38404D48C4D0B894535D1789F2BDE173DEABDCE9750D3479` |
| `C:\Users\AI001\.codex\config.toml` | exists | 16128 | `C7AAB6FCF366561C4A49EFD2B55A5D4ACB011F53AC1BA5C80F4F930C7B65CD61` |
| `C:\Users\AI001\.claude\settings.json` | exists | 68 | `6697AC8BF3813E484FAAE85BE37242DC958B90660EAA184B99823308E32D699F` |
| `C:\Users\AI001\.cc-panes\.claude\settings.local.json` | exists | 3468 | `8B3F97C46BB6193CE547D49783925491EA21416CBFE2B629190D681AF103C580` |
| `C:\Users\AI001\.cc-panes\launch-profiles.json` | exists | 87622 | `89C2D972FA1D3BD21C756A7E607F45C16C9857FCE6DECA876CA3FB0D79B30AAE` |
| `C:\Users\AI001\.cc-panes\shared-mcp.json` | exists | 1308 | `1391170F468C9FD1A590446BAD4D06E7DBEF439CFEB92DD4D99EE550622B2B9F` |
| `C:\Users\AI001\.cc-panes\mcp-orchestrator.json` | exists | 329 | `7B9EA296DC02AD28FB53AE73FEEF80749C924DE00061DF4B70C1C48EFECF2A2C` |
| `C:\Users\AI001\.cc-panes\providers.json` | exists | 2549 | `2D0DA5A6B6744438C4D6D7F206A4D63073406A93D49610E6DE90549D483642E8` |

敏感性说明：`providers.json` 和 `mcp-orchestrator.json` 含凭据或 token 类字段；本预检只记录文件哈希和风险，不复制内容。

## 3. Codex 当前 Hook 状态

`C:\Users\AI001\.codex\hooks.json` 当前内容要点：

```text
hooks.UserPromptSubmit[0].hooks[0].type = command
command        = "C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe"
commandWindows = "C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe"
timeout        = 5
statusMessage  = Routing cold skills
```

`C:\Users\AI001\.codex\config.toml` 中相关要点：

```text
features.plugin_hooks = false
hooks.state.'C:\Users\AI001\.codex\hooks.json:user_prompt_submit:0:0'.trusted_hash = sha256:bb3a3bdd19a4301bd2a1dc83b3bced3ee0bd4f2dddcfdeebb39a21155adbf895
mcp_servers.fastctx.command = C:/Users/AI001/.fastctx/bin/fastctx.exe
```

FastCtx 本机落盘 exe 只做存在状态、大小和 SHA-256 记录：

```text
path: C:\Users\AI001\.fastctx\bin\fastctx.exe
size: 53498368
lastWriteUtc: 2026-08-06T03:59:38Z
sha256: C94A7504FEA51CABDCD15BDBCFC95F494EF113AA11AE93A562E13492BAFA8579
```

判断：

- Codex prompt 层 hook 已存在，目标就是 `skills-hub-hook.exe`。
- 该 hook 的职责是 cold skill routing，不是 tool-write guard。
- 当前 task-probe prototype 的 `dry-run-hook --input` 接收的是 JSON 文件，不是 Codex hook stdin event；直接挂上不能形成真实写入门禁。
- `timeout = 5` 对 prompt routing 合适；对路径解析、workspace scan、artifact verify 这类门禁动作偏紧。

## 4. Claude / CC-Panes 当前 Hook 状态

`C:\Users\AI001\.claude\settings.json` 当前没有 hook 配置，只包含 UI/权限提示类设置。

`C:\Users\AI001\.cc-panes\.claude\settings.local.json` 已存在 CC-Panes 自有 hook 管线，命令目标为：

```text
C:\Users\AI001\AppData\Local\cc-panes\binaries\cc-panes-cli-hook.exe
```

已覆盖事件：

```text
Notification
PreToolUse
PostToolUse
PreCompact
SessionStart
SessionEnd
Stop
StopFailure
UserPromptSubmit
```

判断：

- CC-Panes/Claude 侧已经有 `PreToolUse` 和 `PostToolUse`，这是未来接入 task ownership / write gate 的更自然位置。
- 不建议直接替换 `cc-panes-cli-hook.exe`，因为它已承担 CC-Panes 会话、等待输入、工具前后、compact、结束等多事件职责。
- 更稳的集成方式是让 `cc-panes-cli-hook.exe` 或其上游配置在 `PreToolUse` dry-run 阶段调用 task-probe 的 adapter，作为子步骤，而不是并联一个新 hook 命令。

## 5. 与当前 prototype 的能力差距

当前 prototype 已具备：

```text
write-current
probe --workspace-root
dry-run-hook --input
record-acceptance
verify-acceptance
npm run smoke
```

还缺真实接入所需能力：

1. **Hook stdin adapter**  
   需要读取 Codex/Claude/CC-Panes 实际 hook event JSON，而不是只读 `--input <file>`。

2. **Event schema detection**  
   需要识别事件来源、tool 名称、参数字段、目标路径字段、是否写操作。

3. **Exit-code contract**  
   需要定义 dry-run、allow、block、error 的退出码与 stdout/stderr 格式。

4. **Fail-open / fail-closed 策略**  
   当前原型适合 dry-run；真实门禁要明确哪些事件阻断、哪些事件只记录。

5. **Audit log 位置**  
   需要固定写入 synthetic/任务目录，避免写入用户全局配置或泄露路径/参数。

## 6. 推荐接入路线

### Phase 0：保持现状

继续保留：

- Codex `UserPromptSubmit` → `skills-hub-hook.exe`
- CC-Panes Claude hooks → `cc-panes-cli-hook.exe`
- task-probe prototype 作为手动 dry-run / smoke 工具包

生产门禁：

```powershell
cd D:\cc-pane\tool\experiments\ccpanes-task-probe
npm test
npm run typecheck
npm run build
npm run smoke
```

### Phase 1：实现 hook event adapter，仍不改配置

建议新增：

```text
src/hook-event-adapter.ts
tests/hook-event-adapter.test.ts
examples/hook-events/*.json
```

目标：

- 从 stdin 或 `--event <json-file>` 读取真实/模拟 hook event。
- 转换为现有 `HookCall` 或 batch input。
- 输出 `ccpanes.hook-dry-run-batch-result.v1`。
- smoke 覆盖 allow/block/error。

### Phase 2：CC-Panes hook 管线 dry-run 集成

只在得到明确授权后进行。优先研究：

```text
C:\Users\AI001\AppData\Local\cc-panes\binaries\cc-panes-cli-hook.exe
C:\Users\AI001\.cc-panes\.claude\settings.local.json
```

目标不是替换现有 hook，而是为 `tool-before` 增加可选 dry-run 子步骤。

### Phase 3：真实阻断门禁

前置条件：

- Phase 1 adapter 通过测试和 smoke。
- Phase 2 dry-run 至少跑一段时间，有 artifact 证明误报率可接受。
- 明确 fail-closed 只作用于 task worktree 内授权写入。
- 有一键回滚文档和配置备份。

## 7. 实际改配置前的最小授权包

若后续要动真实配置，最小授权应精确包含：

```text
允许读取：
- C:\Users\AI001\.codex\hooks.json
- C:\Users\AI001\.codex\config.toml
- C:\Users\AI001\.cc-panes\.claude\settings.local.json
- C:\Users\AI001\.cc-panes\launch-profiles.json

允许写入：
- 仅用户明确指定的单个配置文件
- 仅新增或调整明确列出的 hook 子项

禁止：
- 修改 auth/provider/token 文件
- 替换 cc-panes-cli-hook.exe
- 替换 skills-hub-hook.exe
- 写入业务项目
- 写入 Comet/FastCtx reference repo
- 远端 push
```

每次写配置前后必须记录：

```text
exists
bytes
mtimeUtc
SHA-256
backup path
exact diff
rollback command
```

## 8. 风险清单

| Risk | Impact | Mitigation |
|---|---|---|
| 已有 Codex prompt hook 被误改 | cold skill routing 失效 | 不替换现有 `hooks.json`；先做 adapter 和 dry-run |
| CC-Panes Claude hook 已承担多事件职责 | 替换会破坏 session/tool lifecycle | 不替换 `cc-panes-cli-hook.exe`；只研究子步骤集成 |
| provider/orchestrator 文件含凭据 | 报告或日志泄露敏感信息 | 只记录哈希；报告中不复制值 |
| prototype 只支持 JSON 文件输入 | 真实 hook event 接不上 | 先实现 stdin/event adapter |
| timeout 过短 | 门禁误失败 | dry-run 阶段记录耗时；真实门禁前调 timeout |
| fail-closed 范围过宽 | 阻断正常工作 | 仅对 task worktree 内明确归属写入启用阻断 |

## 9. 当前可执行下一步

推荐下一步做 **Phase 1：hook event adapter**，仍只在 prototype 内实现，不改真实配置：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\src\hook-event-adapter.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\tests\hook-event-adapter.test.ts
D:\cc-pane\tool\experiments\ccpanes-task-probe\examples\hook-events\*.json
```

验收门禁：

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
```

完成 Phase 1 后，再决定是否做 CC-Panes hook 管线 dry-run 集成预案。
