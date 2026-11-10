# 仅供诊断，不得合入

父提交 bbaaa38315a2db36939429d0493d58a7cc3753b0；正式 APK 7a24d8c230fd2602734de689799d316e02e31616 / build 300003601。
固定执行英文 texas / signed_in_texas_game_table 五次，用父提交新加的完整 ROI、采样时间及原始距离诊断复现 opponent-turn-countdown。
只增加 --repeat-each=5，并在原账号分配完成后筛选唯一英文 game-table 分片；保留原账号锁和分配结果。
不修改业务场景、事件、App、采样方法/间隔/数量、门限 >1、基准、重试 2 或 failOnFlakyTests。
五次通过也不代表已唯一归因；任何首败均按 worker/retry/startTime 隔离，读取实际倒计时 ROI 和时间线。
