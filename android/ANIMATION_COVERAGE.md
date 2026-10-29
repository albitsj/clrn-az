# Android 动画视觉回归清单

待测 Staging Release 和完整应用提交只读取当前检出提交的 `deployments/staging.json`，在 API 35、x86_64、720×1280、英文模拟器上运行。`animation-assets.json` 独立记录 16 个动画 WebP 的已审查内容基准，不额外固定应用版本。以下覆盖记录最初在 `android-staging-7304-856f052cfdd8` 核对；后续版本继续执行相同的素材与画面比较。三种语言的普通页面截图仍由原有场景覆盖；动画轨迹只采集一次英文版。新增动画时，要在对应场景加入真实触发、可见运动断言和关键帧基准，再运行 `compare`。

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

搜索确认框的入场录屏完成后，从 `confirm-pop-up-image-background` 读取实际边界，再用同一坐标裁切录屏和完整首尾截图；退场在弹窗消失前读取边界。用例还断言标题、正文、关闭、取消和登录按钮完整位于该范围内。原固定区域 `(58, 495, 604, 345)` 截掉了约 55 像素的上缘及关闭按钮；修复只调整采集代码，不改应用布局或 APK 引用。旧的局部中途替代相位已移除，不能与新完整弹窗混用。报告保留实际边界及原始 MP4。

#32 收敛后，额外飞行位置只接受 `asset-sequence.ts` 显式登记的四张茶杯相位图，
目录中新出现备用文件不会自动参与比较，登记文件丢失仍失败。三张主体道具备用图、
三个滑块备用终点和一个重复桌面起点已移除，原有运动、空间轨迹和关键状态检查
全部保留。逐项保留/删除依据及覆盖映射见[收敛记录](SCREENSHOT_SIMPLIFICATION_32.md)。

拼三张带入审核面板的录屏还保存了遮罩先变暗、面板随后绘出的真实中途相位；两个相位均沿用同一色差上限。排行榜入场前要等待房间重连提示消失，起点才对应稳定牌桌。

德州精确加注退场、摊牌和自动带入的入退场使用原生录屏，以取得短于截图轮询间隔的中途相位。错误弹窗基准中的左侧玩家倒计时统一使用实际 100 像素遮罩范围；弹窗主体和其他牌面仍逐像素比较。

德州玩家动作标签的录屏区域位于头像倒计时右侧，不使用动态遮罩；首、中、尾基准从已审查的原生截图对应区域逐像素裁出。小型标签的中途帧变化门槛按该标签的实际首尾色差计算，画面仍需匹配中途基准。

网页专用的分享链接确认弹窗使用 `.web.js`，Android 版调用系统分享界面，因此不计入 Android 应用内动画。Android 系统分享界面的外观由系统版本控制。

固定 Staging 包在 `LaunchBranding` 挂载时同步打开不透明提示框，文字的 500 毫秒淡入被提示框遮住，无法在这个包上取得可见像素轨迹。启动场景只声明实际可见的插画和提示出现；若应用将提示延后或提供可测试的无提示启动入口，应为品牌淡入另加逐帧基准。

源码中 `TreasureBox` 只有导出而无页面消费，`PrizeCoinAnimation` 没有调用入口，不能把直接挂载组件产生的图片当作应用视觉回归。德州 `RTCPanel` 的首次初始化依赖尚未挂载的面板 ref，正常 UI 无法打开；这些效果需要应用先提供可达入口。旧引擎房间骨架同样不在固定 React Native 引擎包的可达路径内。

旧版快速匹配页的 `MatchGameBackgroundV2` 气球循环虽然有导航路由，当前大厅的旧版快速匹配内容分支已注释，固定包中没有可操作入口。拼三张的旧 `RaiseBetPopup` 只调用 `hide()`，没有 `show()` 调用；可见牌桌使用快捷加注与精确加注弹层，其动画已覆盖。房间设置的 `StepSlider.native` 没有开启 `animateTransitions`，调整值时不执行源码中的 `StepIndicator` 动画。

德州预测记录弹层虽然在源码中实现，但本包的菜单选项在 `DrawerMenu` 首次计算时未包含该项；牌桌出现预测按钮后，已显示的菜单选项没有重新计算。真实模拟器菜单截图只有排名、主题、设置、反馈、带入和退出。应用修复入口后再增加该弹层的入退场基线。

搜索确认框完整关键帧来自 [reference 39613843389](https://github.com/albitsj/clrn-az/actions/runs/39613843389) 的通过场景（1 项），测试提交 `3d09f83265d174ef9405e9044935a69160a8dfcf`。六张 PNG 从该轮报告的原始 start/middle/end 附件逐字节取回，人工检查入场终点与退场起点为同一完整弹窗，两张中途图为真实录屏的淡入淡出相位。实际边界为 `(58, 440, 604, 400)`，保留原画面并补齐顶部 55 像素。APK 继续固定为 `android-staging-100001002-b99077e07427`，应用提交 `b99077e07427f469838aeb34811975cda4fe2487`，SHA-256 为 `66972306f1d9be6f610749a3035c79d56a8e3fbc4b973cad75680e44091a0c0a`。
