import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { playerActionRegion, waitForPlayerActionStart } = require('./texas-support.ts');
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);
const stale = readFileSync(new URL('./fixtures/player-action/raise-start-with-call.png', import.meta.url));
const ready = readFileSync(new URL('texas-player-action-raise-start.png', snapshots));

/** 将原始分区放回其实际屏幕位置，其他像素不参与准备条件。
 * @param crop - 未修改的原始分区。
 */
function screen(crop) {
  const result = new PNG({ width: 720, height: 1280 });
  const part = PNG.sync.read(crop);
  PNG.bitblt(part, result, 0, 0, part.width, part.height, playerActionRegion.x, playerActionRegion.y);
  return PNG.sync.write(result).toString('base64');
}

/** 只替换外部原生帧输入，准备条件及超时继续使用生产实现。
 * @param frames - 设备依次返回的真实分区；最后一帧持续显示。
 * @param options - 采集模式、基准位置和同次采样的目标玩家节点。
 */
function readiness(frames, options = {}) {
  let reads = 0;
  const sampleTimes = [];
  const attachments = [];
  const device = { _connection: {
    /** 返回原始首败画面，随后才完成上一动作退场。 */
    toImpl: () => ({ /** 仅模拟原生截图输入，使用生产准备逻辑。
       * @param method - 驱动截图方法。
       */
      _send: async method => {
        if (method === 'tree') {
          sampleTimes.push(Date.now());
          return { bounds: playerActionRegion, children: options.players?.(reads - 1) || [] };
        }
        assert.equal(method, 'screen');
        return screen(frames[Math.min(reads++, frames.length - 1)]);
      },
    }),
  } };
  const info = {
    config: { updateSnapshots: options.mode || 'none' },
    /** 定位现有已审查基准。
     * @param name - 基准文件名。
     */
    snapshotPath: options.snapshotPath || (name => new URL(name, snapshots).pathname),
    /** 保留生产准备截图。
     * @param name - 附件名称。
     * @param attachment - 原始准备截图。
     */
    attach: async (name, attachment) => attachments.push({ name, ...attachment }),
  };
  return {
    attachments,
    sampleTimes,
    /** 读取准备条件实际拍摄的次数。 */
    reads: () => reads,
    /** 使用生产参数执行准备条件。 */
    run: () => waitForPlayerActionStart(device, info, 'raise', 'target'),
  };
}

test('真实首败仍有 call 标签时不能开始 raise，须等已有起点画面出现', async () => {
  assert.equal(createHash('sha256').update(stale).digest('hex'),
    '7f5bc709b2ce7b76d85dca9338085ca528eacf6025d0152f50a04fe4ab4b2a10');
  const probe = readiness([stale, stale, ready]);
  await probe.run();
  assert.equal(probe.reads(), 3, '不能在旧 call 尚可见的前两次采样后返回');
  assert.equal(probe.attachments[0].name, 'texas-player-action-raise-prepared-start');
  assert.deepEqual(PNG.sync.read(probe.attachments[0].body).data, PNG.sync.read(ready).data);
});

test('旧动作持续可见时超时失败，并保存真实阻塞画面', async () => {
  const probe = readiness([stale]);
  await assert.rejects(probe.run(), /上一玩家动作必须完成退场/);
  assert.ok(probe.reads() > 1);
  assert.deepEqual(PNG.sync.read(probe.attachments[0].body).data, PNG.sync.read(stale).data);
});

test('reference 不读取缺失或过期基准，等待目标玩家全部旧动作消失及画面稳定', async () => {
  /** 构造目标玩家的可见控件树。
   * @param children - 该座位当前动作节点。
   */
  const player = children => ({ res: 'texas-holdem-player-container-target-operating', bounds: playerActionRegion, children });
  const label = { res: 'texas-holdem-player-action-call', bounds: playerActionRegion };
  const probe = readiness([stale, stale, ready], { mode: 'all',
    /** 候选采集不允许查找现有基准。 */
    snapshotPath: () => { throw new Error('reference 不应读取待生成的图片'); },
    // 另一个座位持续保留动作标签；目标座位中的上一轮 call 必须先消失。
    /** 返回同次截图对应的真实语义状态。
     * @param index - 当前截图编号。
     */
    players: index => [player(index < 2 ? [label] : []),
      { ...player([label]), res: 'texas-holdem-player-container-other' }],
  });
  await probe.run();
  assert.ok(probe.reads() >= 4, '旧标签消失后仍须再次采样确认画面稳定');
  assert.ok(probe.sampleTimes.at(-1) - probe.sampleTimes[2] >= 500, '实际画面须连续稳定至少 500ms');
  assert.deepEqual(PNG.sync.read(probe.attachments[0].body).data, PNG.sync.read(ready).data);
});

test('比较模式缺失起点基准仍明确失败，不能降级为 reference 准备条件', async () => {
  const probe = readiness([ready], { /** 明确指向不存在的比较基准。 */
    snapshotPath: () => new URL('./snapshots/local/absent-start.png', import.meta.url).pathname });
  await assert.rejects(probe.run(), /ENOENT/);
  assert.equal(probe.reads(), 0);
});

test('reference 即使画面稳定也不能接受未找到目标玩家或仍有旧动作的状态', { concurrency: 2 }, async context => {
  await Promise.all([[], [{ res: 'texas-holdem-player-container-target', bounds: playerActionRegion,
    children: [{ res: 'texas-holdem-player-action-call', bounds: playerActionRegion }] }]]
    .map((players, index) => context.test(index ? '旧 call 持续存在' : '目标玩家缺失', async () => {
      const probe = readiness([ready], { mode: 'all', /** 持续返回阻塞采集的语义状态。 */ players: () => players });
      await assert.rejects(probe.run(), /上一玩家动作必须完成退场/);
      assert.ok(probe.reads() > 2);
      assert.deepEqual(PNG.sync.read(probe.attachments[0].body).data, PNG.sync.read(ready).data);
    })));
});
