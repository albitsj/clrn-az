import { test } from '@playwright/test';
import { buildScenarios } from '../../visual/scenarios';
import { withAndroidProxy } from '../proxy';
import { runRecordCase } from './support/records-case';

const locale = process.env.ANDROID_LOCALE || 'en';
const enabled = ['all', 'records'].includes(process.env.ANDROID_GROUP || 'all');
for (const scenario of enabled ? buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: 'app' })
  .filter(item => item.group === 'game-record' && item.viewport.label === 'mobile') : []) {
  test(`${locale} / game-record / ${scenario.pageLabel}`, async ({}, testInfo) => {
    test.setTimeout(900_000);
    await withAndroidProxy(connection => runRecordCase(connection, scenario, locale, testInfo), 'records');
  });
}
