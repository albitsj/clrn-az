import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const artifacts = path.join(__dirname, 'artifacts/current');

/**
 * 执行限定模拟器的 Android 调试命令，拒绝默认选中手机。
 * @param argumentsList - adb 参数列表。
 */
export function adb(...argumentsList: string[]): string {
  const serial = process.env.ANDROID_SERIAL || '';
  if (!/^emulator-\d+$/.test(serial)) throw new Error('必须通过 ANDROID_SERIAL 指定专用模拟器，例如 emulator-5554。');
  return execFileSync('adb', ['-s', serial, ...argumentsList], { encoding: 'utf8', timeout: 120_000 });
}

