# 网络夹具清单与 #31 迁移记录

本次核对基线为 `d9ebf4d232a2511f9f486eb3985334acb52cdacd`，已包含 #29。
开始时工作树干净，没有 MERGE_HEAD 或冲突；未执行合并、提交或重置。
仓库及子目录没有 AGENTS.md、AGENTS.txt、DEVELOPMENT.md；适用说明为根 README、
android/README.md，以及 `.github/workflows/{check,android-visual,android-diagnostics}.yml`。
未采用工具仓库规则。任务资料未列附件，没有将旧截图或旧运行当成本轮验证。

## 入口和边界

Android 用例通过 `withAndroidProxy(task, scene)` 选择互斥场景：`pages`（默认）、
`records`、`texas-holdem`、`zhajinhua`、`matching`、`slot`、`skeleton`、`invitable`。
Node 仅启动 mitmdump、准备临时证书和模拟器流量、调用持有随机令牌的控制接口。
不再监听 HTTP 夹具端口，不上传响应正文，不提供 Python 回调或后备响应服务。
唯一响应入口是 `android/proxy-addon.py` 及其调用的 Python 业务模块。
独立 Python 玩法、战绩、故障 addon 继续保留，复用既有隔离协议，不重写 #29 选线。

普通 HTTP 夹具在 `e2e/mitmproxy/visual_fixtures.py`，商品在
`visual/fixtures/shop-goods.json`，大厅沿用两份 hall-matching JSON。
只匹配 staging 主机和明确的读取方法；`PUT /v10/clubs` 与
`PUT /v2/building/rooms` 是批量读取。预检、metadata、所有节点健康检查、真实登录、
本轮建房和清理、未匹配流量继续透传。商品列表可读，Alipay 订单写请求明确拒绝。
第三方 Freshchat/反馈页有单独的精确主机边界，不能因域名包含相同字符串误匹配。

牌桌用例只传场景名、街、操作方、布局、动画文件等少量参数。
`e2e/mitmproxy/replay_scenes.py` 读取 `fixtures/*-events.json`，
`table_scenes.py` 生成两种玩法的恢复状态；不是可上传任意协议的配置语言。
原有 `/texas/replay`、`/zhajinhua/replay` 控制接口改为 `{roomId, scene: {scene: ...}}`，
旧的 `{roomId, data: ...}` 返回 400；未知参数也失败。
本人身份从已确认的真实订阅频道取得，不接受控制端指定身份。
控制令牌认证、本轮建房归属、目标房间、订阅成功确认、断线/取消订阅、其他房间流量和
消息顺序仍由原有 replay 模块检查。低层 publish 的原始数据参数仅供 Python 内部及其单元测试。

## 原 TypeScript HTTP Mock 的逐项决定

下表原实现均在 `visual/src/support/networkMocks.ts`，经 `android/network-routes.ts`
和 `android/fixture_bridge.py` 调用；现由 `visual_fixtures.py` 处理。
保留项都有实际页面用途，没有为正常流程增加节点或认证成功响应。

| 接口/资源 | 目的、场景 | 决定及必要性 |
| --- | --- | --- |
| `*.freshchat.com` | 帮助页第三方客服脚本，避免无关外部脚本 | 保留中断；精确主机/子域匹配 |
| `feedback.userreport.com` | 帮助页 WebView 静态背景 | 保留空 HTML，限 GET |
| GET `/public/v10/profile/country` | 游客登录/认证页固定中国区号 | 保留 `86`；原 localStorage 区号写入无原生调用，随浏览器适配器删除 |
| GET `/v2/room/disallow-rule/reminder` | 普通视觉页无维护提醒，避免无关登出 | 保留禁用提醒夹具；不作用于真实登录接口 |
| GET `/public/v1/hall_matching/available.json` | 大厅公共牌局版本 | 保留 v3，避免全局超时弹窗污染页面 |
| GET `/public/v1/hall_matching/texas_holdem/halls` | 德州大厅入口配置 | 保留原 JSON |
| GET `/public/v1/hall_matching/zhajinhua/halls` | 拼三张大厅入口配置 | 保留原 JSON |
| GET `/v10/club?user_id=…` | 普通俱乐部空态 | 保留空列表；战绩、搜索/有牌局/骨架专项优先 |
| PUT `/v10/clubs` | 普通俱乐部批量详情空态 | 保留空列表；同上 |
| GET `/v10/house/user/{user}` | 私人房表单展示固定房屋 | 保留；玩法场景透传真实房屋 |
| GET `/v10/house/users/{user}/visit_history` | 私人房访问记录空态 | 保留；玩法场景透传 |
| PUT `/v2/building/rooms` | 私人房无牌局空态 | 保留；玩法场景透传，邀请和俱乐部专项优先 |
| GET `/v{n}/alipay_order/goods` | 钱包商城七种商品卡 | 保留为简单 JSON；非 GET 订单操作拒绝，不能真实充值 |
| GET `/v11/wallet/{user}/currency/{coin,diamond}/statement` | 钱包账单空态 | 保留；不伪造余额写入 |
| GET `/v2/check_in/seven_day/rule` | 签到奖励展示 | 保留七天奖励 |
| GET `/v2/check_in/seven_day/current` | 当日已签到展示，不执行真实签到 | 保留当日 UTC 时间 |
| GET `/v10/club/application` | 社交申请空态 | 保留 |
| GET `/v10/buy_in/auditor/{user}/applications/pending` | 通用带入审核空态 | 保留；牌桌专用审核数据优先 |

未发现独立无人调用的业务响应项；无调用的浏览器初始化副作用和整条桥接基础设施已删除。
旧 URL 路由没有方法/主机约束；迁移只保留真实读取契约，不把未知方法包装成成功。

## 既有 Python Mock 的决定

以下保留既有实现与调用关系；HTTP 通用夹具放在专项处理之后，避免覆盖专项结果。

| 接口/消息 | 场景、目的 | 实现与决定 |
| --- | --- | --- |
| 登录成功、GET 本人 profile/account、PUT 本人 wallet 读取的展示字段 | 三语普通页的昵称、日期、展示余额稳定；错误和令牌真实 | `android/presentation.py` 保留，仅修改成功结果 |
| GET 本轮 `/v1/room/{room}` 的展示房号 | 真实建房页面稳定 | `android/game_session.py` 保留真实 UUID/权限/清理 |
| GET `/public/v10/user/username/is_existed` | 玩法登录只校验本轮账号，阻止缺失账号进入自动注册 | `android/username_lookup.py` 保留；其他用户名透传 |
| GET `/v10/club/search`、PUT `/v10/clubs` | 搜索命中定向只读卡片 | `android/club_search_fixture.py` 保留显式启用和请求计数 |
| GET `/v10/club`、PUT `/v10/clubs`、PUT `/v2/building/rooms` | 有牌局俱乐部列表、房间卡 | `visual/cases/club/mitmproxy/addon.py` 保留指定虚拟俱乐部范围 |
| 同上 club/clubs 读取的延迟 | 骨架加载动画 | `android/proxy-addon.py` 保留 skeleton 显式暂缓/释放 |
| PUT `/v2/building/rooms` | 私人房邀请动画的等待牌局 | `android/proxy-addon.py` 保留 invitable 专项 |
| HTTP/RPC `/v1/hall_matching/{join,quit,keep_waiting}` | 匹配等待动画，禁止进入真实队列 | `android/proxy-addon.py` 保留 matching 隔离 |
| HTTP/RPC `/v2/slot_machine/user/{user}/{energy,spin}`、PUT 本人 wallet 读取 | 旋转/奖励/能量不足动画，无真实奖励写入 | `android/proxy-addon.py` 保留 slot 本人校验及错误分支 |
| GET `/node/v1/status` 的暂缓 | 品牌启动页自然等待初始化 | `android/launch_network.py` 保留显式 hold，释放后真实访问 |
| `/public/v1/hall_matching/available.json`、真实登录、本人 club 读取的故障 | 明确 hall-timeout/login-failure/club-failure | `e2e/mitmproxy/network_faults.py` 保留；默认无故障，不影响预检 |
| 本轮德州 room/user_settings、hand_prediction、审核 applications、blacklist | 大厅/面板/操作错误；隔离本轮房间和虚拟对手写入 | 德州 `room_view.py`、`ui_states.py`、`addon.py` 保留 |
| 本轮 `enable_auto_rebuy` 的暂缓响应 | 自动带入按钮加载动画 | `android/proxy-addon.py` 保留显式 hold |
| 两种玩法的虚拟 profile、coin wallet、德州 statistics；混合 profile/users | 对手资料/统计和真实本人同屏 | 两种 `*_replay.py` 及 `response_overrides.py` 保留，仅补虚拟玩家；本人资料继续真实查询 |
| 本轮玩法 RPC、`/v1/chat_room/{room}/…`、奖励消息 | 牌桌操作、语音、升级动画，无真实带入/投注 | 两种 `*_replay.py` 保留既有房间隔离；消息生成迁至 Python 场景 |
| 德州 game_log 的 room settlement/game_amount/game、本人 games；新版 session/round | 牌谱、结算、新版战绩 | `game_log.py`、`records_v2.py` 保留本轮房间/账号过滤 |
| 旧版本人 game_records、新版 recent/session/round、虚拟 room/profile/club、settlement/game_amount/game/games、虚拟记录 DELETE | 战绩加载、空态、分页、删除、详情、回放、错误恢复 | `visual/cases/game-record/mitmproxy/{addon,data}.py` 保留明确账号/记录范围，不删除真实记录 |
| 成功 game_log available 的版本字段 | 新旧版战绩入口切换 | `response_overrides.py` 保留成功字段覆盖，错误/未知结构/压缩不改成成功 |
| 两种玩法恢复、全压、摊牌、结算、切换玩家、动作、座位、聊天/音频、审核、猜牌、表情/道具 | 全部原有静态页面和英文动画状态 | TypeScript `replayData.ts` 及用例内协议对象删除；`replay_scenes.py` + `table_scenes.py` + `fixtures/*-events.json` 提供命名场景 |

`visual/scenarioTypes.ts` 保留来源场景描述，原生执行不使用其中的浏览器存储/隐藏/文字替换字段。
语言继续从真实设置界面切换，登录继续走真实界面；`visual/cases/_shared/room.ts` 的
localStorage 读取不是状态注入，也没有搬进代理。账号准备脚本的 HTTP 替身仅属于
Node 单元测试，不是设备运行夹具。

## 删除与保留的基础设施

删除 `android/network-routes.ts`、`android/fixture_bridge.py`、
`visual/src/support/networkMocks.ts`、两份 `visual/cases/*/replayData.ts`；
删除桥接专属 `android/test_fixture_bridge.py` 和旧 TS 路由测试，业务断言迁入
`e2e/mitmproxy/test_visual_fixtures.py` 与 `test_replay_scenes.py`。
删除 Node 夹具 HTTP 服务、独立夹具随机令牌及 `ANDROID_FIXTURE_URL/TOKEN` 配置。
六个可组合环境开关收敛为单一 `ANDROID_SCENE`，现有专项控制命令保留。

保留 mitmdump 进程管理、回环监听、每会话随机控制令牌、独立 CA、指定模拟器校验、
连接等待、反向转发、旧代理恢复、失败/清理错误聚合，以及账号锁/余额准备/房间清理。
不调整截图阈值、遮罩、基准、覆盖矩阵或工作流检查。

## 本轮验证与待验证

从基线源码离线生成迁移前结果，先比较国家码/大厅/商品等代表接口，再核对全部调用：
51 个 HTTP 样本业务结果相同（签到比较当日）；76 个牌桌参数组合的协议内容与队列顺序
相同（忽略生成时间）；42 处原有其他消息表达式在新的场景数据中内容及顺序相同。
这些是离线契约比较，不能证明真实设备画面一致。

本轮完成 npm ci、ESLint、TypeScript、400 行门禁、Ruff 0.15.12，以及原生用例收集。
ShellCheck 和 actionlint 通过直接调用宿主缓存的固定版本二进制验证；正常 uvx 入口因
沙箱无法写宿主缓存而失败，未修改检查脚本或跳过 CI 步骤。

Python 使用宿主已有的 Python 3.12/mitmproxy 12.2.3 虚拟环境只读运行：
Android 31 项、club 3 项、game-record 10 项、texas 32 项、zhajinhua 19 项全部通过；
e2e 23 项中 22 项通过，真实 mitmdump 集成项在绑定本地上游端口时被沙箱拒绝。
Node 全套 116 项中 102 项通过，14 项因本地端口 EPERM 未通过（包括连带无法到达的错误聚合断言）。
`npm run check` 尚未完整通过；本轮 venv 的 pip 安装亦因沙箱 DNS 限制失败。
固定检查应由宿主在可运行环境重跑，不把这些权限错误转换为成功或源码阻塞。

没有运行 APK、收集本轮截图或录像，也未取得本轮新提交的远端 CI 结果。
正式验收仍须使用当前部署记录固定的 APK、同轮 build-info/network-selection 与
Android 全矩阵 compare 报告，按 android/README.md 审查真实图、差异和动画附件。
原生用例收集、离线协议相等及旧 CI 均不代表真实设备回归通过，不据此更新或批准基准。
