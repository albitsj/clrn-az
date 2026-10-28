# 合并请求 #29：恢复原比较并复用按钮基准

## 选择依据与范围

本次从 `1fa5b9f6734b6a95a1a316807bf0802bed46f3bc` 继续，保留原提交 `b0c8264b4ea124040b8bbbf863ea675246fc1b50` 对问题 #23 的多节点真实选线实现。获取远端后，`origin/master` 仍为 `a2de07fcaf6f4b39abcc0b50c7e940b43a407a2d`，已是当前提交的祖先，没有重复合并。

[合并请求 #24](https://github.com/albitsj/clrn-az/pull/24) 引入共用的 0.5% 规则；当前 master 及其后续[历史审查记录](BASELINE_REVIEW_69f9251d.md)曾据此恢复 83 张旧图。应用[圆形按钮修复 #7066](https://github.com/kevinanew/laiwan_react_native/pull/7066) 的 `center` → `contain` 变化已经被认可。旧按钮画面本身与当前画面相差约 3804—4376 像素，恢复真实选线后又叠加节点编号遮罩宽度造成的 924 像素差异，36 个状态超过完整截图的 4608 像素门槛。

上轮为保留旧图增加了 `snapshot-assertion.ts`，在内存中处理预期图，随后运行通过。本轮按用户明确修订撤回该模块、专用测试及两个截图入口的接入，`device.ts` 与 `game-transient.ts` 已与 `b0c8264` 逐字节一致。改为逐图复用历史已审查的当前构建按钮图。只更新对应上述 36 个状态的基准，其他历史候选不整体恢复，不增加比较器、遮罩、备选图片、重试或容差。

## 固定构建、环境与证据

应用提交为 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`，Release 为 `android-staging-300001001-69f9251d3b5f`。固定环境为 Android API 35、x86_64、720×1280、320 dpi、字体比例 1、英文系统，页面由真实设置选择三种应用语言。十二份下载报告的 `build-info.json` 均与部署记录相同，安装包 SHA-256 为 `27618d750fc306b1a75d52d642b2d90f361501fd1b9998bc3cd65ca5874196f5`。

候选从已审查提交 `21a1c519cddb03e8fa6fb16d08efbe100205dcfe` 的 Git 对象取出，逐字节核对[历史清单](BASELINE_REVIEW_69f9251d.md)中的完整摘要：两种中文的对应状态及英文其他场景源自[参考运行 40523304048](https://github.com/albitsj/clrn-az/actions/runs/40523304048)的通过用例；英文四街页面源自[参考运行 40551318429 的确切牌桌用例](https://github.com/albitsj/clrn-az/actions/runs/40551318429/job/122357471838)，该用例一次通过，其他分片未匹配用例造成的整轮失败不作为通过证据。本轮复用了这些原始 PNG，没有重新绘制、拼接或从未通过场景取图。

已读取[原失败运行 40649166168](https://github.com/albitsj/clrn-az/actions/runs/40649166168)和[后续运行 40710883615](https://github.com/albitsj/clrn-az/actions/runs/40710883615)的完整日志，并下载后者全部十一份德州视觉报告。后续运行所有检查通过，德州用例全部一次通过；英文游客品牌启动页曾因“必须真正拦截启动健康检查”失败一次，重试后通过，故不声称整轮所有用例都一次通过。没有接收任何错误弹窗、重连页或网络错误画面。

## 逐图审查

每一行均实际查看了旧基准、历史候选、运行 `40710883615` 中通过用例的完整未遮罩原生界面，以及候选与旧图的差异图。临时审阅面板为 `/tmp/clrn-29-revision/review/01.png` 至 `36.png`；这些只作调查材料，不进入提交。以下链接给出可追溯的仓库原图、候选原图和远端产物，附件相对路径用于在报告中找到原始界面与原失败差异。候选与旧图的差异可由两个原始文件及固定 Playwright `1.61.1` 比较器重算，颜色容差为 `threshold: 0.1`。

所有更新均为完整 `720×1280` 页面，不涉及独立动画分区或静态补集面积。表中的新旧差异仅作审查，不决定是否回退为旧图；本轮按用户指定的当前预期画面选择。各项原生业务断言、动画运动与轨迹检查均保留。

### 1. `en-signed-in-texas-controls-check`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-check.png)，摘要 `0be667d0ea29c56ddc4e4df7fadaa0d2bec489d03db627313651af1c56df1a19`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-check.png)；参考运行 `40523304048`，摘要 `73b9fb1490c64df9d4bb504f74f270b696fb754e8e68a651fa74ac43bdf2d4c9`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/caf3a3e834406d47cb710555d6b308e2099c8382.png`；对应普通截图附件为 `en-signed-in-texas-controls-check`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/b5ce7d0f46496c282dae62c62a7c0acd73d65377.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：五张公共牌、底池 180 和看牌操作一致；仅按钮圆环及加注箭头为预期缩放变化，接收。

### 2. `en-signed-in-texas-controls-shortcut-blinds`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-shortcut-blinds.png)，摘要 `5ff534722473a762bb831d9ec3f9ba539b129367912629fbc125f77c0969d948`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-shortcut-blinds.png)；参考运行 `40523304048`，摘要 `8342afe4ad27369aaf7c113113b29a382fdb6d03d9d5a8e49b0f943b3e8e443e`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/5e08a1ddf79e4b7b21070c6ffe1fe113972fd02e.png`；对应普通截图附件为 `en-signed-in-texas-controls-shortcut-blinds`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/2b4bbb122d6c8316331988d074021589d2a499e6.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：底池 3，快捷档位为 2、3、4、5 倍大盲；按钮标签与金额完整，接收预期圆环变化。

### 3. `en-signed-in-texas-controls-shortcut-disabled`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-shortcut-disabled.png)，摘要 `84b3261542b901806bc34150ac8fe36d5475084fcac70ed85a6715fb1be3d941`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-shortcut-disabled.png)；参考运行 `40523304048`，摘要 `c7e950ffd0e4c43e9449ae8e82398f73cdff266ad43e09d0eb186100ba365d9d`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/0d58824570e39c552b61a913e1382d4f5e570dcf.png`；对应普通截图附件为 `en-signed-in-texas-controls-shortcut-disabled`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/588e7624f5d36c1ef44eef055663b02865b30621.png`；该实际图的原比较器差异为 4728 像素。
- 审查结论：前三个快捷按钮为灰色禁用态，最低加注仍可见，跟注为 20；状态与布局一致，接收。

### 4. `en-signed-in-texas-game-flop`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-flop.png)，摘要 `3b8f4c6935589e681514948b44cc26d5962d4625e20dc265043b46aa345fb73d`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-flop.png)；参考运行 `40551318429`，摘要 `cae3fd6dbfb5e46ba5f7faa395613fac1fa8e3734218cb29ef3d4235669954c8`。
- 当前实际原图：[产物 12827106220](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827106220) 中 `playwright-report/data/1f531f1c97020e54a47593f5c9798f1cef229749.png`；对应普通截图附件为 `en-signed-in-texas-game-flop`。
- 原失败差异图：[产物 12800111128](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800111128) 中 `playwright-report/data/14356abe99123996ea1abf015c7c478eccb3a194.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：公共牌 A、K、7 明牌，其余两张牌背，底池 180；牌面及手牌完整，接收按钮边缘变化。

### 5. `en-signed-in-texas-game-preflop`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-preflop.png)，摘要 `a12b7afc2998c35cfe81373249db83087d541d76b50f27f846f4716c4660d7da`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-preflop.png)；参考运行 `40551318429`，摘要 `5014dd0dd37d6e2665c2fe00b7946dbdd547c84ecfe9e7b20b06b69d4a35d2cb`。
- 当前实际原图：[产物 12827106220](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827106220) 中 `playwright-report/data/1a7a6f2f2e4bf7171568fe24014d981967f32821.png`；对应普通截图附件为 `en-signed-in-texas-game-preflop`。
- 原失败差异图：[产物 12800111128](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800111128) 中 `playwright-report/data/55eda990212eb4e890bb892945cbc0d42fb05897.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：五个公共牌位均为牌背，本人双 A、底池 6；牌面、金额与操作完整，接收按钮边缘变化。

### 6. `en-signed-in-texas-game-river`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-river.png)，摘要 `54dad3776975e253cbec9394aae30425a9371edd314b3a1c08bd6b9d8d5d4e24`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-river.png)；参考运行 `40551318429`，摘要 `fcc1d03072703aece3dd93e05d39ba34f457c4016f1c3b8abecdfb1ac20b8df0`。
- 当前实际原图：[产物 12827106220](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827106220) 中 `playwright-report/data/837ba44094b5f9ac1d5c4a114f490952c39c5c42.png`；对应普通截图附件为 `en-signed-in-texas-game-river`。
- 原失败差异图：[产物 12800111128](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800111128) 中 `playwright-report/data/bbc7093c71260884de918454a82589e96429e2ba.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：五张公共牌 A、K、7、2、Q 均完整，底池 180；接收按钮边缘变化。

### 7. `en-signed-in-texas-game-turn`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-turn.png)，摘要 `5e3407f1855e149d9e24a781e1a4cb0bef531f88ec02bf9da942c6250ff34e76`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-game-turn.png)；参考运行 `40551318429`，摘要 `84f419c26b115781403c07e5863160bd5ec226c1ee000e0bee05afc4821a1cbe`。
- 当前实际原图：[产物 12827106220](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827106220) 中 `playwright-report/data/bbb198f6ef5ccb138b7940b61798248a2d1213bd.png`；对应普通截图附件为 `en-signed-in-texas-game-turn`。
- 原失败差异图：[产物 12800111128](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800111128) 中 `playwright-report/data/7b43c2e80f2f5504e22831f7b098e579247e4142.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：公共牌 A、K、7、2 明牌，末张牌背；底池 180，接收按钮边缘变化。

### 8. `en-signed-in-texas-hall-variants-delay-cooldown`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-hall-variants-delay-cooldown.png)，摘要 `3051c43ba9d23f80e85132f2a4a4dcf89db24227d3b23cab8d05e9151340a8b3`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-hall-variants-delay-cooldown.png)；参考运行 `40523304048`，摘要 `16272bfa550fdeef0ce58714ef91944748078dc836d3142acc3f803864db6c63`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/cee26d4ee40b9326e1276a3b7b7f70d29d175e92.png`；对应普通截图附件为 `en-signed-in-texas-hall-variants-delay-cooldown`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/f3f6c7a2e8a3029983082e3b774c01f00dc64d7d.png`；该实际图的原比较器差异为 5288 像素。
- 审查结论：大厅筹码、底池和加时冷却状态一致；既有计时遮罩未扩大，接收按钮边缘变化。

### 9. `en-signed-in-texas-table-states-full-table-multiple-pots`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-full-table-multiple-pots.png)，摘要 `b94d4fad63aa9364f91bd40a7c8b51518138fb2af25986de57050f7cd9931ebb`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-full-table-multiple-pots.png)；参考运行 `40523304048`，摘要 `00c513f1080e3310e52464c46ad9df253297910d16613f56d7c5278d0ba60260`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/e55c8f50e28dc9b648eaa891a031c690d9a0f678.png`；对应普通截图附件为 `en-signed-in-texas-table-states-full-table-multiple-pots`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/c3bfe5e1c6a300c0d35466ff2b7c1d68919c65f4.png`；该实际图的原比较器差异为 5152 像素。
- 审查结论：九个座位、底池 450 及九项边池完整，玩家与快捷金额一致，接收按钮边缘变化。

### 10. `en-signed-in-texas-table-states-full-table`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-full-table.png)，摘要 `aad4ffc4d795f81542cb87dc38922449d3698a0a9d68a97a0d3f233e2f131aef`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-full-table.png)；参考运行 `40523304048`，摘要 `e0d596dc877e2eb340a4c126bcf5d08087e0f31eb3c60e9b14e80f17b7bc8315`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/465efc8c4268e013e366f9f55d330648abe02675.png`；对应普通截图附件为 `en-signed-in-texas-table-states-full-table`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/c29053f320234589ada2edadc55305bd04ea9979.png`；该实际图的原比较器差异为 5152 像素。
- 审查结论：九个座位、底池 180 及 120、60 两项边池完整，接收按钮边缘变化。

### 11. `en-signed-in-texas-table-states-player-disconnected`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-player-disconnected.png)，摘要 `33c5372c4f91e2f7438cec96444656d97c3b3ea45267857573664a3492fce291`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-player-disconnected.png)；参考运行 `40523304048`，摘要 `460eb5fbbbb7f7cb65a9425316b6825aad0a7721c33bbfe37374fea1e36a0e6b`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/6b9f8634a3342db7c1050a173cab1f8561e736a9.png`；对应普通截图附件为 `en-signed-in-texas-table-states-player-disconnected`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/aded09c8fbc5465f326cdef8ab496f8fe9318cc7.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：离座图标仍位于 Player3，牌面与筹码不变，接收按钮边缘变化。

### 12. `en-signed-in-texas-table-states-reserved-seat`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-reserved-seat.png)，摘要 `f6a83ad6c89a7cfd682f578f73c313a8e1db64f9ce0d0eab89aacf0b1db94278`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-reserved-seat.png)；参考运行 `40523304048`，摘要 `f058a5ef971f42ebcf46ccafd75b9f5e1a82a36cd9b9405616e0d9d5ba3c9d36`。
- 当前实际原图：[产物 12827690946](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827690946) 中 `playwright-report/data/27e187307611d7f9c373d4d5fcc2a1cf0340d3dd.png`；对应普通截图附件为 `en-signed-in-texas-table-states-reserved-seat`。
- 原失败差异图：[产物 12799874776](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799874776) 中 `playwright-report/data/58535d3b0d6b008b0b42ca0427ea136aaba26b84.png`；该实际图的原比较器差异为 5243 像素。
- 审查结论：右上保座区域仍由既有倒计时遮罩处理，其他空位及本人操作完整，接收按钮边缘变化。

### 13. `zh-Hans-signed-in-texas-controls-check`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-check.png)，摘要 `a2acf01c7fd36f724968da017f3e69686af370d04608a224e0924ed7d2dda01b`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-check.png)；参考运行 `40523304048`，摘要 `02033b711fc4576b78c25fc8d9c5fccd85058c5cb0450d86a5c6327dbf1193e6`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/7fb6e8f89f56929d1f1ac3d38797078832a43746.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-controls-check`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/afe08238cdbaa6954f9a2dfdf4b1a3c0577bfed1.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：五张公共牌、底池 180 和看牌操作一致；仅按钮圆环及加注箭头为预期缩放变化，接收。

### 14. `zh-Hans-signed-in-texas-controls-shortcut-blinds`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-shortcut-blinds.png)，摘要 `5bdb19ed0a8954fcbe1ed713ca49a1109adc184a51b6affa763ede3626da2224`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-shortcut-blinds.png)；参考运行 `40523304048`，摘要 `6aaabedc3311f0c19dc09a09d70c82fb2c909fcaa6cdbd92edafd493c5e28e2d`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/1601ca2af6334417659ec1136f3afa81401a5351.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-controls-shortcut-blinds`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/cf51db0790351fc35b654ae8e45a4a04b20f492a.png`；该实际图的原比较器差异为 5295 像素。
- 审查结论：底池 3，快捷档位为 2、3、4、5 倍大盲；按钮标签与金额完整，接收预期圆环变化。

### 15. `zh-Hans-signed-in-texas-controls-shortcut-disabled`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-shortcut-disabled.png)，摘要 `754ce9dd8bb8d569bb265d718a5e0d63d75d4a727d449f1a6ccf1cedacf40770`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-shortcut-disabled.png)；参考运行 `40523304048`，摘要 `65b770d70332407a5fdde4d6ab5894cbce26ee8abfec7e18a60c191b745678e4`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/5315fe05d2ec6d7e4b51b07683dfa4f9139cdf60.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-controls-shortcut-disabled`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/feb5a32fae7d22f26a9d8d820a26823b31239b1b.png`；该实际图的原比较器差异为 4752 像素。
- 审查结论：前三个快捷按钮为灰色禁用态，最低加注仍可见，跟注为 20；状态与布局一致，接收。

### 16. `zh-Hans-signed-in-texas-game-flop`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-flop.png)，摘要 `f563b3c28f430fc3ed0d568396c5d4dc3b365ed89db4ffb17c1760038e87c69e`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-flop.png)；参考运行 `40523304048`，摘要 `5133509319c0035a805dcce867ec5a67a4590e9741b9b22070e498ebec527f8a`。
- 当前实际原图：[产物 12828100484](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828100484) 中 `playwright-report/data/7ee406a25d830974bac2af747b453411d9d8346d.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-game-flop`。
- 原失败差异图：[产物 12800671846](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800671846) 中 `playwright-report/data/886637a9f530ff5b0f9dbf02643843b2dccd2ad4.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：公共牌 A、K、7 明牌，其余两张牌背，底池 180；牌面及手牌完整，接收按钮边缘变化。

### 17. `zh-Hans-signed-in-texas-game-preflop`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-preflop.png)，摘要 `e67b485602b6dcd54c9fd660b42f835b3cc9b7514e94db38953633b755ed1bef`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-preflop.png)；参考运行 `40523304048`，摘要 `3a489f991f8d093267b729b189a0c6c8cc1db72c8c3b5f88501285641c850261`。
- 当前实际原图：[产物 12828100484](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828100484) 中 `playwright-report/data/ac7974d75d7e4876cc6076890adea892f5735c77.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-game-preflop`。
- 原失败差异图：[产物 12800671846](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800671846) 中 `playwright-report/data/b273357e043c21619984deedeebabb65d8467a29.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：五个公共牌位均为牌背，本人双 A、底池 6；牌面、金额与操作完整，接收按钮边缘变化。

### 18. `zh-Hans-signed-in-texas-game-river`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-river.png)，摘要 `9f7259834eeaf0cc6e112df02a0b6288f2ead589195d501aa6f48f34879475e0`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-river.png)；参考运行 `40523304048`，摘要 `fdeb893eff777d8a5a36c7ec6dbcf5037cb61869a2ed52d30aa1efd6cd717118`。
- 当前实际原图：[产物 12828100484](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828100484) 中 `playwright-report/data/58446b791d6f011e584fd7555de36fdc7a17404e.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-game-river`。
- 原失败差异图：[产物 12800671846](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800671846) 中 `playwright-report/data/7c54b7fb4944b51f19fb7b010b1e0d66a27751b2.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：五张公共牌 A、K、7、2、Q 均完整，底池 180；接收按钮边缘变化。

### 19. `zh-Hans-signed-in-texas-game-turn`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-turn.png)，摘要 `f3bb0fad1feeb6bb84b2def3d2f4104fa5a9861ed63559ddab16a8615eaa3ffa`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-turn.png)；参考运行 `40523304048`，摘要 `a6ed38f3476faeceeccad6a3fc1fdd0fa66520f3d323f6e4b3aa77cfe69e0103`。
- 当前实际原图：[产物 12828100484](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828100484) 中 `playwright-report/data/5fc2363b03ec9e6b1b4cd623bb5c3ee087b19c19.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-game-turn`。
- 原失败差异图：[产物 12800671846](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800671846) 中 `playwright-report/data/7ac7f74d99e18ff3841f0db348de58540ad1b6b6.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：公共牌 A、K、7、2 明牌，末张牌背；底池 180，接收按钮边缘变化。

### 20. `zh-Hans-signed-in-texas-hall-variants-delay-cooldown`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-hall-variants-delay-cooldown.png)，摘要 `58d56e0d41b53b036d3ffa58c37cbdbbfa54faf1de0a85612b2405656c48867c`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-hall-variants-delay-cooldown.png)；参考运行 `40523304048`，摘要 `e948022a7da11763ade1573e3c1297938269b54a8ed66feaa4ab3563e02c91ea`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/3eb602243e6975ad317cbac7315f532aada4e4a5.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-hall-variants-delay-cooldown`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/f917861b80c50f4281a81fe3f7585067df7e7821.png`；该实际图的原比较器差异为 5300 像素。
- 审查结论：大厅筹码、底池和加时冷却状态一致；既有计时遮罩未扩大，接收按钮边缘变化。

### 21. `zh-Hans-signed-in-texas-table-states-full-table-multiple-pots`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-full-table-multiple-pots.png)，摘要 `5b05e4f1225727b388bab84c2961f0f8e2e5eb791b6dbdecf0644bdf47fdc131`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-full-table-multiple-pots.png)；参考运行 `40523304048`，摘要 `b56b8a073a9422b0da7f6fd22fc05900039eabe97092765f392afcc95b0fafb1`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/700fe924d47a2203138b925b703ac7391888e10f.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-table-states-full-table-multiple-pots`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/7b1acb7b06972a03a24945f0dc18f3a96fb340a4.png`；该实际图的原比较器差异为 5194 像素。
- 审查结论：九个座位、底池 450 及九项边池完整，玩家与快捷金额一致，接收按钮边缘变化。

### 22. `zh-Hans-signed-in-texas-table-states-full-table`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-full-table.png)，摘要 `9da9e92feae1917c3d348795b5bb65446069edac0a4982f323d3f27e739a31dd`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-full-table.png)；参考运行 `40523304048`，摘要 `db7d0f05f8344635168c1cd9e5310ddc96c9bafd24f8c1828383d27c63f6d1a7`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/1debbcabd51f009c276ff44bccfe8a311f07e966.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-table-states-full-table`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/8138b91408cd712a4f54ea19a7dba8c325d2e2d9.png`；该实际图的原比较器差异为 5194 像素。
- 审查结论：九个座位、底池 180 及 120、60 两项边池完整，接收按钮边缘变化。

### 23. `zh-Hans-signed-in-texas-table-states-player-disconnected`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-player-disconnected.png)，摘要 `b0bafa9c2409a0bff1d9418163c302e89446d0fccd21d1df3c91ed715e088d56`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-player-disconnected.png)；参考运行 `40523304048`，摘要 `cc49b26daf09bfa90653b92f98403cb7348ece35a0ab9a14eb0e3d015cd1ba9b`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/bf106df2373ca8e312b4f40f19ed6caafff1a05b.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-table-states-player-disconnected`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/2358e941a6bafe41d8a893e110b68356f99f739f.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：离座图标仍位于 Player3，牌面与筹码不变，接收按钮边缘变化。

### 24. `zh-Hans-signed-in-texas-table-states-reserved-seat`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-reserved-seat.png)，摘要 `40c5f6ca902ba573f2f2b5456e46c5afb7c2f6a26fd58009fad8867390f63b1d`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-reserved-seat.png)；参考运行 `40523304048`，摘要 `cdb1bc093fc3aae65e5a383eafe897f4b189432ff2e9acc6cc805e492b34789a`。
- 当前实际原图：[产物 12828017491](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828017491) 中 `playwright-report/data/ec0353938dfa8bbd1e463b971f6a3dd65c11d414.png`；对应普通截图附件为 `zh-Hans-signed-in-texas-table-states-reserved-seat`。
- 原失败差异图：[产物 12800426191](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12800426191) 中 `playwright-report/data/691597ccb1c14352bdfe4b2fccb4f7c2230731dc.png`；该实际图的原比较器差异为 5285 像素。
- 审查结论：右上保座区域仍由既有倒计时遮罩处理，其他空位及本人操作完整，接收按钮边缘变化。

### 25. `zh-Hant-signed-in-texas-controls-check`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-check.png)，摘要 `2f7205a8d7609bb71e23e6a95f896b8b16a2fc7dffcc1e9e46cec0353e37ee3b`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-check.png)；参考运行 `40523304048`，摘要 `50de46862453f9b46d256e9072b348cbc755d029ab7f829fff8112f1f24b445f`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/790ade75a61ec1cc929c366dfd59592e459929ed.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-controls-check`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/5d5e6613fa7610912bff766d6ddf483ac7e4bc19.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：五张公共牌、底池 180 和看牌操作一致；仅按钮圆环及加注箭头为预期缩放变化，接收。

### 26. `zh-Hant-signed-in-texas-controls-shortcut-blinds`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-shortcut-blinds.png)，摘要 `930e7f8ec496e5814d9bb776699959476552b86044e862bfdb02b4e5071bd878`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-shortcut-blinds.png)；参考运行 `40523304048`，摘要 `29131a14b247930291c8ffccea17c2230d9c1dcaa768504a2ac213f5d5f0470c`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/0890dfcc6d1570b614e77c59bf8efa3c8534caff.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-controls-shortcut-blinds`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/c460caf073682f1e5ce6ab9b0af338576e3fbe6e.png`；该实际图的原比较器差异为 5289 像素。
- 审查结论：底池 3，快捷档位为 2、3、4、5 倍大盲；按钮标签与金额完整，接收预期圆环变化。

### 27. `zh-Hant-signed-in-texas-controls-shortcut-disabled`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-shortcut-disabled.png)，摘要 `507aa648baa50e93d4e95f13986d036fbedd0526335a1cc86ca8c9f7bb7662f7`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-shortcut-disabled.png)；参考运行 `40523304048`，摘要 `d56d36bafaf5627b47cf6602b6cdb9190e0f42a214356116805a87374ae2e17f`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/681e57d46b3056cccf8d2513cce1040445a9aeab.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-controls-shortcut-disabled`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/78a55bfe4060873d6a3f93562689488bc6fe494c.png`；该实际图的原比较器差异为 4735 像素。
- 审查结论：前三个快捷按钮为灰色禁用态，最低加注仍可见，跟注为 20；状态与布局一致，接收。

### 28. `zh-Hant-signed-in-texas-game-flop`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-flop.png)，摘要 `60090d50480e70d486516a61315b282afbca218da59aa71cc87375db5c511bd8`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-flop.png)；参考运行 `40523304048`，摘要 `e355d136e738a79f259fd09c914962aa8c41c28b90f347e476dace5e7e4a5d35`。
- 当前实际原图：[产物 12827756566](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827756566) 中 `playwright-report/data/17cde4d72de720c03a8876381eaf85682677f8a1.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-game-flop`。
- 原失败差异图：[产物 12799353600](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799353600) 中 `playwright-report/data/7196abb6d39182ff14b6d965e3efe221417a75a1.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：公共牌 A、K、7 明牌，其余两张牌背，底池 180；牌面及手牌完整，接收按钮边缘变化。

### 29. `zh-Hant-signed-in-texas-game-preflop`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-preflop.png)，摘要 `6d5df887b72e00b4db87d02eda1fcdc4074594cbd7e6922d695ef2e8aafec825`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-preflop.png)；参考运行 `40523304048`，摘要 `951774cf5a99fad56fdda0838cac3ebdeb43ed72c87b5ebf0891ffc6476a2326`。
- 当前实际原图：[产物 12827756566](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827756566) 中 `playwright-report/data/4cdaf97172f8c4eb6db0a07b9a1a61099ab7d9d8.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-game-preflop`。
- 原失败差异图：[产物 12799353600](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799353600) 中 `playwright-report/data/d31241bcbe2c59202da0c4f0ea3bf3c408f34711.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：五个公共牌位均为牌背，本人双 A、底池 6；牌面、金额与操作完整，接收按钮边缘变化。

### 30. `zh-Hant-signed-in-texas-game-river`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-river.png)，摘要 `beab12855395cdb87aef47b591b0293d0d22e4c94e5a587db89cd46966702a5c`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-river.png)；参考运行 `40523304048`，摘要 `1d704ecc1e5f7b704785fd36525e34a3c52b69e80942fb2466443d9399197380`。
- 当前实际原图：[产物 12827756566](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827756566) 中 `playwright-report/data/4d81a5db9f77232e59d994892bcdcb13463c7ac6.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-game-river`。
- 原失败差异图：[产物 12799353600](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799353600) 中 `playwright-report/data/ea098a1fbc3af70a306c8a0ff034f5109bb6249e.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：五张公共牌 A、K、7、2、Q 均完整，底池 180；接收按钮边缘变化。

### 31. `zh-Hant-signed-in-texas-game-turn`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-turn.png)，摘要 `3e0165ead81f340eacf5e63727f7ec4d2854bd33fe16a8e3eb42328e91a85cba`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-turn.png)；参考运行 `40523304048`，摘要 `8acb29704c3a2d8857b18534bd64172c8b04dbdb2b21662e2e1f6ac1153177e3`。
- 当前实际原图：[产物 12827756566](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12827756566) 中 `playwright-report/data/ed0eeaf3eb87784978699f3706a9e8ad4e83dd71.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-game-turn`。
- 原失败差异图：[产物 12799353600](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799353600) 中 `playwright-report/data/2087458e02b52fc9099fb7701d0137fbbe97171d.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：公共牌 A、K、7、2 明牌，末张牌背；底池 180，接收按钮边缘变化。

### 32. `zh-Hant-signed-in-texas-hall-variants-delay-cooldown`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-hall-variants-delay-cooldown.png)，摘要 `e6c1210f37d7ac82ee2ea7d563c91ac85b6e2d234da4e1755c36398c9bb62a7d`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-hall-variants-delay-cooldown.png)；参考运行 `40523304048`，摘要 `7350178448c77e4ecc8eef3224640400e2593f89fc694c3ab608f82d293fdf4d`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/f239132cf212a0755caee906aae17ffaf2c7aee6.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-hall-variants-delay-cooldown`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/40499b9c3e309b7bbb6232896d22cfef695ddfcd.png`；该实际图的原比较器差异为 5300 像素。
- 审查结论：大厅筹码、底池和加时冷却状态一致；既有计时遮罩未扩大，接收按钮边缘变化。

### 33. `zh-Hant-signed-in-texas-table-states-full-table-multiple-pots`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-full-table-multiple-pots.png)，摘要 `f671f93b945c583d5865bca577f02b385b7de7feafe78a6d31dbba9e18eab9d3`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-full-table-multiple-pots.png)；参考运行 `40523304048`，摘要 `c57ccb11c7b28b68ed615d382e1f3ec0d3820781e911c45970494b79dbc23eb6`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/13d68c88a0c89d59c8a56064785dc528a1dcd444.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-table-states-full-table-multiple-pots`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/3f53c0f4f0eb1101c6096eb943ce6fc3a56952a4.png`；该实际图的原比较器差异为 5191 像素。
- 审查结论：九个座位、底池 450 及九项边池完整，玩家与快捷金额一致，接收按钮边缘变化。

### 34. `zh-Hant-signed-in-texas-table-states-full-table`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-full-table.png)，摘要 `dfacc046057736ec33e3e2745e589a8439b5b8098cfdcd11831ca19d68c19187`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-full-table.png)；参考运行 `40523304048`，摘要 `43472d28361877675f7e5485a272bef6680b79e521661f79e3e498954b08b403`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/2803c87b3c58608f044682365e7541eb13ab41a8.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-table-states-full-table`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/1f3f5417a06a21926ed7584d3b01cd10ee0f8238.png`；该实际图的原比较器差异为 5191 像素。
- 审查结论：九个座位、底池 180 及 120、60 两项边池完整，接收按钮边缘变化。

### 35. `zh-Hant-signed-in-texas-table-states-player-disconnected`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-player-disconnected.png)，摘要 `31175ebf4651085eb0a7b1f694e523ca13dfbcc93acaa8aaa0bc626cf973e4ef`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-player-disconnected.png)；参考运行 `40523304048`，摘要 `4a38798e964a3e7d80ecafe09f33a8b358c6f34f3536c8bc0768ac39646b099e`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/7ed78aeab54f22317b15527fa117ef7a99833c0c.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-table-states-player-disconnected`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/a56f41319bb950b0caa19ad93f8e8ed4efb825a1.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：离座图标仍位于 Player3，牌面与筹码不变，接收按钮边缘变化。

### 36. `zh-Hant-signed-in-texas-table-states-reserved-seat`

- 原图：[本轮修改前基准](https://github.com/albitsj/clrn-az/blob/1fa5b9f6734b6a95a1a316807bf0802bed46f3bc/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-reserved-seat.png)，摘要 `92c1da43e9295ad30596a26984790aabac3867d0265b254b6344b965109191ec`。
- 候选：[已审查原始文件](https://github.com/albitsj/clrn-az/blob/21a1c519cddb03e8fa6fb16d08efbe100205dcfe/android/snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-reserved-seat.png)；参考运行 `40523304048`，摘要 `dbedeb442f371fe291095104e4690886afac8e49e607de3e2295e200c7ab3445`。
- 当前实际原图：[产物 12828176283](https://github.com/albitsj/clrn-az/actions/runs/40710883615/artifacts/12828176283) 中 `playwright-report/data/ae068ed1a80377225bcdfa1f599223aea0383c55.png`；对应普通截图附件为 `zh-Hant-signed-in-texas-table-states-reserved-seat`。
- 原失败差异图：[产物 12799369583](https://github.com/albitsj/clrn-az/actions/runs/40649166168/artifacts/12799369583) 中 `playwright-report/data/11509199b657bc7e2380fa0f813c894cd8ec3799.png`；该实际图的原比较器差异为 5282 像素。
- 审查结论：右上保座区域仍由既有倒计时遮罩处理，其他空位及本人操作完整，接收按钮边缘变化。

## 原比较器交叉验证与剩余验证

使用仓库原有 `toMatchSnapshot` 所调用的固定 Playwright 图片比较器，按 `threshold: 0.1`、`maxDiffPixelRatio: 0.005` 对原始图片字节直接比较，没有动态改写任何预期像素。后续运行的全部 284 张德州普通截图与独立历史比较运行 `40541846623` 的 36 张普通截图，以及原失败运行的 104 张实际图均纳入复算；动画采样附件没有冒充普通页面计数。320 张普通截图及 104 张原失败实际图均符合原规则；其中本次更新的 36 个状态涉及 44 张独立通过样本，单节点与双节点样本的最大差异为 924 像素，未接近 4608 像素上限。

独立历史运行中五个英文其他场景均一次通过，控件树显示单节点 `64`，边界为 `x=663,y=1240,width=28,height=34`。本轮后续运行同时存在单节点 `64` 和 `64,67`、`64,68`、`67,64`、`67,68`、`68,64`、`68,67` 等双节点真实样本，双节点区域宽 61 像素。历史运行与后续运行之间不复用被改写后的预期图：都直接读取本次基准，因此这不是只验证某一种节点组合。更新的按钮图消除了接近门槛的旧按钮差异，给原有编号变化留下实际余量。

旧运行英文牌桌第三次尝试的起手牌动画幅度为零、起止附件相同，最后屏幕缺少手牌；前两次已完成动画流程，仅有静态截图差异。后续运行英文牌桌一次通过，但尚未证明旧异常的根因。本轮不调整动画实现、重试、断言或基准，也没有认定为应用缺陷；如后续再现，应继续对照真实回放与连接证据调查，不能以静态基准更新解释该异常。

本地完整仓库检查通过，包含静态检查、类型检查、用例收集及 119 项单元测试；删除的三项测试仅属于被撤回的额外比较器，原有动画、业务和比较器边界测试均保留。

本地检查与复算仅验证当前改动的代码及已有样本；仍需由宿主提交并上传后，等待新提交的完整远端自动测试。没有自行提交、上传、启动工作流或合并合并请求，也没有改动其他仓库及治理问题。
