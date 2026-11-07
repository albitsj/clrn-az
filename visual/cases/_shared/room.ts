import type { Page, Response } from '@playwright/test';
import { expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 30_000 });
import { canTopUpVisualAccount } from '../../test-account';
import { businessRequest, createStagingClient, setTestingBalance } from '../../../network/staging.ts';
import type { NetworkClient } from '../../../network/client.ts';

export type RoomSession = { roomId: string; apiOrigin: string; authorization: string };
export type Account = { userId: string; username: string; authorization: string };
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 读取页面持久化的账号和认证信息，构建真实房间操作所需的会话。
 * @param page - 执行操作的 Playwright 页面。
 */
async function visualAccount(page: Page) {
  const raw = await page.evaluate(() => localStorage.getItem('save.user.origin.data.from.server.key'));
  const auth = raw ? JSON.parse(raw) : null;
  if (!ROOM_ID_PATTERN.test(auth?.user_id || '') || !auth?.api_token?.access_token || !auth?.username) {
    throw new Error('视觉测试登录态缺少有效用户 ID 或 API token');
  }
  return {
    userId: String(auth.user_id),
    username: String(auth.username),
    authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}`,
  };
}

/**
 * 读取真实钱包响应中的钻石余额，拒绝缺失币种或非数值余额。
 * @param client - 独立的 Node 业务网络客户端。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
async function readDiamondBalance(client: NetworkClient, account: Account): Promise<number> {
  const body = await businessRequest<{ currencies: { code: string; balance: string }[] }>(
    client, `/v10/wallet/${account.userId}`, 'PUT', { currencies: ['diamond'] }, account.authorization);
  const diamond = body.result?.currencies?.find((item: { code: string }) => item.code === 'diamond');
  const balance = Number(diamond?.balance);
  if (!Number.isFinite(balance)) throw new Error('视觉测试账号钻石余额无效');
  return balance;
}

/**
 * 确认建房钻石足够，仅允许为受支持的测试账号补充余额。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
export async function ensureRoomBalance(account: Account): Promise<void> {
  const client = createStagingClient();
  try { await ensureBalance(client, account); }
  finally { client.dispose(); }
}

/** Validate balance and restrict test top-ups to the current allowed account.
 * @param client - Caller-owned business client.
 * @param account - Current real test session.
 */
async function ensureBalance(client: NetworkClient, account: Account): Promise<void> {
  if (await readDiamondBalance(client, account) >= 10) return;
  if (!canTopUpVisualAccount(account.username)) {
    throw new Error('仅允许为本轮使用的固定视觉测试账号自动补钻');
  }
  const token = process.env.TESTING_API_TOKEN?.trim();
  if (!token) throw new Error('账号不足 10 钻；需要 TESTING_API_TOKEN 为 staging 测试账号补钻');
  const body = await setTestingBalance<{ wallet_id: string; currency_name: string; balance: string }>(
    `/public/v1/wallet/${account.userId}/set_balance/testing`, { currency_name: 'diamond', balance: '60' }, token);
  validateTopup(body.result, account.userId);
  await expect.poll(() => readDiamondBalance(client, account)).toBe(60);
}

/**
 * 从真实界面创建指定游戏的私人房，立即登记房间以便失败时清理。
 * @param page - 执行操作的 Playwright 页面。
 * @param onCreated - 创建成功后立即登记房间的回调，用于失败时清理。
 * @param gameType - 待创建的私人房游戏类型。
 * @param optionalFeatures - 是否启用可选建房功能。
 */
export async function createPrivateGameRoom(
  page: Page,
  onCreated: (room: RoomSession) => void,
  gameType: 'texas_react_native' | 'zhajinhua',
  optionalFeatures = false,
): Promise<RoomSession> {
  const account = await visualAccount(page);
  await ensureRoomBalance(account);
  await page.locator('[data-testid="create-game-button"]:visible').last().click();
  await page.locator(`[data-testid="game-type-button-${gameType}"]:visible`).last().click();
  await expect(page.locator('[data-testid="base-create-room-screen"]:visible')).toBeVisible();
  await page.locator('[data-testid="room-name-input"]:visible').last().fill('TestRoom');
  if (optionalFeatures) {
    await page.locator('[data-testid="advanced-options-button"]:visible').last().click();
    await page.locator('[data-testid="BlindsEnableFlipSwitch"]:visible').last().click();
  }
  const responsePromise = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
  const clickError = await page.locator('[data-testid="creat-room-button"]:visible').last()
    .click().then(() => null, error => error as Error);
  const response = await responsePromise;
  const body = await response.json();
  const roomId = createdRoomId(response, body, gameType);
  const room = { roomId, apiOrigin: new URL(response.url()).origin, authorization: account.authorization };
  onCreated(room);
  if (clickError) throw clickError;
  return room;
}

/**
 * 只删除本用例创建响应中的 UUID；即使截图失败也执行。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 */
export async function deletePrivateGameRoom(room: RoomSession): Promise<void> {
  if (!ROOM_ID_PATTERN.test(room.roomId)) throw new Error('清理房间需要本轮创建响应中的有效 UUID');
  const client = createStagingClient();
  try {
    await businessRequest(client, `/v1/room/${room.roomId}`, 'DELETE', undefined, room.authorization);
    console.log('ROOM CLEANUP > 本次新建房间已解散');
  } finally { client.dispose(); }
}

/** Verify management response identity and balance without printing its contents.
 * @param result - Real management result.
 * @param userId - Current account ID.
 */
function validateTopup(result: { wallet_id: string; currency_name: string; balance: string }, userId: string): void {
  if (result?.wallet_id !== userId || result?.currency_name !== 'diamond' || Number(result?.balance) !== 60) {
    throw new Error('staging 测试账号补钻结果无效');
  }
}

/** Validate the actual UI creation response before registering its cleanup ID.
 * @param response - Actual browser response.
 * @param body - Parsed server response.
 * @param gameType - Static game name.
 */
function createdRoomId(response: Response, body: { ok?: boolean; result?: { room_id?: string } }, gameType: string): string {
  const roomId = body?.result?.room_id;
  if (!response.ok() || body?.ok !== true || !ROOM_ID_PATTERN.test(roomId || '')) {
    throw new Error(`${gameType} 房间创建失败：HTTP ${response.status()}，无有效建房成功响应`);
  }
  return roomId!;
}
