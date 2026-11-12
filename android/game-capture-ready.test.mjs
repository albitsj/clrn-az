import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const masksModule = require('./game-capture-masks.ts');
const panelsModule = require('./game-masks.ts');
const panel = { res: 'auto-rebuy-popup', bounds: { x: 20, y: 410, width: 680, height: 460 } };
const ping = { res: 'ping-screen-container', bounds: { x: 600, y: 66, width: 120, height: 140 } };
const name = 'zh-Hant-signed-in-texas-game-preflop';

/** 复用 f666940 的设备边界回放，覆盖本轮 preflop 缺少网络节点的树序列，使用真实遮罩规则。
 * @param trees - 依次返回的原生树。
 * @param compared - 最终比较时实际使用的遮罩。
 */
function captureWithTrees(trees, compared) {
  let reads = 0;
  const { captureGame } = loadGameFlow('./game-capture.ts', {
    '@playwright/test': { expect },
    './device': {
      /** 记录普通截图边界，不执行设备采样。
       * @param args - 原样传入的比较参数。
       */
      compareScreenshot: async (...args) => { compared.push(args[3]); },
    },
    './game-animation': {}, './game-transient': {}, './loop-animation': {}, './loop-keyframes': {},
    './game-capture-masks': masksModule,
    './game-masks': panelsModule,
    './game-controls': {
      /** 此重放没有房间重连。 */ gameConnected: async () => {},
      /** 按顺序返回树，耗尽后保持最后一棵。 */
      gameNodes: async () => trees[Math.min(reads++, trees.length - 1)],
    },
  });
  return {
    /** 使用真实普通截图流程与就绪轮询。
     * @param captureName - 当前场景名。
     */
    run: captureName => captureGame({}, captureName, { /** 不写报告。 */ attach: async () => {} }),
    /** 返回实际查询次数。 */ reads: () => reads,
  };
}

test('本轮 preflop 面板边界稳定仍须等到同一次树读取包含网络遮罩来源', async () => {
  const compared = [];
  const flow = captureWithTrees([[panel], [panel], [panel], [panel, ping]], compared);
  await flow.run(name);
  assert.ok(flow.reads() >= 5);
  assert.deepEqual(compared, [[{
    x: 610, y: 146, width: 100, height: 48, reason: '网络延迟数值、图标与前后端延迟比例条',
  }]]);
});

test('没有网络节点要求的其他截图保持原有面板就绪路径', async () => {
  const compared = [];
  const flow = captureWithTrees([[panel]], compared);
  await flow.run('zh-Hans-signed-in-texas-hall-auto-rebuy');
  assert.equal(flow.reads(), 3);
  assert.deepEqual(compared, [[]]);
});
