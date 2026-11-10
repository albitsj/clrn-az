# 9fd9ca3 完整原生回归：34 通过，1 flaky

run 42762695410 / attempt 1，HEAD 9fd9ca3645711503f087c0b2b2b2633f144a9e2d。Repository checks 42762695430 与 SDK 诊断 42762695428 成功；35 个原生分片中 34 通过、简中拼三张失败。兼容检查及总门禁的派生失败不能算成额外原生失败。

失败 job 129652026699 的 pre_game 首次通过；signed_in_zhajinhua_game 首次在 createGameRoom → waitRoomReady → gameReady(menu-button) 等待 45 秒失败，retry 1 通过，failOnFlakyTests 正确阻断。
artifact 13740522636，SHA256 b80ddf8c318eed72c568418cbfdf88a334ce2ba06129cd63971e3af75319a03f；在新目录核验运行、HEAD、摘要、CRC、路径及正式 App 7a24d8c / build 300003601 后读取报告。一次下载失败只重试读取，并未重跑 CI。

已查看首次原图：仍在房间启动页，上面有真实“连接超时 / 请稍后重试”弹窗，并非菜单截图或遮罩差异。新房间已经登记，失败后的原有 DELETE 仍只发送一次并成功解散。

原网络证据 19 项：大厅连接 64 节点的 WebSocket 握手及订阅 ACK 成功；建房后再次请求 public/v12 metadata 成功，随后该节点健康响应 server_load=normal、backend_delay=1111，另外 04 与 67 节点探测错误。
正式应用 ProxyUtil.listFastProxy 的原条件要求 backendDelay <1000；HTTP 200 不等同于符合该条件。MainScreen._connectCentrifuge 对元数据或快速线路选择异常显示该弹窗。
缺少完整的当前方法错误与其余候选结果，因此不能唯一归因于桥接、远端延迟或缓存状态，也不能以 retry 1 通过声称已修复。

本分支不提高后端延迟门槛、不自动点击重试、不重复建房、不增加健康请求。独立 ADB reverse 候选减少桥接依赖，实际重复验证仍在进行。新的正式 App b062c6e / build 300003701 已发布，最终完整回归须同步并保留最新部署记录。
