import { expect, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { AndroidDevice } from 'playwright';
import { gameNodes } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { challengeFrames, type ChallengeFrame } from './game-animation-sampling';

/**
 * 比牌的四个高亮框各自循环闪烁，按各自相位比较，不遮掉其中的玩家内容。
 * 页面其余像素保持普通基准比较；每个动画分区都必须在真实采样帧中匹配基准。
 * @param device - 专用模拟器连接。
 * @param name - 共用状态生成的基准名称。
 * @param testInfo - 当前测试报告。
 * @param masks - 房号、倒计时等既有小区域遮罩。
 */
export async function captureChallengeAnimation(device: AndroidDevice, name: string, testInfo: TestInfo,
  masks: ScreenshotMask[]): Promise<void> {
  const selectors = (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector');
  expect(selectors).toHaveLength(4);
  // 原生树将 63×91dp 高亮图裁到 50×50dp 头像内；恢复绘制范围并留两像素边缘。
  const regions = selectors.map(({ bounds }) => ({
    x: bounds.x - Math.ceil(bounds.width * 0.14), y: bounds.y - Math.ceil(bounds.width * 0.42),
    width: Math.ceil(bounds.width * 1.3), height: Math.ceil(bounds.width * 1.88),
  }));
  await testInfo.attach(`${name}-animation-regions`, { body: JSON.stringify(regions), contentType: 'application/json' });
  await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const reference = testInfo.config.updateSnapshots === 'all';
  const expected = challengeReference(testInfo, name, regions);
  const matched = regions.map(() => false);
  const moving = regions.map(() => false);
  const matchingFrames: Buffer[] = [];
  let latest: Buffer | undefined;
  const state: ChallengeState = { stableSince: 0, started: Infinity, capturedAt: 0, backgroundMatches: false };
  try {
    await expect(async () => {
      // 先在设备连续采集，再编码和比较，避免 screencap 往返及 PNG 比较漏掉闪烁相位。
      for (const frame of await challengeFrames(device)) {
        latest = maskScreenshot(frame.original, masks);
        const parts = motionParts(latest, regions);
        updateChallengeState(state, parts, latest, frame);
        recordMotion(parts, state.previous, moving);
        state.previous = parts;
        state.backgroundMatches = matchingBackground(parts, expected);
        if (state.backgroundMatches) matchChallengeParts(parts, expected, matched, matchingFrames, frame.original);
      }
      assertChallengeSamples(state, moving, matched, reference);
    // 外层期限须覆盖原生响应等待及随后全部帧的像素校验。
    }).toPass({ timeout: 120_000, intervals: [137, 263, 181, 347] });
    expect((await gameNodes(device)).filter(node => node.res === 'challenge_player_selector').map(node => node.bounds))
      .toEqual(selectors.map(node => node.bounds));
    await testInfo.attach(`${name}-original`, { body: state.best!.original, contentType: 'image/png' });
    await testInfo.attach(name, { body: state.best!.bytes, contentType: 'image/png' });
    assertChallengeReference(reference, state.best!.bytes, name);
    await attachMatchingFrames(name, testInfo, matchingFrames);
  } catch (error) {
    if (latest) await testInfo.attach(`${name}-animation-failure`, { body: latest, contentType: 'image/png' });
    throw error;
  }
}

type Parts = ReturnType<typeof motionParts>;
type ChallengeState = {
  stableSince: number; started: number; capturedAt: number; backgroundMatches: boolean;
  previous?: Parts; stabilityReference?: Buffer;
  best?: { bytes: Buffer; original: Buffer; score: number };
};

/** 背景变化时重新开始稳定时间并清空上一背景的最佳帧。
 * @param state - 当前采集状态。
 * @param parts - 实际画面分区。
 * @param bytes - 当前遮罩图。
 * @param frame - 当前原图及设备实际采集时刻。
 */
function updateChallengeState(state: ChallengeState, parts: Parts, bytes: Buffer, frame: ChallengeFrame): void {
  expect(frame.capturedAt, '原生帧时间必须严格递增').toBeGreaterThan(state.capturedAt);
  state.started = Math.min(state.started, frame.capturedAt);
  state.capturedAt = frame.capturedAt;
  if (!state.stabilityReference || !samePixels(parts.outside, state.stabilityReference)) {
    state.stableSince = frame.capturedAt;
    state.stabilityReference = parts.outside;
    state.best = undefined;
  }
  selectBestChallengeFrame(state, parts, bytes, frame.original);
}

/** 选择当前稳定背景下高亮面积最大的真实帧。
 * @param state - 当前采集状态。
 * @param parts - 实际画面分区。
 * @param bytes - 当前遮罩图。
 * @param original - 当前原图。
 */
function selectBestChallengeFrame(state: ChallengeState, parts: Parts, bytes: Buffer, original: Buffer): void {
  if (!state.best || parts.score > state.best.score) state.best = { bytes, original, score: parts.score };
}

/** 每个高亮框都必须与上一帧有实际像素差异。
 * @param parts - 当前分区。
 * @param previous - 上一帧分区。
 * @param moving - 每位玩家的运动证据。
 */
function recordMotion(parts: Parts, previous: Parts | undefined, moving: boolean[]): void {
  parts.regions.forEach((part, index) => {
    if (previous && !part.equals(previous.regions[index])) moving[index] = true;
  });
}

/** 分别匹配四个选择框，并继续严格匹配全部外部像素。
 * @param parts - 当前实际分区。
 * @param expected - 已审查基准分区。
 * @param matched - 各玩家的匹配证据。
 * @param frames - 各玩家首次匹配的原始帧。
 * @param original - 当前原始截图。
 */
function matchChallengeParts(parts: Parts, expected: Parts | undefined, matched: boolean[], frames: Buffer[], original: Buffer): void {
  if (!expected) return;
  parts.regions.forEach((part, index) => {
    if (!matched[index] && samePixels(part, expected.regions[index])) {
      matched[index] = true;
      frames[index] = original;
    }
  });
}

/** 检查同一真实帧的全部非动画像素，禁止用错误背景积累玩家匹配证据。
 * @param parts - 当前真实帧分区。
 * @param expected - 比较模式的已审查基准。
 */
function matchingBackground(parts: Parts, expected: Parts | undefined): boolean {
  return !expected || samePixels(parts.outside, expected.outside);
}

/** 使用设备时间验证实际观察窗口，编码或比较耗时不能充当稳定时间。
 * @param state - 当前设备采样状态。
 * @param moving - 各玩家真实运动证据。
 * @param matched - 各玩家完整像素匹配证据。
 * @param reference - 是否显式生成基准。
 */
function assertChallengeSamples(state: ChallengeState, moving: boolean[], matched: boolean[], reference: boolean): void {
  expect(state.backgroundMatches, '动画之外的全部像素必须匹配基准').toBe(true);
  if (!reference) expect(matched, '四位玩家及高亮框必须各自在真实帧中完整匹配基准').toEqual([true, true, true, true]);
  expect(moving, '四个选择框应实际闪烁').toEqual([true, true, true, true]);
  expect(state.capturedAt - state.started).toBeGreaterThanOrEqual(4000);
  expect(state.capturedAt - state.stableSince, '动画之外的像素须连续稳定两秒').toBeGreaterThanOrEqual(2000);
}

/** 三语言完整比较；只在英文报告附加独立的玩家相位帧。
 * @param name - 截图名。
 * @param testInfo - 当前测试报告。
 * @param frames - 玩家匹配帧。
 */
async function attachMatchingFrames(name: string, testInfo: TestInfo, frames: Buffer[]): Promise<void> {
  if (!name.startsWith('en-')) return;
  for (const [index, frame] of frames.entries()) {
    await testInfo.attach(`${name}-matched-player-${index + 1}`, { body: frame, contentType: 'image/png' });
  }
}

/** 仅生成基准时不读取旧图，比较模式仍使用同一分区和原始文件。
 * @param info - 测试报告。
 * @param name - 截图名。
 * @param regions - 已校准的四个动画区域。
 */
function challengeReference(info: TestInfo, name: string, regions: import('./screenshot').ScreenshotBounds[]): Parts | undefined {
  if (info.config.updateSnapshots === 'all') return undefined;
  return motionParts(readFileSync(info.snapshotPath(`${name}.png`)), regions);
}

/** 保留显式更新模式下的原有快照写入入口。
 * @param reference - 是否显式生成基准。
 * @param bytes - 最佳实际帧。
 * @param name - 截图名。
 */
function assertChallengeReference(reference: boolean, bytes: Buffer, name: string): void {
  if (reference) expect(bytes).toMatchSnapshot(`${name}.png`);
}
