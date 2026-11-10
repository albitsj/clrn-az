# 独立帧时间线取证，禁止合并

此分支从五次复现诊断 6ce8dbc 建立，只在实际老虎机退场前启动 10 秒、16MiB 的 Perfetto 帧时间线和线程调度，结束后附加完整轨迹。应用、用例、原生截图、比较区域、所有基准、阈值、重试和 failOnFlakyTests 不变。仍限定原五次重复，不能作为完整 35 分片验证。

目的：42732052092/a1 已复现三次真实失败，需要区分未呈现中途帧和截屏漏采。此前 gfxinfo 在 Modal 销毁后无法证明统计属于该弹窗，不能据此猜测根因。只读取本次已结束、实际输出的 trace，失败日志仍在首次失败后优先保存；诊断异常不替代原始异常。

官方依据：https://perfetto.dev/docs/data-sources/frametimeline ，https://perfetto.dev/docs/learning-more/tracing-in-background 。background-wait 在数据源就绪后返回，固定期限结束且进程退出后才拉取，避免未完成 trace 被当成完整证据。
