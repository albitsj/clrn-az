import { readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';

/** 先保存实际相位，再按显式更新模式或已审查基准进行比较。
 * @param info - 当前测试报告。
 * @param file - 相位基准名称。
 * @param frame - 真实采样的相位。
 * @param compare - 使用原有业务阈值检查基准的断言。
 */
export async function comparePhaseSnapshot(info: TestInfo, file: string, frame: Buffer,
  compare: (reference: Buffer) => void): Promise<void> {
  await info.attach(file, { body: frame, contentType: 'image/png' });
  if (info.config.updateSnapshots === 'all') expect(frame).toMatchSnapshot(file);
  else compare(readFileSync(info.snapshotPath(file)));
}
