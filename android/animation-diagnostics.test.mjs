/** 验证首次动画失败在后续日志轮转后仍有独立附件，且诊断不能替换原错误。 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { preserveAnimationFailure } = require('./animation-diagnostics.ts');
const source = ts.transpileModule(readFileSync(new URL('./game-panel-animation.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

/** 在真实文件与附件边界运行完整面板函数，只替换设备和失败输入。
 * @param directory - 本轮已有采集日志的位置。
 * @param failure - 原采集入口的结果，未指定时正常完成。
 * @param attach - 实际保存附件的边界。
 */
function panel(directory, failure, attach) {
  const modules = {
    './game-controls': {
      /** 入口已可操作。 */ gameConnected: async () => {},
      /** 返回真实入口所需的设备边界。 */ gameReady: async () => ({ bounds: { x: 0, y: 0, width: 10, height: 10 } }),
      /** 动画入口的两次布局查询已经一致。 */ gameTapTarget: async () => ({ bounds: { x: 0, y: 0, width: 10, height: 10 } }),
    },
    './game-panel-diagnostics': require('./game-panel-diagnostics.ts'),
    './device': { /** 设备点击已完成。 */ adb: () => {} },
    './animation-transition': { /** 保留原入口的成功或失败，不更改其结果。 */
      captureNativeTransition: async () => { if (failure) throw failure; },
    },
    './animation-diagnostics': { /** 仅定位隔离日志，复制及附加继续执行生产逻辑。
       * @param name - 转场名称。
       * @param startedAt - 实际采集开始时间。
       * @param info - 本次报告。
       */
      preserveAnimationFailure: (name, startedAt, info) => preserveAnimationFailure(name, startedAt, info, directory),
    },
  };
  const exports = {};
  runInNewContext(source, { exports, Date, /** 提供设备边界与实际诊断实现。
     * @param name - 生产模块名称。
     */ require: name => modules[name] });
  return (game = 'texas-holdem', name = 'chat', phase = 'enter') => exports.animateGamePanel(
    {}, game, name, 'chat-button', {}, { attach }, phase, 'videoFrames');
}

test('聊天首败立即固定现有脱敏日志，重试轮转后仍保留失败窗口及原始错误', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-animation-diagnostics-'));
  try {
    const originals = new Map(['logcat.log.1', 'logcat.log', 'adb.log', 'host.log', 'lifecycle.log']
      .map(file => [file, Buffer.from(`2026-11-04T10:39:47.374+00:00 ${file} first failure [REDACTED]\n`)]));
    for (const [file, bytes] of originals) writeFileSync(path.join(directory, file), bytes);
    const attachments = new Map();
    const failure = new Error('必须采到起点和终点之间的真实动画帧');
    const startedAt = Date.now();
    const run = panel(directory, failure, async (name, value) => attachments.set(name, value.body));
    await assert.rejects(run(), error => error === failure);
    const prefix = 'texas-holdem-chat-enter-diagnostics-';
    for (const [file, bytes] of originals) {
      writeFileSync(path.join(directory, file), 'later attempt, failure window already rotated away\n');
      assert.deepEqual(attachments.get(prefix + file), bytes);
      assert.notDeepEqual(attachments.get(prefix + file), readFileSync(path.join(directory, file)));
    }
    const window = JSON.parse(attachments.get(prefix + 'window'));
    assert.ok(window.startedAt >= startedAt && window.capturedAt >= window.startedAt);
    assert.equal(window.logs.length, 8);
    assert.deepEqual(window.logs.filter(log => log.status === 'attached').map(log => log.file), [...originals.keys()]);
    assert.deepEqual(window.logs.filter(log => log.status === 'unavailable').map(log => log.file),
      ['adb.log.1', 'host.log.1', 'lifecycle.log.1']);
    assert.equal(JSON.stringify(window).includes(directory), false);
    const count = attachments.size;
    for (const args of [['texas-holdem', 'chat', 'exit'], ['zhajinhua', 'chat']]) {
      await assert.rejects(run(...args), error => error === failure);
    }
    await panel(directory, undefined, async () => { throw new Error('成功路径不应收集首败诊断'); })();
    assert.equal(attachments.size, count, '其他转场和正常采集不增加此项诊断');
    await assert.rejects(run('texas-holdem', 'voice'), error => error === failure);
    for (const file of originals.keys()) {
      assert.deepEqual(attachments.get(`texas-holdem-voice-enter-diagnostics-${file}`), readFileSync(path.join(directory, file)));
    }
    assert.ok(attachments.has('texas-holdem-voice-enter-diagnostics-window'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('日志缺失或报告写入失败仍抛出原始动画错误，不将诊断异常或凭据写入附件', async () => {
  const failure = new Error('动画中途帧的实际画面须接近已审查轨迹');
  const attachments = [];
  const run = panel('/missing-animation-diagnostics', failure, async (name, value) => {
    attachments.push({ name, body: value.body });
  });
  await assert.rejects(run(), error => error === failure);
  const window = JSON.parse(attachments[0].body);
  assert.equal(window.logs.every(log => log.status === 'unavailable'), true);
  await assert.rejects(panel('/missing-animation-diagnostics', failure, async () => {
    throw new Error('report write failed token=private-diagnostic-token');
  })(), error => error === failure);
  assert.equal(JSON.stringify(attachments).includes('private-diagnostic-token'), false);
});
