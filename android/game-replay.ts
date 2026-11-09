import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { gameNodes, gameNodesWithin, gameSemanticText } from './game-controls';
import { gameSession } from './game-room';

/**
 * 复用 Web 回放控制接口，且只允许本轮真实建房响应中登记的 UUID。
 * @param proxy - 本轮独占代理。
 * @param game - 共用的玩法代理名。
 * @param roomId - 本轮创建的房间。
 * @param scene - Python 中登记的命名场景及少量参数。
 */
export async function replay(proxy: Mitmproxy, game: 'texas' | 'zhajinhua', roomId: string, scene: unknown): Promise<void> {
  expect((await gameSession(proxy)).room?.roomId, '回放只能发送到本轮新建的私人房').toBe(roomId);
  await expect(async () => {
    const result = await proxy.command<{ replayedMessages?: number }>(`${game}/replay`, { roomId, scene });
    tracePredictionReplay(game, scene, result);
  }).toPass({ timeout: 30_000, intervals: [500] });
}

/** 只记录缺帧场景的宿主时间及代理注入计数，不复制身份、连接或事件载荷。
 * @param game - 当前回放玩法。
 * @param scene - 仅检查固定场景名。
 * @param result - 已有回放响应，不追加网络请求。
 */
function tracePredictionReplay(game: string, scene: unknown, result: { replayedMessages?: number }): void {
  if ([game === 'texas', (scene as { scene?: string })?.scene === 'prediction-loss'].every(Boolean)) {
    console.log('ANDROID PREDICTION REPLAY >', JSON.stringify({ at: Date.now(),
      replayedMessages: Number(result.replayedMessages) }));
  }
}

/**
 * 断言可见牌面容器关联的牌名。辅助文字可能被 Android 裁到父容器外，
 * 只从实际可见的牌面容器读取它，不能把屏外历史牌面计入当前状态。
 * @param device - 专用模拟器连接。
 * @param container - 当前牌面的可见容器 ID。
 * @param marker - 容器内的语义牌名 ID。
 * @param expected - 顺序无关的预期文字。
 * @param options - 可限定前景区域，或仅验证已取得牌名的明牌。
 */
export async function gameCardNames(device: AndroidDevice, container: string, marker: string, expected: string[],
  options: { scope?: string; namedOnly?: boolean } = {}): Promise<void> {
  await expect.poll(async () => {
    const nodes = await gameNodes(device);
    return (options.scope ? gameNodesWithin(nodes, options.scope) : nodes).filter(node => node.res === container)
      .map(node => gameSemanticText(node, marker) || '')
      .filter(text => !options.namedOnly || text !== '').sort();
  },
    { timeout: 30_000, intervals: [250] }).toEqual([...expected].sort());
}

/** 为当前房间绑定共用回放入口，所有事件仍经过会话 UUID 校验。
 * @param proxy - 本轮独占代理。
 * @param game - 共用玩法名。
 * @param roomId - 本轮真实房间。
 */
export function gameReplaySender(proxy: Mitmproxy, game: 'texas' | 'zhajinhua', roomId: string): (scene: unknown) => Promise<void> {
  return scene => replay(proxy, game, roomId, scene);
}
