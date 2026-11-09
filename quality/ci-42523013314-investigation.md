# CI 42523013314 修复依据

- 诊断指纹：`13fcb8d298673d7a3c58696bcc0cb795ddb2fbfd8f778521bcfaa6c6709b155a`。
- run / attempt：`42523013314 / 1`；PR HEAD 与修改前本地 HEAD 均为 `b710e323a97fe9d493852292dfd86796a3358189`。
- job 检出的 PR 合并提交为 `c7bac5e0e14cf68b5ef1111fa1e44e5c9b566f61`，日志明确列出其合并上述 HEAD 与 `9bfc8fe`。
- 附件 `android-{diagnostics,staging-visual}-account-en-all-42523013314-1` 在核对身份后下载到含 run、attempt、HEAD 的全新临时目录；两次下载解压均成功，未读取旧目录。

## 实际测试失败与根因

job `128871335194`：`en / account / signed_in_reset_password` 首次比较差异为 **4742 像素**，重试通过，最终为 1 flaky、14 passed、14 skipped。`failOnFlakyTests` 正常使 job 失败，重试通过不构成无需修复的依据。

首败 actual PNG 显示旧、新密码英文提示均折为两行；expected 为单行。expected 的 SHA-256 与本地正式基准相同：`e63ced0ff77ffc972d9493966dd2cb8322fc7764940fccbdbbe0e41d652b319d`；actual 为 `e7b709861572686f19cf2f8a9b0d0e8985fb5b40bff5dee7f6a852f2f10adb6d`。因此不是错误基准来源或报告混用。

本轮 build-info 确认应用 `5d11c3e118f47538497cae30cca1799bd69d7977`、Release `android-staging-300001901-5d11c3e118f4`、APK SHA-256 `b7d59732b1bc9f3021399f84082abbd042768a0c1ebabb31b30bd3adc8acd19b`。只读检查该应用提交的 `ResetPasswordTextInputStyle.js`：标题、输入框固定 flex 2:3，输入框另设 width=100%；字段虽已设 multiline=false、numberOfLines=1，仍会出现原生提示折行。应用已有修复 `92bed562a` 按标题自然宽度和 8dp 间隔分配剩余输入宽度，移除 width=100%，保留字号、文案和密码行为。

修改前已只读检查现有分支及相关提交。历史调查 `74f8aa2:quality/password-placeholder-investigation.json` 记录相同 4742 像素差异：失败、通过画面分别在约 2.7 秒内保持稳定，屏幕尺寸、density、font_scale 与输入边界相同；完整前置场景曾三次失败。`3f6a36c:quality/ci-42568906820-investigation.md` 还记录同账号冷启动对照 `42568471301` 的 retry 1 仍失败，完整前置对照 `42568473860` 首次通过。这些反例否定“等待更久或独立 worker 必然修复”的推断。未复用已被 `cee7723` 撤回的冷启动隔离，也未仅凭一次对照通过认定因果。

## 复用的最小修改

1. 原样复用 `84f0c71` 的 `deployments/staging.json`，选择已包含上述应用布局修复的已发布构建 `100002101 / beea05ce1f1fa92c9bd3ad7ae5cc97000bce0a8f`。
2. 原样复用 `3f6a36c` 的三个密码页 PNG。应用使用三语共享样式，因此三个语言的对应基准一起同步；没有接受本轮折行失败画面为新基准。

Release API 已确认发布状态、schema 标记及 APK 摘要 `4c00f64258d905df2d1c0f3df1b4cba1e787ed7684dd140d7a0fd37000f44610`。历史参考采集 `42577473320 / attempt 1 / HEAD a2c3bc9837dff05c464f0e33b641d9beedc9e77b` 的身份和三个 job 日志已重新核对：每种语言均 1 passed。它是 reference 模式的局部采集，不能代替正式 compare 完整矩阵。

逐图审查复用的三语 PNG，标签、提示、按钮均完整；英文旧、新密码输入框分别为 402/387px，原为 367px。复用字节摘要与既有审查记录一致：

| 语言 | 来源 job | PNG SHA-256 |
| --- | --- | --- |
| en | 129028802916 | `4e811a10dbb66a3af34d9b091ebd5a99049cdb710652834f0f6d73f2112b5bb0` |
| zh-Hans | 129028802909 | `158099a19ec717dba5b7665ed007bdf688f096104f9a8e5417e540987f0166a2` |
| zh-Hant | 129028802913 | `f5be4478b008b4e1454839812748bc9355f7a0502568067aa24d047cbd2137e5` |

此处消费既有发布包，没有重写应用或测试修复。该包相对旧包还包含此前已有的 HTTP 错误提示及构建安装改动，因此整个新包仍须原完整矩阵验收，不能由密码页局部通过推断其他业务全部通过。

## 其余失败逐项核对

完整回归 job `128890142032` 的依赖为 remaining=failure，其他准备依赖成功、空 priority 被跳过；其错误是“当前提交的 Android 完整回归未通过”。这是实际分片失败的正确传播，无需修改。

以下 35 个 job 已逐项读取日志，均只运行 `test "$COMPLETE_RESULT" = success`，环境值均为 failure，没有独立的测试错误。均证实门禁自身无需修改，继续保留。

| 分组 | job ID（对应语言／分片） |
| --- | --- |
| texas | 128890223606（zh-Hans/table）、128890223534（zh-Hans/other）、128890223790（zh-Hant/table）、128890223541（zh-Hant/other） |
| texas/en | 128890223567（pregame-first）、128890223550（pregame-middle）、128890223609（pregame-second）、128890223593（game-table）、128890223594（game-effects）、128890223537（panels）、128890223766（other） |
| zhajinhua | 128890223559（zh-Hans）、128890223592（zh-Hant）、128890223787（en/pregame-first）、128890223544（en/pregame-second）、128890223780（en/game-table）、128890223723（en/game-effects） |
| guest | 128890223786（zh-Hans）、128890223782（zh-Hant）、128890223670（en） |
| account | 128890223826（zh-Hans）、128890223764（zh-Hant）、128890224345（en） |
| social | 128890223769（zh-Hans）、128890223669（zh-Hant）、128890223696（en） |
| rooms | 128890223757（zh-Hans）、128890223699（zh-Hant）、128890223719（en） |
| wallet-help | 128890223691（zh-Hans）、128890223703（zh-Hant）、128890223652（en） |
| records | 128890223823（zh-Hans）、128890223731（zh-Hant）、128890223730（en） |

CLI 逐项读取遇到 API 限流后，使用 GitHub 连接器补齐全部 35 份日志，未以取证失败作为无需修改依据。

## 验证与待验收

- 本地仅执行发布引用相关的三个既有测试文件：`node --test scripts/staging-deployment.test.mjs android/release.test.mjs android/release-download.test.mjs`，21 项全部通过，无跳过。
- 四个复用文件与来源提交逐字节一致；`git diff --check` 通过。
- 未本地重跑 Android 用例，未修改测试执行方式、采样、断言、重试或门禁。修复后的正式 compare 全量结果仍交由 CI 验证，当前不宣称远端失败已全部转绿。
