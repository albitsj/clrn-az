import { waitAbsent } from '../../native-state';
import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';
import type { Mitmproxy } from '../../../e2e/helpers/mitmproxy-client';
import type { VisualScenario } from '../../../visual/scenarioTypes';
import { captureFailure } from '../../diagnostics';
import { preserveRecordFailure } from '../../record-diagnostics';
import { RecordProxy } from '../../../visual/cases/game-record/proxy';
import { adb, launchApplication, waitForHall } from '../../device';
import { navigateScenario, reveal, selectLanguage, signIn, tap } from '../../navigation';
import { pressRecordControl, recordRow, recordSnapshots, reopenRecords, scrollRecords } from '../../record-navigation';
import { recordStates } from '../../record-states';
import { recordDeletion, legacyRecordEnd, v2RecordErrors } from '../../record-extra';
import { scrollToEnd } from '../../scroll-end';

type Version = 'legacy' | 'v2';
type Controls = { loading: string; header: string; relationship: string; actions: string;
  settlement: string; hall: string; noHands: string; replay: AndroidSelector };
const recordControls: Record<Version, Controls> = {
  legacy: { loading: 'progress-hud-activity-indicator', header: 'header-right-button', relationship: 'player-name-text',
    actions: 'game-action-list-container', settlement: 'game-settlement-list', hall: 'game-hall-record-view',
    noHands: 'no-hands-text', replay: { res: 'replay-tab-button' } },
  v2: { loading: 'loading-indicator', header: 'navigation-bar-right-button', relationship: 'player-win-and-lose-relationship-list',
    actions: 'review-board-action-list', settlement: 'review-board-settlement-list', hall: 'game-record-player-item',
    noHands: 'no-hands-footer', replay: { text: /^(Replay|战绩回放|戰績回放)$/i } },
};
type Context = { device: AndroidDevice; proxy: RecordProxy; scenario: VisualScenario; locale: string;
  version: Version; controls: Controls; capture: (state: string) => Promise<void> };

/** 登录前配置版本，账号仍由真实登录绑定；异常继续保留诊断和清理。
 * @param connection - 本轮代理连接。
 * @param scenario - 共享场景。
 * @param locale - 当前语言。
 * @param testInfo - 当前报告。
 */
export async function runRecordCase(connection: Mitmproxy, scenario: VisualScenario, locale: string, testInfo: TestInfo): Promise<void> {
  const version = scenario.pageLabel.endsWith('legacy') ? 'legacy' : 'v2';
  const proxy = new RecordProxy(connection);
  await proxy.configure('pending-login', version, 'empty');
  const device = await launchApplication();
  const { capture, complete } = recordSnapshots(device, scenario, testInfo, recordStates[version]);
  const context: Context = { device, proxy, scenario, locale, version, controls: recordControls[version], capture };
  const startedAt = Date.now();
  try {
    await recordOpening(context);
    await recordBottom(context);
    await recordSelection(context);
    await recordDeletion(device, capture);
    await recordDetails(context);
    await recordOverviews(context);
    await recordNoHands(context);
    await recordEnding(context);
    complete();
  } catch (error) {
    await preserveRecordFailure(device, proxy, testInfo, startedAt).catch(() => undefined);
    await captureFailure(device, testInfo);
    throw error;
  }
  finally { await proxy.release(); await device.close(); }
}

/** 保留空态、加载态及列表的既有请求和截图顺序。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function recordOpening(context: Context): Promise<void> {
  const { device, proxy, scenario, locale, controls, capture } = context;
  await waitForHall(device);
  await selectLanguage(device, locale);
  await signIn(device);
  await navigateScenario(device, { ...scenario, tabTestId: 'club-tab', visualReadySelector: '[data-testid="club-tab-screen"]' });
  await navigateScenario(device, scenario);
  await proxy.mode('empty', true);
  await tap(device, 'game-record');
  await device.wait({ res: controls.loading });
  await capture('loading');
  await proxy.release();
  await device.wait({ res: 'no-records-text' });
  await capture('empty');
  await proxy.mode('list');
  await reopenRecords(device);
  await device.wait(recordRow('Private Texas'));
  await capture('list');
}

/** 新版先开启分页，再采集列表底部。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function recordBottom(context: Context): Promise<void> {
  const { device, proxy, version, capture } = context;
  if (version === 'v2') {
    await proxy.mode('paged');
    await reopenRecords(device);
  }
  await scrollRecords(device, true);
  await reveal(device, recordRow('Long Room Name ABCDE'));
  if (version === 'v2') {
    await scrollToEnd(device, { res: 'my-game-record-list' }, { res: 'record-retained-days-text' });
  }
  await capture('list_bottom');
  await proxy.mode('list');
  await reopenRecords(device);
}

/** 通过真实控件依次校验选择、汇总和取消。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function recordSelection(context: Context): Promise<void> {
  const { device, controls, capture } = context;
  const header = controls.header;
  await tap(device, header);
  await device.wait({ res: 'record-sum-score-text', text: '0' });
  await capture('select_none');
  await selectRecord(context, 'private', 'Private Texas');
  await device.wait({ res: 'record-sum-score-text', text: '+180' });
  await capture('select_win');
  await selectRecord(context, 'private', 'Private Texas');
  await selectRecord(context, 'club', 'Club Cards');
  await device.wait({ res: 'record-sum-score-text', text: '-90' });
  await capture('select_loss');
  await tap(device, 'game-record-list-select-all-button');
  await device.wait({ res: 'record-sum-score-text', text: '-1.2m' });
  await capture('select_all');
  await tap(device, 'game-record-list-select-all-button');
  await device.wait({ res: 'record-sum-score-text', text: '0' });
  await capture('select_clear');
  await tap(device, header);
  await waitAbsent(device, { res: 'record-sum-score-text' });
  await capture('select_cancel');
}

/** 每个房间详情仍在同一会话中按原有顺序打开并关闭。
 * @param context - 当前战绩会话。
 */
async function recordDetails(context: Context): Promise<void> {
  for (const [name, prefix] of [['Private Texas', 'private'], ['Club Cards', 'club']]) await oneRecordDetails(context, name, prefix);
}

/** 依次采集概览、关系、操作、结算与回放。
 * @param context - 当前战绩会话。
 * @param name - 房间名。
 * @param prefix - 截图状态前缀。
 */
async function oneRecordDetails(context: Context, name: string, prefix: string): Promise<void> {
  const { device, controls, capture } = context;
  await pressRecordControl(device, recordRow(name));
  await device.wait({ res: 'game-name-value-text', text: name });
  await device.wait({ res: 'detail-button' });
  await capture(`${prefix}_overview`);
  if (prefix === 'private') await privateRelationship(context);
  await tap(device, 'detail-button');
  await device.wait({ res: controls.actions });
  await capture(`${prefix}_actions`);
  await pressRecordControl(device, { res: /^(Game settlements|Settlement|牌局结算|牌局結算)$/i });
  await device.wait({ res: controls.settlement });
  await capture(`${prefix}_settlement`);
  await device.input.press('Back');
  await device.wait({ res: 'detail-button' });
  if (prefix === 'private') {
    await pressRecordControl(device, controls.replay);
    await device.wait({ res: 'game-replay-item' });
    await capture('replay_list');
  }
  // Android 系统返回会先回到 Overview 标签；页头返回才离开战绩详情。
  await tap(device, 'navigation-bar-back-image');
  await device.wait({ res: 'my-game-record-list' });
}

/** 保留两次对手切换和详情收起后的三次回滚。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function privateRelationship(context: Context): Promise<void> {
  const { device, controls, capture } = context;
  await pressRecordControl(device, { res: 'player-nickname-text', text: 'Testing User' });
  await reveal(device, { res: controls.relationship }, true);
  await capture('private_relationship');
  await pressRecordControl(device, { res: 'player-nickname-text', text: 'Opponent' });
  await reveal(device, { res: controls.relationship }, true);
  await capture('private_relationship_switch');
  await pressRecordControl(device, { res: 'player-nickname-text', text: 'Opponent' });
  await waitAbsent(device, { res: controls.relationship });
  // 关系详情位于长页面底部；正常滚回概览后再进入详细战绩。
  for (let reset = 0; reset < 3; reset++) adb('shell', 'input', 'swipe', '680', '400', '680', '1100', '600');
}

/** 采集大厅和短牌概览后正常返回列表。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function recordOverviews(context: Context): Promise<void> {
  const { device, controls, capture } = context;
  for (const [name, state, ready] of [
    ['Hall Texas', 'hall_overview', controls.hall],
    ['Short Deck', 'short_deck_overview', 'detail-button'],
  ]) {
    await pressRecordControl(device, recordRow(name));
    await device.wait({ res: ready });
    await capture(state);
    await tap(device, 'navigation-bar-back-image');
    await device.wait({ res: 'my-game-record-list' });
  }
}

/** 保留无手牌、空回放与重新打开列表。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function recordNoHands(context: Context): Promise<void> {
  const { device, proxy, controls, capture } = context;
  await proxy.mode('no-hands');
  await reopenRecords(device);
  await pressRecordControl(device, recordRow('No Hands'));
  await device.wait({ res: controls.noHands });
  await capture('no_hands');
  await pressRecordControl(device, controls.replay);
  await device.wait({ res: 'no-replay-text' });
  await capture('replay_empty');
  await tap(device, 'navigation-bar-back-image');
  await proxy.mode('list');
  await reopenRecords(device);
}

/** 按版本验证尾部或错误场景，确认真实代理请求不为空。
 * @param context - 当前设备、版本、代理和采集入口。
 */
async function recordEnding(context: Context): Promise<void> {
  const { device, proxy, version, capture } = context;
  if (version === 'legacy') await legacyRecordEnd(device, proxy, capture);
  else await v2RecordErrors(device, proxy, capture);
  expect(Object.values((await proxy.status()).recordRequests).reduce((total, count) => total + count, 0)).toBeGreaterThan(0);
}

/** 使用当前版本的真实复选控件选择同一条记录。
 * @param context - 当前战绩会话。
 * @param key - 记录标识。
 * @param name - 房间名称。
 */
async function selectRecord(context: Context, key: string, name: string): Promise<void> {
  const { device, version } = context;
  if (version === 'v2') { await tap(device, `select-record-visual-record-${key}-button`); return; }
  const { bounds } = await device.info(recordRow(name));
  const checkbox = await device.info({ res: 'select-status-button' });
  await device.input.tap({ x: checkbox.bounds.x + checkbox.bounds.width / 2, y: bounds.y + bounds.height / 2 });
}
