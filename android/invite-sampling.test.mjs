import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { captureNativeTransition } = require('./animation-transition.ts');
const snapshots = new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url);
const inviteBounds = { x: 0, y: 820, width: 720, height: 460 };
const scenes = [
  { name: 'invite-friends-enter', bounds: inviteBounds, method: 'motionFrames' },
  { name: 'invite-friends-exit', bounds: inviteBounds, method: 'motionFrames' },
  { name: 'zhajinhua-chat-enter', bounds: { x: 110, y: 860, width: 140, height: 310 }, method: 'videoFrames' },
];

/** 用原有审查图替换设备边界，首尾仍返回真实尺寸的整屏输入。
 * @param scene - 真实动效名称和是否保留中间相位。
 */
function setup(scene) {
  const { bounds } = scene;
  const pictures = ['start', 'middle', 'end'].map(phase => readFileSync(new URL(`${scene.name}-${phase}.png`, snapshots)));
  const screens = [pictures[0], pictures[2]].map(bytes => {
    const picture = PNG.sync.read(bytes), screen = new PNG({ width: 720, height: 1280 });
    PNG.bitblt(picture, screen, 0, 0, picture.width, picture.height, bounds.x, bounds.y);
    return PNG.sync.write(screen).toString('base64');
  });
  let screenIndex = 0;
  const methods = [];
  const frames = scene.middle ? pictures : [pictures[0], pictures[0], pictures[2]];
  const device = { _connection: { /** 返回当前用例的原生设备边界。 */ toImpl: () => ({
    /** 确认区域协议及坐标，只有首尾查询返回整屏。
     * @param method - 实际原生调用。
     * @param params - 现有比较区域。
     */
    _send: async (method, params) => {
      methods.push(method);
      if (method === 'screen') return screens[screenIndex++];
      assert.equal(method, 'panelFrames');
      assert.deepEqual(params, { regions: [bounds] });
      return frames.map((bytes, index) => ({ capturedAt: 1000 + index * 24, regions: [bytes.toString('base64')] }));
    },
  }) } };
  const attachments = new Map();
  const info = { config: { updateSnapshots: 'none' }, /** 保留实际比较输入。
    * @param name - 附件名。
    * @param value - 附件内容。
    */ attach: async (name, value) => attachments.set(name, value.body),
  /** 只读取既有唯一基准。
   * @param file - 原有基准文件名。
   */ snapshotPath: file => fileURLToPath(new URL(file, snapshots)) };
  return { device, info, attachments, methods };
}

for (const scene of scenes) {
  for (const middle of [true, false]) {
    test(`${scene.name} 区域采样${middle ? '保留原中间帧门禁' : '仍拒绝只有首尾的跳变'}`, async () => {
      const { name, bounds, method } = scene;
      const capture = setup({ ...scene, middle });
      let triggers = 0;
      const pending = captureNativeTransition(capture.device, name, capture.info, bounds,
        /** 每次采集只点击一个正式入口。 */ () => { triggers++; }, [], [], 0, method);
      if (middle) await pending;
      else await assert.rejects(pending, /必须采到起点和终点之间的真实动画帧/);
      assert.equal(triggers, 1);
      assert.deepEqual(capture.methods, ['screen', 'panelFrames', 'screen']);
      assert.deepEqual(JSON.parse(capture.attachments.get(`${name}-timeline`)), [1000, 1024, 1048]);
    });
  }
}
