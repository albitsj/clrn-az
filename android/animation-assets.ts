import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';

/**
 * 读取 WebP 的顶层 ANMF 块；拒绝仅凭字节中出现 ANMF 文本冒充真实动画帧。
 * @param bytes - 从已验证 APK 原样取出的 WebP。
 */
export function animatedWebpFrames(bytes: Buffer): number {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('无效 WebP RIFF 长度或标记');
  let count = 0;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('WebP 块头被截断');
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) throw new Error('WebP 动画帧被截断');
    if (bytes.toString('ascii', offset, offset + 4) === 'ANMF') count++;
    offset += 8 + size + (size % 2);
  }
  return count;
}

/**
 * 对真实发布 APK 中全部 WebP 动画做精确视觉素材回归；SHA 覆盖像素、帧序和时长。
 * @param packagePath - 已由 Release 下载器验证的 APK 路径。
 * @param expected - 已审查素材名称、SHA-256 与帧数。
 */
export function comparePackagedAnimations(packagePath: string,
  expected: Record<string, [string, number]>): void {
  const entries = execFileSync('unzip', ['-Z1', packagePath], { encoding: 'utf8' })
    .trim().split('\n').filter(name => name.endsWith('.webp'));
  expect(entries.length, '新增动画素材须登记并审查').toBe(Object.keys(expected).length);
  const observed = new Map<string, number>();
  for (const entry of entries) {
    const bytes = execFileSync('unzip', ['-p', packagePath, entry], { maxBuffer: 10 * 1024 * 1024 });
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(observed.has(hash), `APK 中不能重复打包同一动画：${entry}`).toBe(false);
    observed.set(hash, animatedWebpFrames(bytes));
  }
  for (const [name, [hash, frameCount]] of Object.entries(expected)) {
    expect(observed.get(hash), `${name} 的真实 APK 素材、帧或时长已变化`).toBe(frameCount);
    expect(frameCount, `${name} 不能退化为静态图`).toBeGreaterThan(1);
  }
}
