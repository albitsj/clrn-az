import { existsSync, readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { screenshotComparison } from './screenshot-comparison';

const comparator = require('playwright-core/lib/coreBundle').utils.getComparator('image/png');

/**
 * 基准中的节点编号已经遮罩；真实选线可把单节点编号变成两个编号，比较时对基准应用同一动态区域。
 * 仅处理节点编号，不能用当前控件边界重新遮罩基准里的业务内容。
 * @param expected - 仓库中已审查的原始基准字节。
 * @param masks - 当前原生界面中明确排除的动态区域。
 */
export function networkCodeReference(expected: Buffer, masks: ScreenshotMask[]): Buffer {
  return maskScreenshot(expected, masks.filter(mask => mask.reason === 'game-network-proxy-code'));
}

/**
 * 保留仓库原图，按相同的节点编号遮罩和共用像素规则比较，并保存实际参与比较的预期图与差异图。
 * @param actual - 已完成稳定检测并应用动态遮罩的真实截图。
 * @param name - 截图名称。
 * @param testInfo - 当前测试报告。
 * @param masks - 本轮真实控件的动态区域。
 */
export async function expectScreenshot(actual: Buffer, name: string, testInfo: TestInfo,
  masks: ScreenshotMask[]): Promise<void> {
  const file = `${name}.png`;
  const reference = testInfo.snapshotPath(file);
  if (!masks.some(mask => mask.reason === 'game-network-proxy-code')
    || testInfo.config.updateSnapshots === 'all' || !existsSync(reference)) {
    expect.soft(actual).toMatchSnapshot(file);
    return;
  }
  const expected = networkCodeReference(readFileSync(reference), masks);
  const result = comparator(actual, expected, screenshotComparison);
  await testInfo.attach(`${name}-expected.png`, { body: expected, contentType: 'image/png' });
  if (result) {
    await testInfo.attach(`${name}-actual.png`, { body: actual, contentType: 'image/png' });
    if (result.diff) await testInfo.attach(`${name}-diff.png`, { body: result.diff, contentType: 'image/png' });
  }
  expect.soft(result?.errorMessage, `${name} 截图必须符合已审查基准及共用差异比例`).toBeUndefined();
}
