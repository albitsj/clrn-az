/** 约束真实视频相位，排除只剩背景统一变暗或淡出的画面。 */
import { localMotionDistance, videoThumbnail, type VideoThumbnail } from './video-motion';

type FrameDistance = (left: Buffer, right: Buffer) => number;

/** 去掉整幅画面各色通道统一的亮度与对比度变化，保留面板等局部内容差异。
 * @param endpoint - 原生终点缩略图。
 * @param frame - 同尺寸真实录屏或已审查相位。
 */
export function foregroundMotion(endpoint: VideoThumbnail, frame: VideoThumbnail): number {
  if (endpoint.width !== frame.width || endpoint.height !== frame.height) throw new Error('动画帧尺寸变化');
  let residual = 0;
  const count = endpoint.pixels.length / 3;
  for (let channel = 0; channel < 3; channel++) {
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (let index = channel; index < endpoint.pixels.length; index += 3) {
      const x = endpoint.pixels[index], y = frame.pixels[index];
      sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
    }
    const denominator = count * sumXX - sumX * sumX;
    const scale = denominator ? (count * sumXY - sumX * sumY) / denominator : 0;
    const offset = (sumY - scale * sumX) / count;
    for (let index = channel; index < endpoint.pixels.length; index += 3) {
      residual += Math.abs(frame.pixels[index] - Math.max(0, Math.min(255, endpoint.pixels[index] * scale + offset)));
    }
  }
  return residual / endpoint.pixels.length;
}

/** 保留原起点运动要求，终点一侧再排除统一背景渐变。
 * @param before - 原生起点。
 * @param frame - 真实采集的待比较相位。
 * @param endpoint - 原生终点缩略图。
 * @param actual - 当前实际相位缩略图。
 * @param reference - 原有已审查相位的运动约束。
 */
export function preservesLocalPhase(before: Buffer, frame: Buffer, endpoint: VideoThumbnail, actual: VideoThumbnail,
  reference: { localMotion: number; foregroundMotion: number }): boolean {
  return localMotionDistance(before, frame) >= Math.max(2.5, reference.localMotion * 0.15)
    && foregroundMotion(endpoint, actual) >= Math.max(2.5, reference.foregroundMotion * 0.15);
}

/** 原生首尾只用于运动约束，不增加可接受的中途参考。
 * @param before - 原生起点。
 * @param after - 原生终点。
 * @param anchor - 原有已审查相位。
 * @param total - 原生首尾总变化幅度。
 * @param distance - 调用方原有完整像素色差计算。
 */
export function reviewedVideoReference(before: Buffer, after: Buffer, anchor: Buffer, total: number, distance: FrameDistance): {
  start: number; end: number; thumbnail: VideoThumbnail; localMotion: number; foregroundMotion: number } {
  const thumbnail = videoThumbnail(anchor);
  return { start: distance(before, anchor) / total, end: distance(after, anchor) / total,
    thumbnail, localMotion: localMotionDistance(before, anchor), foregroundMotion: foregroundMotion(videoThumbnail(after), thumbnail) };
}
