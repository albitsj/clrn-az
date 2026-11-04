import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { addGameMasks } = require('./game-capture-masks.ts');
const presentation = require('../visual/fixtures/game-presentation.json');
const bounds = { x: 100, y: 200, width: 48, height: 40 };

for (const res of ['texas-holdem-room-id-text', 'zhajinhua-room-id-text']) {
  test(`${res} 的展示房号必须与共享夹具一致且不遮罩`, () => {
    const masks = [];
    addGameMasks([{ res, bounds, text: presentation.roomNumber }], [], masks);
    assert.deepEqual(masks, []);
    assert.throws(() => addGameMasks([{ res, bounds, text: 'unexpected-room' }], [], []), /房号展示/);
  });
}

const cases = [
  ['seat-guide-1', '', { x: 99, y: 199, width: 50, height: 64, reason: 'seat-guide-1 完整箭头动画范围' }],
  ['texas-holdem-active-countdown', '', { x: 98, y: 198, width: 52, height: 44, reason: 'texas-holdem-active-countdown 含两像素绘制边缘' }],
  ['zhajinhua-active-countdown', '', { x: 98, y: 198, width: 52, height: 44, reason: 'zhajinhua-active-countdown 含两像素绘制边缘' }],
  ['seat-progress-pie', '', { x: 98, y: 198, width: 52, height: 44, reason: 'seat-progress-pie 含两像素绘制边缘' }],
  ['view-community-cards-countdown', '9', { x: 76, y: 200, width: 96, height: 40, reason: 'view-community-cards-countdown' }],
  ['game-network-proxy-code', '64', { ...bounds, reason: 'game-network-proxy-code' }],
  ['countdown_timer_text', '12s', { ...bounds, reason: 'countdown_timer_text' }],
  [undefined, '02:30', { ...bounds, reason: '保座或加时冷却倒计时' }],
  [undefined, '12345678-abcd-abcd-abcd-123456789abc', { ...bounds, reason: '本轮真实房间 UUID' }],
  ['player-profile-id', '12345', { ...bounds, reason: 'player-profile-id' }],
];
for (const [res, text, expected] of cases) {
  test(`动态遮罩保留真实几何和诊断原因：${res} ${text}`, () => {
    const masks = [];
    addGameMasks([{ res, text, bounds }], [], masks);
    assert.deepEqual(masks, [expected]);
  });
}

test('已登记控件命中后停止分派，异常 UUID 和倒计时仍报错', () => {
  const masks = [];
  addGameMasks([{ res: 'leader-board-room-id', bounds, text: '12345678-abcd-abcd-abcd-123456789abc' }], [], masks);
  assert.deepEqual(masks, [{ ...bounds, x: -96, width: 440, reason: 'leader-board-room-id' }]);
  assert.throws(() => addGameMasks([{ res: 'leader-board-room-id', bounds, text: 'bad' }], [], []));
  assert.throws(() => addGameMasks([{ res: 'view-community-cards-countdown', bounds, text: 'time' }], [], []), /公共牌倒计时/);
});

test('前景自身动态文字仍被遮罩，背景倒计时不能覆盖面板内容', () => {
  const source = { res: 'game-network-proxy-code', bounds };
  const panel = { bounds: { x: 90, y: 190, width: 100, height: 100 }, children: [source] };
  const ownMasks = [];
  addGameMasks([source], [panel], ownMasks);
  assert.deepEqual(ownMasks, [{ ...bounds, reason: source.res }]);
  const backMasks = [];
  addGameMasks([{ ...source }], [panel], backMasks);
  assert.deepEqual(backMasks, []);
});

for (const [res, text] of [['plain-label', '12345'], ['countdown_timer_text', 'hello'],
  ['plain-label', '12345678-abcd-abcd-abcd-123456789abc']]) {
  test(`未登记的静态内容保持比较：${res} ${text}`, () => {
    const masks = [];
    addGameMasks([{ res, text, bounds }], [], masks);
    assert.deepEqual(masks, []);
  });
}
