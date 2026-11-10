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
标准错误及 PID 通道独立；只停止本次 PID，等待退出且拒绝非零状态；远端 shell 另设 8 秒 SIGINT、10 秒强杀保险。
原始帧分支自身不执行编码器的 --time-limit 检查，故不依赖该参数假装有界。

真实 POSIX shell 进程测试另复现了初版保险 sleep 继承输出管道的问题：即使录制和 shell 退出，管道仍未释放。
保险进程现在将全部标准流重定向到 /dev/null；同一测试从失败变为通过，不能用 mock close 代替此验证。
正常停止超时还会对本次 PID 进行有界强杀，但保留原停止错误，不能将强杀当成成功。

原 ROI、截图基准、距离 46、列覆盖、错位反证、局部运动、首尾视觉门槛、重试两次及 failOnFlakyTests 均保持。
诊断分支的五次重复、账号筛选和 Perfetto 包装绝不能合入修复分支。

## Android 停止链修正与真实验证

旧候选 09e0ce2 的实际 run 42755833885、HEAD 4e28424、artifact 13736957335（摘要 d4ea3b2f15a04b104e7a057da3e9d6b3e7fafdd218e518ee4f509383b2508009）九次执行均停止超时，不能单独合入未修正版本。
首败有效 Perfetto 中，录制 PID 4160 最后调度为 239.842272497 秒；父 shell 4158 自 239.845859 秒等待约 2026ms 后终止，状态 X。
保险 shell 4162 则从 239.845989 秒睡眠至 244.409726 秒；其 sleep 子进程 4163 在 244.409735 秒变为 Z，保险 shell 随后在 244.410071 秒变为 Z。
这与父 shell 在停止后等待保险的前台 sleep 相符，不能据此唯一证明信号系统调用或 stdin EOF 根因。

本次仅把保险内部的 sleep 改为独立后台子进程加内建 wait，并显式 TERM trap 终止及回收自己登记的 sleep；保留八秒 INT、十秒 KILL、原停止期限与非零失败判断。
不改变采样、颜色比较或任何正式空间门槛。最终干净候选 2b15cb0 在下述真实五次运行及原比较器回放中通过。

20 项 Surface 测试、类型及定向 ESLint 通过；真实 shell 测试另以 Android15 官方 mksh 源码 695e5e51cdab62910f8d12a7becc74d6c11bd726 编译的宿主二进制执行通过。
测试将测试录制器的启动等待与停止等待分开，停止仍须在 1500ms 内释放通道。宿主原命令也能通过，不能宣称宿主测试复现了 Android 的九次超时。

另外，原采样仅配置四核的独立 run 42760702191 已失败（十次执行中九次同一中途帧断言失败），严格回放同样拒绝；四核方案不合入。


实际 run 42766681040 / attempt 1，诊断 HEAD 8592a54c7ac4d77fd2dfa53a74e9fc8ea133da5e、job 129665122293：五次全部 retry 0 passed、无 flaky，录制正常退出。正式 App 7a24d8c / build 300003601，原双核及原账户映射不变。
报告 artifact 13742025405，SHA256 7a5fd5f1feb7868733716e495ec5771fdf1f01dcf3d6c002786203badac9e657，运行、HEAD、摘要、CRC、构建身份已核验。实际附件表明采样方法 surfaceFrames、完整原 ROI，时钟明确为 host-receipt-performance.now。
每次完整接收帧数 36/64/42/63/62，保留变化帧 8/17/13/18/17。用未改的生产 middleCandidates/assertReviewedVideoMiddle、46、列结构、错位及局部运动条件回放五次均接受，最佳距离分别为 10.53197、7.35263、14.49745、7.35263、7.35263；已查看实际匹配原图。
诊断包含当前代理与失败取证，禁止把 repeat/filter/Perfetto 包装合入。最终仅合入干净 2b15cb0 和独立干净代理候选 3933b44，再同步最新正式包后全量验证。不能据此声称整个最新 master CI 已通过。

干净候选另补跑完整本地测试：570 项中 568 通过，2 项既有 SDK 夹具外层五秒等待超时；同一 SDK 文件单独 7 项通过。最终组合修复仅把测试夹具防挂死上限改为十五秒，生产 120/600 秒与十秒强杀参数不变，7 项回归通过；最终组合的完整检查仍须执行。
