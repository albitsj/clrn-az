# Android CI 42568906820 首败取证

- 诊断指纹：`1553d458f783cd491b524c915f219c995dfb74bf3cffb31cb344ddec0d24e4a5`
- run / attempt：`42568906820 / 1`；PR HEAD：`96e3c80b63006f99fe749d57ebe85de9b8a48a91`。
- job API 的 HEAD 与本地一致；实际 PR 合并测试提交为 `7a669e05fad398003b4c5257dc3ec85330097cd0`。
- 已逐项读取诊断列出的 45 个失败 job 日志：9 个 remaining、1 个完整回归、35 个汇总门禁。
- 附件按本轮 run、HEAD 和名称中的 attempt 校验后下载到全新临时目录，ZIP 校验和解压成功后才读取；同时检查 `logcat.log` 和 `logcat.log.1`。

## 每项实际失败

| remaining job | 已取得的依据 | 结论／下一步 |
| --- | --- | --- |
| 129001593919 texas / zh-Hant / other | controls 首败截图明确为 `Network Error-room_profile`；retry 1 的房间删除因全部候选健康探测超时而失败；retry 2 及 table_states、panel_variants 各次截图均停在同一个未清理私人房间，找不到建房入口。 | 网络错误及清理失败已证实；首次请求详细记录已轮转，不能推断所有根因都是上游。保留原门禁，固定每次失败时的日志以区分代理、应用选线和上游故障。 |
| 129001593973 zhajinhua / en / pregame-first | settings-exit-end 附件显示 `Connecting...`，导致动画终点像素不匹配；此前入口已通过 gameConnected，重试通过。 | 入口就绪不保证录制末尾仍连接；尚不能区分真实连接故障和时序问题，不修改采样、终点比较或遮罩。固定首败窗口确认重连触发原因。 |
| 129001594151 zhajinhua / en / pregame-second | 05:56:53–05:56:58 四个 bootstrap 探测均 timeout，登录请求 `attempts=0`，模拟器和测试步骤未开始。 | 该次失败证实为账号准备阶段无法取得健康节点；不重放登录，不放宽超时。 |
| 129001594344 guest / zh-Hant | 启动品牌测试首次在重新启动后等待 staging-confirmation-input 超时；截图停在 `68 v1/status` 网络错误弹窗。失败在 hold 健康检查之后、正式启动页采样之前。 | 不能仅凭重试通过判为无须修改；需首败 W/I 级日志确定与有意 hold 的关系。固定首次失败日志，不取消错误弹窗或增加 RETRY。 |
| 129001593970 guest / en | network-64-unavailable 的快照仅有 64、68 的预期注入 503，以及真实 67 健康请求 error；应用日志另记录 65 状态接口 network_error，初始化未完成。 | 真实候选请求失败已证实，保留要求首次初始化成功的原断言；不伪造健康响应。冻结日志供继续核对故障注入与客户端选线。 |
| 129001594365 wallet-help / zh-Hans | 05:56:52–05:57:17 metadata 和健康探测连续超时；选中旧 bootstrap 后登录在总时限内超时，`attempts=1`，测试未开始。 | 该次真实账号登录请求超时已证实；不能根据别的节点稍后成功就认定增加超时或重试登录安全，不改网络策略。 |
| 129001594234 wallet-help / zh-Hant | mall 首败仍在登录表单；purchase_history 首败已回到游客设置；gift_card 首败停在礼品卡页并等待进度条消失超时。三项均 retry 通过。最终日志两代最早为 05:53:42，已晚于三个首次失败的发生窗口；runtime 只采 E 级，缺少请求失败的 W/I 级细节。 | 登录结果、会话失效、请求等待尚待证实；不能将三项声明为无须修改。固定每项首次失败的已有脱敏日志，区分会话状态和网络响应。 |
| 129001594049 records / zh-Hans | v2 首败详情等待超时，截图是 `Network Error`；logcat.log.1 在 05:57:12 显示 `/v10/profile/users` 无响应的 Network Error，retry 的同一流程通过。 | 详情依赖的资料请求失败已证实；仍需其首败窗口判别代理转发或上游，不替换真实资料响应。 |
| 129001593990 records / en | legacy 首败重新打开列表后等待 my-game-record-list 超时，截图为双加载指示器；最终两代日志从 05:49:31 开始，而首败为 05:46:41–05:48:39。retry 完整流程通过。 | 请求挂起、代理 hold 状态和原生状态尚待证实；固定首次失败的日志，不能以延长等待或重试通过代替定位。 |

## 汇总门禁

完整回归 job `129012681227` 因 remaining.result=failure 报错。其后诊断列出的 35 个 `Android (...)` job 均只执行 `test "$COMPLETE_RESULT" = success`，环境值为 failure，没有独立测试失败。已逐项核对，证实这些门禁自身无须修改，继续保留。

## 已有修复及反例

修改前只读检查全部现有分支及提交。`96e3c80` 已含密码页独立冷启动；`bc3048e` 已含聊天再次入场连续录屏；`a2e3a00` 保留诊断失败时的原比较结果；未丢弃或重复实现。复用已有 `preserveAnimationFailure`，不再实现一套日志采集器。

历史 run `42565523529 / attempt 1 / bc3048e` 实际只在 account/en priority 失败，remaining 未运行，因此它不构成本轮 remaining 用例此前全部通过的证据。该历史 run 的密码页问题仍需上游应用修复，不能把 `96e3c80` 的独立 worker 当作已证实的修复。

固定同一账号的冷启动对照 `42568471301 / attempt 1 / 74f8aa2` 在 retry 1 仍出现 4742 像素差异，而包含全部前置页面的对照 `42568473860` 首次通过。独立会话与前置页面都不足以解释全部反例，因此撤回 `96e3c80` 的特殊 worker，保留原场景顺序与严格比较。应用布局候选在 [laiwan_react_native #7091](https://github.com/kevinanew/laiwan_react_native/pull/7091)，实际 APK、三语原生截图及完整比较仍须单独验证。

本轮 retry 成功、其他语言成功，以及部分健康接口返回 200，均不能排除短时请求失败或测试状态问题；尤其拼三张进入采样前已连接、终点却重连，是“只等入口就绪即可解决”的直接反例。故本次不按猜测修改时序或网络重试策略。

## 本次最小改动及验证

`captureFailure` 在任何额外设备诊断之前复制现有脱敏 logcat/adb/host/lifecycle 两代文件到当前尝试附件，包含缺失文件清单。后续重试不能覆盖它们。复制或附件失败均不替换原错误；不增加设备探测，不更改任何采样或断言。

定向单元验证覆盖：复制发生在日志轮转之前、截图不可用仍保留首败日志、报告写入失败仍抛出同一个原始超时；同时运行已有动画日志保留测试。远端 Android 原始失败尚未验证修复，需 CI 使用 `failure-diagnostics-*` 附件继续定位；没有以未完成调查申报 NO-FIX。

## 密码页应用修复的原生证据

[参考采集 42577473320](https://github.com/albitsj/clrn-az/actions/runs/42577473320) 的三语密码页各 1 项首次通过，0 retry、0 flaky、0 skipped；测试 HEAD 为 `a2c3bc9837dff05c464f0e33b641d9beedc9e77b`，attempt 1。报告构建信息均对应应用 `beea05ce1f1fa92c9bd3ad7ae5cc97000bce0a8f`、Release `android-staging-100002101-beea05ce1f1f`，APK SHA-256 `4c00f64258d905df2d1c0f3df1b4cba1e787ed7684dd140d7a0fd37000f44610`。

逐图审查三张完整 720×1280 原生稳定截图：英文旧、新密码提示均完整单行显示，标签没有重叠或裁切；简繁中文标签及提示完整，确认按钮及页面结构正常。英文输入框从旧版的 367 像素变为旧密码 402、新密码 387 像素，边界分别为 `(258,196,402,100)`、`(273,316,387,100)`。字体仍为 15，density 320、font_scale 1.0。自然标签宽度与剩余输入宽度匹配，无需特殊会话或容差调整。

只接收三个成功场景报告中与 `toMatchSnapshot` 使用同一 Buffer 的原始稳定 PNG 附件，按原始字节复制到唯一正式基准；未从包含其他既有图片的 reference 全目录覆盖。

| 语言 | job | PNG SHA-256 |
| --- | --- | --- |
| zh-Hans | `129028802909` | `158099a19ec717dba5b7665ed007bdf688f096104f9a8e5417e540987f0166a2` |
| zh-Hant | `129028802913` | `f5be4478b008b4e1454839812748bc9355f7a0502568067aa24d047cbd2137e5` |
| en | `129028802916` | `4e811a10dbb66a3af34d9b091ebd5a99049cdb710652834f0f6d73f2112b5bb0` |

以上只证明候选原生画面符合布局修复；提交后的 compare 完整矩阵及最终主分支 CI 仍须通过，reference 成功不代替正式回归。
