# 模拟器代理使用本轮 ADB 反向转发

## 已观察事实

- 生产提交 `bbaaa38315a2db36939429d0493d58a7cc3753b0` 的 Visual run `42756670268`、guest/en job `129632668694`，首次执行在启动页的初始 `waitForHall` 失败，发生在网络 hold 之前。
- 已核验报告 artifact `13735989409` 的运行身份、SHA256、ZIP CRC 和正式 App build `300003601`。实际屏幕显示 staging 节点 67 的网络错误；网络诊断没有记录到代理请求。同期 logcat 记录 `Network is unreachable`。
- 原选择方式仅在初始化时探测 `10.0.2.2`，一次 TCP 探测成功不能保证模拟器后续桥接路由一直可用。后续重试进入原有 ADB reverse 分支并通过；这提供传输改动的依据，但不能唯一证明原始失败的根因或排除远端故障。

## 改动

每个隔离代理会话先创建原已支持的专用 `adb reverse tcp:port tcp:port`，在模拟器回环地址执行原有三秒 TCP 探测，然后配置 `127.0.0.1:port`。不再依赖 `10.0.2.2` 的桥接路由。配置失败立即回收本轮已创建的映射；映射创建失败不移除未拥有的映射。退出仍恢复旧代理设置，保留原始错误及清理错误。

不增加业务请求重放、启动重试、等待时限或截图宽容度。原有 App、场景、采样和视觉断言不变。

## 验证及限制

`node --import tsx --test android/proxy.test.mjs`：10 项通过，包含反向转发 TCP 探测失败及创建失败的负向验证；typecheck、定向 ESLint、git diff 检查通过。

真实运行 42764115228 / attempt 1，诊断 HEAD 4f9f94c6399cf07d7ebce4092d187f4360da3e41：五次启动全部 retry 0 passed、无 flaky。报告 artifact 13741995578，SHA256 9cf3b49aff64559974bd2bacb473a40e47d323f0988c7f890779cc74a203ec61，运行身份、摘要、CRC 及正式 App 7a24d8c / build 300003601 均已核验。
诊断只添加五次重复；生产只合入干净候选 3933b44，重复参数不得合入。最终同步新正式包后的完整 PR 及 master CI 仍须验证；五次成功不能排除所有远端故障。
