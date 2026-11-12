# CI 42923278206 / attempt 1 调查

诊断指纹 `437daff0dd3ddc105ece4dc1c278aa38812ff627a5fcfaec2d986fc1784caeb8`。
37 个诊断 job 的 API run_id、run_attempt、head_sha 已逐项校验，为 42923278206、1、4a4ff41c324e2f2dd238c2239e7b3f4164f16097，与工作区 HEAD 一致。
实际 checkout 日志为 PR 合并提交 09422bdf2c98837c42f5aacdc76dc6b9f81b0736，将该 HEAD 合入 e8bd5e3。
当前已有专用修复分支，工作区起始干净，全程只修改文件。

## 实际失败与可验证的证据缺口

Job 130211387633 的 signed_in_zhajinhua_game_effects 首次失败于 zhajinhua-prop-water 飞行 peak，全部候选对正式锚点的最小 frameColorDistance 为 15.004692513368983，上限为 15。
首败 23:46:22.486Z 开始，持续 241718ms；retry 1 持续 303833ms 并通过，报告 outcome=flaky，failOnFlakyTests 拒绝该结果。
首败和重试的接收者 timeline 都有 20 帧，分别在第 12、11 帧出现明显素材，两次素材比较、结束恢复及飞行运动断言均执行通过。
首败报告仅保留 flight-start 和所选 flight-peak，没有全量飞行候选或 capturedAt，且尚未执行 flight-changed 附件保存。两次均无 raw-samples 附件。
按生产 frameColorDistance 复算所选 flight-peak 对正式 peak 的距离分别为 16.816501782531194、16.760485739750447。重试通过说明真正最佳候选并非所选 peak，首败的 15.00469 也不能从该图复现。现有附件不能区分相位遗漏与实际渲染偏差。
失败后 hierarchy.xml 的 adb cat 异常属于 captureFailure 已捕获的 hierarchy-error 附件，报告只有原始色差断言错误，未形成独立测试失败。启动前单元测试故意输出的 cleanup 错误也未导致其步骤失败。

报告附件 android-staging-visual-zhajinhua-en-game-effects-42923278206-1（artifact 13815270375）由该 job 日志关联，下载前已核对 run、attempt 和 HEAD。
使用全新目录 /tmp/ci-42923278206-attempt1-cRuEhF，下载解压成功后才读取；报告内嵌 ZIP 单独校验 testzip 成功。
构建信息为应用 f3ba50029e9b33b90c09841e35b8cd838b304061，构建 300004201，APK SHA256 57f15755f3554920f595789d004ebbf44bc225439ef8d5375dc93c53139e1fd4。

## 已有修复、反例和本次改动

修改前只读检查全部本地/远端分支，以及 asset-sequence 的历史提交。0180d77 已提供德州茶道具原始区域采样诊断；50cac25 有同类啤酒取证实现，本次复用当前 helper，仅扩展到 zhajinhua-prop-water。
f4344e1 的原生区域采样针对德州茶道具，涉及驱动协议及缓存，本轮无全量帧证据支持直接移植。历史调查还记录约 9fps 录像让水、啤酒失败，且茶道具曾首次失败、重试通过，不能以改用录像或一次通过作为因果证明。
43f810d 曾允许额外水道具相位，但 4cc323f 已明确移除目录驱动的备用图放行。本轮没有证据支持恢复该规则或新增锚点。

本次在原有 finally 诊断中增加水道具名称，保存驱动已返回的全部接收者及飞行区域 PNG 和 capturedAt。完整屏幕不写入新增附件。裁切及附件异常均由既有 catch 隔离。
采样命令、触发、重触发、断言、正式基准、阈值与稳定性门禁继续按原配置执行。
这是已证实的取证缺口修复，原生动画失败的最终根因尚待 CI 证据。后续用 raw-samples 的全部飞行候选按生产运动过滤和原锚点复算最小距离，并核对真实时间间隔，检验相位遗漏假设；不能把重试成功视为无需修改。

## 连带失败逐项核对

130225802743（Android full regression）的日志明确 remaining.result=failure，completeRun 因完整回归未通过抛错。其自身无需改动。
以下 35 个 job 均已单独读取日志，全部在 COMPLETE_RESULT=failure 时执行 test "$COMPLETE_RESULT" = success 退出 1，各自没有独立测试失败。每项均证实为连带门禁，无需改动。

- 130225970246 — Android (texas / zh-Hans / table)，连带门禁，无需改动。
- 130225970280 — Android (texas / en / pregame-first)，连带门禁，无需改动。
- 130225970287 — Android (texas / zh-Hant / other)，连带门禁，无需改动。
- 130225970341 — Android (texas / en / game-effects)，连带门禁，无需改动。
- 130225970349 — Android (account / zh-Hans)，连带门禁，无需改动。
- 130225970350 — Android (texas / en / pregame-middle)，连带门禁，无需改动。
- 130225970366 — Android (zhajinhua / en / game-effects)，连带门禁，无需改动。
- 130225970379 — Android (zhajinhua / en / pregame-second)，连带门禁，无需改动。
- 130225970384 — Android (social / zh-Hant)，连带门禁，无需改动。
- 130225970400 — Android (rooms / en)，连带门禁，无需改动。
- 130225970403 — Android (guest / zh-Hans)，连带门禁，无需改动。
- 130225970410 — Android (texas / zh-Hant / table)，连带门禁，无需改动。
- 130225970413 — Android (texas / en / panels)，连带门禁，无需改动。
- 130225970415 — Android (account / zh-Hant)，连带门禁，无需改动。
- 130225970420 — Android (texas / zh-Hans / other)，连带门禁，无需改动。
- 130225970427 — Android (social / zh-Hans)，连带门禁，无需改动。
- 130225970430 — Android (account / en)，连带门禁，无需改动。
- 130225970433 — Android (texas / en / game-table)，连带门禁，无需改动。
- 130225970440 — Android (wallet-help / zh-Hant)，连带门禁，无需改动。
- 130225970441 — Android (zhajinhua / en / pregame-first)，连带门禁，无需改动。
- 130225970445 — Android (zhajinhua / zh-Hans)，连带门禁，无需改动。
- 130225970446 — Android (guest / zh-Hant)，连带门禁，无需改动。
- 130225970451 — Android (texas / en / pregame-second)，连带门禁，无需改动。
- 130225970452 — Android (rooms / zh-Hant)，连带门禁，无需改动。
- 130225970481 — Android (rooms / zh-Hans)，连带门禁，无需改动。
- 130225970487 — Android (guest / en)，连带门禁，无需改动。
- 130225970491 — Android (social / en)，连带门禁，无需改动。
- 130225970509 — Android (zhajinhua / en / game-table)，连带门禁，无需改动。
- 130225970520 — Android (zhajinhua / zh-Hant)，连带门禁，无需改动。
- 130225970525 — Android (records / zh-Hans)，连带门禁，无需改动。
- 130225970531 — Android (wallet-help / zh-Hans)，连带门禁，无需改动。
- 130225970601 — Android (records / zh-Hant)，连带门禁，无需改动。
- 130225970632 — Android (texas / en / other)，连带门禁，无需改动。
- 130225970659 — Android (wallet-help / en)，连带门禁，无需改动。
- 130225970722 — Android (records / en)，连带门禁，无需改动。

## 验证

7 项定向单元测试通过，覆盖两种目标道具的全部尝试、时间戳与原区域像素保留，其他道具隔离，裁切/附件失败隔离，以及缺失飞行锚点时附件失败仍保留 ENOENT。既有未登记备用图不能放行测试通过。
修改文件 ESLint、TypeScript 类型检查与 git diff --check 通过。本地未启动模拟器或重跑原生矩阵，原生失败仍需 CI 验证。不申报 NO-FIX。
