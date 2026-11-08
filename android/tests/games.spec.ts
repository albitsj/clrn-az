import { test as base } from '@playwright/test';
import { buildScenarios } from '../../visual/scenarios';
import { deletePrivateGameRoom, type RoomSession } from '../../visual/cases/_shared/room';
import { withAndroidProxy } from '../proxy';
import { gameLabel, gameParts } from './support/games-plan';
import { runGameCase } from './support/games-case';

const test = base.extend<{ ownedRoom: { value: RoomSession | null } }>({
  /**
   * 独立于用例正文的收尾阶段，确保整例超时后仍清理已登记房间。
   * @param use - 将本轮房间登记容器交给用例，并等待框架进入收尾阶段。
   */
  ownedRoom: async ({}, use) => {
    const ownedRoom: { value: RoomSession | null } = { value: null };
    try { await use(ownedRoom); }
    finally { if (ownedRoom.value) await deletePrivateGameRoom(ownedRoom.value); }
  },
});

const locale = process.env.ANDROID_LOCALE || 'en';
for (const [suite, game] of [['texas', 'texas-holdem'], ['zhajinhua', 'zhajinhua']] as const) {
  const enabled = ['all', suite].includes(process.env.ANDROID_GROUP || 'all');
  const scenarios = enabled ? buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: suite })
    .filter(scenario => scenario.viewport.label === 'mobile') : [];
  for (const scenario of scenarios) {
    for (const part of gameParts(scenario, locale)) {
      test(`${locale} / ${suite} / ${gameLabel(scenario, part)}`, async ({ ownedRoom }, testInfo) => {
        test.setTimeout(1_200_000);
        await withAndroidProxy(proxy => runGameCase(proxy, { scenario, suite, game, part, locale, ownedRoom, testInfo }), game);
      });
    }
  }
}
