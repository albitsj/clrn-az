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
