import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { flattenNodes, gameNodes, gameNodesWithin, gameSemanticText, gameTextWithin, gameTap, gameTapTarget } = require('./game-controls.ts');

test('原生控件树保留重复 ID，忽略屏外历史面板但不忽略可见子节点', () => {
  const root = { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: [
    { res: 'seat', bounds: { x: 10, y: 20, width: 40, height: 40 } },
    { res: 'seat', bounds: { x: 110, y: 20, width: 40, height: 40 } },
    { res: 'old-popup', bounds: { x: 0, y: 1300, width: 720, height: -20 } },
    { res: 'flattened-parent', bounds: { x: 0, y: 0, width: 0, height: 0 }, children: [
      { res: 'visible-child', bounds: { x: 20, y: 20, width: 40, height: 40 } },
    ] },
  ] };
  assert.deepEqual(flattenNodes(root).map(node => node.res), [undefined, 'seat', 'seat', 'visible-child']);
});

test('摊牌余额读取当前玩家的嵌套语义标记，不依赖被牌型覆盖的可见文字', () => {
  const own = { res: 'self', bounds: { x: 200, y: 1000, width: 100, height: 180 }, children: [
    { bounds: { x: 200, y: 1150, width: 100, height: 30 }, children: [
      { res: 'player_stack_text', text: 'self 1120', bounds: { x: 200, y: 1150, width: -1, height: 0 } },
    ] },
  ] };
  assert.equal(flattenNodes(own).some(node => node.res === 'player_stack_text'), false);
  assert.equal(gameSemanticText(own, 'player_stack_text'), 'self 1120');
  assert.equal(gameSemanticText(own, 'missing-marker'), undefined);
  assert.equal(gameSemanticText(undefined, 'player_stack_text'), undefined);
});

test('控件树驱动协议变更和断连必须失败，不能当作空页面', async () => {
  for (const result of [{}, { bounds: {} }]) {
    await assert.rejects(gameNodes({ _connection: {
      /** 模拟固定版本驱动的不完整响应。 */
      toImpl: () => ({ /** 返回损坏的控件树。 */ _send: async () => result }),
    } }), /完整控件树/);
  }
  await assert.rejects(gameNodes({ _connection: {
    /** 模拟原生连接失败。 */
    toImpl: () => ({ /** 传播断连异常。 */ _send: async () => { throw new Error('Device closed'); } }),
  } }), /Device closed/);
});

test('Fabric 压平聊天文字为兄弟节点时仍按消息行边界严格校验内容', () => {
  const row = { res: 'message', bounds: { x: 39, y: 1013, width: 642, height: 44 } };
  const text = { text: 'Player1: Good hand!', bounds: { x: 39, y: 1017, width: 241, height: 36 } };
  const other = { text: 'Other row', bounds: { x: 39, y: 1060, width: 200, height: 36 } };
  assert.deepEqual(gameTextWithin([row, text, other], 'message'), ['Player1: Good hand!']);
  assert.deepEqual(gameTextWithin([text, other], 'message'), []);
  assert.deepEqual(gameTextWithin([row, other], 'message'), []);
  const card = { res: 'card', bounds: { x: 100, y: 1017, width: 20, height: 30 } };
  const behind = { res: 'card', bounds: { x: 100, y: 1100, width: 20, height: 30 } };
  assert.deepEqual(gameNodesWithin([row, card, behind], 'message').filter(node => node.res === 'card'), [card]);
});

test('无响应的原生驱动在查询超时后失败，留出用例清理时间', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const query = gameNodes({ _connection: {
    /** 模拟已连接但不返回响应的原生驱动。 */
    toImpl: () => ({ /** 持续等待响应。 */ _send: () => new Promise(() => {}) }),
  } });
  const rejected = assert.rejects(query, /超过 30 秒/);
  context.mock.timers.tick(30_000);
  await rejected;
});

test('遍历中的两类瞬时异常重读完整树，保持原有五次读取上限', async () => {
  const root = { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: [] };
  let calls = 0;
  const device = { _connection: { /** 返回同一原生连接。 */ toImpl: () => ({
    /** 前两次模拟真实转场移除节点，第三次返回完整树。 */
    _send: async () => {
      calls++;
      if (calls < 3) throw new Error('StaleObjectException');
      return root;
    },
  }) } };
  assert.deepEqual(await gameNodes(device), [root]);
  assert.equal(calls, 3);
  let failures = 0;
  const failure = new Error('NullPointerException');
  await assert.rejects(gameNodes({ _connection: { /** 返回持续失败的原生连接。 */ toImpl: () => ({
    /** 每次都传播相同的遍历异常。 */ _send: async () => { failures++; throw failure; },
  }) } }), failure);
  assert.equal(failures, 5);
});

test('命中第一个语义标记后立即停止，不读取后续兄弟子树', () => {
  const bounds = { x: 0, y: 0, width: 10, height: 10 };
  const unused = { bounds, /** 命中后不能继续访问此树。 */ get children() { throw new Error('unexpected traversal'); } };
  const root = { bounds, children: [{ res: 'target', text: '', bounds }, unused] };
  assert.equal(gameSemanticText(root, 'target'), '');
});

/** 按顺序提供真实树协议响应，验证稳定性等待，不替换被测轮询。
 * @param states - 连续查询中的入口节点，undefined 表示消失。
 */
function targetSequence(states) {
  let queries = 0;
  const device = { _connection: { /** 返回原生查询边界。 */ toImpl: () => ({
    /** 每次读取返回下一次布局状态。 */
    _send: async () => {
      const target = states[Math.min(queries++, states.length - 1)];
      return { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: target ? [target] : [] };
    },
  }) } };
  return { device, /** 已执行查询次数。 */ queries: () => queries };
}

const targetA = { res: 'entry', enabled: true, bounds: { x: 100, y: 300, width: 120, height: 40 } };
const targetB = { ...targetA, bounds: { ...targetA.bounds, y: 400 } };
for (const [condition, states] of [
  ['布局改变', [targetA, targetB, targetB]],
  ['禁用后恢复', [targetA, { ...targetA, enabled: false }, targetA, targetA]],
  ['消失后恢复', [targetA, undefined, targetA, targetA]],
]) {
  test(`点击前${condition}必须重新获得连续两次可用且一致的边界`, async () => {
    const scene = targetSequence(states);
    const observations = [];
    const result = await gameTapTarget(scene.device, 'entry', node => observations.push(node));
    assert.deepEqual(result, states.at(-1));
    assert.equal(scene.queries(), states.length);
    assert.equal(observations.length, states.length);
  });
}

test('未提供 enabled 的旧版节点保持兼容，仍须两次布局一致', async () => {
  const target = { res: 'entry', bounds: targetA.bounds };
  const scene = targetSequence([target, target]);
  assert.deepEqual(await gameTapTarget(scene.device, 'entry'), target);
  assert.equal(scene.queries(), 2);
});

test('普通点击也复用稳定性检查，只向最终节点中心发送一次输入', async () => {
  const scene = targetSequence([targetA, targetA, targetB, targetB]);
  const clicks = [];
  scene.device.input = { /** 保存原生点击坐标。
   * @param point - 真实入口中心。
   */ tap: async point => clicks.push(point) };
  await gameTap(scene.device, 'entry', true);
  assert.equal(scene.queries(), 4);
  assert.deepEqual(clicks, [{ x: 160, y: 420 }]);
});
