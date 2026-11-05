# 短时提示入场元数据

`frames.json` 是 [运行 41773207539](https://github.com/albitsj/clrn-az/actions/runs/41773207539)
中 texas/en/other 的 `signed_in_texas_controls` retry0 附件
`en-signed-in-texas-controls-accurate-raise-minimum-error-frames` 的原始 UTF-8 正文，未重新序列化。
SHA256 为 `cf0fabee0ba58f5faa9f5e817802ee279b1d10affbe36f77232e71ec29fe3d18`。
报告 artifact ID 为 `13296995648`，测试提交为 `ec7ff5a97e404c20f4b4bb89a681817624d03563`。
APK SHA256 为 `9259063dbdf25f4f52e93570a943c88f6a081e28e091075ae4c48c0e0c73161e`。

全部 7 帧元数据均保留，第一帧文字在采集前后由 y0/6px 移到 y121/33px，panel 尚未进入控件树；
其余六帧均有 panel。原代码在保存这一帧的位图前就因 panel 缺失抛错，因此原报告没有该位图。
单元测试只复用真实元数据，像素使用明确的合成输入，不宣称还原或批准原始失败画面。
