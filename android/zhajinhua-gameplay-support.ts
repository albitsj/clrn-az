import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { gameNodes, gameSemanticText } from './game-controls';
import type { ScreenshotMask } from './screenshot';

export type ZhajinhuaContext = {
  device: AndroidDevice; proxy: Mitmproxy; roomId: string; self: string;
  capture: (state: string, masks?: ScreenshotMask[]) => Promise<void>; animationInfo?: TestInfo;
};

/** 当前可见玩家的余额必须与回放事件完全一致。
 * @param context - 当前真实房间。
 * @param amount - 预期余额。
 */
export async function expectZhajinhuaBalance(context: ZhajinhuaContext, amount: string): Promise<void> {
  await expect.poll(async () => gameSemanticText((await gameNodes(context.device))
    .find(node => node.res === `zhajinhua-player-container-${context.self}`), 'player_stack_text'),
    { timeout: 30_000 }).toBe(`${context.self} ${amount}`);
}
