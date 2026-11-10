# 启动代理传输五次复现（仅诊断，禁止合并）

基于生产候选 `3933b44`，仅为原 Playwright 启动器添加 `--repeat-each=5`。
workflow_dispatch 选择 guest/en 的 `launch_branding`。使用原矩阵账户、正式包、断言、两次失败重试及全局失败门槛；未添加额外请求或等待。

本分支仅用于检验 ADB reverse 首轮连接候选。正式修复只能取不包含重复参数的独立生产候选提交。
