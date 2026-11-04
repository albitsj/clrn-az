import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { restoreTable } from '../e2e/helpers/zhajinhua-scenes';
import { gameNodes, gameReady } from './game-controls';
import { captureGameFeedback } from './game-feedback';
import { captureTimedLevelUp } from './game-panel-animation';
import { gameReplaySender } from './game-replay';
import type { ScreenshotMask } from './screenshot';
import { expectZhajinhuaBalance, type ZhajinhuaContext } from './zhajinhua-gameplay-support';

import { zhajinhuaTable } from './zhajinhua-gameplay-table';

/**
 * 选择 Python 八个牌局状态，真实点击原生操作按钮。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param roomId - 本轮创建的房间。
 * @param self - 本轮真实登录用户。
 * @param capture - 使用共用状态名采集截图。
 * @param animationInfo - 英文原生发牌、翻牌和摊牌关键帧基准。
 * @param phase - 英文长牌局拆成牌桌状态和反馈动画。
 */
export async function zhajinhuaGameplay(device: AndroidDevice, proxy: Mitmproxy, roomId: string,
  self: string, capture: (state: string, masks?: ScreenshotMask[]) => Promise<void>, animationInfo?: TestInfo,
  phase: 'all' | 'table' | 'effects' = 'all'): Promise<void> {
  const context = { device, proxy, roomId, self, capture, animationInfo };
  if (phase === 'effects') await prepareSettlement(context);
  else await zhajinhuaTable(context);
  await capturePhaseEffects(context, phase);
  const status = await proxy.command<{ replayedMessages: number; blockedRpcs: number }>('status');
  expect(status.replayedMessages).toBeGreaterThan(0);
  expect(status.blockedRpcs).toBeGreaterThan(0);
}

/** 独立效果阶段经真实房间消息重建结算牌桌。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function prepareSettlement(context: ZhajinhuaContext): Promise<void> {
  const { device } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  const showdown = { scene: 'showdown' };
  const settlement = { scene: 'settlement' };
  // 反馈动画独立建房；用真实房间消息恢复结算牌桌，保持贴纸和升级前的可见背景。
  await send(restoreTable(true, true));
  await expect.poll(async () => (await gameNodes(device))
    .filter(node => node.res?.startsWith('zhajinhua-player-container-')).length,
    { timeout: 30_000 }).toBe(5);
  await send(showdown);
  await send(settlement);
  await expectZhajinhuaBalance(context, '1120');
}

/** 牌桌阶段不播放效果，其余阶段沿用原有反馈采样。
 * @param context - 当前房间。
 * @param phase - 当前阶段。
 */
async function capturePhaseEffects(context: ZhajinhuaContext, phase: string): Promise<void> {
  if (phase !== 'table') await captureEffects(context);
}

/** 通过真实房间消息播放贴纸道具，再用真实操作响应验证升级。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureEffects(context: ZhajinhuaContext): Promise<void> {
  const { device, proxy, roomId, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  if (!animationInfo) return;
  await new Promise(resolve => setTimeout(resolve, 3000));
  await captureFeedbackSequences(context);
  // 新牌局清除胜利皇冠，再通过当前房间的真实操作响应触发独立的拼三张升级动画。
  await send({ scene: 'new-game' });
  await send(restoreTable());
  await send({ scene: 'room-status' });
  await gameReady(device, 'zhajinhua-operation-button-call');
  await proxy.command('zhajinhua/operation-reward', { roomId, enabled: true });
  try {
    await captureTimedLevelUp(device, 'zhajinhua', 'zhajinhua-operation-button-call', animationInfo);
  } finally { await proxy.command('zhajinhua/operation-reward', { roomId, enabled: false }); }
}

/** 每一种贴纸及道具都验证原生画面播放。
 * @param context - 当前真实房间、原生设备和报告。
 */
export async function captureFeedbackSequences(context: ZhajinhuaContext): Promise<void> {
  const { device, animationInfo } = context;
  const send = gameReplaySender(context.proxy, 'zhajinhua', context.roomId);
  await captureGameFeedback(device, 'zhajinhua', animationInfo!, send);
}
