# 合并请求 #35 本轮验证记录

记录日期：2026-10-29。宿主累计远端失败次数为 0，尚未触发复盘；没有以本轮本地失败增加远端修复次数。原提交 38 项检查已通过，但不能代替此次合并后的新提交检查。

## 身份和合并状态

- 本地目录及分支与宿主指定值一致；开始时没有未提交修改、没有正在进行的合并，全部已有工作位于原来的两个提交中。
- 原远端 `albitsj/clrn-az` 的 `issue-repair/30` 在开始和交付前均为 `4b669e8a92b594840f906e46f2512bebb14371ea`。
- 抓取后真实 `origin/master` 在两次只读核对中均为 `4cc323f746c4b15f97848dd7791590196b101ad8`，它尚未成为原 `HEAD` 的祖先。
- 按要求执行 `git merge --no-commit --no-ff origin/master`，无冲突。当前 `HEAD` 仍是原提交，`MERGE_HEAD` 为最新主分支，未解决冲突列表为空。未创建提交、上传、变基、清理已有工作或启动远端工作流。
- `deployments/staging.json` 未变化，应用提交及发布版本与原英文德州牌桌日志核验一致。

## 调查和修订经过

1. 合并后原样执行完整入口，发现 ESLint 新增 3 项、失效 6 项。对照主分支变更，原因是旧基线仍指向 `24e4686`：动画和素材函数简化、嵌套减少及位置移动使原清单失效。这不是从本轮新代码推导豁免的依据。
2. 用同组锁定规则分别扫描旧主分支和最新主分支，保存完整独立报告。保留旧文档与旧迁移清单。只登记最新主分支实际已有且当前仍存在的违规；下载器原有修复消除的两项诊断不登记。
3. 首次登记原来只校验声明行源码或环中各文件存在，不能证明相应复杂度值或依赖环属于主分支。改成扫描独立历史快照，逐项核对真实诊断；首次比较基准必须等于固定最新主分支。变更前提交已有清单时仍只允许缩减。
4. 第一次独立 Ruff 报告受 macOS `/var` 与 `/private/var` 目录别名影响，生成带临时目录前缀的相对路径，完整入口正确拒绝这些条目。改为先解析真实路径，再计算仓库相对路径；重新扫描并验证固定报告可重现，未通过修改清单接受临时路径。
5. 初次沙箱内安装依赖及运行 uvx 受宿主缓存写入限制影响。保留原日志后在获准的环境完成安装和完整检查。初始默认 Python 为 3.14.6，完成依赖安装后，将本轮新建的虚拟环境改用与工作流相同的 Python 3.12.0，再安装同一份依赖并执行固定测试。

上述安装和中间失败日志保留在 `/tmp/clrn35-npm-ci.log`、`/tmp/clrn35-check-before.log`、`/tmp/clrn35-old-measure.log`、`/tmp/clrn35-master-measure.log` 及本轮对应工具输出中。最终证据摘要和独立测量进入仓库，临时文件、依赖和凭据不进入提交。

## 实际执行结果

| 检查 | 结果与证据 |
| --- | --- |
| `npm ci` | 完成固定安装，退出状态 0；日志 `/tmp/clrn35-npm-ci-full.log` |
| 本地默认 `npm run check` | 退出状态 0；147 项单元测试通过，0 失败、0 跳过；日志 `/tmp/clrn35-check.log` |
| 使用 `QUALITY_BASE_REV=4cc323f746c4b15f97848dd7791590196b101ad8` 的完整入口 | 退出状态 0；147 项通过、0 失败、0 跳过；日志 `/tmp/clrn35-workflow-check.log` |
| 门禁和负例 | ESLint、Ruff、ShellCheck、工作流检查、133 个代码文件的行数检查、依赖门禁、重复门禁、类型检查及原生用例收集全部通过；真实复杂度、嵌套、语法夹具、依赖分层、导出解析、重复副本和新增首次来源负例均在完整入口中执行 |
| 工作流报告步骤 | 实际生成比较身份、版本和四类报告，全部可以解析；当前诊断为 ESLint 42 项、Ruff 12 项、旧环 2 个，初始重复 47 对；输出 `/tmp/clrn35-workflow-artifacts/quality-reports/` |
| `python3.12 -m venv --clear e2e/.venv` 与固定依赖安装 | 完成；只重建本轮新建的虚拟环境，不涉及已有源码；日志 `/tmp/clrn35-python312-install.log` |
| `e2e/.venv/bin/python -m unittest discover -s android -p 'test_*.py'` | 31 项中 30 项通过、1 项失败；原样复核结果相同；日志 `/tmp/clrn35-python-android.log`、`/tmp/clrn35-python-android-repeat.log` |
| `e2e/mitmproxy` 的同类 Python 测试 | 23 项通过；日志 `/tmp/clrn35-python-e2e-mitmproxy.log` |
| `visual/cases/club/mitmproxy` 的同类 Python 测试 | 3 项通过；日志 `/tmp/clrn35-python-visual-cases-club-mitmproxy.log` |
| `visual/cases/game-record/mitmproxy` 的同类 Python 测试 | 10 项通过；日志 `/tmp/clrn35-python-visual-cases-game-record-mitmproxy.log` |
| `visual/cases/texas-holdem/mitmproxy` 的同类 Python 测试 | 32 项通过；日志 `/tmp/clrn35-python-visual-cases-texas-holdem-mitmproxy.log` |
| `visual/cases/zhajinhua/mitmproxy` 的同类 Python 测试 | 19 项通过；日志 `/tmp/clrn35-python-visual-cases-zhajinhua-mitmproxy.log` |
| 现场及范围核对 | 无冲突、差异空白检查通过；截图代码和图片相对最新主分支无额外改动；原下载器修复保留；视觉比例仍为 `0.005`、`threshold: 0.1` |

完整入口中的关键结果：

```text
eslint：无新增违规；42 项精确历史债务见 quality/legacy-lint.json。
ruff：无新增违规；12 项精确历史债务见 quality/legacy-lint.json。
dependency-cruiser：无新增违规；2 项精确历史债务见 quality/legacy-cycles.json。
ℹ tests 147
ℹ pass 147
ℹ fail 0
ℹ skipped 0
```

## 仍须远端确认的内容

本地唯一未通过项是 `test_ci_diagnostics.CollectorTests.test_hung_adb_probes_do_not_block_host_collectors`：一秒超时的临时假设备脚本没有读到 `offline probe`，但其超时状态为 124、独立宿主采集仍完成。该测试、`ci_diagnostics.py`、`diagnostics_io.py` 与原提交和最新主分支均一致。

为排除集成改动，另从固定最新主分支只读提取诊断实现和测试，在独立临时目录运行该测试文件；10 项中同一项失败，其余 9 项通过。证据为 `/tmp/clrn35-python-master-diagnostics.log`，关键断言如下：

```text
AssertionError: 'offline probe' not found
Ran 10 tests in 1.433s
FAILED (failures=1)
```

事实仅能确认相同问题也出现在未合并的主分支本地快照；具体系统原因尚未确定，不能宣称已经恢复或新提交已通过。原远端 [仓库检查](https://github.com/albitsj/clrn-az/actions/runs/40832908727/job/123310960271) 的该组 31 项已通过，本轮不为本机现象增加重试、放宽超时、跳过断言或修改无关诊断实现。由脚本上传本次合并及门禁修订，再以新提交的远端结果确认该项和全部必要检查。

没有执行本地真实设备用例或启动新远端运行。新提交的全部 Android 视觉组、工作流附件中的真实父提交与比较基准，以及完整仓库检查均待宿主提交上传后验证。已读取的原英文德州牌桌 [日志](https://github.com/albitsj/clrn-az/actions/runs/40832908665/job/123311104831) 只用于核对应用版本，不替代此次截图简化后的验证，也不批准任何新基准。
