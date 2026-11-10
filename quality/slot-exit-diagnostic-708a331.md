# 独立老虎机退场诊断

本分支的运行时代码与 `708a331100d13ac88f51365991c0de2295823fd9` 完全相同，只有此说明不同；原 SDK 关闭验证分支及其历史保留。

主 PR 的完整回归继续运行。本分支通过已有手动工作流，以 `group=social`、`locale=en`、`mode=compare`、`full=true`，仅选择 `all three native slot reels and reward types animate from real spin responses` 取得独立真实运行证据。

目的：老虎机在 `113b149` 的首次无损采样仍遗漏合格轨迹，当前仅补充首次日志及渲染统计，尚未证实根因已经消除。诊断运行保持原基准、采样、断言、失败及 flaky 门禁；不改动应用或测试。

手动过滤运行只对应诊断门禁，不证明完整矩阵或主分支成功，也不替代主 PR 或最终 master 的 35 个原生分片验证。
