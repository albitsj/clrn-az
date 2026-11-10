# 模拟器 CPU 资源对照候选，尚需真实验证

有效跟踪 run 42745222012 / attempt 1 / HEAD 2d9abb984b6a9ed65d9d77eaea3986e781440533，正式 App 7a24d8c / build 300003601。
Slot 首败相同首尾下，91 次原生截图保留 9 帧，最佳中途距离 51.0649，原要求 <=46。
关键 250ms 内，guest 两颗 CPU 共 500ms 容量，空闲约 27.70ms；App RenderThread 142.70ms，
SurfaceFlinger RenderEngine 79.93ms，composer 76.13ms，截图驱动 RenderThread/JUnit 共 83.37ms。
这能证明该窗口 guest 负载接近容量，不能证明增加核心一定修复所有漏采。

已有首败宿主 host.log 含 ksoftirqd/0..3、约 16GiB 内存；QEMU 生命周期平均约 178..182% CPU。
平均 CPU 不是关键窗口峰值，也不能据此声称宿主完全空闲；至少有四颗逻辑核心可由本轮真实跟踪继续核对。
实际执行的 reactivecircus/android-emulator-runner SHA a421e43855164a8197daf9d8d40fe71c6996bb0d
的官方 action.yml 明确支持 cores，默认 2。当前 action 没有显式设置，原 guest 跟踪也只有两颗 CPU。

候选仅显式配置视觉模拟器 cores:4，沿用现有公开 Ubuntu runner，不改运行器规格、账号锁、RAM、GPU或应用。
原 panelFrames、采样窗口/数量/间隔、完整 ROI、截图基准、距离 46、列覆盖/错位/局部运动、重试两次及 failOnFlakyTests 全部保留。
与连续 raw Surface 帧候选分开：raw 的两轮真实验证均有停止超时，该实现不合入本候选。

独立诊断分支固定五次 Slot 运行，并保留原 Perfetto 包装；需要逐次核对实际四颗 guest CPU、采样间隔和原空间比较器。
只有实际重复运行及正式完整 CI 通过后才可接受；诊断分支的 repeat/filter/trace 包装不得合入。
