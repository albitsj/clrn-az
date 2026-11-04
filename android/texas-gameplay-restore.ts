import { expect, type TestInfo } from '@playwright/test';
import { restoreTable, type Street } from '../e2e/helpers/game-scenes';
import { captureNativeTransition } from './animation-transition';
import {
  gameNodes,
  gameReady
} from './game-controls';
import { gameCardNames, gameReplaySender } from './game-replay';
import { type TexasContext } from './texas-support';

import type { ScreenshotBounds } from './screenshot';
export type TexasRestore = (street: Street, opponent?: boolean) => Promise<void>;

/** 建立牌局恢复入口，保留同一房间的回放隔离。
 * @param context - 当前真实房间。
 */
export function texasRestore(context: TexasContext): TexasRestore {
  const { device, self, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  return async (street: Street, opponent?: boolean) => {
    const regions = {
      preflop: { x: 360, y: 1054, width: 137, height: 102 },
      flop: { x: 151, y: 603, width: 249, height: 117 },
      turn: { x: 408, y: 603, width: 76, height: 117 },
      river: { x: 492, y: 603, width: 78, height: 117 },
    };
    if (animateOwnRestore(animationInfo, opponent)) await animateRestore(context, street, Boolean(opponent), regions[street]);
    else await send(restoreTable(street, opponent));
    const count = { preflop: 0, flop: 3, turn: 4, river: 5 }[street];
    await gameCardNames(device, 'community_card', 'community_card_name_text', ['ah', 'kd', '7c', '2s', 'qs']
      .map((card, index) => index < count ? card : 'back'));
    await expect.poll(async () => (await gameNodes(device))
      .some(node => node.res?.startsWith(`texas-holdem-player-container-${self}`)), { timeout: 30_000 }).toBe(true);
    if (!opponent) await gameReady(device, 'texas-holdem-operation-button-raise');
  };
}

/** 对手回合只恢复牌桌，英文本人回合额外采样翻牌。
 * @param info - 英文动画报告。
 * @param opponent - 是否轮到对手。
 */
function animateOwnRestore(info: TestInfo | undefined, opponent: boolean | undefined): boolean {
  return Boolean(info) && !opponent;
}

/** 保留短翻牌的两次上限，起手牌和其他错误直接传播。
 * @param attempt - 当前尝试序号。
 * @param street - 当前街。
 * @param error - 原始采样错误。
 */
function assertRestoreRetry(attempt: number, street: Street, error: unknown): asserts street is Exclude<Street, 'preflop'> {
  if (attempt || street === 'preflop') throw error;
  assertMissingRestoreFrame(error);
}

/** 逐街采样，失败时恢复上一街并等原有牌名就绪。
 * @param context - 当前真实房间。
 * @param street - 当前街。
 * @param opponent - 是否轮到对手。
 * @param region - 当前牌面动画区域。
 */
async function animateRestore(context: TexasContext, street: Street, opponent: boolean, region: ScreenshotBounds): Promise<void> {
  const { device, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'texas', context.room);
  /** 起手牌先建立背面牌位，再下发手牌；整批状态与手牌同帧渲染会跳过翻牌中间帧。 */
  const publish = async () => {
    if (street !== 'preflop') { await send(restoreTable(street, opponent)); return; }
    await send(restoreTable(street, opponent, 'standard', 'without-hand'));
    await new Promise(resolve => setTimeout(resolve, 400));
    await send(restoreTable(street, opponent, 'standard', 'hand'));
  };
  /** 四种翻牌动作均可能短于原生截图间隔，改用持续录屏。 */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await captureNativeTransition(device, `texas-${street}-cards`, animationInfo!, region, publish,
        [], [], 0, 'videoFrames', undefined, undefined,
        restoreAnchors[street]);
      break;
    } catch (error) {
      assertRestoreRetry(attempt, street, error);
      const previous = { flop: 'preflop', turn: 'flop', river: 'turn' } as const;
      await send(restoreTable(previous[street]));
      const count = { preflop: 0, flop: 3, turn: 4 }[previous[street]];
      await gameCardNames(device, 'community_card', 'community_card_name_text',
        ['ah', 'kd', '7c', '2s', 'qs'].map((card, index) => index < count ? card : 'back'));
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
}

const restoreAnchors = { preflop: ['texas-preflop-cards-backed.png', 'texas-preflop-cards-turning.png'], flop: [], turn: [], river: [] };

/** 只对原有两类缺失中途采样错误恢复上一街。
 * @param error - 原始动画采样错误。
 */
function assertMissingRestoreFrame(error: unknown): void {
  if (!/必须采到起点和终点之间的真实动画帧|动画中途帧的实际画面须接近已审查轨迹/.test(String(error))) throw error;
}
