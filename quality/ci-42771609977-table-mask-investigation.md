# 观察者和满桌截图的已有网络遮罩就绪条件

run 42771609977 / attempt 1，HEAD 004739663fce28ac63e5d2f9970fc474a6f2e2fa，texas/zh-Hans/other job 129680881144。signed_in_texas_table_states 首次在 observer 和 full_table 两张截图失败，observer 报 5249 个差异像素；retry 1 通过仍由 flaky 门禁阻断。
报告 artifact 13742826946，SHA256 fbab3ef89b8c60128b76f01fc3e676338fba1b0ee8f718868d259df9229c1815，已核验运行、HEAD、摘要、CRC 和正式 App b062c6e / build 300003701，已查看实际 observer 图及 diff。

两张首败记录的 native-tree 均没有 ping-screen-container，mask 列表也因此缺少已有网络延迟遮罩；实际 PNG 的右上网络数值和图标已经绘出。重试的树有该节点，原规则生成网络遮罩并通过。这是读取树与实际绘制的就绪差异，不能靠扩大截图容差解决。

使用首败和重试的四张完整 original PNG 执行现有 samePixels 与 maskScreenshot：保留其它所有原遮罩、仅移除既有网络遮罩时四张均失败；恢复既有 (610,146,100,48) 区域后四张均通过。首败恢复后的整图 RGBA 不同像素上界分别为 3603、1122，低于原 0.005×720×1280=4608；没有修改该阈值或基准。

修复沿用自动带入已存在的 requirePing 和连续两次前景布局稳定流程，仅把 observer、full-table 纳入同一要求，三种语言共用。必须在生成遮罩的本次树中取得真实节点；没有新增遮罩、扩大范围、重拍掩盖失败或增加外部请求，其它截图保留原路径和原三十秒就绪上限。

六项新增回归覆盖三语两个状态：旧代码六项失败，修复后连同已有测试八项通过；完整 lint、类型检查通过。原图回放不能代替最终真实全量 CI，组合修复仍须最终验收。

同轮 texas/en/game-effects 的 profiles 首败另有 artifact 13743340950（SHA256 afcf0a7532a36204c7065f8a541d4ef28bf6ba8ece5dbb5be8a0236fbc3f66fe）。身份、摘要、CRC、正式包已核验，实际图为 Create game failed / Request failed with status code 500 /v3/pay_action/do；不是没有点击建房。该真实服务端付费失败保留，不自动重放创建或付款请求，不改变该场景的失败门槛。
