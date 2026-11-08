import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { VisualScenario } from '../../../visual/scenarioTypes';
import { captureGame } from '../../game-capture';
import type { ScreenshotMask } from '../../screenshot';
import { gameAnimation } from './games-plan';

const transientMarkers: Record<string, string> = {
  statistics_help: 'toastText1', accurate_raise_minimum_error: 'toastText1',
  prediction_result: 'bet-next-hand-result-amount', prediction_loss: 'bet-next-hand-result-amount',
  prediction_diamond: 'bet-next-hand-result-amount', level_up: 'level-up-title',
  remaining_cards: 'view-community-cards-countdown',
};
const expectedAlerts: Record<string, string> = {
  quit_confirm: 'common-alert-button-quit', alert_retry: 'common-alert-message',
  alert_insufficient_balance: 'common-alert-button-go_to_mall', alert_authentication_failed: 'common-alert-button-quit',
  delay_cooldown_alert: 'common-alert-message',
};

/** 每个状态继续核对共享顺序，截图成功后才推进索引。
 * @param device - 原生设备。
 * @param scenario - 共享场景。
 * @param locale - 当前语言。
 * @param suite - 当前玩法任务。
 * @param states - 当前阶段的完整状态序列。
 * @param testInfo - 当前报告。
 */
export function gameSnapshots(device: AndroidDevice, scenario: VisualScenario, locale: string, suite: string,
  states: string[], testInfo: TestInfo) {
  let index = 0;
  return {
    /** 校验并保存一个状态。
     * @param state - 共享状态名。
     * @param masks - 已检测到的动态区域。
     * @param triggerTransient - 遮罩准备后触发提示。
     */
    async capture(state: string, masks: ScreenshotMask[] = [], triggerTransient?: () => Promise<string | void>): Promise<void> {
      expect(state).toBe(states[index]);
      console.log(`ANDROID > ${suite} 截图状态 ${state}`);
      await captureGame(device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}-${state.replaceAll('_', '-')}`, testInfo,
        transientMarkers[state], expectedAlerts[state], masks, triggerTransient);
      index++;
    },
    /** 英文大厅升级由入场、倒计时、退场帧覆盖，不等待已消失的提示。 */
    complete(): void {
      const timedLevelUp = gameAnimation(scenario, locale) && scenario.pageLabel === 'signed_in_texas_hall';
      expect(index).toBe(states.length - Number(timedLevelUp));
    },
  };
}
