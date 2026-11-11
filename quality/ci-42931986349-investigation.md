# CI 42931986349 / attempt 1 调查

诊断指纹：5e97fdeaa164e2227e65c9341f8dc4e779b7f3bf8a3e47dc8abbc777e4ae277e。
API 核对 run=42931986349、attempt=1、head_sha=e7e07cd7b2e28a05237f688271d6d00c7f84138c，与工作区 HEAD 一致；全部诊断 job 的 run_attempt=1。
实际 checkout 为 PR #78 合并提交 d10c4bb2c80ce1378f76aeee5a1e4426a981a352。
开始时工作区干净且已处于专用修复分支；只读检查本地/远端分支和相关历史提交，未修改 index、引用或历史。没有 .codegraph 目录。

## 实际测试失败：已补充取证，动画根因尚待 CI 验证

130232923662 的 signed_in_zhajinhua_game_effects 首败仅有一个错误：zhajinhua-prop-beer 飞行 peak 视觉回归，全部 moving 候选对正式锚点的最小色差 17.54989750445633，上限 15。
首败持续 395262ms，retry 1 持续 400205ms 并通过，但 failOnFlakyTests 拒绝 flaky。不能以重试通过宣布无需改动。
两次接收者时间线均有 20 帧，首个明显效果均在 index 10，peak 分别为 index 10、11；接收者素材、结束恢复和飞行运动断言都已通过。
已保存的 flight-peak 对正式 peak 复算分别为 18.006969696969698、5.587878787878788。首败所选帧不能复现实际最小值 17.5498975，证明报告缺少其他候选。
两次都没有 beer raw-samples；首败未执行到 flight-changed 附件。尚无法区分中途相位遗漏与实际渲染偏差，不凭这些结果调整采样、阈值或基准。

本轮视觉附件 13817058794 和设备诊断 13817133680 的 run/attempt 名称及上传 job 均已核对。
下载到全新 .ttyctl/investigation-42931986349-1-e7e07cd/report 和 diagnostics，命令成功后才读取；HTML 内嵌 ZIP 已通过 testzip 校验。
HTML 首个 base64 是非 ZIP 资源，解析报错后停止该读取；随后按 PK 签名选择真实内嵌报告，并校验后读取，没有沿用旧解压报告。
构建身份为 applicationCommit=f3ba50029e9b33b90c09841e35b8cd838b304061、buildNumber=300004201、APK SHA256=57f15755f3554920f595789d004ebbf44bc225439ef8d5375dc93c53139e1fd4。
设备 logcat 轮转只保留 00:42:07 后数据，已处于重试，无法重建首败采样。

## 复用已有实现与反例

50cac25（origin/kevinanew/e2e-js-ts-3-6）已有德州啤酒原始区域取证；当前 0180d77/e7e07cd 已保留同类 helper，但仅启用德州茶、炸金花水。本次复用该 helper，仅把 zhajinhua-prop-beer 加入两个名称条件，并扩展现有参数化测试。
诊断在原断言 finally 中执行，仅保存已返回帧的原效果/飞行区域 PNG 与 capturedAt，不保存完整屏幕、不查询设备、不重触发、不改变采样或断言。裁切与附件异常继续被 catch 隔离。
修复的是本轮已证实的候选帧取证缺口，未宣称动画故障已修复。

历史 42923278206 水道具首败 15.00469、重试通过，与本轮道具不同，不能把水诊断已启用视作啤酒证据充分。
50cac25 记录的德州啤酒曾先路径帧不足、再 changed 色差超限、最后通过；不能把不同失败归结为同一种原因。
f4344e1 的茶道具区域采样及历史约 9fps 录像的水/啤酒失败，都不能证明本轮整屏 PNG 的因果关系，不移植采样改动。
历史 43f810d 备用图放行被 4cc323f 移除，本次不恢复目录驱动放行或增加锚点。
下一轮 CI 对首败与成功尝试的全部 beer flight 区域按原 moving >1 过滤、原锚点和 frameColorDistance 复算最佳距离，核对 capturedAt 的真实间隔和位置覆盖，以检验“关键相位未采到”的明确假设；若覆盖充分仍超限，继续调查渲染差异。

hierarchy-error 是 captureFailure 失败收尾中已捕获的 adb cat 异常，报告 errors 仅原始视觉断言，无独立测试失败，无需改动。启动前故意输出的诊断/cleanup 错误来自通过的单元测试，未导致步骤失败。

## 连带失败逐项结果

全部日志已分别读取；guest/en 首次下载失败，重新读取成功后才判断。保留所有门禁。

| job | 检查 | 依据和结果 |
| --- | --- | --- |
| 130240347741 | Android full regression | 优先分片失败、remaining skipped，完整覆盖未通过；无需改动汇总门禁 |
| 130240500115 | Android (texas / zh-Hans / table) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500199 | Android (texas / zh-Hans / other) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500247 | Android (texas / zh-Hant / table) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500176 | Android (texas / zh-Hant / other) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500228 | Android (texas / en / pregame-first) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500250 | Android (texas / en / pregame-middle) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500350 | Android (texas / en / pregame-second) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500217 | Android (texas / en / game-table) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500265 | Android (texas / en / game-effects) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500283 | Android (texas / en / panels) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500271 | Android (texas / en / other) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500328 | Android (zhajinhua / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500410 | Android (zhajinhua / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500488 | Android (zhajinhua / en / pregame-first) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500404 | Android (zhajinhua / en / pregame-second) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500355 | Android (zhajinhua / en / game-table) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500343 | Android (zhajinhua / en / game-effects) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500326 | Android (guest / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500665 | Android (guest / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500387 | Android (guest / en) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500413 | Android (account / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500496 | Android (account / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500381 | Android (account / en) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500450 | Android (social / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500402 | Android (social / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500451 | Android (social / en) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500595 | Android (rooms / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500599 | Android (rooms / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500758 | Android (rooms / en) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500606 | Android (wallet-help / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500546 | Android (wallet-help / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500577 | Android (wallet-help / en) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500474 | Android (records / zh-Hans) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500534 | Android (records / zh-Hant) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |
| 130240500562 | Android (records / en) | COMPLETE_RESULT=failure，门禁退出 1；无需改动 |

## 验证

10 项定向测试全部通过，包括三种目标道具的时间戳及原区域像素保留、裁切/附件失败隔离、非目标道具隔离、飞行锚点丢失时仍保留 ENOENT，以及目录额外备用图不能放行。
修改文件 ESLint、npm run typecheck、git diff --check 通过。本地未启动模拟器或重复原生矩阵；原生失败根因及稳定性仍待 CI 新证据，不申报 NO-FIX。
