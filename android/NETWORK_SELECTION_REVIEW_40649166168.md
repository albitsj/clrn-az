# 真实选线后的节点编号遮罩复核

本文记录提交 `1fa5b9f6734b6a95a1a316807bf0802bed46f3bc` 的历史调查与方案。该额外比较器现已按用户要求撤回，专用测试也已删除；当前使用原截图比较实现，并复用已逐图审查的同构建基准，详见[当前修订记录](BASELINE_REVIEW_29_REVISION.md)。以下内存处理算法和计数仅供追溯，不再作为当前执行规则。

本轮调查对象为[合并请求 #29](https://github.com/albitsj/clrn-az/pull/29) 的提交 `b0c8264b4ea124040b8bbbf863ea675246fc1b50`，失败证据来自[比较运行 40649166168](https://github.com/albitsj/clrn-az/actions/runs/40649166168)。本地起始工作区没有未提交修改；获取远端后，`origin/master` 的 `a2de07fcaf6f4b39abcc0b50c7e940b43a407a2d` 已是该提交的祖先，因此没有重复合并。

## 应用与失败证据

六个失败分片的 `artifacts/current/build-info.json` 均对应应用提交 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`、Release `android-staging-300001001-69f9251d3b5f`，与 `deployments/staging.json` 一致。安装包大小为 `144081145` 字节，SHA-256 为 `27618d750fc306b1a75d52d642b2d90f361501fd1b9998bc3cd65ca5874196f5`，本轮没有切换应用版本。

已下载并读取三个语言的 `table`、`other` 失败分片报告。英文牌桌从 `game-table` 分片读取。差异图中的变化集中在已有圆形按钮修复的边缘及右下角节点编号遮罩；没有把网络错误页面接收为基准。

英文起手牌报告的 `en-signed-in-texas-game-preflop-native-tree` 显示，首次节点文字为 `64,67`，第一次重试为 `68,64`，两次控件边界均为 `x=630, y=1240, width=61, height=34`。旧基准只遮罩了单节点编号区域。恢复真实选线后，应用可同时显示接口节点和连接节点，当前截图的遮罩随文字变宽，旧基准却没有应用同一区域。因此原本 4319 个按钮边缘差异又增加 924 个遮罩差异，达到 5243 个，超过整图上限 4608 个。

`network-selection` 附件同时记录到完整候选节点、真实健康响应，以及不同节点上的连接建立，支持编号变化来自真实选线这一解释；不是缺少健康响应覆盖。节点选择和连接仍保持真实透传。

## 已撤回方案的比较规则与历史核算

当时的 `expectScreenshot` 在比较内存中对旧基准应用当前实际控件的 `game-network-proxy-code` 遮罩。实际图沿用原有稳定检测与遮罩；其他动态遮罩没有用于重新处理旧基准。普通截图与短时提示共用该判定，短时提示保留实际选中帧对应的遮罩。该路径现已删除，当前预期图直接读取仓库基准，不再执行这些处理。

使用仓库固定的 Playwright `1.61.1` 比较器，沿用 `threshold: 0.1` 与 `maxDiffPixelRatio: 0.005`，未修改允许比例、动画分区或业务断言。以下 36 个不同状态、含全部重试的 104 张失败实际图均为完整 `720×1280` 截图；每张允许 4608 个差异像素。报告中的预期图已按字节摘要逐一对应到仓库原图。对两侧统一既有节点编号遮罩后，104 张均符合现有比例，所有原图保留，不生成或接收新截图。

下表列出各状态全部尝试中的精确差异数；多值表示不同尝试的计数。完整原生报告和差异图保留在上述运行的六个视觉产物中。

| 状态（截图文件名去掉 `.png`） | 实际图数量 | 修复前差异像素 | 统一节点遮罩后差异像素 |
| --- | ---: | ---: | ---: |
| `en-signed-in-texas-controls-check` | 3 | 5243 | 4319 |
| `en-signed-in-texas-controls-shortcut-blinds` | 3 | 5243 | 4319 |
| `en-signed-in-texas-controls-shortcut-disabled` | 3 | 4728 | 3804 |
| `en-signed-in-texas-game-flop` | 2 | 5243 | 4319 |
| `en-signed-in-texas-game-preflop` | 2 | 5243 | 4319 |
| `en-signed-in-texas-game-river` | 2 | 5243 | 4319 |
| `en-signed-in-texas-game-turn` | 2 | 5243 | 4319 |
| `en-signed-in-texas-hall-variants-delay-cooldown` | 3 | 5288 | 4364 |
| `en-signed-in-texas-table-states-full-table` | 3 | 5152 | 4228 |
| `en-signed-in-texas-table-states-full-table-multiple-pots` | 3 | 5152 | 4228 |
| `en-signed-in-texas-table-states-player-disconnected` | 3 | 5243 | 4319 |
| `en-signed-in-texas-table-states-reserved-seat` | 3 | 5243 | 4319 |
| `zh-Hans-signed-in-texas-controls-check` | 3 | 5285 | 4361 |
| `zh-Hans-signed-in-texas-controls-shortcut-blinds` | 3 | 5292、5295 | 4368、4371 |
| `zh-Hans-signed-in-texas-controls-shortcut-disabled` | 3 | 4750、4752 | 3826、3828 |
| `zh-Hans-signed-in-texas-game-flop` | 3 | 5285 | 4361 |
| `zh-Hans-signed-in-texas-game-preflop` | 3 | 5285 | 4361 |
| `zh-Hans-signed-in-texas-game-river` | 3 | 5285 | 4361 |
| `zh-Hans-signed-in-texas-game-turn` | 3 | 5285 | 4361 |
| `zh-Hans-signed-in-texas-hall-variants-delay-cooldown` | 3 | 5300 | 4376 |
| `zh-Hans-signed-in-texas-table-states-full-table` | 3 | 5194 | 4270 |
| `zh-Hans-signed-in-texas-table-states-full-table-multiple-pots` | 3 | 5194 | 4270 |
| `zh-Hans-signed-in-texas-table-states-player-disconnected` | 3 | 5285 | 4361 |
| `zh-Hans-signed-in-texas-table-states-reserved-seat` | 3 | 5285 | 4361 |
| `zh-Hant-signed-in-texas-controls-check` | 3 | 5282 | 4358 |
| `zh-Hant-signed-in-texas-controls-shortcut-blinds` | 3 | 5289、5292 | 4365、4368 |
| `zh-Hant-signed-in-texas-controls-shortcut-disabled` | 3 | 4735、4737 | 3811、3813 |
| `zh-Hant-signed-in-texas-game-flop` | 3 | 5282 | 4358 |
| `zh-Hant-signed-in-texas-game-preflop` | 3 | 5282 | 4358 |
| `zh-Hant-signed-in-texas-game-river` | 3 | 5282 | 4358 |
| `zh-Hant-signed-in-texas-game-turn` | 3 | 5282 | 4358 |
| `zh-Hant-signed-in-texas-hall-variants-delay-cooldown` | 3 | 5300 | 4376 |
| `zh-Hant-signed-in-texas-table-states-full-table` | 3 | 5191 | 4267 |
| `zh-Hant-signed-in-texas-table-states-full-table-multiple-pots` | 3 | 5191 | 4267 |
| `zh-Hant-signed-in-texas-table-states-player-disconnected` | 3 | 5282 | 4358 |
| `zh-Hant-signed-in-texas-table-states-reserved-seat` | 3 | 5282 | 4358 |

## 验证与待确认项

`npm run check` 已通过，包含静态检查、类型检查、安卓用例收集及 122 项本地单元测试。新增回归覆盖旧单边遮罩误报、一万有效像素中 50 个业务差异通过与 51 个失败、其他遮罩不改写基准、尺寸不符失败、失败附件及比较过程不写基准文件。

[英文牌桌任务](https://github.com/albitsj/clrn-az/actions/runs/40649166168/job/122685064682) 的前两次执行各只有四张静态截图差异，起手牌和后续动画检查继续完成；第三次尝试在起手牌动画处出现“入口点击必须产生足够大的可见变化”，差异幅度为零，起止附件相同，最后屏幕没有手牌。现有证据不足以确定它属于应用问题、回放时序还是临时连接问题。本轮保留原动画运动、轨迹和牌面断言，不凭推测增加重试或接受动画候选；新提交的完整远端比较需要重点复查此项。

上述计数是上轮方案的离线复核。随后[运行 40710883615](https://github.com/albitsj/clrn-az/actions/runs/40710883615) 的全部检查通过，英文牌桌一次通过，但这不能确定旧动画异常的根因，也不能证明撤回算法后的代码已通过。本次后继修订仍须由脚本发布，再以新提交的完整远端结果验证。
