# 玩家动作起点原始输入

`raise-start-with-call.png` 原样取自 [master b591b9e 的运行 41690686827](https://github.com/albitsj/clrn-az/actions/runs/41690686827/job/126109054724)
中 `texas/en/game-table` retry0 的 `texas-player-action-raise-start` 附件
`data/90257555a9e65306214322af33a0e64b9617ae38.png`，未重编码或修改像素。
SHA256 为 `7f5bc709b2ce7b76d85dca9338085ca528eacf6025d0152f50a04fe4ab4b2a10`。
区域为 x132/y465/63×130；实际画面仍有上一轮绿色 call 标签和筹码 20，既有起点是空牌桌。

该轮 APK SHA256 为 `9259063dbdf25f4f52e93570a943c88f6a081e28e091075ae4c48c0e0c73161e`，
应用提交 `b20853dbe65c5025d7232b17ea99e9a5d9a1a3ec`。
首败为起点逐像素断言失败，重试通过；不能把 Actions success 当成首次通过。
本图仅是准备逻辑的否定输入，不是新增或替换的正式截图基准。

reference 回归另使用 `check-middle.png`：原样取自同一固定 APK 的
[运行 41814766279](https://github.com/albitsj/clrn-az/actions/runs/41814766279) 中
`texas/en/game-table` retry0 的 `texas-player-action-check-middle` 附件
`data/a110bb58fb3325c2cf1aab9377a16da97de74228.png`。
SHA256 为 `4c84342f37dddf2bc946d10f35076d1dbe3ce1fbc55df00c8e9e2d2c48b92a28`，未修改像素。
既有正式 check 中途图十分接近起点，不能当作录屏候选的测试输入；这里保留实际录屏中途帧，
不改变正式参考集合或候选阈值。reference 测试在临时目录实际生成并核对四种动作的首中尾图片，
覆盖首次缺图及已有起点变化；静止、直接跳到终点、录屏未完成仍必须失败。
