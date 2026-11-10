# 五次独立原生复现：仅诊断分支，不得合并

基于 `708a331100d13ac88f51365991c0de2295823fd9`。应用、用例正文、采样、像素比较、基准、超时及失败判据不变；本分支只增加五次用例重复，并在手动选择德州繁体时将诊断矩阵限定为原账号对应的 other 分片。默认全矩阵仍为 35 个分片。

使用已有 workflow_dispatch：full=true、mode=compare。光标诊断选择 group=texas、locale=zh-Hant、filter=signed_in_texas_hall_variants；如需老虎机补充复现，选择 group=social、locale=en、filter=all three native slot reels and reward types animate from real spin responses。

目的：在主 PR 与独立单次观察未复现间歇故障后，用同一未经修复的采样/光标实现收集更多实际观测；每次结果和首次失败均保留，原 failOnFlakyTests 继续生效。此重复运行是取证过程，不是修复方案，不得据此声称原始失败根因已经消除。

此分支严禁创建合并 PR 或整支合并回主修复分支；若取得根因，实际修复应另从生产修复 HEAD 建立，不带入本分支的诊断编排。诊断门禁不替代主 PR 及最新 master 的完整 35 分片验收。
