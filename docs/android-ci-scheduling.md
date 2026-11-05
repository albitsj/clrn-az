# Android CI 失败优先调度

[issue #46](https://github.com/albitsj/clrn-az/issues/46) 的实现接入 `.github/workflows/android-visual.yml`。当前实际计划是 **35 个 Android 分片**，业务分组、语言、场景过滤、断言、视觉阈值和账号分配继续来自既有代码。Repository checks 和 Android diagnostics smoke 保留各自的独立运行方式。

## 执行与门禁

1. `accounts` 从当前检出提交生成完整矩阵，并保存 `android-ci-plan`。账号按本轮 run ID 一次分配，历史账号不被复用。
2. `driver` 准备一次原生驱动；`apk` 按当前 `deployments/staging.json` 下载、校验一次 APK，保存同轮不可变产物。两个阶段下载同一份 APK，每个分片仍核对应用提交、Release 元数据、文件大小与 SHA-256。APK 与驱动保留一天；过期后须 Re-run all jobs，不能用新下载的可变外部包替代本轮目标。
3. `priority` 仅展开此前未成功的分片，依赖 `accounts`、`driver`、`apk`。
4. `remaining` 明确依赖整个 `priority` 阶段成功，才展开余下矩阵。无优先项时，只有预期的空阶段 skipped 才允许执行全量 remaining。优先失败或取消时，剩余重型检查不提交给 runner。
5. `Android full regression` 使用 `always()` 检查依赖结论，并经 Actions API 逐项核对当前 run、当前 SHA 的完整计划。所有预期 job 必须唯一、完成且成功。依赖已成功而 Jobs API 暂时缺项、仍显示未完成或缺少结论时，每隔 10 秒重新分页读取最新快照，最多等待 5 分钟；网络查询也受同一截止时间约束。只有快照完整且全部成功才放行，超时保留最后一次完整 API 快照并拒绝放行。失败、取消、neutral、意外 skipped、身份不匹配、重复或计划外分片及门禁 API 故障直接拒绝，不因另一个分片未同步而重试。
6. 原 `Android (业务组 / 语言 / 分片)` 名称保留为轻量门禁，每项都依赖全量门禁成功。已有 required check 名称继续有效；为保留它们，每轮增加 35 个只执行结论检查的轻量 job。重型任务改名为 `Android priority (...)`、`Android remaining (...)`。

本实现不修改分支保护。可以将 `Android full regression` 设为额外 required check；既有分片 required checks 和 Repository checks 无需重命名。若静态规划自身失败，矩阵可能无法生成，应通过 accounts / 全量门禁的失败定位，不能把未出现的分片视为通过。

设备仍为每个 runner 的独立模拟器；两个阶段继续使用 `android-staging-account-${account}` concurrency、`queue: max` 及原有账号分区。诊断从初始化开始收集，原失败日志、截图、报告、构建身份及 reference 产物继续保存。凭据只注入需要它们的 composite action 步骤。

## 历史边界和连续修复

历史通过只用于决定顺序。当前完整矩阵始终重新执行，绝不复用其他提交的通过结果。

历史查找按 workflow ID、事件、来源仓库、分支和 PR 隔离；计划产物进一步验证 PR ref、head/base 分支、SHA 与运行编号。只考虑当前 run 之前的最近候选，不绕过不完整的新记录去挑更旧的成功记录。PR 记录同时保留 head SHA 与实际测试的 merge SHA，防止将两者混淆。

计划签名包含全部分片的稳定 group/locale/shard、label、filter，以及 workflow、composite action、调度代码、账号配置、Playwright 配置、用例入口与场景注册表、驱动、Release 校验代码、部署记录、锁文件和手动输入。轮转账号不参与签名。新增、删除、重命名分片或改变配置都会回退当前配置全量；新增场景仍由当前分片的现有用例收集执行。

无历史、旧 workflow 无计划产物、产物过期、API 故障、上一轮未结束、历史身份不匹配、分片映射缺失或重复，都回退全量。分页有明确上限；超限失败并回退，不能截断后静默漏项。

例如：35 项中 3 项失败 → 新提交先跑 3 项 → 其中 1 项仍失败，剩余 32 项不启动 → 下个提交先跑这 1 项，再跑当前其余 **34 项**。上个提交已通过的 2 项也重新纳入，因而不会在连续修复中缩小覆盖。

GitHub 原生 **Re-run failed jobs** 继续服务同一 run / 同一提交。结果读取全部 attempt，按 job 名选择最新 attempt，同时保留此前成功项；同一 attempt 的重复名称仍被拒绝。规划产物使用固定名称，门禁重跑可以读取之前成功的规划产物。新提交由上述独立调度机制处理。

## 手动全量与观测

Actions → Android Staging 视觉回归 → Run workflow：设置 `full=true`、`group=all`、`locale=all`、`filter` 留空、`mode=compare`，强制执行当前全部 35 项。保留的 group、locale、filter、reference 选项用于既有局部诊断，局部运行的成功仅表示所选计划通过；局部或 reference 手动运行的门禁名称使用 `Android diagnostic ...`，不能把完整比较的 required checks 标记为成功。

规划摘要列出历史 run / attempt / SHA、回退原因、当前 SHA、优先及剩余清单。全量门禁摘要和 `android-ci-results-${run_attempt}` 产物包含依赖结论、完整 job 结果、各阶段计划/启动/成功数量、首个失败反馈时间，以及成功时从 run 创建至全部重型分片完成的耗时（不含最后汇总及兼容门禁）。端到端成功总耗时须在线上验收时取整个 run 的创建到完成时间。启动数量只统计真正取得 runner 的重型 job，不将 skipped 占位符算作启动。

GitHub jobs API 没有独立的 job 入队时间，摘要明确把 run 创建到 job 开始标为包含准备与依赖等待的时间，不能当成纯排队时间。比较优化效果时分别记录失败反馈与全量成功总耗时，后者可能因阶段串行和轻量门禁增加。

## 验证记录

本地自动化覆盖真实 35 分片计划、连续修复、取消/跳过/超时、配置与分片变化、来源隔离、API/产物不可用、分页、同提交 failed-jobs 重跑及全量门禁。离线 CLI 集成测试执行真实规划和汇总入口，使用 ZIP 计划产物模拟三轮 PR：全量 35 → 优先 1 失败且余项零启动 → 优先 1 加剩余 34 成功；这些是模拟结果，不能据此声称线上排队或反馈时间改善。

Jobs API 同步回归测试执行真实汇总 CLI，并只替换离线 API 响应和等待时钟：覆盖优先阶段为 0、1、35 项时的缺项与 `in_progress` 后恢复、持续不完整直到截止时间、等待期间出现终态失败或 API 故障，以及错误身份、依赖失败和重复映射不能被后续成功快照覆盖。测试核对退出状态、完整 35 项结果、摘要及失败诊断产物；这不替代修复后的真实 PR 线上验收，本次未触发或重跑 CI。

本地验证结果：

- `npm run lint`（含 actionlint、ShellCheck、架构和重复代码门禁）通过。
- `npm run typecheck`、`npm run test:android:collect` 通过，另按实际矩阵逐项收集全部 35 个分片（简体 9、繁体 9、英文 17），均非空且无收集错误。
- `npm test`：全量运行 309 项，295 项在沙箱内通过，14 项因禁止监听 `127.0.0.1` 报 `listen EPERM`；随后在沙箱外分别复跑 `android/proxy.test.mjs` 和 `e2e/helpers/mitmproxy-session.test.mjs`，两文件各 8 项全部通过，覆盖全部受限项。309 项均已验证，含全部 81 段真实录屏回放。
- `node --test scripts/android-ci-*.test.mjs`：含 Jobs API 同步回归的 22 项调度专项测试通过。
- `python3 -m unittest discover -s android -p 'test_*.py'`：38 项通过。
- Composite action 的所有 run 步骤均声明 shell，所有 env 引用均由两个阶段提供；`git diff --check` 通过。

本机默认 `uv` 缓存不可写，静态检查使用已缓存的相同固定版本 Ruff、actionlint 和 ShellCheck 二进制执行，检查配置未调整。

真实 PR 验收尚需在发布该改动后记录以下数据：

| 场景 | 实际重型启动数量 | remaining 是否晚于全部 priority 成功 | 原 required checks / 全量门禁 | 失败反馈 / 全量成功总耗时 |
| --- | --- | --- | --- | --- |
| 首轮无历史 | 待测（预期 35） | 无优先项 | 待测 | 待测 |
| 修复后优先仍失败 | 待测（预期仅历史未成功项） | 不应启动 | 应失败 | 待测 |
| 连续修复成功 | 待测（合计 35，分片不重复） | 应晚于 | 应成功 | 待测 |
| 同提交 Re-run failed jobs | 待测 | 继续遵守阶段依赖 | 应核对所有最新有效结果 | 待测 |

线上记录还应保留 run URL、head/merge SHA、APK SHA-256 和 Actions 时间线；不修改阈值、扩大重试或删除检查来获得通过。
