# 未解决的聊天入场采集阻塞

原始输入来自 [运行 41814766279](https://github.com/albitsj/clrn-az/actions/runs/41814766279)
的 `texas/en/pregame-second`，源提交 `94487630882fc00f143af5286bdb623c4a5ae26b`。
实际报告为 expected=1、flaky=1、ok=false；目标用例 retry0、retry1 失败，retry2 通过。
固定 APK 为 `9259063dbdf25f4f52e93570a943c88f6a081e28e091075ae4c48c0e0c73161e`，
应用提交 `b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec`，没有切换构建。

`recordings.tar.gz` 原样保留三轮 MP4、原生首尾 PNG 和 build-info，不重编码或合成录像。
清单记录原始附件路径、SHA256、报告的全部解码时间线和 ffprobe 读取的原视频 PTS。
完整原报告另保存在本工作区 `.ttyctl/review-evidence/pregame-second-41814766279/`。
下载 ZIP 的 SHA256 与 GitHub artifact 13315017929 的 digest 相同。

逐帧查看原视频并在取消 fps 重采样后检查，retry0 的 159 帧仍无合格中途相位；
retry1 的 161 帧仅有三张晚期候选，进度约 0.979、距终点约 0.185，仍不符合原轨迹约束。
retry2 的 164 帧有五张中途候选。同一失败在生产 fps=30 解码参数下同样重现。
这排除了“解码时丢掉本来合格的帧”作为两轮失败的解释，尚不能区分录屏漏采与应用绘制停顿。

`chat-entry.test.mjs` 用全部真实帧运行完整生产采集，要求前两轮继续失败、第三轮通过；
这是防止错误放行的负例，不能作为根因已修复或设备验收已通过的证据。
正式基准、参考集合、区域、阈值、遮罩、重试次数和产品行为均未改变。
验收配置增加 `failOnFlakyTests`，保留诊断重试但让 flaky 报告以非零退出，阻止未知故障被当作成功。
本机没有运行中的模拟器，也没有固定 x86_64 系统镜像，当前修改没有提交或推送。
该阻塞须在同一固定 APK 的设备上继续定位并完成当前源码的首轮及完整回归，不能用重试成功关闭。
