import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildScenarios } = require('../../../visual/scenarios.ts');
const { gameParts, gameStates, gameLabel, gameLaunchOptions } = require('./games-plan.ts');

for (const [suite, page, parts] of [
  ['texas', 'signed_in_texas_pre_game', ['first', 'middle', 'second']],
  ['texas', 'signed_in_texas_game', ['table', 'effects', 'profiles']],
  ['zhajinhua', 'signed_in_zhajinhua_pre_game', ['first', 'second']],
  ['zhajinhua', 'signed_in_zhajinhua_game', ['table', 'effects']],
]) {
  test(`${page}：分段保留共享状态的完整顺序，中文仍执行完整场景`, () => {
    const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SCOPE: 'full', VISUAL_SUITE: suite })
      .find(item => item.pageLabel === page && item.viewport.label === 'mobile');
    assert.deepEqual(gameParts(scenario, 'en'), parts);
    assert.deepEqual(parts.flatMap(part => gameStates(scenario, part)), scenario.snapshotStates);
    assert.deepEqual(gameParts(scenario, 'zh-Hans'), ['all']);
    assert.deepEqual(gameParts(scenario, 'zh-Hant'), ['all']);
    assert.deepEqual(gameStates(scenario, 'all'), scenario.snapshotStates);
    assert.equal(gameLabel(scenario, parts[0]), `${page}_${parts[0]}`);
    assert.equal(gameLabel(scenario, 'all'), page);
    assert.deepEqual(gameLaunchOptions(scenario, 'en'), { gameDriver: true, enableSystemAnimations: true });
    assert.deepEqual(gameLaunchOptions(scenario, 'zh-Hans'), { gameDriver: true, enableSystemAnimations: false });
  });
}

test('可选开局和专项面板保持原有完整流程与动画选择', () => {
  const optional = { pageLabel: 'signed_in_texas_optional_pre_game', snapshotStates: ['one', 'two'] };
  assert.deepEqual(gameParts(optional, 'en'), ['all']);
  assert.deepEqual(gameStates(optional, 'all'), ['one', 'two']);
  assert.equal(gameLaunchOptions(optional, 'en').enableSystemAnimations, true);
  for (const pageLabel of ['signed_in_texas_hall', 'signed_in_texas_panels', 'signed_in_texas_panel_variants']) {
    assert.equal(gameLaunchOptions({ pageLabel }, 'en').enableSystemAnimations, true);
  }
  assert.equal(gameLaunchOptions({ pageLabel: 'signed_in_texas_hall_variants' }, 'en').enableSystemAnimations, false);
});
