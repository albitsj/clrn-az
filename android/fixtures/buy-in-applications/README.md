# #31 原始轨迹输入

这里的 PNG 是历史报告附件中的原始输入，**不是新基准或视觉批准**。
`timelines.json` 保存三组完整 20 帧的顺序及原生设备时间戳；重复帧复用同一文件，
与正式基准字节相同的帧用 `snapshots/` 引用。其余 PNG 以原始字节的 SHA256 命名。
所有帧均为原报告的 `x110/y400/470×450` 裁图，未缩放、补帧或重新编码。

来源：

- 迁移前 `d9ebf4d`：[40729146743](https://github.com/albitsj/clrn-az/actions/runs/40729146743)，
  texas/en/pregame-second 的 retry0。
- 迁移后 `24e46865`：[40754530804 / job 123050281508](https://github.com/albitsj/clrn-az/actions/runs/40754530804/job/123050281508)，
  同场景 retry0（失败）与 retry1（通过）。
- 两份报告的 build-info 均为应用 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`，
  APK SHA256 `27618d750fc306b1a75d52d642b2d90f361501fd1b9998bc3cd65ca5874196f5`。

`animation-transition.test.mjs` 将设备输入替换为这些原始帧，保留完整比较流程。
迁移前和原重试仍通过原截图比较；首败在原路径仍得到 `36.50041134751773 > 36`，
同一首败输入通过现有录屏比较路径。后者只证明断言路径兼容该真实相位，
不把旧截图冒充新录屏，也不证明模拟器录屏的实际帧率或新提交设备运行通过。

修复在采集前为德州带入审核入场固定选用已有 screenrecord 路径；不以实际差异
挑选图片或采样方式。没有接入晚期备用图，没有改变截图比较器、阈值或重试。
背景/文字和面板位置的正式视觉验收仍须检查新提交同轮 MP4、首尾 PNG、区域、
progress、build-info 和网络诊断；见 [调查记录](../../../ISSUE_31_SAMPLING.md)。
