import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { ensureRoomBalance, type Account, type RoomSession } from '../visual/cases/_shared/room';
import { prepareTestAccountRooms } from '../scripts/prepare-test-account-rooms.mjs';
import { enterTexasRoom } from '../visual/cases/texas-holdem/room';
import { gameGone, gameNodes, gameReady } from './game-controls';
import { dismissKeyboard } from './keyboard';
import { returnToTabs, reveal, tap } from './navigation';

/**
 * 从认证的本机控制接口取得本轮真实会话；不将令牌写入日志或报告。
 * @param proxy - 本轮独占代理。
 */
export async function gameSession(proxy: Mitmproxy): Promise<{ account: Account | null; room: RoomSession | null }> {
  return proxy.command('android/session');
}

/**
 * 共用 Web 的余额验证，通过原生表单创建本例私人房，立即登记以便失败时清理。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param game - 本轮玩法。
 * @param onCreated - 新房间登记回调。
 * @param optionalFeatures - 与 Web 一致，从真实建房表单启用升盲。
 * @param observerConnection - 大厅或非房主展示也必须建立当前私人房的真实观察者连接。
 */
export async function createGameRoom(device: AndroidDevice, proxy: Mitmproxy,
  game: 'texas-holdem' | 'zhajinhua', onCreated: (room: RoomSession) => void, optionalFeatures?: boolean,
  observerConnection?: boolean): Promise<RoomSession> {
  const account = await roomAccount(proxy);
  await ensureRoomBalance(account);
  await prepareTestAccountRooms(account);
  await submitRoomForm(device, game, optionalFeatures);
  let room: RoomSession | null = null;
  await expect(async () => {
    room = (await gameSession(proxy)).room;
    expect(room, '真实建房接口必须返回本轮新建的房间').not.toBeNull();
  }).toPass({ timeout: 60_000, intervals: [500] });
  onCreated(room!);
  await connectRoomObserver(room!, observerConnection);
  await waitRoomReady(device, game);
  return room!;
}

/** 建房前核实当前真实测试账号身份。
 * @param proxy - 本轮独占代理。
 */
async function roomAccount(proxy: Mitmproxy): Promise<Account> {
  const { account } = await gameSession(proxy);
  if (!account || account.username !== process.env.VISUAL_USERNAME) throw new Error('建房必须使用本轮真实登录的测试账号。');
  return account;
}

/** 真实填写私人房表单，可选功能仍经原生高级设置启用。
 * @param device - 原生设备。
 * @param game - 当前玩法。
 * @param optionalFeatures - 是否启用升盲。
 */
async function submitRoomForm(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', optionalFeatures?: boolean): Promise<void> {
  await returnToTabs(device);
  await tap(device, 'private-room-tab');
  await reveal(device, { res: 'copy-house-number-button' });
  await tap(device, 'create-game-button');
  await reveal(device, { res: 'select-game-category-text' });
  await tap(device, `game-type-button-${game === 'texas-holdem' ? 'texas_react_native' : game}`);
  await device.wait({ res: 'room-name-input' });
  await device.fill({ res: 'room-name-input' }, 'TestRoom');
  await dismissKeyboard(device);
  if (optionalFeatures) {
    await tap(device, 'advanced-options-button');
    await tap(device, 'BlindsEnableFlipSwitch');
  }
  await tap(device, 'creat-room-button');
}

/** 大厅或非房主场景仍建立真实观察者连接并释放请求上下文。
 * @param room - 已登记的新房间。
 * @param observerConnection - 是否需要观察者连接。
 */
async function connectRoomObserver(room: RoomSession, observerConnection?: boolean): Promise<void> {
  if (observerConnection) {
    await enterTexasRoom(room);
  }
}

/** 等待真实牌桌就绪，拼三张必须先有九个完整座位。
 * @param device - 原生设备。
 * @param game - 当前玩法。
 */
async function waitRoomReady(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua'): Promise<void> {
  await gameReady(device, 'run-game-view');
  await gameGone(device, 'game-splash-screen-bg');
  await gameReady(device, 'menu-button');
  if (game === 'zhajinhua') {
    // 菜单比真实初始桌况更早挂载；完整九个座位就绪后才能发送牌局回放。
    await expect.poll(async () => (await gameNodes(device)).filter(node => /^zhajinhua-seat-[1-9]$/.test(node.res || '')).length,
      { timeout: 45_000 }).toBe(9);
    await gameReady(device, 'zhajinhua-text-room-name', 'TestRoom');
  }
}
