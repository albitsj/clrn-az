# Android Staging 视觉回归

这里仅保存原生界面测试、截图基准和 Release 下载工具。应用源码和构建流程留在 `laiwan_react_native`；Woodpecker 将 APK 发布到 clrn 的 Release，APK 下载到被 Git 忽略的 `android/artifacts/current/`，不提交到 clrn-az。

## 测试内容

使用 Playwright Android 原生控件驱动操作正式构建的 Staging APK，正常完成初始化和真实账号登录。`scenarios.ts` 从 Web 的 `buildScenarios` 读取手机页面，共 71 个可达基础场景、三种语言，包含游客、认证、账号、社交、大厅、私人房建房表单、钱包和帮助页面。保留原有四张认证冒烟截图。网页的桌面留白不重复计入安卓覆盖；安卓截图独立保存，不能直接比较网页像素。

俱乐部搜索命中用例在社交业务组三种语言运行：正常登录后打开搜索页，再启用 mitmproxy 的定向只读夹具，实际提交关键字，核对结果卡片和搜索、资料两段请求，并将稳定后的原生截图与各语言独立基准比较。现有搜索初始页基准保留；新基准须由固定 x86_64 自动测试模拟器的参考图任务采集、逐图审查后提交。三张搜索命中基准来自[参考图任务 40219814546](https://github.com/albitsj/clrn-az/actions/runs/40219814546)，使用 `android-staging-300000901-c451f743aad6`；三个语言的用例均通过，已分别核对关键字、结果卡片及完整画面。正式比较仍以提交后的自动测试结果为准。

Web 另外有 5 个下载帮助场景。当前 Staging APK 的发布渠道为 `default`，原生 `SettingItems._listAndroidAdSectionItems` 仅在 `self-host` 渠道显示该入口，因此在 `unavailablePages` 明确列为不可达，不计入通过数量。

动画关键帧统一只保留英文（`en`）一套；采集入口会拒绝其他语言，牌桌空座箭头、倒计时和比牌目标也仅在英文任务保存运动采样附件，普通页面继续保留三语言。截图中心的动画单列展示，不提供多语言切换。

`animation-baselines.json` 登记已审查的英文动画帧；普通代码 CI 也核对文件完整性，缺帧、遗留中文动画或未登记的动画都会失败。新增动画必须同步更新清单与真实采集图，普通页面不在该清单中。

动画测试清单见 [ANIMATION_COVERAGE.md](ANIMATION_COVERAGE.md)。英文模拟器对实际入口采集起点、中途和终点，循环效果保存多个运动相位；短弹层使用 Android 原生录屏。素材测试另锁定 WebP 的逐帧哈希与时长。手动工作流的 `reference` 模式只生成待审查候选图，提交基准后须用 `compare` 模式验证。

启动页另由 `launch-pages.spec.ts` 在游客组三种语言任务采集。先通过应用设置选择语言，再冷启动，保存测试环境提示出现后的完整 `720×1280` 屏幕，命名为 `<locale>-launch-staging-notice.png`。整屏连续稳定两秒后比较，不裁切、不加页面遮罩。截图中心将它与启动动画放在同一“应用启动”场景的“页面”分类。可用 `group=guest`、`locale=all`、`filter=launch_staging_notice` 定向生成和比较。

品牌启动页由 `launch-branding.spec.ts` 通过真实确认按钮进入：代理暂缓 `/node/v1/status`，在应用自然等待初始化的阶段保存 `<locale>-launch-branding.png`。不改应用状态、系统时钟或超时；整屏须稳定两秒且前后没有测试提示或错误弹窗，释放真实请求后还必须正常进入大厅。两种启动状态可用 `filter=launch_(staging_notice|branding)` 一起比较。

启动截图沿用正式基准的英文系统环境，应用语言由真实设置切换。提示文案随应用语言变化；当前 APK 的品牌文案读取系统语言，因此这组三语品牌图均显示 `GoPlay360 / Play with friends`。这记录实际行为，不通过修改内部语言存储制造中文品牌。原有 `native-launch-artwork-visible.png` 继续作为启动瞬间的局部插画检查，不当作完整启动页。

三语测试环境提示基准来自 [reference 39153754436](https://github.com/albitsj/clrn-az/actions/runs/39153754436)，使用 [APK 7319](https://github.com/kevinanew/clrn/releases/tag/android-staging-7319-fcf7a0a22576)。只接收这轮成功用例的完整 PNG，保留全部原动画基准。

三语完整品牌页基准来自 [reference 39154218107](https://github.com/albitsj/clrn-az/actions/runs/39154218107)，使用同一 APK，三个用例全部通过。每张均为原生完整屏幕，英文系统下三张品牌图的 SHA-256 相同，已核对品牌、标语、角色和水面完整可见。

战绩直接复用 Web 的完整状态清单：旧版 32 个、新版 30 个状态，三种语言，共 186 张截图。覆盖加载、空列表、列表底部、分数选择汇总、侧滑删除、详情输赢展开、结算、回放入口、分页和故障恢复。与基础场景及冒烟图合计 403 张正式基准。德州完整 95 个状态、拼三张完整 26 个状态已接入同一份 Web 清单，涵盖操作控件、边池、旁观、聊天举报、带入审核、牌谱、主题、语音面板、大厅和故障恢复；三语合计 766 张截图，由 256 个测试用例执行。全部基准均来自固定 x86_64 CI 环境并经过审查；回归结果以对应提交的 compare 运行及 PR 检查为准。

网络代理直接在 Python addon 内读取商品、私人房、俱乐部等必要夹具；TypeScript 仅选择命名场景，不启动响应服务。未匹配的请求继续访问真实服务。逐项保留/迁移决定、接口范围及本轮验证限制见[网络夹具清单](../docs/network-fixtures.md)。新增 `signed_in_club_rooms_populated` 场景仅在该用例中由 mitmproxy 返回一个俱乐部及两条牌局，沿用原有空态场景；三张原生基准来自 [reference 40212302471](https://github.com/albitsj/clrn-az/actions/runs/40212302471)，使用 `android-staging-300000901-c451f743aad6` 的固定 API 35、720×1280、x86_64 模拟器。三种语言用例均通过；逐图核对两条牌局、人数、等待状态、界面语言和完整画面，保留原空态基准；三语社交场景在 [比较运行 40220337781](https://github.com/albitsj/clrn-az/actions/runs/40220337781) 中均已通过。真实登录成功后，仅将本人昵称、展示用户名、注册日期和余额固定为 `visual/fixtures/account-presentation.json`，身份和令牌保持原值，失败响应不改成成功。普通页面测试不提交表单。牌桌组通过真实界面创建本轮专用私人房，复用 Web 的余额检查与清理；退出和失败时都解散该房间。仅测试账号余额不足时复用现有 testing 接口补钻，不执行真实充值。Web 和 Android 共用 `visual/fixtures/game-presentation.json` 中的展示房号；Android 仅覆盖本轮真实房间成功响应的 `options.house_number`，保留 UUID、房主、权限、房间状态及连接和清理请求。房号及复制图标完整参与截图比较。

正常视觉与登录准备完整透传 v12 数组、v13 字典、所有候选节点的健康结果和 CORS 预检，包括错误状态、压缩及未知字段。Python 玩法/战绩代理和公共夹具都不固定首尔 64、不伪造健康指标、不排除其他节点；应用按真实候选自主选线。`enableVisualFixtures` 仅启用业务夹具；房间回放随实际确认订阅的连接工作，换节点后仍只针对本轮房间。超时、断线和不可用响应仅在明确的异常用例中注入；品牌启动页仍只在控制接口显式开启期间暂缓健康 GET，释放后访问原服务器。

真实选线可能使右下角节点编号同时显示两个节点。截图继续使用原有直接比较实现及共用的 0.5% 比例，不动态改写预期图。已逐图复用同构建的 36 张按钮基准，保留节点编号的原有遮罩；原图、真实样本、差异及审查结论见[合并请求 #29 基准修订记录](BASELINE_REVIEW_29_REVISION.md)。上轮比较器方案及撤回原因保留在[历史复核记录](NETWORK_SELECTION_REVIEW_40649166168.md)。

`e2e/mitmproxy/test_response_overrides_integration.py` 用本地上游验证 64 指标 1065 或失效、67 正常、第三节点真实 503，以及 metadata 不包含 64 的情况；覆盖五个共享入口及 Android 普通/登录、德州、拼三张、战绩入口，Android 直接运行 Python 夹具，不依赖 TypeScript 响应服务。`test_native_network.py` 从 Android 入口验证换线回放的订阅确认和房间隔离，并核对启动暂缓边界。这些是离线代理回归，不代表 APK 在真实设备或模拟器上通过。完整验收仍须在当前部署记录固定的同一 APK 下运行 Android 德州视觉场景，报告会附带同轮 `build-info` 和 `network-selection`：最多保留最近 200 条 metadata 候选、真实健康状态/指标、连接错误及 WebSocket 所选主机，不保存令牌、请求正文或用户/房间身份；不能用原生用例收集或旧 CI 结果替代。

固定环境为 Android API 35、720×1280、320 dpi、字体比例 1、英文系统。GitHub Actions 使用 Ubuntu 和 x86_64 Google APIs 模拟器。正式基准应在相同 CI 环境生成并人工检查；本机 ARM 模拟器适合验证操作流程，渲染差异不能直接当作应用回归。

## 测试开始前的金币准备

持续集成在账号独占锁内调用 `scripts/configure-ci-account.mjs`，本机通过
`node scripts/with-test-account.mjs -- node android/run-visual.mjs` 启动。
两者共用 `scripts/prepare-test-account.mjs`：先通过普通登录核实本任务账号，
调用 staging 的 `POST /public/v1/wallet/{用户ID}/set_balance/testing` 将金币设为 **10000**，
再用真实钱包接口回读确认，之后才启动原生测试。
每次设置固定余额，不累加，不修改其他任务或 Web 分区账号；牌桌测试现有的补钻逻辑保持原样。

`TESTING_API_TOKEN` 仅在 Node 中发送给余额设置接口，不进入设备或测试代理。
持续集成缺少 Secret、身份不符、设置或回读失败时立即停止；本机失败仍释放账号锁。
本机可以配置同名环境变量，也可以复用相邻 `goplay_staging_auto_stack` 中的既有 staging Secret。
应用仍执行完整初始化和真实界面登录，既有展示余额夹具保持原值；本人牌桌资料展示真实的 10000 金币。
同一账号锁内还会核对私人房屋为空。只恢复本人房屋中、本人创建、名称为 `TestRoom` 或
`E2E私局` 加时间戳、无入座者且从未开始计时的非官方测试房间；删除前复查详情，删除后回读为空。
未知房间或使用中的房间会使准备失败。正常用例仍在收尾删除本次创建的 UUID，清理请求使用固定 staging 入口。
低余额专项案例需在通用准备之后显式设置所需余额，并在结束后恢复 10000。
直接调用 `android/run-visual.mjs` 不经过账号准备，真实登录测试应使用账号分配器入口。

## 下载与本机执行

需要 Node.js 24 或更高版本、已认证的 `gh`、Android SDK 的 `adb` 和一个专用模拟器。把 SDK 的 `platform-tools` 加入 `PATH`。脚本要求显式指定模拟器编号，拒绝操作实体手机；每次运行会卸载并重新安装专用模拟器中的 `com.ac.laiwanDev` 测试应用。

```sh
npm ci
python3 -m venv e2e/.venv
e2e/.venv/bin/python -m pip install -r e2e/mitmproxy/requirements.txt
npx playwright install android
node android/download-release.mjs
ANDROID_SERIAL=emulator-5554 ANDROID_GROUP=guest ANDROID_LOCALE=en node scripts/with-test-account.mjs -- node android/run-visual.mjs
```

下载器只读取当前提交的 `deployments/staging.json`，按其中的 `release_tag` 下载 `android-staging.apk`。下载后核对构建环境、应用标识、完整应用提交、架构、附件大小和 SHA-256；安装前再次校验部署记录与 APK，安装后检查版本。指定 Release 缺少附件会直接失败。每次报告附带 `build-info.json`，用于确认实际测试的应用提交。

## GitHub Actions

工作流为 `Android Staging 视觉回归`，维护在 `albitsj/clrn-az` 的 `master`。应用仓库 master 完成 APK 上传及远端校验后，使用现有 Woodpecker 发布凭据向本仓库的 `deployments/staging.json` 提交记录：`environment`、`sha`、`deployed_at` 与 H5 协议一致，`release_tag` 锁定 APK。master 推送、PR、每日定时任务和手动任务都按当前检出提交的 JSON 下载标签，并核对 `build-info.json` 的完整应用提交。草稿 PR 只运行仓库检查，标记为可审查后再运行完整模拟器矩阵。

APK 与构建信息继续发布到 **kevinanew/clrn 的公开 Release**，下载步骤使用内置 `github.token` 读取，不增加下载或 dispatch Secret。现有 Woodpecker `android_visual_staging_github_token` 需同时具备 CLRN 和 clrn-az 的 Contents 读写权限；不需要 Actions 写权限。Release 附注标签仍指向 CLRN master 的提交，应用提交记录在标签说明和 `build-info.json` 中。

登录使用本仓库 `CLRN_CI_TEST_ACCOUNTS_V2`：固定选择新建 70 个 `clrnci261015001`–`clrnci261015070`，Web 使用老 30 个 `clrnci26100901`–`clrnci26100930`。八组乘三语的 24 个任务独占账号，同仓库不同轮次通过 `android-staging-account-<用户名>` 排队；跨仓库使用互不重叠的账号，不能依赖同名 concurrency 锁。补钻使用 `TESTING_API_TOKEN`。完整公开清单仍保留 100 个名称以阻止本机工具借用任一 CI 账号，Secret 只需包含安卓分区的 70 个账号。

首次切换先合入 CLRN 的删除与账号分区 PR，等待旧账号任务结束，再合入本仓库并启用安卓回归，最后合入应用端通知。定时任务和网页手动入口要求本仓库默认分支为 master；仓库所有者需将初始 main 默认分支切换到 master。APK 发布、下载及 JSON 的 push 触发不依赖默认分支。已复制的 `deployments/staging.json` 指向迁移时现有的已发布 APK，之后由发布流水线维护。

比较失败时，从工作流产物下载 HTML 报告、实际图、预期图和差异图。附件保留 14 天，不重复上传完整 APK。缺失基准会失败，不会自动接受新截图。

## 更新基准

此前按零差异规则接收的 86 张德州操作按钮基准曾按统一的 0.5% 规则逐项复核，并恢复相对 master 未超标的 83 张原图，其余三张与 master 一致。恢复真实选线后，旧按钮差异与节点编号遮罩差异叠加，使其中 36 个状态超过现有门槛；本次逐图复用这 36 张历史已审查的同构建按钮基准，其余图片保持原样。
历史来源与当时的恢复结果见[审查与复核记录](BASELINE_REVIEW_69f9251d.md)，当前选择与交叉验证见[合并请求 #29 基准修订记录](BASELINE_REVIEW_29_REVISION.md)。

测试前统一准备 10000 金币后，三语德州本人资料图来自全部通过的
[reference 38775872385](https://github.com/albitsj/clrn-az/actions/runs/38775872385)。
逐图核对后只接收这三张图片，金币由 0 改为 10000，其余页面基准保持原样。

正式基准必须来自固定的 x86_64 CI 环境，并逐图检查。reference 产物会同时携带仓库已有图片，因此只能接收该轮实际通过的场景，不能将整个目录直接覆盖到仓库。更新后必须另跑 compare；基准生成成功不代表回归比较通过。

应用修复集中在 [laiwan_react_native #7019](https://github.com/kevinanew/laiwan_react_native/pull/7019)，基准扩充及验证记录见 [clrn #25](https://github.com/kevinanew/clrn/pull/25)，其中注明测试提交、APK Release 和 CI 运行。未执行或失败的用例不计入通过数量。

拼三张三语全部 78 张基准来自 [reference 38673980189](https://github.com/kevinanew/clrn/actions/runs/38673980189)，使用 [APK 7235](https://github.com/kevinanew/clrn/releases/tag/android-staging-7235-72d60d0080df)，六个场景全部通过且已审查。三语独立 compare [38676799300](https://github.com/kevinanew/clrn/actions/runs/38676799300) 全部通过。

通过 GitHub CLI 在部署记录已固定的分支上生成候选基准：

```sh
gh workflow run android-visual.yml --repo albitsj/clrn-az \
  --ref master -f mode=reference
```

在 PR 验证期间，将 `--ref master` 替换为 PR 分支。工作流至少运行过一次后可通过 CLI 指定分支；Actions 网页中的手动运行入口还要求工作流存在于默认分支。成功后下载 `android-staging-reference-*` 产物，审查图片，再将 PNG 放回 `android/snapshots/android-35-x86_64-720x1280-<locale>/`，通过 PR 更新。reference 仅生成候选基准，不代表比较通过。

本机调试可显式生成参考图，保存在被 Git 忽略的 `android/snapshots/local/`，不覆盖 CI 正式基准：

```sh
ANDROID_SERIAL=emulator-5554 ANDROID_VISUAL_MODE=reference node scripts/with-test-account.mjs -- node android/run-visual.mjs
```

牌桌组在 JDK 17 环境构建固定 Playwright 1.61.1 官方提交的原生驱动，修正持续动画时的空闲等待、无障碍树空节点遍历，并增加直接读取目标节点的命令，避免短时提示消失前反复序列化整棵牌桌树。CI 自动读取并校验源码；本机先将官方提交 `39e3553a4f283a41134d75d7e404484bd9e6865a` 检出到 `.ttyctl/playwright-driver-source`，设置 `ANDROID_HOME` 后运行 `node android/build-driver.mjs`。补丁和 APK 均位于忽略目录，不修改被测应用或游戏时钟。

新增用例使用 APK 暴露的原生 `testID`，等待目标控件就绪和位置稳定后，在实时控件边界内点击或滑动，不依赖固定屏幕坐标。先等待业务就绪标记，再等待截图稳定；静态截图、动画关键帧及同类截图稳定性判断共用 `screenshot-comparison.ts` 的差异比例 `0.005`（0.5%），单像素颜色容差保持 `threshold: 0.1`。等于比例上限时通过，超过时失败；尺寸不符、资源缺失和业务断言仍然失败。版本、日期、输入光标和横幅自动轮播图案采用显式小区域遮罩，报告同时保存原始截图与遮罩原因，遮罩面积超过 12% 会失败。

`ANDROID_GROUP` 支持 `guest`、`account`、`social`、`rooms`、`wallet-help`、`records`、`texas`、`zhajinhua` 和 `all`；`ANDROID_LOCALE` 支持 `en`、`zh-Hans`、`zh-Hant`。Actions 默认全组、全语言，也可用 `filter` 缩小调试范围。compare 每组出现三次失败即停止该组，reference 则继续遍历独立场景，报告中的未执行用例不计为通过。

代理仅绑定主机回环地址，控制接口使用每轮随机令牌。只对显式选定的专用模拟器安装临时 CA 和配置代理，结束时还原代理设置；此环境不应拿来运行个人应用。

每轮代理会话先等待指定模拟器连接（最多 120 秒），再读取旧代理设置，避免框架重试早于 adbd 重连。持续离线仍失败，不重放失败的原生命令。启动、设置读取或正文失败都会清理本轮代理进程和证书；恢复设置及删除反向端口分别尝试，原始错误与清理错误按发生顺序一并报告，清理失败不能变成成功。

Android CI 在初始化前启动独立诊断采集器，持续保存 logcat、ADB daemon 日志和模拟器标准输出，同时每 10 秒采集设备连接、进程、主机内存、磁盘和负载。设备探测各自最多等待 5 秒，单项失败会记录退出码或超时原因，其他采集继续；logcat 断连后重新订阅，测试清空设备日志不会删除已保存的主机日志。模拟器启动前安装临时 SDK 包装器，在 `adb emu kill` 前完成最终采集，测试退出码与模拟器清理退出码分别记录；任务结束后恢复 SDK 可执行文件。测试、代理退出和临时证书清理的错误也分别保留。

每个日志流最多保留 2 MiB（当前文件及一个轮转文件合计），七个流共最多 14 MiB。日志写入前使用 CI 账号池、用户名、密码和令牌进行脱敏，并过滤常见凭据字段和输入操作；不采集进程参数、环境变量或 ADB 数据包追踪。诊断文件位于 `android/artifacts/diagnostics/`，附件名称包含业务组、语言、分片、运行 ID 和重试次数，成功或失败均上传，保留 7 天。`lifecycle.log` 关联运行信息及阶段，`cleanup.log` 记录模拟器清理结果；长期运行超过容量时会淘汰最旧日志。

`Android diagnostics smoke` 在真实 API 35 模拟器上独立验证正常运行、子命令退出 23、清空 logcat 后的 adbd 重连，以及模拟器初始化失败；上传前检查时间戳、关闭前采集和脱敏哨兵，结果写入附件中的 `smoke-validation.json`。本机回归通过 `python3 -m unittest discover -s android -p 'test_*.py'` 执行，不依赖 Android SDK。

统计说明等两秒短时提示在触发前准备底层页面遮罩，触发后由原生驱动连续采集真实屏幕，再统一编码传输，避免压缩与传输耗尽提示显示时间；用设备时间验证像素连续稳定至少 250 毫秒，并断言提示在每帧截图前后都可见，背景遮罩不覆盖提示面板；普通页面继续要求连续两秒稳定，截图仍使用统一的 0.5% 差异比例和原有颜色容差。

拼三张比牌选择框会独立闪烁，采用分区相位比较：保留一张完整真实截图作基准，页面其余像素须连续稳定两秒并匹配基准；四个玩家区域各自在真实动画帧中匹配对应区域。使用与普通截图相同的 Playwright 比较器、`threshold: 0.1` 和 `maxDiffPixelRatio: 0.005`；各局部图按实际裁切面积计算，静态补集按排除独立动画分区后的有效面积计算，不遮掉玩家内容，也不合成不同时间的截图。报告附上区域定义及各区域匹配时的完整原图，所有像素都有对应比较。

原生循环动画在两种玩法的开局前等待页检查每个空座引导箭头，在两种玩法的对手回合检查活动玩家倒计时。连续取样验证每个目标区域确实运动，独立保存并比较两个真实相位；其余页面像素继续由正式静态基准比较。转场动画通过独立 ADB 连接触发，原生驱动在入口或退场期间连续截屏，验证起点、中途和终点。完整效果映射见 [动画视觉回归清单](ANIMATION_COVERAGE.md)。

英文登录大厅还采样实际老虎机横幅，最多连续取样五个窗口直到看到轮转，再比较真实关键帧。`animation-assets.json` 只记录全部 16 个动画 WebP 的 SHA-256 和帧数；待测应用版本统一由当前检出提交的 `deployments/staging.json` 决定。英文游客任务先按部署记录重新校验 Release 身份和 APK 完整性，再要求其中每个 WebP 动画逐字节匹配、帧数大于一，且不能出现未登记的新素材；哈希同时锁定每帧像素、帧顺序和时长。应用提交改变但素材内容不变时无需更新素材清单；素材变化时须审查并更新基准。此素材检查覆盖打包内容，牌桌运行时另验证每种表情、道具飞行和全压火焰的实际屏幕关键帧。

原生套件关闭 Playwright 的后台 WebView 发现；后台 ADB 探测失败会关闭整个设备连接，而本套件不使用浏览器调试接口。原生操作、截图及应用错误仍正常失败，不自动重试场景。CI 每轮只构建一次固定版本原生驱动，通过同轮产物分发给需要它的模拟器任务，避免并发请求 Maven 被限流。

列表滚动固定后，三语高级建房基准来自 [38674831805](https://github.com/kevinanew/clrn/actions/runs/38674831805) 的八个通过场景和 [38675676317](https://github.com/kevinanew/clrn/actions/runs/38675676317) 的简体德州场景；三语新版战绩页脚来自完整通过的 [38674838931](https://github.com/kevinanew/clrn/actions/runs/38674838931)，其余 87 张新版战绩图与原基准匹配。

德州新增 110 张已审查基准来自 [reference 38673123965](https://github.com/kevinanew/clrn/actions/runs/38673123965) 的完整通过场景，清单覆盖新版牌谱、牌局、主题及面板变体、满桌/旁观/保座和大厅变体；未接收同轮失败场景及使用旧 UUID 遮罩的排行榜。其余状态来源见后续记录。

德州三语开局前与扩展面板 96 张基准来自全部通过的 [38675400987](https://github.com/kevinanew/clrn/actions/runs/38675400987)，已审查新增及变化图，并更新固定房号和 UUID 遮罩。

礼品卡兑换三语基准来自 [38676970410](https://github.com/kevinanew/clrn/actions/runs/38676970410) 与 [APK 7236](https://github.com/kevinanew/clrn/releases/tag/android-staging-7236-923ccc1008dd)，已检查输入提示完整显示且不覆盖扫码入口。

德州另有 24 张新增及 40 张更新基准来自 [38676785782](https://github.com/kevinanew/clrn/actions/runs/38676785782) 的完整通过场景，覆盖简体满桌/旁观、繁体面板变体、英文等待和大厅；该轮失败场景的部分截图未接收。

英文牌局与操作的最后 29 张基准来自全部通过的 [38682440621](https://github.com/kevinanew/clrn/actions/runs/38682440621)，使用 APK 7236；逐图审查后已补齐 763 个正式截图状态。

三语德州完整 285 个状态的 [reference 38681586730](https://github.com/kevinanew/clrn/actions/runs/38681586730) 全部通过（APK 7236）。牌谱页码仅遮罩实测光标细条，提示框完整保留；该轮变化图已单独审查，其余基准保持匹配。

旧版战绩分页加载截图复用 `scrollToEnd`，在末行真正抵达底部并稳定后截图，避免仅露出房名时提前停止。三语新旧战绩共 186 个状态的 [compare 38687644002](https://github.com/kevinanew/clrn/actions/runs/38687644002) 全部通过，未修改战绩基准。

原生旧版分页保留应用真实的十秒请求截止时间；快速滚至页尾后逐帧确认进度控件仍可见，采用 250 毫秒稳定期截取加载态。释放人工挂起后通过正常回滑、触底恢复可能超时的分页，再等待末行贴底；不暂停应用时钟，也不把进度控件消失后的页面算作加载态。

拼三张圆形加注按钮的 PNG 外缘有透明度，背景计时遮罩按一像素内缩的实心区域裁剪，按钮文字和主体继续比较。三语未看牌、已看牌共六张基准来自全部通过的 [reference 38688512253](https://github.com/kevinanew/clrn/actions/runs/38688512253)；逐图审查确认变化仅位于倒计时与按钮顶部边缘交叠处，其余牌局基准保留。

安卓密码输入字号调整为 14 后，英文提示完整保持一行。三语密码页基准来自全部通过的 [reference 38707410687](https://github.com/kevinanew/clrn/actions/runs/38707410687)，使用 [APK 7237](https://github.com/kevinanew/clrn/releases/tag/android-staging-7237-35d1407ceb85)；逐图审查后仅更新三张密码页，其余 760 张基准保持不变。

截图比例调整关联 [问题 #27](https://github.com/albitsj/clrn-az/issues/27)。按固定版本 Playwright 比较器复核本修复请求中原有的 76 张基准替换，73 张新旧图在 0.5% 范围内，已恢复 master 中经过审查的旧图；超过该比例的既有替换继续保留。动画运动幅度、真实中途相位、素材完整性、遮罩及业务断言保持原有检查范围。比较器边界测试覆盖一万有效像素中 50 个差异通过、51 个失败，整图、局部图、静态补集和稳定性判断均须遵守。

此前十张中文失败截图来自[比较运行 40450523520](https://github.com/albitsj/clrn-az/actions/runs/40450523520)，应用固定为 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`、Release `android-staging-300001001-69f9251d3b5f`。应用[圆形按钮修复 #7066](https://github.com/kevinanew/laiwan_react_native/pull/7066)将图像模式由 `center` 改为 `contain`，引起已审查并获认可的圆环差异。当时按 0.5% 比较首次及重试共二十张实际图全部通过，因此保留旧图。恢复真实选线后的基准选择以[合并请求 #29 修订记录](BASELINE_REVIEW_29_REVISION.md)为准；完整模拟器回归仍需新提交的后续比较运行验证。
