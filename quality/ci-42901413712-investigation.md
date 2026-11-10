# Run 42901413712 / attempt 1 调查

诊断指纹 `e438464c70be7d79739885c67c5f863e9728af84aa573e59c431838813aea362`。
run API、全部诊断 job 及附件 workflow_run.head_sha 均为 `0180d775e0a36e42691dc36024051fa5266d1133`，与工作区 HEAD 一致。
报告实际测试 PR 合并提交 `9a8afbaef30a0cd9260383bf061ab6b762b94d3f`，日志确认合并父提交为该 HEAD 和 e8bd5e3。
工作区开始时干净，已在专用修复分支。修改前只读检查现有本地及远端跟踪分支、相关历史提交与调查记录。
仓库没有 .codegraph。保留 HEAD 已有节点发现修复及茶道具原始采样诊断。

## 四项执行失败

| job | 实际失败 | 本轮处理与验证 |
| --- | --- | --- |
| 130138060205，social/en | club-rooms-empty-enter 末帧尚未完成淡入，触发 animation-transition.ts 的采样终点检查 | 已实施根因修复，待 CI 原生验收。复用 e8890d4 针对此转场的 launchFrames 选择，既有长采样命令和全部比较流程继续执行。 |
| 130138061467，texas/zh-Hans/other | hall_variants 的真实光标检测返回 undefined | 已修复诊断传递缺口，光标失败根因待 CI 证据。复用 708a331、9fd9ca3 的 diagnosticsInfo、采样几何状态及零次采样附件保存器。 |
| 130138061639，zhajinhua/en/pregame-first | renew 入场等待余额节点超时，gameReady 一直找不到节点 | 已补齐定向诊断，根因待 CI 证据。续费入场复用现有点击时间线、失败现场和即时日志保存路径，采样与原余额断言继续执行。 |
| 130138060780，guest/en | 品牌页比较通过，释放 hold 后 settings-tab 等待 120 秒失败 | 已补齐定向诊断，根因待 CI 证据。复用 bbaaa38、9fd9ca3 的既有网络状态和代理传输诊断，并在首败现场固定现有日志。 |

### 俱乐部空态

首败 20 帧时间戳 236908..238656，跨度 1748ms。末帧 3286d6a…仍处于淡入，终点为 85269d84…。
重试 20 帧时间戳 312805..314733，跨度 1928ms，末帧 a365eb9…已通过原终点比较。
当前驱动 motionFrames 同时受 3200ms 和 20 帧上限约束，帧数先耗尽会提前停止。
历史 e8890d4 的失败跨度 1648ms，成功重试跨度 1743ms，同样记录了未完成末帧。
两轮不同的成败时长说明不存在可由一次通过推定的固定安全时长，20 帧不足以保证覆盖此空态淡入。
复用现有 launchFrames 的 10 秒／70 帧预算，保留区域、点击顺序、300ms 触发延迟、原基准、首尾与中间相位检查。
离线使用本轮两条原始时间线和原图调用生产 captureNativeTransition，命令设为 launchFrames，首败仍在原终点检查失败，重试仍通过。
这验证长命令继续拒绝未完成末帧，实际设备上的长采样稳定性须交由 CI 验收。

### 简中光标

原调用只传 context.animationInfo，非英文为 undefined，因此已有 preserveCaretFailure 完全未执行。
本轮报告缺少 caret-state、caret-before、caret-after。最终截图和采样后的单次焦点状态无法区分闪烁漏采、布局移动或失焦。
历史 708a331 已记录同样的非英文诊断断路，本轮复用其必要改动，既有十二次采样次数、延迟、输入和窄光标尺寸判定继续执行。
下一次失败用 samples 数量、焦点与边界区分零次采样失焦和实际帧未识别，再对两张原图复算细光标差异。
重试通过不足以解释首败。诊断附件及取证异常均隔离并保留原始检测异常。

### 拼三张续费

首败原片 cc66de3…在 Renew 菜单仍可见时出现 Connecting 遮罩，最后截图仍是展开的菜单，续费弹窗未打开。
错误来自找不到 renew-popup-remain-diamond，不能据此解释为余额数值为零。
历史 42715187841 的续费失败确实出现余额 0 和钱包 PUT error，与本轮缺失整个弹窗不同。
现有网络记录包含连接切换，但缺少续费实际点击的时间与入口几何状态，无法证明遮罩是否在触发瞬间拦截点击。
最终 logcat 最早从 21:50:50 开始，晚于 21:48 左右的首败，不能用成功重试的日志反推首败原因。
本轮把既有脱敏输入时间线、原有日志快照与失败节点白名单用于 zhajinhua-renew-enter。
下一轮对齐 tap、tap-complete、录屏、重连与菜单／续费节点状态，验证遮罩拦截和旧坐标假设。
诊断不重新点击、不查询采样中的设备，也不更改原等待和余额／价格断言。受阻于首败窗口缺失，待 CI 取得证据。

### 品牌页释放网络后失败

error-context 明确定位 launch-branding.spec.ts 的末尾 settings-tab 等待，前面的品牌页像素比较已经通过。
最后截图为 staging 的 68 v1/status 网络错误。runtime 中 21:30:12 的 67 v1/status 后台初始化错误早于后续品牌采集，不能单独证明释放后的错误原因。
本轮最终两代 logcat 最早从 21:34:09 开始，晚于 21:29:35 开始且持续 167417ms 的首败。
历史 42750216827 同样在释放后失败，而 42756670268 在 hold 开启之前的首次大厅初始化就失败。
因此不能把所有启动失败都解释为 hold 时序，也不能根据重试通过认定节点或代理健康。
本轮复用原轮询返回的 requested/lastRequestedAt、释放返回状态、既有脱敏选线事件和代理／路由可达性诊断，首败立即保存已有日志。
下一轮根据释放时刻与选线响应／错误和代理 TCP 状态区分暂缓窗口、代理传输及上游失败。受阻于首败窗口缺失，待 CI 取得证据。

## 连带门禁

完整回归 job 130161432506 明确记录 priority.result=success、remaining.result=failure，正确拒绝当前提交，无独立修复点。
下列 35 个 job 已逐个读取完整日志，均为 COMPLETE_RESULT=failure 后执行原 test 检查退出 1。
每项均已证实为完整回归结果的连带门禁，无需改动。

| job | 名称 | 结果 |
| --- | --- | --- |
| 130161618123 | Android (zhajinhua / en / game-table) | 已证实无需改动，连带门禁 |
| 130161618134 | Android (texas / zh-Hans / other) | 已证实无需改动，连带门禁 |
| 130161618158 | Android (texas / en / pregame-middle) | 已证实无需改动，连带门禁 |
| 130161618164 | Android (texas / zh-Hans / table) | 已证实无需改动，连带门禁 |
| 130161618174 | Android (zhajinhua / en / pregame-first) | 已证实无需改动，连带门禁 |
| 130161618181 | Android (guest / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618183 | Android (texas / zh-Hant / other) | 已证实无需改动，连带门禁 |
| 130161618213 | Android (zhajinhua / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618220 | Android (guest / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618242 | Android (texas / en / pregame-second) | 已证实无需改动，连带门禁 |
| 130161618243 | Android (zhajinhua / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618252 | Android (records / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618268 | Android (texas / en / panels) | 已证实无需改动，连带门禁 |
| 130161618289 | Android (social / en) | 已证实无需改动，连带门禁 |
| 130161618329 | Android (wallet-help / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618333 | Android (rooms / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618334 | Android (texas / en / game-effects) | 已证实无需改动，连带门禁 |
| 130161618335 | Android (social / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618337 | Android (texas / en / game-table) | 已证实无需改动，连带门禁 |
| 130161618338 | Android (zhajinhua / en / game-effects) | 已证实无需改动，连带门禁 |
| 130161618341 | Android (account / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618345 | Android (records / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618360 | Android (rooms / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618364 | Android (rooms / en) | 已证实无需改动，连带门禁 |
| 130161618365 | Android (account / zh-Hans) | 已证实无需改动，连带门禁 |
| 130161618376 | Android (texas / en / other) | 已证实无需改动，连带门禁 |
| 130161618384 | Android (wallet-help / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618389 | Android (social / zh-Hant) | 已证实无需改动，连带门禁 |
| 130161618391 | Android (guest / en) | 已证实无需改动，连带门禁 |
| 130161618397 | Android (wallet-help / en) | 已证实无需改动，连带门禁 |
| 130161618451 | Android (account / en) | 已证实无需改动，连带门禁 |
| 130161618456 | Android (records / en) | 已证实无需改动，连带门禁 |
| 130161618472 | Android (texas / zh-Hant / table) | 已证实无需改动，连带门禁 |
| 130161618512 | Android (texas / en / pregame-first) | 已证实无需改动，连带门禁 |
| 130161618607 | Android (zhajinhua / en / pregame-second) | 已证实无需改动，连带门禁 |

## 附件与校验

所有下载位于全新目录 /tmp/clrn-run42901413712-attempt1-FEZT9K。
归档日志直连下载超时后改用已连接 GitHub 工具逐 job 读取，未读取零字节 logs.zip。
四份报告分别下载成功并检查 ZIP CRC、路径安全后解压至新 artifact ID 目录。
首次内嵌 ZIP 提取误匹配非 ZIP base64，校验失败即停止，随后选择 PK 签名的载荷并提取至全新 report-v2 目录。
四份报告构建一致为 f3ba50029e9b33b90c09841e35b8cd838b304061 / 300004201，APK SHA-256 为 57f15755f3554920f595789d004ebbf44bc225439ef8d5375dc93c53139e1fd4。

| artifact | ZIP SHA-256 |
| --- | --- |
| 13804933449 | c403cc4280cfb88a04041ac27f42aaf7b998d7136284105ba03c4a4e26a53a6d |
| 13804834182 | 0ba3b2f87a98dc3cba6397a60ca395cf124932b5cbdf8088479cc5e2d75e333b |
| 13805529513 | ab7c678d4b90de7704b3931cffb05d895d8a64b2a00ff542e317d673d90fd757 |
| 13806208630 | bb7588dfcfa270494e5a94e4e53164b32159cc218590b45c91e99a236588219c |
| 13807027132 | 9d9f11804075eabd296d4c22c4d35e657aa02571d548e91b39a257e3f6b179d9 |
| 13805419703 | 42e91899912e23b88323a4277e5cf0535bc92052175f784ea2347d7441d23ddc |
| 13804444011 | b3bab498a081399755c186b1edc061bcbf8f394780db7ad670a79e878773b5f0 |
| 13805208066 | 340d706b7baa9ca2bc4c1a1becd06ff934e665a9da2358aec81ab620f6edd485 |

## 本地验证

使用仓库 test-local.mjs 的既有 --import tsx 入口执行四个定向文件，共 15 项通过，0 failed、0 skipped。
覆盖缺失焦点时保留零次采样、诊断不泄露输入文字、续费失败保留同一个原异常及单次点击、代理读取和附件故障隔离。
代理测试调整至本仓库复杂度上限后单独再次执行通过。
本轮俱乐部两条真实轨迹经生产比较器离线回放，分别复现首败与通过结果。
类型检查、JS lint（含复杂度）、行数、依赖架构、重复代码及 diff 检查通过。
首次直接 node --test 缺少仓库所用 tsx 加载器导致三个文件加载失败，随后按既有加载方式运行通过，未修改环境配置。
未运行本地模拟器矩阵，远端完整回归及三个未定根因的后续证据须由 ci-guard 推送后交给 CI。
本轮存在必要代码与诊断修改，故未写 NO-FIX 文件。
