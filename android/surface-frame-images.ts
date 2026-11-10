import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { TestInfo } from '@playwright/test';
import { collectSurfaceFrames, type SurfaceFrame } from './surface-frame-recording';
import { attachRegionFrames, type NativeRegionFrame } from './native-sampling';
import type { ScreenshotBounds } from './screenshot';
import { preserveAnimationFailure } from './animation-diagnostics';

/** 在采集结束后才解码完整真实帧，不增加、混合或插值时间采样。
 * @param context - 本次转场、原始 ROI 及真实入口。
 */
export async function recordSurfaceRegion(context: { name: string; bounds: ScreenshotBounds;
  trigger: () => unknown; info: TestInfo }): Promise<{ capturedAt: number; png: string }[]> {
  const startedAt = Date.now();
  const recording = await collectSurfaceFrames(context.trigger,
    () => preserveAnimationFailure(`${context.name}-source`, startedAt, context.info));
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-surface-'));
  try {
    await context.info.attach(`${context.name}-surface-source`, { body: JSON.stringify({
      format: 'Android35-screenrecord-frames-rgb888', size: [240, 426], clock: 'host-receipt-performance.now',
      timeOrigin: performance.timeOrigin,
      sampledAt: recording.frames.map(frame => frame.capturedAt), stderr: recording.stderr,
      stoppedTailBytes: recording.stoppedTailBytes,
    }), contentType: 'application/json' });
    const images = decodeSurfaceFrames(directory, recording.frames, context.bounds);
    const retained = retainSurfaceFrames(images, recording.frames);
    await attachRegionFrames({ name: context.name, method: 'surfaceFrames', info: context.info,
      regions: [context.bounds], attachment: { index: 0, label: 'frame' } }, retained);
    return retained.map(frame => ({ capturedAt: frame.capturedAt, png: frame.regions[0] }));
  } catch (error) {
    const raw = path.join(directory, 'capture.rgb');
    if (existsSync(raw)) await context.info.attach(`${context.name}-failed-source.rgb`, {
      path: raw, contentType: 'application/octet-stream' }).catch(() => undefined);
    throw error;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** 沿用既有视频路径的 Lanczos 空间缩放及完整 ROI，禁止 fps 滤镜。
 * @param directory - 本次独立临时目录。
 * @param frames - 实际接收到的全部帧。
 * @param bounds - 调用方原有比较范围。
 */
export function decodeSurfaceFrames(directory: string, frames: SurfaceFrame[], bounds: ScreenshotBounds): Buffer[] {
  const raw = path.join(directory, 'capture.rgb');
  writeFileSync(raw, Buffer.concat(frames.map(frame => frame.rgb)));
  const output = path.join(directory, 'frames');
  mkdirSync(output);
  const { x, y, width, height } = bounds;
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '240x426',
    '-i', raw, '-vf', `scale=720:1280:flags=lanczos,crop=${width}:${height}:${x}:${y}`,
    '-vsync', '0', path.join(output, 'frame-%04d.png')], { timeout: 30_000 });
  const files = readdirSync(output).filter(file => file.endsWith('.png')).sort();
  if (files.length !== frames.length) throw new Error('原始帧解码数量不一致');
  return files.map(file => readFileSync(path.join(output, file)));
}

/** 仅合并连续且逐字节相同的像素，保留最后一帧及所有变化帧。
 * @param images - 按原区域解码的 PNG。
 * @param frames - 同序的实际接收时间。
 */
export function retainSurfaceFrames(images: Buffer[], frames: SurfaceFrame[]): NativeRegionFrame[] {
  if (images.length < 20) throw new Error('原始采帧不足 20 帧');
  const retained: NativeRegionFrame[] = [];
  let previous: Buffer | undefined;
  for (const [index, image] of images.entries()) {
    const pixels = PNG.sync.read(image).data;
    if (previous?.equals(pixels) && index !== images.length - 1) continue;
    retained.push({ capturedAt: frames[index].capturedAt, regions: [image.toString('base64')] });
    previous = pixels;
  }
  if (retained.length > 64) throw new Error('原始变化帧超过 64 帧保留预算');
  retained[0].sampledAt = frames.map(frame => frame.capturedAt);
  return retained;
}
