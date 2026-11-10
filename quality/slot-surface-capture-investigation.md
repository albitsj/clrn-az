# Slot 退出：连续原始帧采集候选

本修改仍需远端验证，不能据此声称 Slot 偶发失败已经消失。

原实现的固定五次诊断 run `42732052092` 有两次 flaky，且首次失败中有一次没有合格中途帧。
正式 APK 为 master `7a24d8c230fd2602734de689799d316e02e31616`、build `300003601`。
后续有效系统跟踪 run `42745222012`、attempt 1、诊断 HEAD `2d9abb984b6a9ed65d9d77eaea3986e781440533`
得到四次通过、一次 flaky。所有六次尝试均保留完整 Perfetto 跟踪；首败 report artifact `13732403502`
的 ZIP SHA256 为 `0148f5b35be59e221f4f9e4bae9d5661388aa2e853b3cf3592a860f46acb56c9`。

首败实际 panelFrames 采样 91 次、保留 9 帧；原比较器的最佳中途距离 51.0649，大于原门限 46。
临近退场的采样间隔达到 92、56、89、62、52、65 毫秒。
Perfetto 的 BOOTTIME 与 MONOTONIC 时钟快照仅相差 120ns，设备 uptime 可直接对齐。
将 App SurfaceFrame 的 display_frame_token 连接实际 SurfaceFlinger DisplayFrame，能看到采样间的显示更新；
不能仅凭这些时间戳声称其中某个未采集画面一定包含已审查姿态。

设备 uptime 330800..331050ms 的 250ms 窗口内，两颗 CPU 共约 500ms 容量：
App RenderThread 使用 142.70ms；SurfaceFlinger RenderEngine 79.93ms；composer binder 76.13ms；
采集驱动自己的 RenderThread 52.90ms、AndroidJUnitRunner 30.47ms，空闲仅约 27.70ms。
App 主线程使用约 3.78ms，不能归因成单纯 JS 主线程长阻塞。
截图观测本身增加负载，是要通过候选对照验证的因素。

已核对 Android `android-15.0.0_r1` 的 `UiAutomation.java`：takeScreenshot 在返回前已复制为软件 ARGB_8888。
因此额外复制软件 Bitmap 不能消除这次整屏读回开销，没有加入该改动。
实际候选采用同版本 `FrameOutput.cpp` 的 `screenrecord --output-format=frames` RGB_888 协议，
沿用既有视频的 240×426 源分辨率与 Lanczos 720×1280 缩放，再裁切原完整 `(0,500,720,680)`。
逐包校验固定头、尺寸、步幅、格式与预算；没有时间插帧或固定 fps 滤镜。
时间戳明确记录为主机收到完整包的 performance.now，不能冒充设备呈现时间。

只对 slot-popup-exit 启用；关闭按钮通过 Playwright 异步 shell 单次触发，避免同步 ADB 阻塞接收。
首帧与自身 PID 均就绪后等待原 300ms 触发，观察原 3.2s 窗口；只有连续完全相同像素可合并。
保留全部实际接收时间、全部变化帧与末帧，240 原始帧、64 变化帧任一预算超出均失败。
标准错误及 PID 通道独立；只停止本次 PID，等待退出且拒绝非零状态；远端 shell 另设 8 秒停止保险。
原始帧分支自身不执行编码器的 --time-limit 检查，故不依赖该参数假装有界。

原 ROI、截图基准、距离 46、列覆盖、错位反证、局部运动、首尾视觉门槛、重试两次及 failOnFlakyTests 均保持。
诊断分支的五次重复、账号筛选和 Perfetto 包装绝不能合入修复分支。
