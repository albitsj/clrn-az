# 下注弹层缩放回归输入

原始输入来自 [master a11c646 的运行 40923950554](https://github.com/albitsj/clrn-az/actions/runs/40923950554)
中 `texas/en/game-table` 的首轮与重试。首轮 143 帧被逐列覆盖断言误拒，重试 162 帧通过。
这两段录像与对应原生首尾截图只作为测试输入，不加入正式截图参考集合。

`recordings.tar.gz` 原样保存两段 MP4 和两张去重后的首尾 PNG；没有重编码或合成录像。
`recordings.json` 固定原始附件路径、SHA256、区域、完整时间线及原始视频帧信息。
应用提交为 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`，APK SHA256 为
`27618d750fc306b1a75d52d642b2d90f361501fd1b9998bc3cd65ca5874196f5`。
首轮 MP4 SHA256 为 `8f8ebb87fce3ff77e8e91a86e0e80b5e477ce9ab27e2728be95472b3699141cb`，
重试为 `4e557900f99e1b8f41e6109bfb562a961851f36fae42594d4d72d05753f9f3c7`，与 #31 原调查记录一致。

`recorded-transitions.test.mjs` 使用与生产相同的解码参数重放全部帧，并校验原始字节和帧数。
接受参考仅使用调用方原有的 `texas-holdem-accurate-bet-enter-middle.png`。
此前 79 段录像归档、三组历史 60 帧及全部正式基准均保持原样。
