# Android 动画视觉回归清单

本清单对应固定 Staging Release `225cede6b37f3d11d40ff66696ecea483b36fb12`，在 API 35、x86_64、720×1280、英文模拟器上运行。三种语言的普通页面截图仍由原有场景覆盖；动画轨迹只采集一次英文版。新增动画时，要在对应场景加入真实触发、可见运动断言和关键帧基准，再运行 `compare`。

| 动画 | 原生测试入口 | 关键帧或素材验证 |
| --- | --- | --- |
| 启动品牌淡入、测试版提示出现 | `animation-transitions.spec.ts` 启动场景 | `native-launch-and-staging-notice` 起点、中途、终点；分别要求品牌和弹窗区域变化 |
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
| 德州公共牌与玩家操作 | `games.spec.ts` 德州 `_game` | 翻牌、转牌、河牌、跟注、加注、看牌、弃牌关键帧及牌面、下注语义断言 |
| 德州倒计时、加注面板、全压火焰、摊牌、结算与胜利光效 | `games.spec.ts` 德州 `_game` | `texas-operation-countdown`、`texas-holdem-raise-bet`、`texas-all-in-fire`、`texas-showdown`、`texas-settlement` |
| 德州玩家资料、举报、升级 | `games.spec.ts` 德州 `_game` 和 `_hall` | 对应面板入退场、`texas-holdem-level-up-enter/exit` |
| 德州语音、系统提示、弹幕、聊天举报/屏蔽、带入审核 | `games.spec.ts` 德州 `_panels` | `texas-holdem-voice`、`texas-system-prompt`、`texas-barrage`、聊天及审核面板关键帧 |
| 德州操作失败、余额不足、身份失效提示 | `games.spec.ts` 德州 `_panel_variants` | `texas-alert-retry/balance` 入退场、`texas-alert-auth` 入场；分别由真实错误响应触发 |
| 德州自动补充带入、合谋举报、个人排行榜、加载转圈 | `games.spec.ts` 德州 `_hall` | 对应面板入退场、`texas-loading-spinner` 两个区域各自运动 |
| 拼三张倒计时、发牌、翻牌、快捷加注、精确加注 | `games.spec.ts` 拼三张 `_game` | `zhajinhua-operation-countdown`、`zhajinhua-deal-cards`、`zhajinhua-flip-cards`、`zhajinhua-quick-raise`、精确加注入退场 |
| 拼三张比牌目标、摊牌、结算、升级 | `games.spec.ts` 拼三张 `_game` | 四个目标各自闪烁；`zhajinhua-showdown-cards`、`zhajinhua-settlement`、升级入退场 |
| 两种牌桌的七种表情和七种道具 | 两种 `_game` 场景 | 每种效果各自的播放首帧、变化帧；道具另检查飞行区；`animation-assets.json` 逐字节锁定全部 16 个 WebP 的帧数、顺序和时长 |

所有转场基准保存真实屏幕的起点、中途和终点，并检查触发前后确有可见变化。循环动画要求原生连续帧内发生运动，同时保存两个实际相位。普通页面截图不替代这些检查。`reference` 仅产生待审查候选图；提交基准后必须在 `compare` 模式验证。

网页专用的分享链接确认弹窗使用 `.web.js`，Android 版调用系统分享界面，因此不计入 Android 应用内动画。Android 系统分享界面的外观由系统版本控制。
