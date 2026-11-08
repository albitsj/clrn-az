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
  if (!validVisualAuth(auth)) {
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
  const balance = diamondBalance(body.result);
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
  const token = testingToken();
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
  await configureRoomFeatures(page, optionalFeatures);
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
  if (!result) throw new Error('staging 测试账号补钻结果无效');
  const fields = [[result.wallet_id, userId], [result.currency_name, 'diamond'], [Number(result.balance), 60]];
  if (!fields.every(([actual, expected]) => actual === expected)) {
    throw new Error('staging 测试账号补钻结果无效');
  }
}

/** Validate the actual UI creation response before registering its cleanup ID.
 * @param response - Actual browser response.
 * @param body - Parsed server response.
 * @param gameType - Static game name.
 */
function createdRoomId(response: Response, body: { ok?: boolean; result?: { room_id?: string } }, gameType: string): string {
  const roomId = responseRoomId(body);
  if (!validCreatedResponse(response, body, roomId)) {
    throw new Error(`${gameType} 房间创建失败：HTTP ${response.status()}，无有效建房成功响应`);
  }
  return roomId!;
}

type VisualAuth = { user_id: string; username: string; api_token: { token_type: string; access_token: string } };

/** Check identity separately from credentials before using the parsed session.
 * @param auth - Persisted login data.
 */
function validVisualAuth(auth: VisualAuth | null): auth is VisualAuth {
  if (!ROOM_ID_PATTERN.test(visualUserId(auth))) return false;
  return Boolean(visualToken(auth)) && Boolean(visualUsername(auth));
}

/** Read the optional stored identity with the original empty fallback.
 * @param auth - Persisted login data.
 */
function visualUserId(auth: VisualAuth | null): string {
  return auth?.user_id || '';
}

/** Read the optional stored token.
 * @param auth - Persisted login data.
 */
function visualToken(auth: VisualAuth | null): string | undefined {
  return auth?.api_token?.access_token;
}

/** Read the optional stored username.
 * @param auth - Persisted login data.
 */
function visualUsername(auth: VisualAuth | null): string | undefined {
  return auth?.username;
}

/** Select the requested currency before validating its numeric balance.
 * @param result - Wallet result.
 */
function diamondBalance(result: { currencies: { code: string; balance: string }[] } | undefined): number {
  const diamond = result?.currencies?.find(item => item.code === 'diamond');
  return currencyBalance(diamond);
}

/** Preserve Number conversion of a missing currency balance.
 * @param currency - Selected currency.
 */
function currencyBalance(currency: { balance: string } | undefined): number {
  return Number(currency?.balance);
}

/** Require the testing token only when a permitted account needs a top-up. */
function testingToken(): string {
  const token = process.env.TESTING_API_TOKEN?.trim();
  if (!token) throw new Error('账号不足 10 钻；需要 TESTING_API_TOKEN 为 staging 测试账号补钻');
  return token;
}

/** Enable the optional room controls in the existing UI order.
 * @param page - Current page.
 * @param enabled - Whether the scenario requests optional features.
 */
async function configureRoomFeatures(page: Page, enabled: boolean): Promise<void> {
  if (!enabled) return;
  await page.locator('[data-testid="advanced-options-button"]:visible').last().click();
  await page.locator('[data-testid="BlindsEnableFlipSwitch"]:visible').last().click();
}

/** Read the optional room identity from the creation response.
 * @param body - Parsed response.
 */
function responseRoomId(body: { result?: { room_id?: string } }): string | undefined {
  return body?.result?.room_id;
}

/** Require successful HTTP and business status before accepting an ID.
 * @param response - Actual browser response.
 * @param body - Parsed response.
 * @param roomId - Returned identity.
 */
function validCreatedResponse(response: Response, body: { ok?: boolean }, roomId: string | undefined): boolean {
  if (!response.ok()) return false;
  return successfulRoomBody(body, roomId);
}

/** Verify the business success flag and UUID.
 * @param body - Parsed response.
 * @param roomId - Returned identity.
 */
function successfulRoomBody(body: { ok?: boolean }, roomId: string | undefined): boolean {
  if (body?.ok !== true) return false;
  return validRoomId(roomId);
}

/** Apply the original missing-ID fallback before testing the UUID pattern.
 * @param roomId - Returned identity.
 */
function validRoomId(roomId: string | undefined): boolean {
  return ROOM_ID_PATTERN.test(roomId || '');
}
