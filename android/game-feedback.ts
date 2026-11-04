import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { captureAssetSequence } from './asset-sequence';

/** 每种贴纸和道具都经本轮房间消息触发，并验证原生画面的实际播放。
 * @param device - 原生设备。
 * @param game - 当前玩法。
 * @param info - 英文动画报告。
 * @param send - 当前房间的真实回放入口。
 */
export async function captureGameFeedback(device: AndroidDevice, game: 'texas' | 'zhajinhua', info: TestInfo,
  send: (data: unknown) => Promise<void>): Promise<void> {
  for (const name of ['angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap']) {
    await captureAssetSequence(device, `${game}-sticker-${name}`, info,
      { x: 220, y: 990, width: 180, height: 190 }, () => send({ scene: 'sticker', file: name }));
  }
  for (const name of ['tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer']) {
    await captureAssetSequence(device, `${game}-prop-${name}`, info,
      { x: 0, y: 460, width: 180, height: 230 }, () => send({ scene: 'props', file: name }),
      { x: 120, y: 700, width: 220, height: 340 });
  }
}
