# Android 动画视觉回归清单

本清单对应固定 Staging Release `6a50fb942877c620a940ae001b6a23217cd9bedb`，在 API 35、x86_64、720×1280、英文模拟器上运行。三种语言的普通页面截图仍由原有场景覆盖；动画轨迹只采集一次英文版。新增动画时，要在对应场景加入真实触发、可见运动断言和关键帧基准，再运行 `compare`。

| 动画 | 原生测试入口 | 关键帧或素材验证 |
| --- | --- | --- |
| 启动插画、测试版提示出现 | `animation-transitions.spec.ts` 启动场景 | `native-launch-artwork-visible` 确认应用插画可见；`native-launch-and-staging-notice` 起点、中途、终点及区域变化 |
| 通用水平导航入栈、出栈 | `animation-transitions.spec.ts` 账号安全 | `native-stack-enter/exit` |
| 搜索确认弹窗入场、退场 | `animation-transitions.spec.ts` 游客搜索 | `search-confirmation-enter/exit` |
| 大厅老虎机横幅轮转 | `slot-animation.spec.ts` 登录大厅 | `hall-slot-banner` 两个运动相位及循环运动断言 |
| 大厅匹配转圈 | `animation-transitions.spec.ts` 匹配等待 | `hall-matching-spinner` 两个相位；颜色分布对比允许任意转角，独立断言位置运动 |
| 俱乐部更多菜单、房间空态淡入 | `animation-transitions.spec.ts` 俱乐部 | `club-more-enter/exit`、`club-rooms-empty-enter` |
| 俱乐部列表骨架脉动 | `club-skeleton-animation.spec.ts` 挂起真实列表响应 | `club-list-skeleton` 两个控件各自的明暗相位 |
| 私人房玩法选择器、邀请好友抽屉 | `animation-transitions.spec.ts` 私人房 | `game-picker-enter/exit`、`invite-friends-enter/exit` |
| 完整老虎机弹层、三滚轮、三种奖励、能量不足提示 | `slot-animation.spec.ts` 真实旋转 RPC | `slot-popup-enter/exit`、`slot-{coin,currency_diamond,energy}-reels`、`slot-no-energy-enter/exit`；三个滚轮分别运动 |
| 德州、拼三张开局前菜单及面板 | `games.spec.ts` 两种 `_pre_game` 场景 | 各玩法的菜单、牌型、主题、设置、带入、续费、排行榜、牌谱、聊天、申请面板入退场 |
| 拼三张九个空座引导箭头 | `games.spec.ts` 拼三张开局前 | `zhajinhua-seat-guides-1..9` 各自两个运动相位 |
| 德州公共牌、操作按钮和玩家操作 | `games.spec.ts` 德州 `_game` | 翻牌、转牌、河牌、操作按钮 `zoomInDown`、跟注、加注、看牌、弃牌关键帧及牌面、下注语义断言 |
| 德州倒计时、加注面板与滑块、全压火焰、摊牌、结算与胜利光效 | `games.spec.ts` 德州 `_game` | `texas-operation-countdown`、`texas-holdem-raise-bet`、真实拖动的 `texas-raise-slider`、`texas-all-in-fire`、`texas-showdown`、`texas-settlement` |
| 德州玩家资料、举报、升级 | `games.spec.ts` 德州 `_game` 和 `_hall` | 资料与举报面板入退场；自动消失的 `texas-holdem-level-up` 出现、倒计时变化及恢复 |
| 德州语音、系统提示、弹幕、聊天举报/屏蔽、带入审核 | `games.spec.ts` 德州 `_panels` | `texas-holdem-voice`、`texas-system-prompt`、`texas-barrage`、聊天及审核面板关键帧 |
| 德州操作失败、余额不足、身份失效提示 | `games.spec.ts` 德州 `_panel_variants` | `texas-alert-retry/balance` 入退场、`texas-alert-auth` 入场；分别由真实错误响应触发 |
| 德州自动补充带入、合谋举报、个人排行榜、加载转圈 | `games.spec.ts` 德州 `_hall` | 对应面板入退场、`texas-loading-spinner` 两个区域各自运动 |
| 德州下一手预测 | `games.spec.ts` 德州 `_hall` | 预测面板和结果保留静态截图；此固定包的菜单未显示预测记录入口，无法触发记录弹层动画 |
| 拼三张倒计时、发牌、翻牌、操作按钮、快捷加注、精确加注 | `games.spec.ts` 拼三张 `_game` | `zhajinhua-operation-countdown`、`zhajinhua-deal-cards`、`zhajinhua-flip-cards`、操作按钮 `zoomInDown`、`zhajinhua-quick-raise`、精确加注入退场 |
| 拼三张比牌目标、摊牌胜利光效、升级 | `games.spec.ts` 拼三张 `_game` | 四个目标各自闪烁；同一次摊牌事件验证 `zhajinhua-showdown-cards` 和 `zhajinhua-victory`；自动消失的升级提示验证出现、倒计时与恢复。结算事件只更新被牌型覆盖的余额语义，保留静态结算截图和余额断言 |
| 拼三张游戏规则弹层 | `games.spec.ts` 拼三张 `_pre_game` 菜单入口 | `zhajinhua-game-rule-enter/exit` |
| 两种牌桌的七种表情和七种道具 | 两种 `_game` 场景 | 每种效果各自的播放首帧、变化帧；道具另检查飞行区；`animation-assets.json` 逐字节锁定全部 16 个 WebP 的帧数、顺序和时长 |

所有转场基准保存真实屏幕的起点、中途和终点，并检查触发前后确有可见变化。循环动画要求原生连续帧内发生运动，同时保存两个实际相位。普通页面截图不替代这些检查。`reference` 仅产生待审查候选图；提交基准后必须在 `compare` 模式验证。

水桶道具飞行峰值有两张经原生录屏审查的位置锚点；对比时仍使用相同的色差上限，允许采样落在任一真实播放相位。

网页专用的分享链接确认弹窗使用 `.web.js`，Android 版调用系统分享界面，因此不计入 Android 应用内动画。Android 系统分享界面的外观由系统版本控制。

固定 Staging 包在 `LaunchBranding` 挂载时同步打开不透明提示框，文字的 500 毫秒淡入被提示框遮住，无法在这个包上取得可见像素轨迹。启动场景只声明实际可见的插画和提示出现；若应用将提示延后或提供可测试的无提示启动入口，应为品牌淡入另加逐帧基准。

源码中 `TreasureBox` 只有导出而无页面消费，`PrizeCoinAnimation` 没有调用入口，不能把直接挂载组件产生的图片当作应用视觉回归。德州 `RTCPanel` 的首次初始化依赖尚未挂载的面板 ref，正常 UI 无法打开；这些效果需要应用先提供可达入口。旧引擎房间骨架同样不在固定 React Native 引擎包的可达路径内。

旧版快速匹配页的 `MatchGameBackgroundV2` 气球循环虽然有导航路由，当前大厅的旧版快速匹配内容分支已注释，固定包中没有可操作入口。拼三张的旧 `RaiseBetPopup` 只调用 `hide()`，没有 `show()` 调用；可见牌桌使用快捷加注与精确加注弹层，其动画已覆盖。房间设置的 `StepSlider.native` 没有开启 `animateTransitions`，调整值时不执行源码中的 `StepIndicator` 动画。

德州预测记录弹层虽然在源码中实现，但本包的菜单选项在 `DrawerMenu` 首次计算时未包含该项；牌桌出现预测按钮后，已显示的菜单选项没有重新计算。真实模拟器菜单截图只有排名、主题、设置、反馈、带入和退出。应用修复入口后再增加该弹层的入退场基线。
