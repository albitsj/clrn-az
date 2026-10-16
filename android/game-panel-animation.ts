import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb } from './device';
import { gameReady, gameTap } from './game-controls';
import { captureNativeTransition, captureTimedPrompt } from './animation-transition';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/**
 * 在原生牌桌的实际入口点击期间采样面板动效；其他语言复用静态页面截图。
 * @param device - 已安装采样驱动的测试模拟器。
 * @param game - 当前玩法。
 * @param name - 组件对应的动效名称。
 * @param button - 实际可见的入口控件。
 * @param region - 不包含牌桌循环箭头的面板可见区域。
 * @param testInfo - 仅英文牌桌动画场景采集关键帧。
 * @param phase - 入场或退场。
 * @param samplingMethod - 首次语音权限检查会延迟弹窗，使用持续采样。
 * @param masks - 与面板无关的计时器等动态区域。
 * @param afterReady - 面板加载业务数据后再固定终点画面。
 */
export async function animateGamePanel(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', name: string,
  button: string, region: ScreenshotBounds, testInfo?: TestInfo, phase: 'enter' | 'exit' = 'enter',
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames' = 'motionFrames',
  masks: ScreenshotMask[] = [], afterReady?: () => Promise<void>): Promise<void> {
  if (!testInfo) { await gameTap(device, button); return; }
  const { bounds } = await gameReady(device, button);
  /** 通过独立 ADB 连接点击真实牌桌控件，使驱动同时截取每一帧。 */
  const press = () => adb('shell', 'input', 'tap',
    String(Math.round(bounds.x + bounds.width / 2)),
    String(Math.round(bounds.y + bounds.height / 2)));
  await captureNativeTransition(device, `${game}-${name}-${phase}`, testInfo, region, press,
    masks, [], 0, samplingMethod, undefined, afterReady);
}

/**
 * 实际按钮触发的升级提示会自动消失；验证显示和倒计时两个真实相位。
 * @param device - 专用 Android 模拟器。
 * @param game - 当前玩法。
 * @param button - 当前可见的操作按钮。
 * @param testInfo - 英文动画基线报告。
 */
export async function captureTimedLevelUp(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua',
  button: string, testInfo: TestInfo): Promise<void> {
  const { bounds } = await gameReady(device, button);
  await captureTimedPrompt(device, `${game}-level-up`, testInfo,
    { x: 0, y: 20, width: 620, height: 230 },
    () => adb('shell', 'input', 'tap', String(Math.round(bounds.x + bounds.width / 2)),
      String(Math.round(bounds.y + bounds.height / 2))));
}
