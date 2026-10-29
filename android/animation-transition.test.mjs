/** 验证转场采集的真实相位比较及延迟边界解析，防止完整首尾截图被错误裁切。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { assertReviewedVideoMiddle, captureNativeTransition, middleCandidates } =
  require('./animation-transition.ts');
const { gamePanelSamplingMethod } = require('./game-panel-animation.ts');
const snapshots = fileURLToPath(new URL('./snapshots/android-35-x86_64-720x1280-en/', import.meta.url));
const name = 'club-more-enter';
const start = readFileSync(`${snapshots}${name}-start.png`);
const middle = readFileSync(`${snapshots}${name}-middle.png`);
const end = readFileSync(`${snapshots}${name}-end.png`);
const { width, height } = PNG.sync.read(start);

/**
 * 用真实已审查截图模拟原生驱动，保留完整的采样与基准比较流程。
 * @param frames - 原生驱动返回的时间线。
 * @param scene - 使用已审查的具体转场画面。
 */
async function compare(frames, scene = { name, start, end, width, height }) {
  let screens = 0;
  const device = { _connection: { /** 返回本例的模拟原生驱动。 */ toImpl: () => ({
    /** 按驱动命令返回屏幕或连续帧。
     * @param method - 原生驱动命令。
     */
    _send: async method => method === 'screen'
      ? (screens++ === 0 ? scene.start : scene.end).toString('base64')
      : frames.map((png, index) => ({ capturedAt: scene.timestamps?.[index] ?? index * 100,
        png: png.toString('base64') })),
  }) } };
  const info = { /** 测试无需保留附件。 */ attach: async () => {}, config: { updateSnapshots: 'none' },
    /** 映射到已审查的本地基准。
     * @param file - 基准文件名。
     */
    snapshotPath: file => `${snapshots}${file}` };
  await captureNativeTransition(device, scene.name, info,
    { x: 0, y: 0, width: scene.width, height: scene.height }, () => {},
    [], [], 0, 'motionFrames', undefined, undefined, scene.anchors || []);
}

test('真实俱乐部菜单中途关键帧通过转场视觉回归', async () => {
  await compare([start, middle, end]);
});

test('整块画面闪烁不能冒充菜单淡入，即使真实起点和终点仍匹配', async () => {
  const flash = PNG.sync.read(start);
  for (let offset = 0; offset < flash.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      flash.data[offset + channel] = Math.min(255, flash.data[offset + channel] + 20);
    }
  }
  await assert.rejects(compare([start, PNG.sync.write(flash), end]), /动画中途帧的实际画面须接近已审查轨迹/);
});

test('起点直接跳到终点不能冒充菜单淡入', async () => {
  await assert.rejects(compare([start, start, end]), /必须采到起点和终点之间的真实动画帧/);
});

test('真实后期弹窗相位仍能通过非录屏视觉回归', async () => {
  const sceneName = 'texas-holdem-buy-in-applications-enter';
  const sceneStart = readFileSync(`${snapshots}${sceneName}-start.png`);
  const sceneEnd = readFileSync(`${snapshots}${sceneName}-end.png`);
  const late = readFileSync(`${snapshots}${sceneName}-late-phase.png`);
  const size = PNG.sync.read(sceneStart);
  await compare([sceneStart, late, sceneEnd], { name: sceneName,
    start: sceneStart, end: sceneEnd, width: size.width, height: size.height });
});

// 历史报告的完整 20 帧及设备时间戳，夹具图片仅是原始输入，不能作为正式基准。
const fixtureRoot = new URL('./fixtures/buy-in-applications/', import.meta.url);
const historical = JSON.parse(readFileSync(new URL('timelines.json', fixtureRoot), 'utf8'));
const buyInName = historical.name;
const buyInStart = readFileSync(`${snapshots}${buyInName}-start.png`);
const buyInEnd = readFileSync(`${snapshots}${buyInName}-end.png`);
const buyInSize = PNG.sync.read(buyInStart);
const buyInScene = { name: buyInName, start: buyInStart, end: buyInEnd,
  width: buyInSize.width, height: buyInSize.height };

/** 读取原始帧，复用字节相同的既有基准，避免重复保存。
 * @param file - 数据清单中的帧路径。
 */
function historicalFrame(file) {
  return readFileSync(file.startsWith('snapshots/')
    ? `${snapshots}${file.slice('snapshots/'.length)}` : new URL(file, fixtureRoot));
}

test('带入审核入场预先选择连续录屏，其他面板和退场沿用指定方式', () => {
  assert.equal(gamePanelSamplingMethod('texas-holdem', 'buy-in-applications', 'enter', 'motionFrames'), 'videoFrames');
  assert.equal(gamePanelSamplingMethod('texas-holdem', 'buy-in-applications', 'exit', 'motionFrames'), 'motionFrames');
  assert.equal(gamePanelSamplingMethod('texas-holdem', 'leaderboard', 'enter', 'motionFrames'), 'motionFrames');
  assert.equal(gamePanelSamplingMethod('zhajinhua', 'buy-in-applications', 'enter', 'videoFrames'), 'videoFrames');
});

for (const record of historical.records) {
  test(`带入审核 ${record.phase} retry${record.retry} 完整原始轨迹重放`, async () => {
    assert.equal(record.frames.length, 20);
    const frames = record.frames.map(([, file]) => historicalFrame(file));
    const scene = { ...buyInScene, timestamps: record.frames.map(([time]) => time) };
    if (record.originalStatus === 'failed') {
      // 保留首败的可复现反证；仅有早期参考时仍须原样失败。
      await assert.rejects(compare(frames, scene), /36\.50041134751773/);
      // 只替换设备采集输入，执行生产录屏路径；仍仅使用原有早期主图。
      await compareRecordedVideo(buyInName, frames);
    } else await compare(frames, scene);
  });
}

/** 按像素制造整体亮度故障，仍保留真实首尾以验证中途断言。
 * @param amount - 每个颜色通道的偏移。
 */
function buyInFlash(amount) {
  const image = PNG.sync.read(buyInStart);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      image.data[offset + channel] = Math.max(0, Math.min(255, image.data[offset + channel] + amount));
    }
  }
  return PNG.sync.write(image);
}

for (const brightness of [-40, 20, 255]) {
  test(`带入审核录屏路径拒绝 ${brightness} 亮度闪屏`, async () => {
    await assert.rejects(compareRecordedVideo(buyInName, [buyInStart, buyInFlash(brightness), buyInEnd]),
      /动画中途帧的实际画面须接近已审查轨迹/);
  });
}

test('带入审核录屏路径拒绝静止画面', async () => {
  await assert.rejects(compareRecordedVideo(buyInName, Array(20).fill(buyInStart)), /录屏结束时动画必须完成/);
});

test('带入审核录屏路径拒绝直接跳到终点', async () => {
  await assert.rejects(compareRecordedVideo(buyInName, [buyInStart, buyInStart, buyInEnd]),
    /必须采到起点和终点之间的真实动画帧/);
});

test('已审查的早期菜单相位按自身运动幅度通过视觉回归', async () => {
  const sceneName = 'texas-holdem-drawer-menu-enter';
  const sceneStart = readFileSync(`${snapshots}${sceneName}-start.png`);
  const sceneEnd = readFileSync(`${snapshots}${sceneName}-end.png`);
  const early = readFileSync(`${snapshots}${sceneName}-early-phase.png`);
  const size = PNG.sync.read(sceneStart);
  await compare([sceneStart, early, sceneEnd], { name: sceneName,
    start: sceneStart, end: sceneEnd, width: size.width, height: size.height,
    anchors: [`${sceneName}-early-phase.png`, `${sceneName}-late-phase.png`] });
});

const videoName = 'slot-popup-exit';
const videoStart = readFileSync(`${snapshots}${videoName}-start.png`);
const videoMiddle = readFileSync(`${snapshots}${videoName}-middle.png`);
const videoEnd = readFileSync(`${snapshots}${videoName}-end.png`);

/** Exercise the same video candidate and reviewed-phase assertions used by the recorder.
 * @param timeline - Simulated native video frames.
 */
function compareVideo(timeline) {
  const candidates = middleCandidates(videoStart, videoEnd, timeline, 'videoFrames');
  assertReviewedVideoMiddle(videoStart, videoEnd, candidates, [videoMiddle]);
}

test('真实录屏中途相位通过空间视觉回归', () => {
  compareVideo([videoStart, videoMiddle, videoEnd]);
});

test('录屏中的错误闪屏不能冒充弹窗滑出', () => {
  const flash = PNG.sync.read(videoStart);
  for (let offset = 0; offset < flash.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      flash.data[offset + channel] = Math.min(255, flash.data[offset + channel] + 10);
    }
  }
  assert.throws(() => compareVideo([videoStart, PNG.sync.write(flash), videoEnd]),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

test('录屏中的反向位置不能冒充弹窗滑出', () => {
  const source = PNG.sync.read(videoMiddle);
  const reversed = PNG.sync.read(videoMiddle);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const from = (y * source.width + source.width - 1 - x) * 4;
    const to = (y * source.width + x) * 4;
    source.data.copy(reversed.data, to, from, from + 4);
  }
  assert.throws(() => compareVideo([videoStart, PNG.sync.write(reversed), videoEnd]),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

test('录屏中的横向错位不能冒充弹窗滑出', () => {
  const background = PNG.sync.read(videoStart);
  const source = PNG.sync.read(videoMiddle);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width - 80; x++) {
    const from = (y * source.width + x) * 4;
    const to = (y * source.width + x + 80) * 4;
    source.data.copy(background.data, to, from, from + 4);
  }
  assert.throws(() => compareVideo([videoStart, PNG.sync.write(background), videoEnd]),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

test('录屏直接跳到终点不能冒充弹窗滑出', () => {
  assert.throws(() => compareVideo([videoStart, videoStart, videoEnd]),
    /必须采到起点和终点之间的真实动画帧/);
});

/** Drive the complete video capture path with a fixed native recording.
 * @param sceneName - Reviewed transition name.
 * @param timeline - Frames returned by the native recorder.
 * @param dynamicRegion - 使用带偏移的完整屏幕验证录屏后才解析的控件边界。
 */
async function compareRecordedVideo(sceneName, timeline, dynamicRegion = false) {
  const sceneStart = readFileSync(`${snapshots}${sceneName}-start.png`);
  const sceneEnd = readFileSync(`${snapshots}${sceneName}-end.png`);
  const size = PNG.sync.read(sceneStart);
  const region = { x: dynamicRegion ? 17 : 0, y: dynamicRegion ? 23 : 0,
    width: size.width, height: size.height };
  let triggered = false, resolutions = 0;
  /** 在入场触发后读取控件边界，模拟弹窗在初始屏幕中尚不存在。 */
  const resolveRegion = async () => {
    assert.equal(triggered, true, '不得在入场前查询尚不存在的弹窗');
    resolutions++;
    return region;
  };
  /** 把真实局部截图放入更大的模拟屏幕，检查首尾帧也使用同一偏移。
   * @param bytes - 已审查的真实局部截图。
   */
  const screen = bytes => {
    if (!dynamicRegion) return bytes;
    const canvas = new PNG({ width: size.width + 40, height: size.height + 50 });
    PNG.bitblt(PNG.sync.read(bytes), canvas, 0, 0, size.width, size.height, region.x, region.y);
    return PNG.sync.write(canvas);
  };
  let screens = 0;
  const device = { _connection: { /** Return the exact start and end screenshots. */ toImpl: () => ({
    /** Mock the Android screen command.
     * @param method - Native driver command.
     */
    _send: async method => method === 'screen'
      ? screen(screens++ === 0 ? sceneStart : sceneEnd).toString('base64') : [],
  }) } };
  const info = { /** Discard test attachments. */ attach: async () => {},
    config: { updateSnapshots: 'none' },
    /** Resolve real reviewed snapshots.
     * @param file - Snapshot name.
     */
    snapshotPath: file => `${snapshots}${file}` };
  await captureNativeTransition(device, sceneName, info,
    dynamicRegion ? resolveRegion : region,
    /** 模拟真实入口，边界必须等此操作之后才能读取。 */ () => { triggered = true; },
    [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [],
    /** 模拟录屏完成后的延迟解码；只替换外部录屏接口，仍执行完整首尾及中途像素比较。
     * @param _name - 转场名称。
     * @param recordedRegion - 固定边界或延迟读取边界的回调。
     * @param trigger - 录屏开始后点击入口。
     */
    async (_name, recordedRegion, trigger) => {
      await trigger();
      assert.deepEqual(typeof recordedRegion === 'function' ? await recordedRegion() : recordedRegion, region);
      return timeline;
    });
  assert.equal(resolutions, dynamicRegion ? 1 : 0, '同一转场的所有相位只能解析一次边界');
}

for (const [sceneName, brightness] of [['native-stack-enter', -10], ['game-picker-exit', -40],
  ['texas-showdown', -40]]) {
  test(`${sceneName} 真实中途相位通过完整录屏比较`, async () => {
    const sceneStart = readFileSync(`${snapshots}${sceneName}-start.png`);
    const sceneMiddle = readFileSync(`${snapshots}${sceneName}-middle.png`);
    const sceneEnd = readFileSync(`${snapshots}${sceneName}-end.png`);
    await compareRecordedVideo(sceneName, [sceneStart, sceneMiddle, sceneEnd]);
  });

  test(`${sceneName} 整体亮度闪屏不能冒充真实滑动`, async () => {
    const sceneStart = readFileSync(`${snapshots}${sceneName}-start.png`);
    const sceneEnd = readFileSync(`${snapshots}${sceneName}-end.png`);
    const flash = PNG.sync.read(sceneStart);
    for (let offset = 0; offset < flash.data.length; offset += 4) {
      for (let channel = 0; channel < 3; channel++) {
        flash.data[offset + channel] = Math.max(0, Math.min(255, flash.data[offset + channel] + brightness));
      }
    }
    const timeline = [...Array(30).fill(sceneStart), ...Array(3).fill(PNG.sync.write(flash)),
      ...Array(117).fill(sceneEnd)];
    await assert.rejects(compareRecordedVideo(sceneName, timeline),
      /动画中途帧的实际画面须接近已审查轨迹/);
  });
}

test('录屏中的纯白饱和闪屏不能冒充滑动', async () => {
  const sceneName = 'game-picker-exit';
  const sceneStart = readFileSync(`${snapshots}${sceneName}-start.png`);
  const sceneEnd = readFileSync(`${snapshots}${sceneName}-end.png`);
  const white = PNG.sync.read(sceneStart);
  for (let offset = 0; offset < white.data.length; offset += 4) {
    white.data.fill(255, offset, offset + 3);
  }
  const timeline = [...Array(30).fill(sceneStart), ...Array(3).fill(PNG.sync.write(white)),
    ...Array(117).fill(sceneEnd)];
  await assert.rejects(compareRecordedVideo(sceneName, timeline),
    /动画中途帧的实际画面须接近已审查轨迹/);
});

/** 使用真实俱乐部转场验证延迟裁剪，不生成或替换任何正式截图基准。 */
test('录屏完成后按实际边界裁切完整首尾截图，所有相位保持相同坐标', async () => {
  await compareRecordedVideo(name, [start, middle, end], true);
});
