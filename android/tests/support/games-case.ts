import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../../../e2e/helpers/mitmproxy-client';
import type { VisualScenario } from '../../../visual/scenarioTypes';
import type { RoomSession } from '../../../visual/cases/_shared/room';
import { artifacts, launchApplication, waitForHall } from '../../device';
import { selectLanguage, signIn } from '../../navigation';
import { captureFailure } from '../../diagnostics';
import { createGameRoom, gameSession } from '../../game-room';
import { gamePreGame } from '../../game-pregame';
import { runTexasScenario } from '../../texas-flows';
import { zhajinhuaGameplay } from '../../zhajinhua-gameplay';
import { gameAnimation, gameLaunchOptions, gameStates, panelAnimation, type GamePart } from './games-plan';
import { gameSnapshots } from './games-capture';

export type OwnedRoom = { value: RoomSession | null };
export type GameCase = {
  scenario: VisualScenario; suite: 'texas' | 'zhajinhua'; game: 'texas-holdem' | 'zhajinhua';
  part: GamePart; locale: string; ownedRoom: OwnedRoom; testInfo: TestInfo;
};
type Context = GameCase & { device: AndroidDevice; proxy: Mitmproxy; room: OwnedRoom };
type Capture = ReturnType<typeof gameSnapshots>['capture'];

/** 在本轮代理会话内执行独立房间，保留失败诊断和完整清理。
 * @param proxy - 本轮代理。
 * @param current - 当前玩法和阶段。
 */
export async function runGameCase(proxy: Mitmproxy, current: GameCase): Promise<void> {
  if (current.scenario.pageLabel === 'signed_in_texas_records_v2') await proxy.command('texas/records', { empty: true });
  const device = await launchApplication(gameLaunchOptions(current.scenario, current.locale));
  const context: Context = { ...current, device, proxy, room: { value: null } };
  try { await runGameSteps(context); }
  catch (error) { await captureFailure(device, current.testInfo); throw error; }
  finally { await finishGameCase(context); }
}

/** 登录、建房、按共享状态采集，并核对完整覆盖。
 * @param context - 当前设备、代理、房间登记和报告。
 */
async function runGameSteps(context: Context): Promise<void> {
  const { device, proxy, scenario, locale, suite, testInfo } = context;
  await waitForHall(device);
  await selectLanguage(device, locale);
  await signIn(device);
  const observer = await configureGameView(proxy, scenario);
  await createGameRoom(device, proxy, context.game, created => {
    context.room.value = created; context.ownedRoom.value = created;
  }, scenario.pageLabel === 'signed_in_texas_optional_pre_game', observer);
  await testInfo.attach('created-room', { body: JSON.stringify({ roomId: context.room.value!.roomId }), contentType: 'application/json' });
  const { capture, complete } = gameSnapshots(device, scenario, locale, suite, gameStates(scenario, context.part), testInfo);
  const { account } = await gameSession(proxy);
  expect(account).not.toBeNull();
  await runGameFlow(context, account!.userId, capture);
  complete();
}

/** 仅大厅和访客展示需要在建房前切换观察者模式。
 * @param proxy - 本轮代理。
 * @param scenario - 共享场景。
 */
async function configureGameView(proxy: Mitmproxy, scenario: VisualScenario): Promise<boolean> {
  const mode = gameView(scenario);
  if (mode) await proxy.command('texas/view', { mode });
  return Boolean(mode);
}

/** 保留大厅优先于访客的既有选择。
 * @param scenario - 共享场景。
 */
function gameView(scenario: VisualScenario): 'hall' | 'guest' | undefined {
  if (['signed_in_texas_hall', 'signed_in_texas_hall_variants'].includes(scenario.pageLabel)) return 'hall';
  return scenario.pageLabel === 'signed_in_texas_table_states' ? 'guest' : undefined;
}

/** 按玩法分发，所有状态仍经过相同采集器。
 * @param context - 当前会话。
 * @param self - 真实登录用户。
 * @param capture - 顺序校验截图入口。
 */
async function runGameFlow(context: Context, self: string, capture: Capture): Promise<void> {
  if (context.suite === 'texas') await runTexasCase(context, self, capture);
  else await runZhajinhuaCase(context, self, capture);
}

/** 普通德州开局按阶段执行，可选开局继续走原有专用场景。
 * @param context - 当前会话。
 * @param self - 真实登录用户。
 * @param capture - 顺序校验截图入口。
 */
async function runTexasCase(context: Context, self: string, capture: Capture): Promise<void> {
  const { device, proxy, room, scenario, part, locale, testInfo } = context;
  if (scenario.pageLabel === 'signed_in_texas_pre_game') await runPreGame(context, capture, ['first', 'middle', 'second']);
  else await runTexasScenario(scenario.pageLabel, { device, proxy, room: room.value!.roomId, self, capture,
    animationInfo: animationReport(gameAnimation(scenario, locale), testInfo), diagnosticsInfo: testInfo }, texasPhase(part));
}

/** 拼三张开局与牌桌阶段沿用各自的原有入口。
 * @param context - 当前会话。
 * @param self - 真实登录用户。
 * @param capture - 顺序校验截图入口。
 */
async function runZhajinhuaCase(context: Context, self: string, capture: Capture): Promise<void> {
  const { device, proxy, room, scenario, part, locale, testInfo } = context;
  if (scenario.pageLabel.endsWith('_pre_game')) await runPreGame(context, capture, ['first', 'second']);
  else await zhajinhuaGameplay(device, proxy, room.value!.roomId, self, capture,
    animationReport(gameAnimation(scenario, locale), testInfo), zhajinhuaPhase(part));
}

/** 开局只接受当前玩法已有的房间阶段。
 * @param context - 当前会话。
 * @param capture - 截图入口。
 * @param phases - 当前玩法允许的阶段。
 */
async function runPreGame(context: Context, capture: Capture, phases: string[]): Promise<void> {
  const { device, game, scenario, locale, testInfo, part } = context;
  await gamePreGame(device, game, capture, animationReport(panelAnimation(scenario, locale), testInfo),
    phases.includes(part) ? part as 'first' | 'middle' | 'second' : 'all');
}

/** 保持普通语言场景没有动画报告的语义。
 * @param enabled - 是否采集动画。
 * @param info - 当前报告。
 */
function animationReport(enabled: boolean, info: TestInfo): TestInfo | undefined { return enabled ? info : undefined; }

/** 德州牌桌只接受已有的三个分段。
 * @param part - 当前阶段。
 */
function texasPhase(part: GamePart): 'all' | 'table' | 'effects' | 'profiles' {
  return ['table', 'effects', 'profiles'].includes(part) ? part as 'table' | 'effects' | 'profiles' : 'all';
}

/** 拼三张牌桌只接受已有的两个分段。
 * @param part - 当前阶段。
 */
function zhajinhuaPhase(part: GamePart): 'all' | 'table' | 'effects' {
  return ['table', 'effects'].includes(part) ? part as 'table' | 'effects' : 'all';
}

/** 附件失败也必须找回已创建房间并关闭设备，fixture 最终负责删除。
 * @param context - 当前会话。
 */
async function finishGameCase(context: Context): Promise<void> {
  const { device, proxy, testInfo } = context;
  try {
    try {
      await testInfo.attach('network-selection', {
        body: JSON.stringify(await proxy.command('android/network-selection')), contentType: 'application/json',
      });
      await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
    } finally { await recoverOwnedRoom(context); }
  } finally { await device.close(); }
}

/** 即使创建后的导航失败，也从本轮真实响应登记找回房间。
 * @param context - 当前会话。
 */
async function recoverOwnedRoom(context: Context): Promise<void> {
  context.room.value ||= (await gameSession(context.proxy)).room;
  context.ownedRoom.value ||= context.room.value;
}
