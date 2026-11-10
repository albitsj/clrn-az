# 初始节点全部不可用时仍执行无凭据服务器发现

run `42750216827` / attempt 1 / HEAD `f666940f762e52bc86d03d973696646953e2ea78`
中，jobs `129618118788`（social/zh-Hant）、`129618118805`（rooms/en）、`129618118852`（guest/zh-Hant）
都在账号准备阶段退出，尚未启动模拟器；错误为 `准备测试私人房间失败 (unavailable; attempts=0)`。
失败位于 get-or-create house 之前的选线，没有发送该业务 PUT。

三份实际日志均显示：03:52:27..33 UTC，HK 67 与 KR-Seoul 64 的健康结果 unavailable，
JP 65 与 KR 68 的健康请求超时。紧接着为 `/v10/house/user/:userId` 的 complete / attempt 0。
此前同账号金币准备阶段成功登录、读取钱包，并通过公共 metadata 发现过包含 US-LA 69 的节点列表。
房间准备使用新的独立客户端，重新从四个 bootstrap 节点启动，初始健康 race 抛错后直接退出，未执行 metadata 发现。
现有日志不能证明那个时刻 US-LA 或其他发现节点一定健康，因此不能声称这些上游节点自身已被修好。

确定性回放覆盖：所有 bootstrap 均 busy；第一个 metadata 入口断开、第二个返回允许域内的第三节点；
第三节点健康检查 normal；随后向第三节点发送唯一一次 replay=never 的业务 PUT。
同一新增测试在原 `f666940` 源码上失败为 unavailable / attempts=0，在候选实现上通过。
这是可复现的初始发现短路问题，不依赖真实服务刚好恢复。

修复仅在初始 bootstrap 健康 race 耗尽时继续原有无凭据公共 metadata 发现，再执行原有健康选线。
没有直接信任 metadata 或向 busy 节点发送业务请求；没有新增业务重放、固定节点、延长超时或放宽 allowlist。
沿用原总调用期限、单探测期限、最多三路并发、失败节点排除以及胜出后取消并回收其他请求。
初始 race 因取消/超时/客户端 dispose 结束时仍立即退出，不继续发现。

定向测试 36/36 通过，包括真实 socket 响应丢失后的 DELETE 不重复结算、get-or-create house 与登录不重放，
以及发现过程中的超时、取消和 dispose 均保持业务发送次数 0、活动请求 0。
原“所有健康探测都失败”测试现在明确区分公共 metadata 与业务请求：所有发现节点仍不健康时继续失败，业务发送次数仍为 0。
TypeScript、ESLint、完整 npm lint 和 diff 空白检查均通过。
实际远端账号准备与全套 CI 仍需验证，不能用本地回放代替远端通过。
