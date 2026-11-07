# 测试侧业务网络模块（Issue #61）

`network/` 是独立的 Node.js 24 TypeScript 模块，不依赖 React Native、Expo、应用状态仓库、设备状态、事件中心或 Playwright。`.mjs` 账号准备脚本直接使用 Node 24 的 TypeScript 类型擦除；Playwright 使用现有 TypeScript 加载器。SDK 与 APK 只有策略对应，不共享节点、连接、登录态或 token。认证始终来自当前独占账号的真实登录或本轮 APK/页面会话。

## 来源与平台适配

核对来源 `kevinanew/laiwan_react_native@b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec`：

| 来源 | 本仓库对应 | 保留或适配 |
| --- | --- | --- |
| `src/laiwan_fundamental_lib/proxy-host/LocalProxyHostModel.js`、`top_servers_staging.json` | `network/staging.ts` | 显式初始化同版本的四个 HTTPS staging bootstrap 入口；不建立磁盘缓存 |
| `RemoteProxyHost.js` | `network/selection.ts` | `POST /public/v13/metadata/servers` 解包 `result.servers` 域名映射；通过其他入口恢复清单读取；探测/发现不携带凭据 |
| `ProxyHostManager.js` | `HostSelector` | `GET /node/v1/status` 且 `server_load === normal`；随机候选、最多三个并发探测、首个健康者胜出；节点/选线缓存 30 秒、健康缓存 10 秒；故障主机失效和排除 |
| `api/BaseApi.js` | `NetworkClient` | 相对路径、有限恢复；明确设为最多三次业务发送、总计 45 秒，代替源端按节点数扩张的上限 |
| `LWFetch.js`、`ApiError.js`、`ApiErrorFactory.js` | `transport.ts`、`errors.ts`、`types.ts` | 原生 fetch/AbortSignal 代替 XHR/Axios；识别 Node/Undici 的 cause、ECONNRESET、ECONNREFUSED、socket hang up、DNS/路由失败及超时 |

与应用不同，远端刷新在本次选线内等待，避免测试完成后仍有后台请求。元数据不可读时仍可使用已确认健康的 bootstrap。健康探测均失败则明确失败。获取缓存清单后没有健康候选，会强制刷新一次元数据再选线；同一调用内失败的节点始终排除，不因缓存刷新重新进入。

不迁移手工选线 UI、RootStore、事件通知、iOS 原生域名/IP 映射、设备离线提示或自动退出登录；Node 使用系统 DNS，并将错误交给测试。并发调用共享客户端缓存，但各自持有探测/发现及取消信号，避免一个调用取消另一个调用。选出节点、取消或失败后中止未获选探测并等待清理；请求包括 JSON 流读取都受 deadline 约束。`dispose()` 取消该客户端所有进行中的工作并清除缓存；每个账号准备/房间辅助操作均在 `finally` 释放客户端。

## 请求清单与逐接口重发策略

业务入口集中在 `businessRequest()` 的精确方法/路径清单，未知接口拒绝发送。`PUT` 本身不被视为可重发依据。SDK 不发送建房或扣款请求。

| 调用位置 | 接口 | 目标与认证 | 自动重发依据 |
| --- | --- | --- | --- |
| `visual/cases/_shared/room.ts`、`scripts/prepare-test-account.mjs` | `PUT /v10/wallet/:userId` | SDK 选线，当前真实 Bearer | 仅读取指定币种余额；无余额变更 |
| `visual/cases/texas-holdem/room.ts`（含 Android 调用） | `PUT /v10/texas_holdem/room/:roomId/enter` | SDK 独立选线，当前房间所属账号的 Bearer；不复用 `room.apiOrigin` | 普通 enter 只续接成员/会话并发进入通知，不调用建房、buy-in 或 sit；同账号/房间重复连接可恢复；通知可能重复，不能用于 enter_and_sit |
| `scripts/prepare-test-account.mjs` | `POST /public/v10/user/login/username/password` | SDK 选线，不带管理 token | **禁止重发**：登录可能建立/替换会话，响应丢失必须明确失败 |
| `scripts/prepare-test-account-rooms.mjs` | `PUT /v10/house/user/:userId` | SDK 选线，当前真实 Bearer | **禁止重发**：服务端为 get-or-create，缺失房屋会创建；未证实并发创建去重保证，响应丢失明确失败 |
| 同上 | `PUT /v2/building/rooms` | SDK 选线，当前真实 Bearer | 仅读取已核对房屋的房间列表 |
| 同上 | `GET /v1/room/:roomId` | SDK 选线，当前真实 Bearer | 删除资格核对所需的房间详情读取 |
| 同上及 `visual/cases/_shared/room.ts` | `DELETE /v1/room/:roomId` | SDK 选线，当前真实 Bearer | **禁止重发**：可能触发结算/退费；沿用本用例 UUID、归属、空闲状态及清理后回读约束，未知结果明确失败 |
| 账号准备及钻石准备 | `POST /public/v1/wallet/:userId/set_balance/testing` | **固定 `https://api.shafayouxi.org`**；仅 `X-Testing-Api-Token` | 管理接口不假设地区节点支持；一次发送、15 秒超时、不重定向；禁止因断线重复写入，成功后仍通过真实钱包核对 |
| 页面/APK 建房 | `POST /v3/pay_action/do` | **仍由页面/APK 网络层管理** | SDK 不调用/重发；保留真实 UI 操作、成功响应验证和清理登记 |

观察者重发的服务端核对：本机 `kevinanew/texas_holdem_flask@5f93944ad72e688e9be6f4f95f3c725086febddf` 的 `src/apps/texas_holdem/services_room.py:EnterRoomServiceApi.save` 持房间锁调用 `EnterRoomWrapperV1`；`src/poker_engine_v1/wrapper/enter_room_wrapper_v1.py` 按用户更新成员并续接 `PlaySessionV1`；`src/poker_engine/controller/table_game_controller.py:enter` 发送通知、对已有玩家清除退出标记，不执行买入/落座。会话默认 ID 不变，成员按用户索引。该源码核对不是线上部署身份认证；上线服务若改变此语义，需要重新审查清单。socket 测试证明响应丢失后实际发出两次相同 enter，只有一份成员，允许重复通知；不把自造幂等标识当作服务端幂等保证。

其他接口语义核对：`house_flask@2d555ad5ce21c31f3844217eeecb154871a4cce4` 的 `src/apps/house/services.py:HouseView.save` 为 get-or-create，并非只读，所以禁止自动重发；`user_transaction_flask@4430dbaf5b514ffca7e3cae42b09069ae194eb6c` 的 `src/apps/user_transaction/service_v10_query.py:CurrenciesDetailServiceView` 仅在钱包锁内查询币种并转换响应；`room_sanic@ff4aec30f80c7f21916be7618e24e7c20f5f81b2` 的 `services_v2.py:MultipleBuildingRoomsView` 查询列表并重算响应管理员字段，`services.py:RoomDetailView` 读取详情并补官方标志，`RoomCloseView` 包含通知/退款登记故而禁止重发。登录未取得会话创建幂等保证；管理余额写入即使使用绝对值，也不假定其他副作用或并发覆盖安全，均采用禁止自动重发。

本机 mitmproxy 控制、Python 回放控制、GitHub/Release 下载继续使用原入口。`e2e/mitmproxy/test_*` 中指向业务样式路径的请求是本地代理契约/响应夹具验证，必须继续经过指定本地代理，不送往真实地区节点。未改变 APK 自身选线和故障注入场景。

## 恢复、错误与诊断

默认单次请求 15 秒、单次健康/元数据请求 5 秒、整个业务调用（含选线、发现、响应体和恢复）45 秒、最多三次业务发送。配置必须为正安全整数。候选清单最多 64 个；故障节点在客户端隔离 30 秒，并在当前调用全程排除。外部主动取消与 `dispose()` 优先结束，不进入故障切换。

`network`、`timeout`、HTTP 5xx `server` 只有在接口明确允许时恢复。401/403 为 `auth`，成功 HTTP 中 `ok:false` 为 `business`，其他非成功状态为 `http`，无效 JSON/envelope 为 `invalid-response`，主动取消为 `cancelled`，无节点可用为 `unavailable`。这些类别不会被吞掉，且响应正文读取期间发生的 socket 故障仍进入网络分支。重定向一律拒绝。

诊断写入 stderr，避免破坏账号准备子进程的 stdout 数据协议；内容只有静态接口模板、节点 origin、事件、类别和调用内尝试数。保留首次故障、切换、最终成功/失败；不保留原始异常 cause、完整 URL、账号 ID、密码、token 或服务端消息。阶段包装的 cause 也经过脱敏。日志回调失败不改变业务结果。

`attempt` 计数只属于当前 SDK 业务调用，Playwright retries 和 flaky 仍由框架独立报告。所有 UI 交互、断言、截图覆盖、重试设置、`failOnFlakyTests: true` 及门禁配置保持有效。修改到的既有函数按现有复杂度规则拆分，仅移除已解决的精确历史债务，没有新增豁免。

## 定向验证

本次相关网络、适配和账号锁测试共 50 项全部通过；TypeScript 检查及 21 个改动/新增代码文件的 ESLint 通过。依赖检查未新增违规，仅保留清单已登记的两个 Android 循环。未运行完整测试集。

定向测试命令：

```sh
node --import tsx --test network/*.test.mjs \
  scripts/prepare-test-account.test.mjs scripts/prepare-test-account-rooms.test.mjs \
  scripts/with-test-account.test.mjs scripts/ci-accounts.test.mjs \
  visual/cases/_shared/room.test.ts
```

测试覆盖 Node 错误/cause 分类、缓存过期、故障排除、元数据入口切换、无效元数据白名单、健康筛选、败选探测取消、并发取消隔离、单次/总超时（含响应体）、取消和 dispose、不重发鉴权/业务/无效响应、写入响应丢失、固定管理入口和凭据约束。真实 loopback HTTP socket 测试在服务端收到请求后销毁连接，验证普通观察者重发并恢复、DELETE 只执行一次；不以模拟成功代替线上分片验收。

实际 Android 目标命令：

```sh
ANDROID_SERIAL=emulator-5580 ANDROID_GROUP=texas ANDROID_LOCALE=en \
  ANDROID_FILTER=signed_in_texas_table_states \
  node scripts/with-test-account.mjs -- node android/run-visual.mjs
```

2026-11-08 本机尝试：模拟器可启动；账号锁入口因共享 Git 目录缺少 `clrn-test-accounts/accounts.json` 报“测试账号池不可读取”，没有进入 Android 用例，也没有发出真实账号准备请求。因此尚未取得线上分片的节点故障、调用内恢复或剩余 flaky 结论。配置真实独占账号池和 `TESTING_API_TOKEN` 后需运行上述目标用例或对应 CI `texas/en/other` 分片；本次未运行完整测试集。
