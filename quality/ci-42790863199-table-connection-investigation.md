# 繁中德州大厅首次连接超时与原生矩阵容量

- 原始运行 [42790863199](https://github.com/albitsj/clrn-az/actions/runs/42790863199)，attempt 1，源 b94793fee6aadc11e965e124253362a52fbf0b30，job 129753091483。正式 App b062c6e14e78407a93711cc89babf66eb9bd5eaf / build 300003701 已核验。
- 产物 android-staging-visual-texas-zh-Hant-other-42790863199-1，ID 13754985458，SHA256 9c6cceabd89c916ebe22d95fb0afc01ad7bb1c94341010cca5411028abbd3363；run、HEAD、attempt、摘要、ZIP CRC 和包身份均核验后解码。
- hall 首次 worker 0 retry 0 在 waitRoomReady 等待 game-splash-screen-bg 消失的原 45 秒条件失败；实际原图已查看，显示“連接超時／請稍後重試”。retry 1 通过，但保留为 flaky；同组另五例首次通过。
- 首败共 19 个事件：初始化节点 64 backend_delay=93ms，钱包 200、WebSocket 101 和连接/订阅 ACK 均有记录。进入牌桌重新取得 v12 六个候选后，64/67 分别报告 backend_delay=1762/1672ms，server_load=normal，超过应用 ProxyUtil 原有 backendDelay<1000 条件；另有 68、03 探测错误。独立 Node observer enter 成功，不能替代 App 自身连接成功。
- 未记录到 HTTP 事件不能证明候选未被调度；缓存、TLS 失败和代理可见范围都需区分。没有改 App 选线代码、1000ms 健康条件、45 秒就绪条件或自动点击重试；也不唯一归因于本仓库负载。
- 本轮简中 other 单独优先执行时通过；随后 remaining 同批启动 20 个原生客户端。限制同批初始化压力是共享环境容量的候选缓解，需要完整运行验证，不能据此声称唯一定位外部故障。
- priority 和 remaining 两个顺序阶段各设置 max-parallel=6；每阶段最多六个原生客户端，其余排队。完整 35 行矩阵、账号映射、账号互斥、输入、采样、截图、遮罩、基准、容差、deadline、业务写入和重试规则均保持。代价是整轮耗时增加；其它 workflow 或仓库总体负载不受此上限控制。
- 只改调度参数，使用 workflow 静态检查核验语法；保留首败和后续完整运行证据，最终仍须新提交全部 CI、普通及独立安全审核，以及实际最新 master 全部 CI 成功。
