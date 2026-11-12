# CI 42521510898 / attempt 1 调查

诊断指纹：84794280783c0d36990a249406a28c3e6e45b27d5674e70466d2991e11d0e62e

远端 run API 与工作区 HEAD 均为 b6984062662d811650b85c74418aff58f1b1b835。修改前只读检查全部本地／已有远端分支和相关提交，未修改 Git index、引用或历史。仓库没有 .codegraph。附件使用包含 run、attempt、HEAD 的全新临时目录，核验 artifact 身份、ZIP CRC 和路径后才解压读取；HTML 内报告 ZIP 也另建目录读取，没有沿用失败解压目录。

## 实际失败及对应修改

- **Social/en，128875021079**：首次失败在 animation-transitions.spec.ts 的 club-rooms-empty-enter，而非菜单入退场。报告 20 帧时间戳 243541..245189，跨度 1648ms；末帧仍为淡入文字，终点已完全显示。同轮 retry 1 的 20 帧跨度 1743ms，最后一帧才等于同一终点。驱动 motionFrames 同时受 3200ms 和 20 帧上限约束，较快截图会提前耗尽帧数，不能保证覆盖后续空态淡入。仅该转场改用现有 launchFrames（10 秒／70 帧），保留原生逐像素首尾、真实中间帧、原基准、区域及 36 色差上限。没有加 settleMs 或 afterReady 绕过末帧断言。原始首败和成功重试的全部帧／时间戳保存在 fixtures/club-rooms-empty；回放证明新命令的比较路径仍拒绝未完成末帧并接受完整轨迹。它不等于新设备采样成功，须 CI 验证长采样能否保留完整相位。
- **Account/en，128875020852**：reset_password 首次和 retry 1 均为完全相同的 4742 像素差异，retry 2 通过；两次实际图 SHA-1 均 df818d03c102b541b8061151bd6ad51354000ba8。逐图确认两个英文占位文字折成两行。构建信息为应用 5d11c3e118f47538497cae30cca1799bd69d7977，APK SHA-256 b7d59732b1bc9f3021399f84082abbd042768a0c1ebabb31b30bd3adc8acd19b。历史 906bfff、74f8aa2、cee7723 记录了完整前置流程可能通过、独立冷启动仍可失败，排除“只需冷启动”的推断。上游应用 PR kevinanew/laiwan_react_native#7091 的密码字段样式修复明确将固定标题／输入 2:3 分列改为标题自然宽度及剩余输入宽度；本轮旧包尚无此修复。应用布局修复点在本工作区外，**受阻于上游应用修复包验收**，不更新旧包基准、不改变会话顺序或接受折行备用图。复用 a2e3a00 的安全诊断及其测试，采集原比较器已有的有限截图和脱敏布局／字体环境，供当前分支 CI 核对稳定折行与迟发重排；不增加截图次数、等待或比较重试，诊断异常不能覆盖比较结果。
- **完整回归，128892900501**：日志明确因 remaining.result=failure 拒绝当前提交；无独立失败原因，门禁无需改动。
- **下表 35 个合并门禁**：已逐项读取各自失败日志，均为 COMPLETE_RESULT: failure 后执行原 test 检查失败；没有独立测试错误，门禁无需改动。

历史 bc3048e／b4ab771 修复的是 texas-holdem-chat-actions-return-enter 丢失中间帧，与本轮空态淡入末帧未完成不同，不移植。历史 3f6a36c 的密码基准属于新布局应用 beea05ce…，不得用于本轮旧应用。上述成功重试均未当作故障消失的依据，failOnFlakyTests 及原测试矩阵保持不变。

## 附件校验

- account artifact 13637750005，ZIP SHA-256 f267de2ef341e28c6f14ee211a41700d384dd063399b98e625d8ec0f5dac56f7。
- social artifact 13636599607，ZIP SHA-256 fd1c3a51207f9121a0e9135f7ae7df316d959b046b4127c878314a901de5fdf4。
- 下载和原始日志存放于 /tmp/ci-42521510898-attempt1-b698406-a6XT30；临时报告未加入仓库。

## 门禁逐项对应

| job | 名称 |
| --- | --- |
| 128892995290 | Android (zhajinhua / en / pregame-second) |
| 128892995293 | Android (zhajinhua / en / pregame-first) |
| 128892995301 | Android (texas / zh-Hant / other) |
| 128892995311 | Android (texas / zh-Hans / table) |
| 128892995315 | Android (texas / zh-Hant / table) |
| 128892995341 | Android (texas / en / pregame-middle) |
| 128892995343 | Android (texas / en / other) |
| 128892995346 | Android (guest / en) |
| 128892995353 | Android (guest / zh-Hans) |
| 128892995357 | Android (social / en) |
| 128892995374 | Android (texas / en / pregame-first) |
| 128892995389 | Android (zhajinhua / en / game-table) |
| 128892995395 | Android (social / zh-Hans) |
| 128892995398 | Android (texas / en / pregame-second) |
| 128892995400 | Android (texas / en / panels) |
| 128892995406 | Android (account / en) |
| 128892995422 | Android (social / zh-Hant) |
| 128892995425 | Android (zhajinhua / zh-Hans) |
| 128892995434 | Android (zhajinhua / zh-Hant) |
| 128892995447 | Android (wallet-help / en) |
| 128892995449 | Android (texas / en / game-table) |
| 128892995456 | Android (zhajinhua / en / game-effects) |
| 128892995459 | Android (records / en) |
| 128892995464 | Android (rooms / zh-Hant) |
| 128892995468 | Android (rooms / en) |
| 128892995483 | Android (records / zh-Hant) |
| 128892995488 | Android (account / zh-Hans) |
| 128892995492 | Android (texas / en / game-effects) |
| 128892995496 | Android (guest / zh-Hant) |
| 128892995520 | Android (wallet-help / zh-Hans) |
| 128892995527 | Android (account / zh-Hant) |
| 128892995544 | Android (records / zh-Hans) |
| 128892995550 | Android (rooms / zh-Hans) |
| 128892995610 | Android (wallet-help / zh-Hant) |
| 128892996053 | Android (texas / zh-Hans / other) |

## 验证

原有动画回归及复用的密码诊断测试共 56 项通过，0 failed、0 skipped；拆出独立文件后的空态回放 2 项再次通过。TypeScript、全仓 JS lint（含三项复杂度门禁）、依赖架构、重复代码、行数和 diff 检查均通过。未运行本地 Android 设备矩阵；远端失败尚不能声明全部修复。没有提交或推送。
