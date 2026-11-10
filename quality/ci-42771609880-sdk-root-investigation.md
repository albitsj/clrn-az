# SDK 正常场景的 adbd 重启握手

实际 run 42771609880 / attempt 1，HEAD 004739663fce28ac63e5d2f9970fc474a6f2e2fa，Diagnostics(normal) job 129680475760。失败不是启动资源不足；emulator 已启动，exercise 在 adb root 返回 1 时失败，后续校验按原规则拒绝。
artifact 13742117036，SHA256 5dd6b42cb6bd964fcbeadb2911e15a364e85171390da02b1b5ce534edf330c49，已核验运行、HEAD、摘要与 CRC；这是 SDK 日志产物，没有 APK。

smoke.log 的原始脱敏输出为 `adb: unable to connect for root: closed`。已有失败诊断表明 wait-for-device 返回 0，service.adb.root=1、init.svc.adbd=running、ro.debuggable=1，id 显示 UID=0，adbd 进程所有者也是 root。重启前的真实脱敏日志标记已保存。该证据明确支持“root 已生效，传输重启中断握手”，不支持忽略任意 root 错误。

修复只对退出 1 且输出精确匹配该 closed 信息的情况继续原有等待；之后独立执行有界 id -u，必须为 0，再观察原有重启后日志标记、保留重启前标记。正常退出 0 的 root 命令也要验证真实权限。root 命令只执行一次，不重放；权限拒绝、其它退出码、offline、重连超时、非 root 状态仍失败。验证失败时保留原始 root 错误和导致验证失败的异常；诊断失败不覆盖原始错误。

新六项回归在原代码上为四项失败（无夹具错误），修复后六项通过，覆盖上述正反边界；原有通用 root 失败与诊断自身失败的错误身份测试继续保留。完整 Python 79 项及完整 lint、类型检查通过；新的真实 SDK 正常场景与最终完整 CI 仍需验证。

此修复不修改原生 UI、正式包、采样、截图门槛、SDK 安装期限或任何业务请求。提交前的完整组合源代码已通过 580 项 Node 测试，Python 变动已通过完整 79 项检查。
