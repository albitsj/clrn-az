# CI 42679053614 修复依据

## 身份与取证

- 诊断指纹：`4ad58a66f47732c6b3f621784e1c93e5a50daaff43a95844e5b02b4e4ec516fa`。
- GitHub API 核对 run `42679053614` / attempt `1` / HEAD `1fa4c7318a9cdeb73c83f5d032dc52db2c0c2abf`，与本地 HEAD 一致。
- 实际 job 检出 `63e5b51`，日志明确为上述 HEAD 合并到 `5aba447` 的 PR 合并提交。
- 全部 37 个失败 job 日志均已读取；一次 HTTP 503 单独重新取得成功后才作判断。
- 本轮 social/en 的视觉附件 `13703342056`、设备诊断 `13703167184` 来自该 run，下载到带 run、attempt、HEAD 标识的全新临时目录，成功解压后读取；未使用旧报告。
- 工作区原为干净的专用分支 `kevinanew/e2e-js-ts-3-6`。只读检查全部现有分支和相关历史提交后修改；没有操作 index、分支引用或提交历史。

## 实际失败、根因与最小修复

[Android remaining (social / en)，job 129368678663](https://github.com/albitsj/clrn-az/actions/runs/42679053614/job/129368678663)：`signed_in_daily_bonus` 首次在 `returnToTabs → waitForTabs` 等待 `settings-tab` 超时，重试通过；最终 1 flaky、19 passed、10 skipped，failOnFlakyTests 正确阻止通过。

19:16:04 前置 `signed_in_slot` 截图通过，19:16:40 签到用例失败，其间没有点击签到入口。首败 last-screen.png 仍为拉霸，前方有消息为 `timeout`、按钮为 `OK` 的原生 Dialog。hierarchy.xml 只有该 Dialog 的树：`android:id/message` 为 `timeout`、`android:id/button1` 为 `OK`，没有拉霸或标签节点。即使八次 Back 后，该 Dialog 仍存在。

原清理逻辑只识别拉霸等页面节点；Dialog 隐藏底层树后，无法识别拉霸，也无法点击其关闭按钮，只能反复等待标签并按 Back。根因是场景间清理未处理本轮明确出现的阻塞 Dialog；不是签到页面加载慢。网络 timeout 的具体请求来源未能从现有日志证明，不据此改网络、代理或应用发布引用。

仅在 `navigation-tabs.ts` 场景间清理中精确识别 `android:id/message + timeout` 和 `android:id/button1 + OK`，正常确认并等待该消息消失，然后沿用已有拉霸关闭、标签等待流程。其他消息、RETRY、断言和当前场景中的失败不被忽略；不改采样、截图、重试、执行方式或门禁。

## 已有修复与反例

- `d64da21` / `9bfc8fe` 已有拉霸关闭及原生 Dialog 专项处理；沿用其实现，补齐本轮缺少的场景间 Dialog 类型。
- `f86ac12` 与当前 device-startup 恢复仅针对 `ServerType: staging + v1/status + RETRY`；历史分支 `feat/android-animation-visual-regression` 的 `2796332` 仅针对牌桌 `Connection Timeout + RETRY`。均不能直接复用于本轮 `timeout + OK`，未复制这些不同场景的重试。
- 历史 `2acfc9a` 及 `quality/ci-42523013314-investigation.md` 处理密码页原生布局和基准，当前已有修复保持不动；本轮附件 build-info 确认仍为已选择的应用 `beea05ce1f1fa92c9bd3ad7ae5cc97000bce0a8f`、build `100002101`。
- 本轮重试通过、social/zh-Hans 与 social/zh-Hant job 成功，说明不是所有运行都被阻塞；不能据此否定首败附件，也不能宣称延长等待或重建会话就能修复。方案依据是首败可见树及不可取消 Dialog 的清理路径，定向回放覆盖该状态，真实设备效果仍须完整 CI 验收。

## 其余失败逐项结果

[Android full regression，job 129392029027](https://github.com/albitsj/clrn-az/actions/runs/42679053614/job/129392029027)：依赖 remaining=failure，完整覆盖校验抛出“当前提交的 Android 完整回归未通过”。已证实汇总本身无需改动，保留门禁。

下表每一项均已单独读取日志，失败命令均为 `test "$COMPLETE_RESULT" = success`，环境均为 `COMPLETE_RESULT: failure`。每项均为前述分片失败的传播，已证实该门禁无需改动，无其他独立失败。

| 检查 | job | 结果 |
| --- | --- | --- |
| Android (texas / zh-Hans / table) | 129392257683 | 已证实门禁无需改动 |
| Android (social / zh-Hans) | 129392257776 | 已证实门禁无需改动 |
| Android (texas / en / game-effects) | 129392257778 | 已证实门禁无需改动 |
| Android (texas / zh-Hant / other) | 129392257841 | 已证实门禁无需改动 |
| Android (guest / zh-Hant) | 129392257937 | 已证实门禁无需改动 |
| Android (texas / en / game-table) | 129392257943 | 已证实门禁无需改动 |
| Android (account / zh-Hant) | 129392257958 | 已证实门禁无需改动 |
| Android (zhajinhua / zh-Hant) | 129392257959 | 已证实门禁无需改动 |
| Android (records / zh-Hans) | 129392257982 | 已证实门禁无需改动 |
| Android (texas / en / other) | 129392257997 | 已证实门禁无需改动 |
| Android (texas / en / pregame-first) | 129392257999 | 已证实门禁无需改动 |
| Android (rooms / zh-Hans) | 129392258009 | 已证实门禁无需改动 |
| Android (guest / en) | 129392258042 | 已证实门禁无需改动 |
| Android (zhajinhua / en / pregame-second) | 129392258056 | 已证实门禁无需改动 |
| Android (texas / en / pregame-middle) | 129392258064 | 已证实门禁无需改动 |
| Android (records / en) | 129392258089 | 已证实门禁无需改动 |
| Android (social / zh-Hant) | 129392258094 | 已证实门禁无需改动 |
| Android (texas / zh-Hant / table) | 129392258106 | 已证实门禁无需改动 |
| Android (account / zh-Hans) | 129392258113 | 已证实门禁无需改动 |
| Android (guest / zh-Hans) | 129392258114 | 已证实门禁无需改动 |
| Android (records / zh-Hant) | 129392258118 | 已证实门禁无需改动 |
| Android (social / en) | 129392258133 | 已证实门禁无需改动 |
| Android (zhajinhua / en / game-effects) | 129392258145 | 已证实门禁无需改动 |
| Android (wallet-help / zh-Hans) | 129392258149 | 已证实门禁无需改动 |
| Android (texas / en / panels) | 129392258156 | 已证实门禁无需改动 |
| Android (zhajinhua / en / game-table) | 129392258176 | 已证实门禁无需改动 |
| Android (texas / zh-Hans / other) | 129392258190 | 已证实门禁无需改动 |
| Android (zhajinhua / en / pregame-first) | 129392258191 | 已证实门禁无需改动 |
| Android (rooms / en) | 129392258194 | 已证实门禁无需改动 |
| Android (texas / en / pregame-second) | 129392258209 | 已证实门禁无需改动 |
| Android (account / en) | 129392258257 | 已证实门禁无需改动 |
| Android (rooms / zh-Hant) | 129392258263 | 已证实门禁无需改动 |
| Android (wallet-help / en) | 129392258266 | 已证实门禁无需改动 |
| Android (wallet-help / zh-Hant) | 129392258323 | 已证实门禁无需改动 |
| Android (zhajinhua / zh-Hans) | 129392258467 | 已证实门禁无需改动 |

## 验证

- 新增原生树回放验证 Dialog 隐藏拉霸、Back 不可替代确认、正常确认后关闭拉霸；另验证未知错误及 RETRY 不被确认，原有九次查询、八次 Back 和原始异常保持。
- `node --import tsx --test android/navigation.test.mjs`：4 项通过、0 跳过。
- `node scripts/android-navigation-complexity.mjs`：通过（实现和测试复杂度 ≤3，工具/配置 ≤6）。
- `npx tsc -p tsconfig.json --noEmit`、`git diff --check`：通过。
- 未本地重跑 Android 设备测试；完整远端矩阵交由 CI，当前不宣称已经转绿。没有受阻的独立失败调查；网络 timeout 的更深来源不作无证据推断。
