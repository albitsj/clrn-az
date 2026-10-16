import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import { adb } from './device';
import type { ScreenshotBounds } from './screenshot';

/**
 * 用 SurfaceFlinger 录屏采集短于单次 UiAutomation 截图间隔的转场。
 * @param name - 用于隔离临时录屏和报告附件的效果名。
 * @param region - 只解码所需的可见绘制区域。
 * @param trigger - 录屏开始后从独立 ADB 连接触发真实入口。
 * @param testInfo - 保存原始视频以便检查每个选出的关键帧。
 */
export async function recordNativeVideoFrames(name: string, region: ScreenshotBounds,
  trigger: () => unknown, testInfo: TestInfo): Promise<Buffer[]> {
  const serial = process.env.ANDROID_SERIAL || '';
  if (!/^emulator-\d+$/.test(serial)) throw new Error('录屏仅允许专用 Android 模拟器。');
  const directory = path.resolve('.ttyctl', `video-${name}-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  const remote = `/sdcard/clrn-visual-${process.pid}.mp4`;
  const video = path.join(directory, 'capture.mp4');
  const recorder = spawn('adb', ['-s', serial, 'shell', 'screenrecord', '--size', '720x1280',
    '--bit-rate', '8000000', '--time-limit', '5', remote], { stdio: ['ignore', 'ignore', 'pipe'] });
  let error = '';
  recorder.stderr.on('data', chunk => { error += String(chunk); });
  const finished = new Promise<void>((resolve, reject) => {
    recorder.once('error', reject);
    recorder.once('close', code => code === 0 ? resolve() : reject(new Error(`Android 录屏失败：${error}`)));
  });
  try {
    await setTimeout(1_000);
    await trigger();
    await finished;
    adb('pull', remote, video);
    await testInfo.attach(`${name}-native-video`, { path: video, contentType: 'video/mp4' });
    const frames = path.join(directory, 'frames');
    mkdirSync(frames);
    const { x, y, width, height } = region;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf',
      `fps=30,crop=${width}:${height}:${x}:${y}`, path.join(frames, 'frame-%04d.png')],
    { timeout: 30_000 });
    const files = readdirSync(frames).filter(file => file.endsWith('.png')).sort();
    if (files.length < 20) throw new Error('原生录屏不足 20 帧，无法审查弹层转场。');
    return files.map(file => readFileSync(path.join(frames, file)));
  } finally {
    if (!recorder.killed && recorder.exitCode === null) recorder.kill('SIGINT');
    adb('shell', 'rm', '-f', remote);
  }
}
