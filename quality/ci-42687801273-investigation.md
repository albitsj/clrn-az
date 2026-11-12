# CI 42687801273 调查与取证改动

## 本轮身份与范围

诊断指纹 `ca6d727f3f5b8b210710cbe0516417aed6e55ad5df4e89bc4d858f4cc1c29079`。
API 核对 run 42687801273 / attempt 1 / HEAD 0f372de560df34271ab72a6796479e49d9c4333e，与工作区一致。
本地专用分支 kevinanew/e2e-js-ts-3-6，原工作区干净；修改前已只读检查全部本地/远端分支及相关修复提交。
没有改 Git index、引用或历史。仓库没有 .codegraph 目录。
下载全部本轮日志及视觉附件 13707863766、13710611033、繁中设备诊断 13709021307，使用全新 run/attempt 临时目录，成功解压后才读取。
英文设备诊断附件首次下载发生 EOF，没有读取该不完整 ZIP；重新下载至独立文件并成功解压后读取。滚动日志只覆盖最后一次尝试后半段，不能还原前两次啤酒路径失败；存在 Choreographer 跳帧记录，但不能证明对应首败采样窗口。英文首败和重试的 runtime.log 也已读取。

## 两个实际测试失败：调查仍需 CI 补充证据，不声明已修复

### 129410332603：texas / zh-Hant / table

signed_in_texas_panels 首败在 texas-panels.ts 的 hand_end 截图进入 captureNodes → assertAlerts，出现意外错误，重试通过但 failOnFlakyTests 正确拒绝。
首败 last-screen.png 明确显示 `Request failed with status code 502-room_profile`；上一帧等待 1180 余额及亮牌按钮并不能证明后台资料请求全部完成。
不能仅凭这个提示就断言故障来自 CI 基础设施，或通过确认提示/扩大等待使测试通过。当前附件没有断言时的完整树，收尾 hierarchy 查询又失败；设备诊断的滚动窗口覆盖后续重试，不能重建首败 RPC 来源。
新增诊断在原断言失败后保存其已经读取的提示节点分类、边界及截图阶段，识别本轮 502-room_profile / 历史 timeout，未知消息正文和身份不输出；不额外查询设备，不确认弹窗。
下一轮可核验断言当时错误类型是否与收尾截图一致。502 的请求来源与应用处理仍未证实，不能宣称无需改动。

历史 0f372de 处理场景间 timeout + OK 阻塞拉霸返回；本轮是在当前牌桌断言中出现 room_profile 502，阶段与消息均不同，保留该已有修复、不扩展为吞掉错误。

### 129410333334：texas / en / game-effects

signed_in_texas_game_effects 首败：texas-prop-beer 路径运动帧仅 1（要求 ≥2）；retry 1 的 flight changed 最好距离 15.347032085561498（要求 ≤15）；retry 2 通过，仍由 failOnFlakyTests 拒绝。
现有报告只有选中效果图和距离列表，未保留该次完整 flight 区域候选帧及 capturedAt，因此不能区分真实路径渲染异常、采样遗漏与基准不适配。
驱动 motionFrames 同时受 3200ms 与 20 帧上限控制，可能提前结束，但没有本轮原始时间戳证明它是原因，故不改变采样窗口、频率、方法、触发或基准。
新增仅针对 texas-prop-beer 的结束后诊断：保存每次原驱动返回帧的时间戳、原效果及路径裁切区的 PNG base64。首败和成功重试都保留，以对照时间覆盖、实际位置和最好基准距离；不追加设备采样，不输出完整牌桌屏幕。
附件写入、裁切失败被隔离，原始异常继续传播，成功结果保持成功。

历史分支 3ce5e57/f4344e1 已分别处理同次触发连续采样及茶道具无损区域采样，后者文档明确水和啤酒未采用该新命令；不能把茶道具的录屏缺帧证据当成当前啤酒整屏 PNG 的因果证据，未复制该不同方案。
本轮两种不同断言失败及最终成功是必须解释的反例：诊断会保留全部真实候选，不以一次通过证明稳定，不放宽距离或运动帧数。

加入诊断包装需触及原复杂度迁移项；只把原飞行断言原样移入同文件 helper，使函数符合既有复杂度门禁并删除已消失的旧迁移项，没有新增豁免或弱化门禁。

## 汇总及每个合并门禁

129434562486 Android full regression 日志 remaining=failure，completeRun 抛出“当前提交的 Android 完整回归未通过”；已证实无独立故障，保持门禁。
下表每项均单独核验对应日志：命令 test "$COMPLETE_RESULT" = success，环境 COMPLETE_RESULT: failure，退出 1。

| 检查 | job | 结论 |
| --- | --- | --- |
| Android (texas / en / panels) | 129434735884 | 已证实为汇总失败传播，门禁无需改动 |
| Android (zhajinhua / zh-Hans) | 129434735905 | 已证实为汇总失败传播，门禁无需改动 |
| Android (zhajinhua / en / game-effects) | 129434735944 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / en / other) | 129434735976 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / en / pregame-middle) | 129434736022 | 已证实为汇总失败传播，门禁无需改动 |
| Android (zhajinhua / en / game-table) | 129434736046 | 已证实为汇总失败传播，门禁无需改动 |
| Android (account / zh-Hans) | 129434736094 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / en / pregame-first) | 129434736111 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / en / game-table) | 129434736119 | 已证实为汇总失败传播，门禁无需改动 |
| Android (guest / zh-Hans) | 129434736131 | 已证实为汇总失败传播，门禁无需改动 |
| Android (account / zh-Hant) | 129434736149 | 已证实为汇总失败传播，门禁无需改动 |
| Android (social / en) | 129434736162 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / en / game-effects) | 129434736173 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / zh-Hans / other) | 129434736197 | 已证实为汇总失败传播，门禁无需改动 |
| Android (rooms / zh-Hant) | 129434736248 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / zh-Hant / table) | 129434736255 | 已证实为汇总失败传播，门禁无需改动 |
| Android (zhajinhua / en / pregame-second) | 129434736257 | 已证实为汇总失败传播，门禁无需改动 |
| Android (social / zh-Hans) | 129434736278 | 已证实为汇总失败传播，门禁无需改动 |
| Android (wallet-help / zh-Hant) | 129434736279 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / zh-Hans / table) | 129434736294 | 已证实为汇总失败传播，门禁无需改动 |
| Android (wallet-help / en) | 129434736306 | 已证实为汇总失败传播，门禁无需改动 |
| Android (guest / en) | 129434736307 | 已证实为汇总失败传播，门禁无需改动 |
| Android (records / en) | 129434736343 | 已证实为汇总失败传播，门禁无需改动 |
| Android (guest / zh-Hant) | 129434736368 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / zh-Hant / other) | 129434736371 | 已证实为汇总失败传播，门禁无需改动 |
| Android (zhajinhua / en / pregame-first) | 129434736372 | 已证实为汇总失败传播，门禁无需改动 |
| Android (rooms / en) | 129434736376 | 已证实为汇总失败传播，门禁无需改动 |
| Android (zhajinhua / zh-Hant) | 129434736384 | 已证实为汇总失败传播，门禁无需改动 |
| Android (social / zh-Hant) | 129434736427 | 已证实为汇总失败传播，门禁无需改动 |
| Android (texas / en / pregame-second) | 129434736432 | 已证实为汇总失败传播，门禁无需改动 |
| Android (records / zh-Hant) | 129434736473 | 已证实为汇总失败传播，门禁无需改动 |
| Android (account / en) | 129434736477 | 已证实为汇总失败传播，门禁无需改动 |
| Android (records / zh-Hans) | 129434736507 | 已证实为汇总失败传播，门禁无需改动 |
| Android (rooms / zh-Hans) | 129434736510 | 已证实为汇总失败传播，门禁无需改动 |
| Android (wallet-help / zh-Hans) | 129434736730 | 已证实为汇总失败传播，门禁无需改动 |

## 验证

- 定向诊断测试：验证全部原生时间戳与裁切尺寸保留、未知消息和身份不输出、附件失败不向调用方抛出。
- 原有 asset-sequence 两项负向测试：错误基准、缺少登记锚点仍被拒绝。
- 类型检查、ESLint 精确历史债务门禁、Android 玩法复杂度门禁及 diff 空白检查均通过；四项定向及原有负向测试全部通过。
- 未本地执行 Android 设备回归；本次是取证改动，两个独立根因尚未完全确定，须由 CI 获取新证据后继续，不声明已经修复或远端转绿。
