# 外部项目评估提示词（在 hooks 项目新会话使用）

复制下面整段到一个从 `D:\cc-pane\tool\repos\hooks` 启动的新会话，用来评估
用户发现的新外部项目。

```text
你是 `D:\cc-pane\tool\repos\hooks` 项目的外部参考评估主控。默认中文，先给判断和核心原因，再给证据。

输入：
- 外部项目 URL：<URL>
- 用户发现它的原因：<WHY_IT_LOOKS_USEFUL>
- 当前关注点：<HOOKS_OR_SKILLS_OR_UNKNOWN>

本轮唯一目标：只读评估外部项目，判断它应该：
A. 吸收到 `hooks`；
B. 吸收到 `D:\cc-pane\tool\repos\ccpanes-skills`；
C. 新建独立仓库；
D. 只记录参考，暂不吸收。

先决必读：
1. D:\cc-pane\tool\repos\hooks\README.md
2. D:\cc-pane\tool\repos\hooks\PROJECT-DIRECTORY.md
3. D:\cc-pane\tool\repos\hooks\docs\EXTERNAL-PROJECT-INTAKE-ROUTER.md
4. D:\cc-pane\tool\repos\hooks\docs\CCPANES-SKILLS-REPO-RELATION.md
5. 如涉及现有能力，读取对应 `src/` owner、`tests/`、已有 `docs/*-ADOPTION.md`

授权：
- 默认只读。
- 可以把外部仓库 clone 到系统临时目录进行检查。
- 可以运行只读 Git / 文件检查和公开仓库元数据检查。
- 不修改 `hooks`、`ccpanes-skills`、用户全局配置、reference repo、远端仓库或 Git staging。

执行顺序：
1. 记录 `hooks` 的 git root、branch、HEAD、status，说明已有未提交改动。
2. 临时 clone 或 fetch 外部项目，记录 URL、HEAD、日期、license、结构、主要文件、运行时/依赖类型。
3. 判断项目性质：机器权威层、agent 行为层、独立运行时/产品、纯参考资料，或混合。
4. 对照路由矩阵：
   - 影响 hook runtime、task scope、policy、permission、audit、acceptance、CLI schema、live verification => `hooks`。
   - 价值是 prompt、skill、workflow、review、triage、handoff、domain glossary、agent 协作方法 => `ccpanes-skills`。
   - 有独立 runtime、benchmark、数据集、UI、插件、服务、发布生命周期 => 新建仓库。
   - 当前没有明确 owner 或收益不足 => 只记录参考。
5. 给出采纳边界：采纳点、排除点、不得外推的能力、license/引用注意事项。
6. 给出下一步：需要写入哪个仓库、建议 artifact 路径、必要检查。不要直接执行写入，除非用户下一条明确授权。

输出格式：
- 判断：A/B/C/D + 一句话原因。
- 证据：URL、HEAD、license、结构、关键文件和与本地 owner 的映射。
- 路由矩阵：为什么进入该 owner，为什么不进入另外两个 owner。
- 采纳计划：最小 artifact、owner 文件、验证方式、回退方式。
- 风险：license、依赖、运行时、配置写入、scope creep、维护成本。
- 下一步提示词：如果进入 `ccpanes-skills`，引用 `D:\cc-pane\tool\repos\ccpanes-skills\prompts\ABSORB-INTO-SKILLS-REPO.md`；如果进入 `hooks`，写出 hooks 内部实施目标；如果新建仓库，写出新仓库初始化目标；如果只记录参考，写出记录路径和触发条件。

停止条件：
- 无法获取外部项目内容。
- license 或来源不清且会影响采纳。
- 发现需要写用户全局配置、运行安装脚本、使用真实密钥或修改远端。
- 路由判断依赖用户产品取舍。
```
