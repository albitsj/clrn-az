import { expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { alignedVideoDistance, localMotionDistance,
  misplacedVideoFrame, preservesVideoColumns, videoThumbnail, type VideoThumbnail } from './video-motion';
/**
 * 局部画面平均色差；忽略编码差异，保留移动、缩放及透明度变化。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function frameColorDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  sameSize(a, b);
  let difference = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    difference += pixelDifference(a, b, offset);
  }
  return difference / (a.width * a.height * 3);
}

/** 平移弹层的颜色分布距离；保留配色与覆盖比例，允许同一幅画面处在不同纵向位置。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function framePaletteDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  sameSize(a, b);
  let difference = 0;
  for (let channel = 0; channel < 3; channel++) {
    difference += paletteChannelDistance(a, b, channel);
  }
  return difference / (a.width * a.height * 3);
}

/** Select only real in-between frames; video compression alone cannot create a transition.
 * @param before - Exact start frame.
 * @param after - Exact end frame.
 * @param timeline - Frames collected by the native driver.
 * @param samplingMethod - Native capture method.
 */
export function middleCandidates(before: Buffer, after: Buffer, timeline: Buffer[],
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames'): {
    frame: Buffer; index: number; progress: number; remaining: number }[] {
  const total = frameColorDistance(before, after);
  const minimum = samplingMethod === 'videoFrames' ? Math.min(7, total * 0.2) : 1;
  return timeline.map((frame, index) => ({ frame, index,
    progress: frameColorDistance(before, frame) / total,
    remaining: frameColorDistance(after, frame) / total }))
    .filter(item => awayFromEndpoints(item.progress, item.remaining)
      && beyondMinimum(before, after, item.frame, minimum));
}

/** Require a recorded frame to follow an approved spatial phase, away from both endpoints.
 * @param before - Exact start frame.
 * @param after - Exact end frame.
 * @param candidates - Frames with visible motion.
 * @param anchors - Reviewed native video phases.
 */
export function assertReviewedVideoMiddle(before: Buffer, after: Buffer,
  candidates: { frame: Buffer; progress: number; remaining: number }[], anchors: Buffer[]): void {
  expect(candidates.length, '必须采到起点和终点之间的真实动画帧').toBeGreaterThan(0);
  const total = frameColorDistance(before, after);
  const endpoints = [videoThumbnail(before), videoThumbnail(after)];
  const references = anchors.map(anchor => ({ start: frameColorDistance(before, anchor) / total,
    end: frameColorDistance(after, anchor) / total,
    thumbnail: videoThumbnail(anchor), localMotion: localMotionDistance(before, anchor) }));
  const distances = candidates.flatMap(({ frame, progress, remaining }) => {
    const actual = videoThumbnail(frame);
    return references.map(reference => reviewedVideoDistance(before, frame, progress, remaining, actual, reference, endpoints));
  });
  expect(Math.min(...distances), '动画中途帧的实际画面须接近已审查轨迹').toBeLessThanOrEqual(46);
}

/** 拒绝尺寸变化。
 * @param a - 前帧。
 * @param b - 后帧。
 */
function sameSize(a: PNG, b: PNG): void {
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
}
/** 积分单个 RGB 像素，保持原有求和顺序。
 * @param a - 前帧。
 * @param b - 后帧。
 * @param offset - RGBA 偏移。
 */
function pixelDifference(a: PNG, b: PNG, offset: number): number {
  let difference = 0;
  for (let channel = 0; channel < 3; channel++) difference += Math.abs(a.data[offset + channel] - b.data[offset + channel]);
  return difference;
}
/** 积分单通道颜色直方图距离。
 * @param a - 前帧。
 * @param b - 后帧。
 * @param channel - RGB 通道。
 */
function paletteChannelDistance(a: PNG, b: PNG, channel: number): number {
  let difference = 0;
  const counts = new Int32Array(256);
  for (let offset = channel; offset < a.data.length; offset += 4) {
    counts[a.data[offset]]++;
    counts[b.data[offset]]--;
  }
  let balance = 0;
  for (const count of counts) { balance += count; difference += Math.abs(balance); }
  return difference;
}
/** 排除过近的相对首尾相位。
 * @param progress - 相对起点距离。
 * @param remaining - 相对终点距离。
 */
function awayFromEndpoints(progress: number, remaining: number): boolean { return progress > 0.02 && remaining > 0.02; }
/** 排除编码噪声，保留两端绝对运动下界。
 * @param before - 起点。
 * @param after - 终点。
 * @param frame - 候选帧。
 * @param minimum - 既有最小运动量。
 */
function beyondMinimum(before: Buffer, after: Buffer, frame: Buffer, minimum: number): boolean {
  return frameColorDistance(before, frame) > minimum && frameColorDistance(after, frame) > minimum;
}

type VideoReference = { start: number; end: number; thumbnail: VideoThumbnail; localMotion: number };
/** 按相位运动量、持续列覆盖、空间对齐和局部运动逐项检查。
 * @param before - 起点。
 * @param frame - 当前帧。
 * @param progress - 起点距离。
 * @param remaining - 终点距离。
 * @param actual - 当前缩略图。
 * @param reference - 审查相位及运动量。
 * @param endpoints - 只用于错位反证的首尾缩略图。
 */
function reviewedVideoDistance(before: Buffer, frame: Buffer, progress: number, remaining: number,
  actual: VideoThumbnail, reference: VideoReference, endpoints: VideoThumbnail[]): number {
  if (progress < reference.start / 4 || remaining < reference.end / 4) return Infinity;
  return spatialVideoDistance(before, frame, actual, reference, endpoints);
}
/** 全局闪屏不能冒充平移，整列背景变化与局部运动须持续存在。
 * @param before - 起点。
 * @param frame - 当前帧。
 * @param actual - 当前缩略图。
 * @param reference - 审查相位。
 * @param endpoints - 首尾缩略图。
 */
function spatialVideoDistance(before: Buffer, frame: Buffer, actual: VideoThumbnail,
  reference: VideoReference, endpoints: VideoThumbnail[]): number {
  if (!preservesVideoColumns(endpoints, reference.thumbnail, actual)) return Infinity;
  const distance = alignedPhaseDistance(actual, reference.thumbnail, endpoints);
  return localVideoDistance(before, frame, reference, distance);
}
/** 镜像与横向调整只用于错位反证，首尾不增加可接受的中途参考。
 * @param actual - 当前缩略图。
 * @param reference - 审查缩略图。
 * @param endpoints - 首尾缩略图。
 */
function alignedPhaseDistance(actual: VideoThumbnail, reference: VideoThumbnail, endpoints: VideoThumbnail[]): number {
  const distance = alignedVideoDistance(actual, reference);
  if (distance > 46) return Infinity;
  if (misplacedVideoFrame(actual, reference, distance, endpoints)) return Infinity;
  return distance;
}

/** 空间检查失败后不再解码颜色，保持原有检查顺序和开销。
 * @param before - 原生起点。
 * @param frame - 候选帧。
 * @param reference - 审查相位运动量。
 * @param distance - 已通过空间检查的距离，失败为 Infinity。
 */
function localVideoDistance(before: Buffer, frame: Buffer, reference: VideoReference, distance: number): number {
  if (distance > 46) return Infinity;
  if (localMotionDistance(before, frame) < Math.max(2.5, reference.localMotion * 0.15)) return Infinity;
  return distance;
}
