import { expect } from '@playwright/test';
import { captureNativeTransition } from './animation-transition';
import { adb } from './device';
import { gameConnected, gameGone, gameNodes, gameReady, gameTap } from './game-controls';
import { closeGameMask } from './game-pregame';
import { replay } from './game-replay';
import { enableGameSetting, restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 复用 Web 的申请分页、音频历史、弹幕开关及三种 RPC 错误状态。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasPanelVariants(context: TexasContext): Promise<void> {
  const { device, proxy, room, capture } = context;
  const tableBackMasks = [
    { x: 260, y: 225, width: 50, height: 55, reason: '弹窗背后的对手背牌会随牌桌回放异步显隐' },
    { x: 16, y: 550, width: 54, height: 70, reason: '弹窗背后的对手背牌会随牌桌回放异步显隐' },
    { x: 16, y: 745, width: 54, height: 60, reason: '弹窗背后的对手背牌会随牌桌回放异步显隐' },
  ];
  const ownTurnMasks = [
    { x: 207, y: 1020, width: 275, height: 34, reason: '弹窗背后的本人回合标识会独立切换' },
    { x: 207, y: 1054, width: 148, height: 148, reason: '弹窗背后的本人头像与筹码状态会独立切换' },
  ];
  await restoreTexas(context);
  for (const mode of ['pending', 'resolved', 'more'] as const) {
    await proxy.command('texas/ui', { applications: mode });
    await gameTap(device, 'buy-in-application-button');
    await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'buy-in-application-nickname').length,
      { timeout: 30_000 }).toBe(mode === 'resolved' ? 3 : 2);
    await applicationChecks[mode](context);
    await capture(`applications_${mode}`, [tableBackMasks[0], ...ownTurnMasks]);
    await closeGameMask(device, 'buy-in-application-list');
  }
  await enableGameSetting(device, 'player-voice');
  await replay(proxy, 'texas', room, { scene: 'audio' });
  await gameTap(device, 'texas-holdem-chat-button');
  await gameTap(device, '-in-game-chat-record-tab');
  await gameReady(device, 'in-game-chat-audio-message-0');
  await capture('chat_audio_history', tableBackMasks);
  await gameTap(device, 'in-game-chat-barrage-switch');
  await capture('chat_barrage_off', tableBackMasks);
  const chat = (await gameReady(device, 'in-game-chat-mask')).bounds;
  adb('shell', 'input', 'tap', String(chat.x + 8), String(chat.y + 80));
  await gameGone(device, 'in-game-chat-container');
  await proxy.command('texas/ui', { rpcError: 'retry' });
  await gameConnected(device);
  await captureAlertTransition(context, 'retry-enter', 'texas-holdem-operation-button-call');
  expect((await gameReady(device, 'common-alert-message')).text).toContain('Please retry');
  // 操作错误弹窗没有 buttonId；与 Web 一样按真实按钮文字校验和操作。
  await expect.poll(async () => (await gameNodes(device)).some(node => /^(Retry|重试|重試)$/.test(node.text || '')),
    { timeout: 30_000 }).toBe(true);
  await capture('alert_retry', [...tableBackMasks,
  { ...ownTurnMasks[0], y: 1010, height: 44 }, ownTurnMasks[1]]);
  await closeRetryAlert(context);
  await restoreTexas(context, 'standard', 'flop', true);
  await proxy.command('texas/ui', { rpcError: 'balance' });
  await texasEvents(context, 'hand-end');
  await captureAlertTransition(context, 'balance-enter', 'texas-holdem-show-remain-community-card-button');
  await gameReady(device, 'common-alert-button-go_to_mall');
  await capture('alert_insufficient_balance');
  await captureAlertTransition(context, 'balance-exit', 'common-alert-button-cancel');
  await proxy.command('texas/ui', { rpcError: 'auth' });
  await texasEvents(context, 'new-game');
  await restoreTexas(context);
  await gameGone(device, 'texas-holdem-show-hand-card-button');
  await gameGone(device, 'texas-holdem-show-remain-community-card-button');
  await captureAlertTransition(context, 'auth-enter', 'texas-holdem-operation-button-call');
  await gameReady(device, 'common-alert-button-quit');
  expect((await gameReady(device, 'common-alert-title')).text).toMatch(/^(身份验证失败|身份驗證失敗|Authentication failed)$/);
  await capture('alert_authentication_failed');
}

const alertRegion = { x: 80, y: 525, width: 560, height: 265 };
const alertMasks = [
  { x: 270, y: 720, width: 180, height: 28, reason: '错误弹窗下方的牌局倒计时独立跳秒' },
  { x: 80, y: 690, width: 55, height: 100, reason: '弹窗左侧的玩家倒计时独立跳秒' },
];

/** 事先读取按钮边界，使点击落在原生采样窗口内。
 * @param context - 当前真实房间。
 * @param resource - 当前实际可见的原生按钮资源标识。
 */
async function press(context: TexasContext, resource: string): Promise<() => void> {
  const { device } = context;
  await gameConnected(device);
  const { bounds } = await gameReady(device, resource);
  return () => adb('shell', 'input', 'tap', String(Math.round(bounds.x + bounds.width / 2)),
    String(Math.round(bounds.y + bounds.height / 2)));
}

/** 每种申请模式保留各自的业务断言。
 * @param context - 当前真实房间。
 */
async function pendingApplications(context: TexasContext): Promise<void> {
  expect((await gameNodes(context.device)).filter(node => node.res === 'buy-in-approved-applications-tab')).toHaveLength(2);
}

/** 已处理申请必须全部显示状态。
 * @param context - 当前真实房间。
 */
async function resolvedApplications(context: TexasContext): Promise<void> {
  expect((await gameNodes(context.device)).filter(node => node.res === 'buy-in-application-status')).toHaveLength(3);
}

/** 更多申请入口必须可操作。
 * @param context - 当前真实房间。
 */
async function moreApplications(context: TexasContext): Promise<void> {
  expect((await gameReady(context.device, 'buy-in-application-list-more')).enabled).toBe(true);
}

const applicationChecks = { pending: pendingApplications, resolved: resolvedApplications, more: moreApplications };

/** 错误弹窗的每次真实点击沿用固定区域与遮罩。
 * @param context - 当前真实房间。
 * @param name - 已审查的错误弹窗相位。
 * @param button - 当前可见的真实按钮。
 */
async function captureAlertTransition(context: TexasContext, name: string, button: string): Promise<void> {
  const { device, animationInfo } = context;
  if (animationInfo) await captureNativeTransition(device, `texas-alert-${name}`, animationInfo,
    alertRegion, await press(context, button), alertMasks, [], 0, 'videoFrames');
  else await gameTap(device, button);
}

/** 操作错误没有 buttonId，继续按真实取消按钮文字点击。
 * @param context - 当前真实房间。
 */
async function closeRetryAlert(context: TexasContext): Promise<void> {
  const { device, animationInfo } = context;
  if (animationInfo) {
    const cancel = await device.info({ text: /^(取消|Cancel)$/ });
    await captureNativeTransition(device, 'texas-alert-retry-exit', animationInfo, alertRegion,
      () => adb('shell', 'input', 'tap', String(Math.round(cancel.bounds.x + cancel.bounds.width / 2)),
        String(Math.round(cancel.bounds.y + cancel.bounds.height / 2))), alertMasks, [], 0, 'videoFrames');
  } else await device.tap({ text: /^(取消|Cancel)$/ });
}
