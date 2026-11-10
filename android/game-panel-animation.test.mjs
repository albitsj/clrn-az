import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { loadGameFlow } from './game-flow-fixture.mjs';

const require = createRequire(import.meta.url);
const controls = require('./game-controls.ts');
const diagnostics = require('./game-panel-diagnostics.ts');
const button = 'drawer-menu-item-game_rule';
const target = { res: button, enabled: true, bounds: { x: 120, y: 420, width: 180, height: 60 } };
const moving = { ...target, bounds: { ...target.bounds, y: 380 } };

/** 运行生产动画入口及真实稳定性等待，只替换 ADB 与采集边界。
 * @param options - 可注入即时节点、采集错误和报告故障。
 */
function panelScene(options = {}) {
  const events = [], attachments = [];
  const layouts = options.layouts || [moving, target, target];
  /** 一次即时查询可以返回节点消失，不能用默认值替代 null。 */
  const current = () => Object.hasOwn(options, 'current') ? options.current : target;
  let queries = 0;
  const device = { _connection: { /** 提供 tree、marker 和失败截图命令。 */ toImpl: () => ({
    /** 返回节点，记录查询发生在录制前还是触发时。
     * @param method - 原生命令。
     */
    _send: async method => {
      events.push(method);
      if (method === 'screen') return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
      if (method === 'marker') return current();
      return { bounds: { x: 0, y: 0, width: 720, height: 1280 }, children: [
        layouts[Math.min(queries++, layouts.length - 1)],
        { res: 'private', text: 'SECRET_USER_TOKEN', bounds: target.bounds },
        { text: 'Connecting...', bounds: target.bounds },
      ] };
    },
  }) } };
  /** 记录真实采集前置阶段。
   * @param observe - 生产入口的阶段记录器。
   * @param method - 本次已选定的采样方式。
   */
  const recordStages = (observe, method) => {
    for (const stage of ['start-screenshot-start', 'start-screenshot-complete',
      method === 'videoFrames' ? 'video-recording-start' : 'native-sampling-start']) observe(stage);
  };
  const { animateGamePanel } = loadGameFlow('./game-panel-animation.ts', {
    '@playwright/test': require('@playwright/test'),
    './device': { /** 记录一次真实 ADB 点击。
     * @param args - 点击命令及坐标。
     */
      adb: (...args) => events.push(args),
    },
    './game-controls': { ...controls,
      /** 连接已就绪，不对本测试的布局序列额外查询。 */ gameConnected: async () => {},
      /** 无动画报告时仍使用普通点击。 */ gameTap: async () => events.push('ordinary-tap'),
    },
    './animation-diagnostics': {
      /** 已脱敏日志采集失败也不能覆盖首败。 */
      preserveAnimationFailure: async () => { events.push('preserve-logs'); throw new Error('logs unavailable'); },
    },
    './game-panel-diagnostics': diagnostics,
    './render-diagnostics': require('./render-diagnostics.ts'),
    './animation-transition': {
      /** 模拟录屏就绪后才触发，保持采集接口的真实参数位置。
       * @param args - 生产采集参数。
       */
      captureNativeTransition: async (...args) => {
        events.push('capture');
        recordStages(args[16], args[8]);
        events.push('recording-ready');
        await args[4]();
        if (options.failure) throw options.failure;
        if (args[10]) await args[10]();
      },
    },
  });
  const info = { /** 保存脱敏诊断，或模拟报告写入失败。
   * @param name - 附件名。
   * @param data - 附件载荷。
   */
    attach: async (name, data) => {
      if (options.attachFailure) throw new Error('report unavailable');
      attachments.push([name, data]);
    },
  };
  return { events, attachments,
    /** 执行入口；可选择无动画的普通路径。
     * @param animationInfo - 当前测试报告。
     */
    run: (animationInfo = info) => animateGamePanel(device, 'zhajinhua', 'game-rule', button,
      { x: 130, y: 330, width: 460, height: 610 }, animationInfo, 'enter', options.method),
    /** 读取结构化入口诊断。 */
    trace: () => JSON.parse(attachments.find(([name]) => name.endsWith('-input-trace'))[1].body),
  };
}

test('规则入口在采集前稳定布局，录屏就绪后轻量核对并仅点击一次真实中心', async () => {
  const scene = panelScene();
  await scene.run();
  assert.deepEqual(scene.events.slice(0, 7), ['tree', 'tree', 'tree', 'capture', 'recording-ready', 'marker',
    ['shell', 'input', 'tap', '210', '450']]);
  const trace = scene.trace();
  assert.equal(trace.testID, button);
  assert.deepEqual(trace.events.map(event => event.event), ['target-query-start',
    'target-query-result', 'target-query-result', 'target-query-result', 'start-screenshot-start',
    'start-screenshot-complete', 'video-recording-start', 'trigger-ready', 'final-query-start',
    'final-query-result', 'tap', 'tap-complete']);
  assert.ok(trace.events.every(event => Number.isFinite(event.at)));
  assert.deepEqual(trace.events.find(event => event.event === 'tap').point, { x: 210, y: 450 });
});

for (const [condition, current, message] of [
  ['移动', moving, /不能移动/],
  ['禁用', { ...target, enabled: false }, /仍应可用/],
  ['消失', null, /仍应可见/],
]) {
  test(`录屏准备期间规则入口${condition}时拒绝旧坐标，不重试点击并保留现场`, async () => {
    const scene = panelScene({ current });
    await assert.rejects(scene.run(), message);
    assert.equal(scene.events.some(Array.isArray), false);
    assert.equal(scene.events.filter(event => event === 'marker').length, 1);
    assert.ok(scene.events.includes('preserve-logs'));
    assert.ok(scene.attachments.some(([name, data]) => name.endsWith('-failure-screen') && data.contentType === 'image/png'));
    const state = JSON.parse(scene.attachments.find(([name]) => name.endsWith('-failure-state'))[1].body);
    assert.equal(state.connecting, true);
    assert.equal(state.markers['game-rule-popup'], null);
    assert.deepEqual(state.markers[button].bounds, target.bounds);
    assert.equal(JSON.stringify(scene.attachments).includes('SECRET_USER_TOKEN'), false);
    assert.ok(scene.trace().events.some(event => event.event === 'final-query-result'));
  });
}

test('单次点击没有打开规则弹窗时原样抛出采集错误，不被日志和附件故障覆盖', async () => {
  const failure = new Error('入口点击必须产生足够大的可见变化');
  const scene = panelScene({ failure, attachFailure: true });
  await assert.rejects(scene.run(), error => error === failure);
  assert.equal(scene.events.filter(Array.isArray).length, 1);
});

test('没有动画报告仍走普通点击，不额外录制或查询', async () => {
  const scene = panelScene();
  await scene.run(null);
  assert.deepEqual(scene.events, ['ordinary-tap']);
});

test('连续截图路径在触发时只用已稳定坐标，不向忙碌的驱动追加节点查询', async () => {
  const scene = panelScene({ method: 'motionFrames' });
  await scene.run();
  assert.equal(scene.events.includes('marker'), false);
  assert.equal(scene.events.filter(Array.isArray).length, 1);
  assert.equal(scene.events.slice(scene.events.indexOf('capture')).includes('tree'), false);
});
