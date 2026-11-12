import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { preserveCaretFailure } from './game-input-caret';
import { focusedCaretMask, type CaretSample } from './screenshot';

/** 保留页码原有采样与断言，仅在失败后保存真实帧和脱敏几何时间线。
 * @param device - 当前模拟器。
 * @param info - 当前报告；所有语言都可记录失败。
 */
export async function recordPageCaret(device: AndroidDevice, info?: TestInfo) {
  let last: CaretSample | undefined;
  const samples: object[] = [];
  try {
    const caret = await focusedCaretMask(device, undefined, sample => {
      last = sample;
      samples.push({ at: Date.now(), bounds: { ...sample.input.bounds }, focused: sample.input.focused,
        targetMatchesPage: sample.input.res === 'review-board-page-input', textMatchesPage: sample.input.text === '1' });
    });
    expect(caret, '页码输入框应检测到真实细光标').toBeDefined();
    return caret!;
  } catch (error) {
    await preserveCaretFailure(info, 'review-board-page-input', last, samples).catch(() => undefined);
    throw error;
  }
}
