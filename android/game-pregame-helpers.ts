import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { captureNativeTransition } from './animation-transition';
import { adb } from './device';
import { gameGone, gameNodes, gameReady, gameTap as tap } from './game-controls';
import { pointOnPanel } from './game-geometry';
import { panelSampling } from './game-panel-animation';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

type Capture = (state: string) => Promise<void>;

/**
 * 打开与 Web 相同的牌桌菜单项，并等待原生面板就绪。
 * @param device - 专用模拟器连接。
 * @param item - 共用菜单标记。
 * @param ready - 面板就绪标记。
 */
export async function gameMenu(device: AndroidDevice, item: string, ready: string): Promise<void> {
  await tap(device, 'menu-button');
  await tap(device, `drawer-menu-item-${item}`);
  await gameGone(device, 'drawer-menu-item-exit');
  await gameReady(device, ready);
}

/**
 * 点击真实弹层遮罩的边缘，避免点击其中央内容。
 * @param device - 专用模拟器连接。
 * @param marker - 当前面板标记。
 */
async function gameMaskClosePoint(device: AndroidDevice, marker: string): Promise<{ x: number; y: number }> {
  const { bounds } = await gameReady(device, 'screen-mask-touch-to-close');
  const panel = (await gameReady(device, marker)).bounds;
  const points = [
    { x: bounds.x + bounds.width - 8, y: bounds.y + Math.min(80, bounds.height / 2) },
    { x: bounds.x + 8, y: bounds.y + Math.min(80, bounds.height / 2) },
    { x: bounds.x + bounds.width - 8, y: bounds.y + bounds.height - 32 },
  ];
  const point = points.find(item => !pointOnPanel(panel, item));
  expect(point, '遮罩上应有未被当前面板覆盖的区域').toBeDefined();
  return point!;
}

/** 点击已定位的遮罩空白处，并等待当前面板关闭。
 * @param device - 专用模拟器连接。
 * @param marker - 当前面板标记。
 */
export async function closeGameMask(device: AndroidDevice, marker: string): Promise<void> {
  const point = await gameMaskClosePoint(device, marker);
  adb('shell', 'input', 'tap', String(Math.round(point!.x)), String(Math.round(point!.y)));
  await gameGone(device, marker);
}

/**
 * 通过真实遮罩关闭牌桌面板，并采样其退场帧。
 * @param device - 专用模拟器连接。
 * @param game - 当前玩法。
 * @param name - 面板名称。
 * @param marker - 当前面板标记。
 * @param region - 动画绘制范围。
 * @param testInfo - 英文动画关键帧报告。
 * @param masks - 与面板无关的动态区域。
 * @param samplingMethod - 短退场动画使用原生录屏取得足够的中途帧。
 * @param videoPhaseAnchors - 已逐图审查的额外退场相位。
 */
export async function closeAnimatedGameMask(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua',
  name: string, marker: string, region: ScreenshotBounds, testInfo?: TestInfo,
  masks?: ScreenshotMask[], samplingMethod?: 'motionFrames' | 'videoFrames', videoPhaseAnchors?: string[]): Promise<void> {
  if (!testInfo) { await closeGameMask(device, marker); return; }
  const point = await gameMaskClosePoint(device, marker);
  await captureNativeTransition(device, `${game}-${name}-exit`, testInfo, region,
    () => adb('shell', 'input', 'tap', String(Math.round(point.x)), String(Math.round(point.y))),
    masks, [], 600, panelSampling(game, samplingMethod), undefined, undefined, videoPhaseAnchors);
  await gameGone(device, marker);
}

/**
 * 两种玩法共用卡牌主题、牌桌背景和开关操作，维持同样的原生验证。
 * @param device - 专用模拟器连接。
 * @param capture - 当前玩法的共享状态截图入口。
 */
export async function captureGameThemes(device: AndroidDevice, capture: Capture): Promise<void> {
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  for (const theme of ['four-color', 'four-color-two', 'realistic']) {
    await tap(device, `game-settings-card-theme-${theme}`);
    await capture(`theme_${theme.replaceAll('-', '_')}`);
  }
  await tap(device, 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-card-theme-simple');
  await captureTableBackgrounds(device, capture);
  await gameMenu(device, 'settings', 'game-settings-popup-container');
  let count = 0;
  for (const name of ['sound-effect', 'vibrate', 'player-voice', 'show-card', 'operation-time', 'see-remain-card', 'shake-avatar']) {
    count += await enableVisibleSetting(device, name);
  }
  expect(count).toBeGreaterThanOrEqual(4);
  await capture('settings_enabled');
}

/** 逐个真实切换背景后恢复绿色。
 * @param device - 原生设备。
 * @param capture - 共用截图入口。
 */
async function captureTableBackgrounds(device: AndroidDevice, capture: Capture): Promise<void> {
  for (const background of ['blue', 'purple', 'black']) {
    await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
    await tap(device, `game-settings-background-${background}`);
    await tap(device, 'game-settings-close-button');
    await gameGone(device, 'game-settings-card-theme-simple');
    await capture(`table_${background}`);
  }
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-background-green');
  await tap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-card-theme-simple');
}

/** 跳过当前玩法没有的开关；可见开关须真实启用。
 * @param device - 原生设备。
 * @param name - 开关名称。
 */
async function enableVisibleSetting(device: AndroidDevice, name: string): Promise<number> {
  const selector = { res: `game-settings-switch-${name}` };
  if (!(await gameNodes(device)).some(node => node.res === selector.res)) return 0;
  if (!(await gameReady(device, selector.res)).checked) await tap(device, selector.res);
  await expect.poll(async () => (await gameReady(device, selector.res)).checked,
    { timeout: 30_000 }).toBe(true);
  return 1;
}
