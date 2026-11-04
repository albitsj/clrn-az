/** 执行完整面板流程，确保首次排行榜失败不能被关闭重开或成功截图掩盖。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('./texas-panels.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

/** 只替换设备和场景边界，运行未经裁剪的生产面板流程。
 * @param failureAt - 首次等待容器或业务数据时注入的原始超时。
 */
function panels(failureAt) {
  const failure = new Error('first leaderboard wait timed out');
  const finished = new Error('remaining panels are outside this regression');
  const events = [];
  let failed = false;
  let dataReady = false;
  /** 首次等待失败。 */
  function failOnce() {
    if (!failed) { failed = true; throw failure; }
  }
  const modules = {
    './game-controls': {
      /** 记录真实入口；排行榜之后的页面不在本回归范围内。
       * @param _device - 隔离设备。
       * @param resource - 待点击控件。
       */
      gameTap: async (_device, resource) => {
        if (resource === 'game-record-button') throw finished;
        events.push(['tap', resource]);
      },
      /** 第一次失败后若被重新打开，后续等待会成功，以复现被吞掉的超时。
       * @param _device - 隔离设备。
       * @param resource - 等待的容器或数据。
       * @param text - 必须保持的业务值。
       */
      gameReady: async (_device, resource, text) => {
        events.push(['ready', resource, text]);
        if (resource === failureAt) failOnce();
        if (resource === 'public-leader-board-item-round-0') {
          assert.equal(text, '10');
          dataReady = true;
        }
      },
      /** 不相关面板已经完成退场。 */
      gameGone: async () => {},
    },
    './game-pregame': {
      /** 前置主题页面已完成。 */
      captureGameThemes: async () => {},
      /** 记录关闭时机，失败现场不能被清除。
       * @param _device - 隔离设备。
       * @param resource - 面板容器。
       */
      closeGameMask: async (_device, resource) => { events.push(['close', resource]); },
    },
    './device': { /** 跳过本回归之外的设备权限授权。 */ adb: () => {} },
    './texas-support': { /** 前置房间已就绪。 */ restoreTexas: async () => {} },
    './game-panel-animation': { /** 前置语音动画已完成。 */ animateGamePanel: async () => {} },
  };
  const exports = {};
  runInNewContext(source, { exports, /** 仅提供隔离的外部边界。
     * @param name - 生产模块名称。
     */
    require: name => modules[name] || {},
  });
  return { failure, finished, events,
    /** 运行完整的生产函数，截图仍受真实流程的等待结果控制。 */
    run: () => exports.texasPanels({ device: {}, /** 记录截图交付结果。
       * @param state - 当前视觉状态。
       */
      capture: async state => {
        if (state === 'leaderboard_players') assert.equal(dataReady, true);
        events.push(['capture', state]);
      },
    }),
  };
}

for (const resource of ['public-leader-board-container', 'public-leader-board-item-round-0']) {
  test(`排行榜首次 ${resource} 超时须原样失败，即使重开后可以成功`, async () => {
    const probe = panels(resource);
    await assert.rejects(probe.run(), error => error === probe.failure);
    assert.equal(probe.events.filter(event => event[0] === 'tap'
      && event[1] === 'texas-holdem-leaderboard-button').length, 1);
    assert.equal(probe.events.some(event => event[0] === 'close'), false);
    assert.equal(probe.events.some(event => event[0] === 'capture' && event[1] === 'leaderboard_players'), false);
  });
}

test('排行榜首次成功须等到业务值 10，截图完成后再关闭面板', async () => {
  const probe = panels();
  await assert.rejects(probe.run(), error => error === probe.finished);
  const start = probe.events.findIndex(event => event[1] === 'texas-holdem-leaderboard-button');
  assert.deepEqual(probe.events.slice(start), [
    ['tap', 'texas-holdem-leaderboard-button'],
    ['ready', 'public-leader-board-container', undefined],
    ['ready', 'public-leader-board-item-round-0', '10'],
    ['capture', 'leaderboard_players'],
    ['close', 'public-leader-board-container'],
  ]);
});
