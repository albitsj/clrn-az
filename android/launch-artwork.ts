import { readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { frameColorDistance } from './animation-transition';
import { motionParts } from './motion-regions';
import { maskScreenshot } from './screenshot';

/**
 * Staging 弹窗出现前，锁定应用插画本身的连续画面；排除系统 Splash 和桌面。
 * @param frames - 冷启动期间采集的完整原生屏幕。
 * @param testInfo - 保存和比较关键帧的测试信息。
 */
export async function verifyLaunchArtwork(frames: Buffer[], testInfo: TestInfo): Promise<void> {
  const region = { x: 70, y: 155, width: 580, height: 900 };
  const clock = { x: 70, y: 220, width: 60, height: 110, reason: 'Pixel Launcher 时钟图标' };
  const artwork = frames.map(frame => motionParts(maskScreenshot(frame, [clock]), [region]).regions[0]);
  /**
   * 判断截图是否处在应用插画可见的蓝色阶段。
   * @param frame - 已裁切并遮蔽桌面时钟的启动截图。
   */
  const isArtwork = (frame: Buffer) => {
    const picture = PNG.sync.read(frame);
    const reds = [100, 200, 300, 400, 500].map(x => picture.data[(90 * picture.width + x) * 4]);
    const center = (90 * picture.width + 300) * 4;
    // 系统 Splash 是均匀蓝底，桌面与弹窗在这个位置没有应用插画的蓝色。
    return picture.data[center] < 160 && picture.data[center + 1] >= 120
      && picture.data[center + 2] >= 200 && Math.max(...reds) - Math.min(...reds) > 8;
  };
  const first = artwork.findIndex(isArtwork);
  expect(first, '必须看到应用自己的启动插画').toBeGreaterThanOrEqual(0);
  const moved = artwork.findIndex((frame, index) => index > first && isArtwork(frame)
    && frameColorDistance(artwork[first], frame) > 4);
  expect(moved, '应用启动插画的角色或背景必须发生可见运动').toBeGreaterThan(first);
  for (const [phase, frame] of [['first', artwork[first]], ['moved', artwork[moved]]] as const) {
    const name = `native-launch-artwork-${phase}.png`;
    await testInfo.attach(name, { body: frame, contentType: 'image/png' });
    if (testInfo.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(name);
    else {
      const reference = readFileSync(testInfo.snapshotPath(name));
      expect(Math.min(...artwork.filter(isArtwork).map(candidate => frameColorDistance(candidate, reference))),
        `${name} 须在真实启动帧里接近已审查的插画相位`).toBeLessThanOrEqual(12);
    }
  }
}
