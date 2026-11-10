/** 用已审查画面构造延迟响应边界，不冒充首败结束后未采集的真实帧。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { diagnosticSource } from './diagnostics-test-support.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { captureSlotSpin } = require('./slot-spin.ts');
const snapshots = fileURLToPath(new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url));
const start = readFileSync(`${snapshots}slot-currency-diamond-reels-start.png`);
const middle = readFileSync(`${snapshots}slot-currency-diamond-reels-middle.png`);
const end = readFileSync(`${snapshots}slot-currency-diamond-reels-end.png`);
const reels = [143, 287, 431].map(x => ({ x, y: 420, width: 137, height: 362 }));

/** 将已审查裁切嵌回原有屏幕位置，可单独冻结一个转轮作为反例。
 * @param crop - 已审查相位。
 * @param frozen - 必须保持静止的转轮编号。
 */
function screen(crop, frozen) {
  const region = PNG.sync.read(crop);
  if (frozen !== undefined) {
    const x = reels[frozen].x - 124;
    PNG.bitblt(PNG.sync.read(start), region, x, 0, 137, 362, x, 0);
  }
  const full = new PNG({ width: 720, height: 1280 });
  PNG.bitblt(region, full, 0, 0, 469, 362, 124, 420);
  return PNG.sync.write(full);
}

/** 首次报告的 20 帧均静止，后续相位是为验证窗口边界而构造的审查图序列。
 * @param options - 静止或单转轮缺失的反例。
 */
function device(options) {
  let screens = 0;
  const before = screen(start);
  const phases = options.static ? [start, start] : [middle, end];
  const frames = [...Array(20).fill(before), ...phases.map(png => screen(png, options.frozen))]
    .map((png, index) => ({ capturedAt: index * 64, png: png.toString('base64') }));
  return { _connection: { /** 返回真实生产采集函数使用的独立设备边界。 */ toImpl: () => ({
    /** 快速采样耗尽 20 帧后才到达响应，长窗口保留其后的真实相位输入。
     * @param method - 生产函数选定的原生命令。
     */
    _send: async method => {
      if (method === 'screen') return (screens++ === 0 ? before : screen(end)).toString('base64');
      if (method === 'motionFrames') return frames.slice(0, 20);
      assert.equal(method, 'challengeFrames');
      return frames;
    },
  }) } };
}

/** 直接经过正式采集、三转轮检查及原始首尾和中途基准，不替换比较函数。
 * @param options - 本例缺失的运动输入。
 */
async function spin(options = {}) {
  let clicks = 0;
  const info = { /** 测试报告无需落盘。 */ attach: async () => {}, config: { updateSnapshots: 'none' },
    /** 与 Playwright 文件名规范使用同一组正式基准。
     * @param file - 生产函数请求的相位名称。
     */ snapshotPath: file => `${snapshots}${file.replaceAll('_', '-')}` };
  const proxy = { /** 只读失败诊断，不引入新的旋转请求。 */ command: async () => ({ spins: 2, lastSpinAt: 0 }) };
  try {
    await captureSlotSpin(device(options), proxy, 'currency_diamond', info, () => { clicks++; }, reels);
  } finally {
    assert.equal(clicks, 1, '长窗口及诊断不得重触发旋转');
  }
}

test('采样前二十帧静止但随后出现奖励动画，三个转轮和原基准仍须完整通过', async () => {
  await spin();
});

test('延长窗口仍拒绝完全没有转轮运动的静止输入', async () => {
  await assert.rejects(spin({ static: true }), /第 1 个区域必须独立运动/);
});

test('延长窗口不能让其他转轮的运动掩盖任何一个未运动的转轮', async () => {
  for (const frozen of [0, 1, 2]) {
    await assert.rejects(spin({ frozen }), new RegExp(`第 ${frozen + 1} 个区域必须独立运动`));
  }
});

/** 用虚拟竞态表示四十五秒后的编码响应，避免实际等待或修改应用时钟。
 * @param method - 被验证的正式原生命令。
 */
async function encodedResponse(method) {
  let deadline;
  let expire;
  const native = device({});
  const transport = native._connection.toImpl();
  /** 仅替换本例独立设备的响应等待边界。 */
  native._connection.toImpl = () => ({
    /** 在生产命令完成时按先后顺序结算响应与超时。
     * @param command - 生产入口要求的命令。
     */ _send: async command => {
      const frames = await transport._send(command);
      if (command === 'screen') return frames;
      return new Promise(resolve => queueMicrotask(() => {
        if (deadline < 45_000) expire();
        else resolve(frames);
      }));
    },
  });
  /** 只虚拟化等待边界；所有像素比较和业务断言仍执行完整生产逻辑。
   * @param duration - 生产函数请求的等待期限。
   * @param value - 计时器完成值。
   * @param options - 采集超时的中止信号。
   */
  const wait = (duration, value, options) => {
    if (!options?.signal) return Promise.resolve(value);
    deadline = duration;
    return new Promise(resolve => { expire = resolve; });
  };
  const exports = {};
  runInNewContext(diagnosticSource('./animation-transition.ts'), { exports, AbortController, Buffer,
    /** 仅替换外部计时器，其他模块继续使用实际实现。
     * @param name - 生产模块名称。
     */ require: name => name === 'node:timers/promises' ? { setTimeout: wait } : require(name) });
  const info = { /** 虚拟响应测试无需落盘报告。 */ attach: async () => {}, config: { updateSnapshots: 'none' },
    /** 使用与实际转轮比较相同的正式基准。
     * @param file - 生产函数请求的相位文件。
     */ snapshotPath: file => `${snapshots}${file.replaceAll('_', '-')}` };
  await exports.captureNativeTransition(native, 'slot-currency_diamond-reels', info,
    { x: 124, y: 420, width: 469, height: 362 }, () => {}, [], reels, 1, method);
}

test('已有长采样命令的四十五秒编码响应能够完成原始像素检查', async () => {
  await encodedResponse('challengeFrames');
});

test('普通采样仍拒绝超过原有响应边界的编码等待', async () => {
  await assert.rejects(encodedResponse('motionFrames'), /原生动画采样超时/);
});
