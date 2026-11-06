/** 离线录像回归共用生产解码参数，不重编码或修改原始 MP4。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ffmpeg = process.platform === 'linux'
  ? fileURLToPath(new URL('../node_modules/@ffmpeg-installer/linux-x64/ffmpeg', import.meta.url)) : 'ffmpeg';

/** 返回完整录屏的全部裁切帧，不只读取报告抽样。
 * @param video - 原始 MP4 路径。
 * @param region - 原调用方的真实绘制区域。
 * @param outputDirectory - 本次隔离的临时解码目录。
 */
export function decodeRecordedVideo(video, region, outputDirectory) {
  mkdirSync(outputDirectory);
  const filter = ['fps=30', 'scale=720:1280:flags=lanczos',
    `crop=${region.width}:${region.height}:${region.x}:${region.y}`].join(',');
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', video, '-vf', filter,
    join(outputDirectory, 'frame-%04d.png')]);
  return readdirSync(outputDirectory).filter(file => file.endsWith('.png')).sort()
    .map(file => readFileSync(join(outputDirectory, file)));
}
