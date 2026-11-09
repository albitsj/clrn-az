# Diagnostics graceful-stop 首败取证

- 诊断指纹：`6c24e6d4912d1a68fd5b320ebf7c1c0fd96527736d849d0c0e69182501181cb9`。
- run `42708690347`、attempt `1`、job `129472192006`；API headSha 与本地 HEAD 均为 `d61365e6049456bc662e1af64237f64dd1a30bda`。当前已在专用修复分支，未改分支引用、index 或历史。
- run API 中唯一失败为 `Diagnostics (graceful-stop)` 的验证步骤，其余六个真实场景及七个账号槽任务成功。原断言为 `Cleanup outcome failure; expected success`，不是业务测试失败。
- artifact `13716005973`，名称 `android-diagnostics-smoke-graceful-stop-42708690347-1`，核对 run/attempt 后下载到全新目录 `/tmp/ci-42708690347-job129472192006-attempt1-OOZ8Xm`；下载解压成功后才读取，没有复用旧报告。

## 日志与根因边界

`cleanup.log`：22:16:02.622 模拟控制台 ACK，`cleanup_exit=0`。`emulator.log`：22:16:12.625 正式包装器向登记进程组发送 SIGTERM；SDK 明确启动 20 秒退出预算，随后记录保存快照请求被忽略；22:16:32.884 原生退出 `-9`，写入 cleanup-failed。没有 `timeout after graceful-stop` 或 `stop-requested`，包装器的 25 秒后备强杀未触发。

`host.log`：SIGTERM 后 QEMU 3453 持续存活，netsimd 3526 变为僵尸，新子进程 4523 存活至 22:16:29。SDK 关闭路径未在其预算内完成是已证实的直接原因；为何阻塞仍缺少线程等待状态。退出时间与 SDK 自身看门狗相符，但不能仅据时间证明 SIGKILL 的发送者，也不能把 `-9` 当作正常退出。

修改前只读检查全部本地／远端跟踪分支和相关提交。HEAD 已含 `6ff92e0` 的正常终止后备、`9da82e6` 的 25 秒等待及 `f9f4a8f` 的标记检查点，全部保留。历史调查 `quality/ci-42568906820-investigation.md` 记录 `42662080514` 在 SIGTERM 后约 2.22 秒原生退出 0，以及 `42672279283` 七场景通过；同轮 normal 成功也没有经过模拟 ACK 的同一后备路径。这些正例不能解释本轮 20 秒后 `-9`，不能以延长包装器等待、重试通过或改写预期退出码解决。

定向核对 SDK `EmulatorNoQtNoWindow::requestClose` 源码：启动 waitAndKillSelf 后，经快照功能分支或 adb 关闭回调请求 VM shutdown。现有日志不能区分该异步路径、线程锁等待或向整个进程组发送信号的影响，不据此修改关闭策略。

## 本次改动及验收

仅在既有 SIGTERM 发出后启动独立 daemon 诊断，立即、约 5 秒及约 15 秒记录原生主进程的线程状态与内核等待点。每次 ps 限时 2 秒、最多保留 256 行，仅 PID/TID/状态/wchan/进程名，经原有脱敏日志写入；不读取 argv、环境或线程内存。进程结束即停止后续观察。诊断与既有 25 秒等待并行，启动和采集异常均由 best_effort 隔离，不设置 cleanup-failed，不改变退出码、信号、采样条件和断言。

三个最小定向单元验证通过：输出上限和结束后停止、ps 失败不改变清理结果、诊断线程启动失败仍发送同一 SIGTERM 并等待原 25 秒。Python 文件行数检查及 diff 空白检查通过。未在本机重跑 Android 场景；完整 CI 门禁不变。

尚未修复／仍待 CI 取证：真实 SDK 偶发关闭阻塞。下一轮若重现，读取 emulator 的 thread-waits 与同一时间 host/emulator 日志，按等待点定位 VM 关闭路径；若通过，也不能仅凭一次通过认定根因消失。本次不使用 NO-FIX 协议，不声明调查完成；由 ci-guard 提交并运行 CI 取得本机无法提供的真实 SDK 线程证据。
