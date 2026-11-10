# 本轮失败调查与交付边界

诊断指纹：`a5ca7238b6dcbc57ec46dbc163e56d3787706010de0f6339d99458d020813462`。
已通过 run/jobs API 核对 run `42750216827`、attempt `1`、HEAD `f666940f762e52bc86d03d973696646953e2ea78`。
工作区初始干净，位于已有专用修复分支。修改前只读检查所有本地/远端引用及相关提交。
没有修改 index、分支引用或提交历史。

日志 ZIP 下载到带 run/attempt/HEAD 的全新临时目录；首次解压失败后删除该次解压目录，未读取残缺内容，改从 ZIP 直接读取各 job 日志。
两个必要报告均先核对 artifact 的 run/HEAD，再下载并解压到各自全新目录：

| job | artifact | ZIP SHA256 |
| --- | --- | --- |
| 129618119268 guest/zh-Hans | 13734847372 | 870cc6999d5dcf8662dd139eae1d271fe8e439b027e27d0827f8571f05bf67a2 |
| 129618119385 texas/en/game-table | 13735380133 | 99447a746ae9390fa513d3ab5f6082a1602bd80080648f98fad241a27b076b48 |

## 三项账号准备失败：已修复可复现的发现短路，真实上游健康仍待 CI

- social/zh-Hant，job `129618118788`。
- rooms/en，job `129618118805`。
- guest/zh-Hant，job `129618118852`。

逐项日志均在 `/v10/house/user/:userId` 前选线失败，业务发送次数为零。
HK/KR-Seoul 健康不可用、JP/KR 超时；此前钱包准备成功不代表房间客户端此刻有健康缓存。
新客户端初始 bootstrap race 抛错后未执行公共 metadata，无法发现其他区域节点。
仅复用已有 `aafb8ea` 的 selection.ts、对应测试及调查说明；没有合入诊断分支工作流或不相关老虎机采样实现。
详见 [发现短路证据](ci-42750216827-bootstrap-discovery.md)。

本轮验证：同一“全部 bootstrap busy，但 metadata 可发现健康第三节点”的测试在原 HEAD 副本失败为 unavailable/attempts=0；
修复后 selection 测试 23/23 通过，涵盖健康门禁、取消、总期限、dispose、无凭据发现和不重复业务写入。
同轮其他分片成功、以及日志没有证明 US-LA 当时健康，均不推翻确定性的发现短路；也不能声称修复了上游负载或超时。

## guest/zh-Hans 启动页：调查未完成，已补失败取证，交由 CI

job `129618119268` 首败在 launch-branding.spec.ts:61，释放 hold 后等待 settings-tab 120 秒超时。
完整品牌截图已通过；失败 last-screen.png 显示 `65 v1/status` 网络错误原生弹窗，重试通过仍被 failOnFlakyTests 拒绝。
现有 hierarchy/runtime 和已保存诊断不能确定错误来自释放前的应用五秒期限，还是释放后的真实上游失败。
不关闭错误弹窗、不增加重试、不延长预算，不将本项声明为无需改动。

已有历史 `ci-42568906820-investigation.md` 记录 hold 后、采样前节点 68 错误；
`ci-42715187841-investigation.md` 记录语言选择阶段的网络弹窗。
这些失败位置不同，不能简单套用历史“上游故障”结论；同轮成功重试也不能证明 hold 时序正确。
新增诊断仅在原 catch 中读取现有脱敏 network-selection 事件，附加原控制查询的时间、请求计数与释放时间。
下一轮用 response/error 的节点、时间和健康状态对齐最后拦截时间与释放时间，区分超时竞态和真实上游错误。
不读取凭据、响应正文或完整 URL；诊断失败被独立捕获，仍抛出原错误。

## texas/en/game-table 倒计时：调查未完成，已补原始 ROI 取证，交由 CI

job `129618119385` 首败为 opponent-turn-countdown 第一个控件运动距离 `0.381371668164121`，原门限 `>1`。
重试通过但门禁拒绝；失败发生在 captureMovingKeyframes，并非老虎机退场。
调用前 verifyLoopAnimation 已完成，故不能仅据失败值认定动画从未运动；亦不能据重试通过认定采样预算足够。
现有报告没有该首败 motionFrames 的完整 ROI/时间线；错误后的全屏和控件树不能还原采样期间的倒计时状态。

只在原运动断言失败后保存同次已采集的全部倒计时 ROI、capturedAt、regions 和逐帧距离。
不追加设备查询、不重采样、不改采样数量、间隔、ROI、阈值或断言，不保存屏幕其他区域。
新证据可区分“采样时间跨度不足”“ROI 内画面静止或倒计时已结束”“确有持续变化但原指标低于门限”，再决定根因修复。
不能现在就增加 maxAttempts 或合入 screenrecord 候选。
定向诊断测试 2/2 通过，使用真实 PNG 和原比较器验证一次采样、完整附件，以及附件存储失败仍保留运动失败。

## 汇总门禁：已证实无需独立修改

job `129627999108` 在 completeRun 汇总阶段因当前提交完整回归未通过而失败。
诊断中的全部 35 个 `Android (...)` 兼容 job 已逐项读取，均为 `COMPLETE_RESULT: failure`，
执行 `test "$COMPLETE_RESULT" = success` 返回 1，没有另一个实际测试失败。
保留完整回归和所有兼容门禁。

## 验证

仅运行网络选择和诊断故障边界定向单元测试，没有重跑模拟器测试或改变远端执行方式。
selection 23/23、诊断 2/2 通过；完整 npm lint、TypeScript、修改文件 ESLint、行数检查和 diff 空白检查通过。
原生两项仍待下一轮 CI 取得新增证据；本次交付不代表远端已通过。
