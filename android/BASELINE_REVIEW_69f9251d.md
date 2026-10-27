# 德州操作按钮原生基准审查

应用提交：[69f9251d3b5f2b93aa2d880d27abbeefe16ee645](https://github.com/kevinanew/laiwan_react_native/commit/69f9251d3b5f2b93aa2d880d27abbeefe16ee645)。发布版本：`android-staging-300001001-69f9251d3b5f`。

候选来自仓库提交 `b30f30adc7722b90e16084f95ff4c41b6fd48e0e` 的[参考图任务 40523304048](https://github.com/albitsj/clrn-az/actions/runs/40523304048)，使用固定 Android API 35、x86_64、720×1280 模拟器。构建信息中的完整应用提交与部署记录一致。

新版应用把德州快捷加注及操作按钮图片的 `resizeMode` 从 `center` 改为 `contain`，完整缩放图片后，圆形外缘与箭头图案出现预期像素变化。下表每张候选均逐图核对了原基准、候选原图及差异图，确认变化仅在这些按钮图片上；牌面、金额、文字、玩家、弹窗和布局符合对应状态。

已分两轮接收 77 张图片，包含 75 张完整页面和两张弹窗入场起点裁图；首轮为 59 张，本轮补充英文其他场景的 18 张。完整页面取自参考图报告中用于写入候选基准的同一稳定原生截图，或对应参考图压缩包；本轮 18 张直接取自英文其他场景参考图压缩包。图片均为原始采集结果，没有拼接或重绘。比较继续使用 `threshold: 0.1`、`maxDiffPixels: 0`。

## 已通过的来源分组

| 来源分组 | 数量 | 任务 |
| --- | ---: | --- |
| 简体中文德州牌桌 | 7 | [已通过](https://github.com/albitsj/clrn-az/actions/runs/40523304048/job/122257086646) |
| 简体中文德州其他场景 | 20 | [已通过](https://github.com/albitsj/clrn-az/actions/runs/40523304048/job/122257086654) |
| 繁体中文德州牌桌 | 7 | [已通过](https://github.com/albitsj/clrn-az/actions/runs/40523304048/job/122257086909) |
| 繁体中文德州其他场景 | 20 | [已通过](https://github.com/albitsj/clrn-az/actions/runs/40523304048/job/122257087353) |
| 英文德州面板 | 5 | [已通过](https://github.com/albitsj/clrn-az/actions/runs/40523304048/job/122257087150) |
| 英文德州其他场景 | 18 | [五个用例全部通过](https://github.com/albitsj/clrn-az/actions/runs/40523304048/job/122257087319) |

简体中文德州大厅变体在参考图任务的第二次尝试中完整通过，采用该次通过结果的三张候选。

## 逐图接收清单

路径相对于本目录，摘要为接收后 PNG 的 SHA-256。

| 图片 | 摘要 |
| --- | --- |
| [en-signed-in-texas-controls-accurate-raise-minimum-error.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-accurate-raise-minimum-error.png) | `5aeeb86d98ecfda9a282c021fe3cf51ec42509bd707816f59560809cef243515` |
| [en-signed-in-texas-controls-accurate-raise-value.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-accurate-raise-value.png) | `c5a45bd39cd5796f8d386d71d8d57098df3c00d5aeca4dd3eaa66549e108393b` |
| [en-signed-in-texas-controls-check.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-check.png) | `73b9fb1490c64df9d4bb504f74f270b696fb754e8e68a651fa74ac43bdf2d4c9` |
| [en-signed-in-texas-controls-raise-dragging.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-raise-dragging.png) | `9d8765d36f387dfa4d2859637686b639fb02b6585b98e508f9635640d4b06460` |
| [en-signed-in-texas-controls-raise-maximum.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-raise-maximum.png) | `249a5e63bb4e6b6f387e83b5f07f7e148de62db3ae90b445b81229cdc22e8f1d` |
| [en-signed-in-texas-controls-shortcut-blinds.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-shortcut-blinds.png) | `8342afe4ad27369aaf7c113113b29a382fdb6d03d9d5a8e49b0f943b3e8e443e` |
| [en-signed-in-texas-controls-shortcut-disabled.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-controls-shortcut-disabled.png) | `c7e950ffd0e4c43e9449ae8e82398f73cdff266ad43e09d0eb186100ba365d9d` |
| [en-signed-in-texas-hall-variants-auto-rebuy-enabled.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-hall-variants-auto-rebuy-enabled.png) | `4f59d9c4ca82c5795319a57fe133f477b3f81e81ed3dbc212f279442d78c4e6e` |
| [en-signed-in-texas-hall-variants-delay-cooldown-alert.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-hall-variants-delay-cooldown-alert.png) | `cd098b9fdd0d1479db094f7a67a814a5c8dbf7381fde62551a2760885b76a6d3` |
| [en-signed-in-texas-hall-variants-delay-cooldown.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-hall-variants-delay-cooldown.png) | `16272bfa550fdeef0ce58714ef91944748078dc836d3142acc3f803864db6c63` |
| [en-signed-in-texas-panel-variants-chat-audio-history.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-panel-variants-chat-audio-history.png) | `fecfc2465d3d3f7d51748216f0c5c7376d9b82a247849f2367234335c68da86b` |
| [en-signed-in-texas-panel-variants-chat-barrage-off.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-panel-variants-chat-barrage-off.png) | `bea9a02488e901d3c14504fb7fdc4bef198411a8faef9bdb770ebbddd578a9c9` |
| [en-signed-in-texas-panels-quit-confirm.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-panels-quit-confirm.png) | `70fa10943c7fbac4330cb2ca76b631d6f68631af98c9855adb83f9147716fce2` |
| [en-signed-in-texas-records-v2-actions.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-records-v2-actions.png) | `8e3b7310a2a745a85bceb192d52cb8187965c53009ba7b606c63280f35691925` |
| [en-signed-in-texas-records-v2-empty.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-records-v2-empty.png) | `18864acbe82f73f5b1920f5b423f8cf311a91319da9c76ef2953f3d3e81d88d3` |
| [en-signed-in-texas-records-v2-settlement.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-records-v2-settlement.png) | `9ef2db9b8e5c2c28037a26a6d8b7a0909729b3310f147ef9c099897d582262ac` |
| [en-signed-in-texas-table-states-full-table-multiple-pots.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-full-table-multiple-pots.png) | `00c513f1080e3310e52464c46ad9df253297910d16613f56d7c5278d0ba60260` |
| [en-signed-in-texas-table-states-full-table.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-full-table.png) | `e0d596dc877e2eb340a4c126bcf5d08087e0f31eb3c60e9b14e80f17b7bc8315` |
| [en-signed-in-texas-table-states-guest-menu.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-guest-menu.png) | `aba25890fb6e95d9f3b0c3efa5d00f2d161a3b132a9cd20d8810c4643cc22022` |
| [en-signed-in-texas-table-states-player-disconnected.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-player-disconnected.png) | `460eb5fbbbb7f7cb65a9425316b6825aad0a7721c33bbfe37374fea1e36a0e6b` |
| [en-signed-in-texas-table-states-reserved-seat.png](snapshots/android-35-x86_64-720x1280-en/en-signed-in-texas-table-states-reserved-seat.png) | `f058a5ef971f42ebcf46ccafd75b9f5e1a82a36cd9b9405616e0d9d5ba3c9d36` |
| [texas-alert-auth-enter-start.png](snapshots/android-35-x86_64-720x1280-en/texas-alert-auth-enter-start.png) | `efa83b2c8cdabbe920c49465b9509298d1218a9c9e61b5b51407253cb3102c76` |
| [texas-alert-retry-enter-start.png](snapshots/android-35-x86_64-720x1280-en/texas-alert-retry-enter-start.png) | `efa83b2c8cdabbe920c49465b9509298d1218a9c9e61b5b51407253cb3102c76` |
| [zh-Hans-signed-in-texas-controls-accurate-raise-minimum-error.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-accurate-raise-minimum-error.png) | `4c3a7b0dc558bed4ac77beb3fb08a68255bf75c73e603dd9298ea0711a3499ef` |
| [zh-Hans-signed-in-texas-controls-accurate-raise-value.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-accurate-raise-value.png) | `7d46b4d24d6d77e18360bedab8893e1a679102942430b4b73e7ec127feb9467b` |
| [zh-Hans-signed-in-texas-controls-check.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-check.png) | `02033b711fc4576b78c25fc8d9c5fccd85058c5cb0450d86a5c6327dbf1193e6` |
| [zh-Hans-signed-in-texas-controls-raise-dragging.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-raise-dragging.png) | `e2674c729c17b3f28bdd5e7bd0e6e03f9501bbe50d177eca0056f42aff045a6a` |
| [zh-Hans-signed-in-texas-controls-raise-maximum.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-raise-maximum.png) | `f881f0ab0de9b6c9de84f5f8fa240f46827502008f411b996008b1e7d866ff78` |
| [zh-Hans-signed-in-texas-controls-shortcut-blinds.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-shortcut-blinds.png) | `6aaabedc3311f0c19dc09a09d70c82fb2c909fcaa6cdbd92edafd493c5e28e2d` |
| [zh-Hans-signed-in-texas-controls-shortcut-disabled.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-controls-shortcut-disabled.png) | `65b770d70332407a5fdde4d6ab5894cbce26ee8abfec7e18a60c191b745678e4` |
| [zh-Hans-signed-in-texas-game-accurate-raise.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-accurate-raise.png) | `371423d9dda2300b8d6a27228d8693c21dae1abfeb8bfc0a150f58a4ebdb00ae` |
| [zh-Hans-signed-in-texas-game-flop.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-flop.png) | `5133509319c0035a805dcce867ec5a67a4590e9741b9b22070e498ebec527f8a` |
| [zh-Hans-signed-in-texas-game-preflop.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-preflop.png) | `3a489f991f8d093267b729b189a0c6c8cc1db72c8c3b5f88501285641c850261` |
| [zh-Hans-signed-in-texas-game-raise.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-raise.png) | `46ab36dfdea90d3003b983e697c4f2866817b822cf3a964d705b6c8972418db1` |
| [zh-Hans-signed-in-texas-game-river.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-river.png) | `fdeb893eff777d8a5a36c7ec6dbcf5037cb61869a2ed52d30aa1efd6cd717118` |
| [zh-Hans-signed-in-texas-game-turn.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-game-turn.png) | `a6ed38f3476faeceeccad6a3fc1fdd0fa66520f3d323f6e4b3aa77cfe69e0103` |
| [zh-Hans-signed-in-texas-hall-variants-auto-rebuy-enabled.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-hall-variants-auto-rebuy-enabled.png) | `1da5073491d8c88e75328cb497817e3685c91129d6b9c30ee8cfd974f1881e8a` |
| [zh-Hans-signed-in-texas-hall-variants-delay-cooldown-alert.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-hall-variants-delay-cooldown-alert.png) | `54c7e1203222289b81e0aa686e9c67f1f7348eb9b21c37b7ffa7167b6f1b677c` |
| [zh-Hans-signed-in-texas-hall-variants-delay-cooldown.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-hall-variants-delay-cooldown.png) | `e948022a7da11763ade1573e3c1297938269b54a8ed66feaa4ab3563e02c91ea` |
| [zh-Hans-signed-in-texas-panel-variants-chat-audio-history.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-panel-variants-chat-audio-history.png) | `0a46498e478b9219e920faf58a0a9de62664149f290c5b9a4ef6f02732380291` |
| [zh-Hans-signed-in-texas-panel-variants-chat-barrage-off.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-panel-variants-chat-barrage-off.png) | `e410fa01bb92cdda2fbe7cca93d4ad6fef48e78ab152cb1421e9f830c0fa481c` |
| [zh-Hans-signed-in-texas-panels-quit-confirm.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-panels-quit-confirm.png) | `5baeb53ab81b3b822595a9d88603f15caeccaae97ea2a9eb0d0542675f62c8a5` |
| [zh-Hans-signed-in-texas-records-v2-actions.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-records-v2-actions.png) | `0e80cde7dd43767e9cff396974a9e6b0a1e371c179fcd04bd0a6a109497bdbbe` |
| [zh-Hans-signed-in-texas-records-v2-empty.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-records-v2-empty.png) | `d9cce7c4fa9d65830c6d69930fa1d203c429e22daf318c145c35908572b9542e` |
| [zh-Hans-signed-in-texas-records-v2-settlement.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-records-v2-settlement.png) | `4337c03fd5df1e91264bc04c36cb2b92bf4caab9279fdc87907fd9bffee5c2a1` |
| [zh-Hans-signed-in-texas-table-states-full-table-multiple-pots.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-full-table-multiple-pots.png) | `b56b8a073a9422b0da7f6fd22fc05900039eabe97092765f392afcc95b0fafb1` |
| [zh-Hans-signed-in-texas-table-states-full-table.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-full-table.png) | `db7d0f05f8344635168c1cd9e5310ddc96c9bafd24f8c1828383d27c63f6d1a7` |
| [zh-Hans-signed-in-texas-table-states-guest-menu.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-guest-menu.png) | `5cc8a615fbc69ffe109aa4374abc3e766c6cae4d00dacb0dfa57124f6b5c9096` |
| [zh-Hans-signed-in-texas-table-states-player-disconnected.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-player-disconnected.png) | `cc49b26daf09bfa90653b92f98403cb7348ece35a0ab9a14eb0e3d015cd1ba9b` |
| [zh-Hans-signed-in-texas-table-states-reserved-seat.png](snapshots/android-35-x86_64-720x1280-zh-Hans/zh-Hans-signed-in-texas-table-states-reserved-seat.png) | `cdb1bc093fc3aae65e5a383eafe897f4b189432ff2e9acc6cc805e492b34789a` |
| [zh-Hant-signed-in-texas-controls-accurate-raise-minimum-error.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-accurate-raise-minimum-error.png) | `3749fe71e6a228902b3d51e5c7ea621ff774d817ef70e45febd4b3b6a575c05d` |
| [zh-Hant-signed-in-texas-controls-accurate-raise-value.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-accurate-raise-value.png) | `7a995794531272360fef1ccea8d0e93627d6e4a076beec81f316e8fb4f5d9a07` |
| [zh-Hant-signed-in-texas-controls-check.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-check.png) | `50de46862453f9b46d256e9072b348cbc755d029ab7f829fff8112f1f24b445f` |
| [zh-Hant-signed-in-texas-controls-raise-dragging.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-raise-dragging.png) | `4828b8e9adbd9a7f9736f43bf6428539f9053df7ab810196ee2e381d2c5ad4e9` |
| [zh-Hant-signed-in-texas-controls-raise-maximum.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-raise-maximum.png) | `4fce57727801f18760a94b3ba371b94cf9c4021d6bebcea375ad5142faac408c` |
| [zh-Hant-signed-in-texas-controls-shortcut-blinds.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-shortcut-blinds.png) | `29131a14b247930291c8ffccea17c2230d9c1dcaa768504a2ac213f5d5f0470c` |
| [zh-Hant-signed-in-texas-controls-shortcut-disabled.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-controls-shortcut-disabled.png) | `d56d36bafaf5627b47cf6602b6cdb9190e0f42a214356116805a87374ae2e17f` |
| [zh-Hant-signed-in-texas-game-accurate-raise.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-accurate-raise.png) | `b1ebbfb21699fbe4462190b4153077bedd3a8404946de1ad85477d24abfed990` |
| [zh-Hant-signed-in-texas-game-flop.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-flop.png) | `e355d136e738a79f259fd09c914962aa8c41c28b90f347e476dace5e7e4a5d35` |
| [zh-Hant-signed-in-texas-game-preflop.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-preflop.png) | `951774cf5a99fad56fdda0838cac3ebdeb43ed72c87b5ebf0891ffc6476a2326` |
| [zh-Hant-signed-in-texas-game-raise.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-raise.png) | `ee879f7abcea1f4932f6e263563fefc3ed800e14dec312207504f8ca0d6adcfa` |
| [zh-Hant-signed-in-texas-game-river.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-river.png) | `1d704ecc1e5f7b704785fd36525e34a3c52b69e80942fb2466443d9399197380` |
| [zh-Hant-signed-in-texas-game-turn.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-game-turn.png) | `8acb29704c3a2d8857b18534bd64172c8b04dbdb2b21662e2e1f6ac1153177e3` |
| [zh-Hant-signed-in-texas-hall-variants-auto-rebuy-enabled.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-hall-variants-auto-rebuy-enabled.png) | `894a99f63a48f6355012940ca1500d8bdeb8ebd6078e72ea31d8d080ee9793a4` |
| [zh-Hant-signed-in-texas-hall-variants-delay-cooldown-alert.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-hall-variants-delay-cooldown-alert.png) | `b0bb8d983b9eadeddb3c06c9ed04e298b71cfe13729e45f62854c23f07f062a3` |
| [zh-Hant-signed-in-texas-hall-variants-delay-cooldown.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-hall-variants-delay-cooldown.png) | `7350178448c77e4ecc8eef3224640400e2593f89fc694c3ab608f82d293fdf4d` |
| [zh-Hant-signed-in-texas-panel-variants-chat-audio-history.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-panel-variants-chat-audio-history.png) | `3bf528efb60561e4392e03e7385c6640541aedbc0975520ff3314a2f34141e03` |
| [zh-Hant-signed-in-texas-panel-variants-chat-barrage-off.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-panel-variants-chat-barrage-off.png) | `c6c04738f2565635dc177f9acc1ce0c8cb2ea9e3e2582b49c7daafb2c77feb37` |
| [zh-Hant-signed-in-texas-panels-quit-confirm.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-panels-quit-confirm.png) | `b7a59806d4627ae7c8717bc2321876a7f3641b8d5b49fe0c973fb2804fd0f20f` |
| [zh-Hant-signed-in-texas-records-v2-actions.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-records-v2-actions.png) | `b1fe93a9d34e629c49f6e7b72c1d652d39cf23b9711b665122438adbb8c6c3c3` |
| [zh-Hant-signed-in-texas-records-v2-empty.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-records-v2-empty.png) | `8478319d838df61428629e3b2e2972283b93e171a0b8f6b2d4911a831ac01ebf` |
| [zh-Hant-signed-in-texas-records-v2-settlement.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-records-v2-settlement.png) | `5e3bc56dc5ba021f0baf9346a0dc5162ce09cf9085432d14559c4e45027493d6` |
| [zh-Hant-signed-in-texas-table-states-full-table-multiple-pots.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-full-table-multiple-pots.png) | `c57ccb11c7b28b68ed615d382e1f3ec0d3820781e911c45970494b79dbc23eb6` |
| [zh-Hant-signed-in-texas-table-states-full-table.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-full-table.png) | `43472d28361877675f7e5485a272bef6680b79e521661f79e3e498954b08b403` |
| [zh-Hant-signed-in-texas-table-states-guest-menu.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-guest-menu.png) | `6c23a6a3eee06e83d5e524f2d38add1fb3614fd4e495e548fdea08e1f9693a1e` |
| [zh-Hant-signed-in-texas-table-states-player-disconnected.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-player-disconnected.png) | `4a38798e964a3e7d80ecafe09f33a8b358c6f34f3536c8bc0768ac39646b099e` |
| [zh-Hant-signed-in-texas-table-states-reserved-seat.png](snapshots/android-35-x86_64-720x1280-zh-Hant/zh-Hant-signed-in-texas-table-states-reserved-seat.png) | `dbedeb442f371fe291095104e4690886afac8e49e607de3e2295e200c7ab3445` |

## 比较验证与尚待处理的场景

[比较运行 40531424406](https://github.com/albitsj/clrn-az/actions/runs/40531424406) 使用提交 `0964366a4e82d21128c2eac10fdec7c3b8c6c938`，首轮 59 张基准对应的中文德州牌桌、中文其他场景和英文面板分组全部通过；英文德州特效与英文拼三张牌桌也通过。本轮补充的 18 张仍须在新提交上独立比较。

英文其他场景的产物上轮下载返回 `HTTP 503: Egress is over the account limit`；本轮串行下载成功，逐图审查后仅接收表中新增的 18 张。其余内容匹配现有基准。

英文德州牌桌在参考图任务 `40523304048` 中三次遇到持续重连，`gameConnected` 等待 120 秒超时，未接收该失败用例的任何图片。当前比较运行的失败集中在五张牌桌页面和加注滑块动画起点的旧按钮画面；需要该场景通过的参考候选后再逐图更新，不能以当前失败比较图直接替换基准。所有正式比较结论以提交后新的自动测试为准。
