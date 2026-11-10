import { expect, type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { gameTap, gameTapTarget } from './game-controls';
import { focusedCaretMask, type CaretSample } from './screenshot';

/** 明确聚焦并等待键盘和布局，再检测同一个输入框的真实细光标。
 * @param device - 原生设备。
 * @param resource - 当前唯一的输入框标记。
 * @param text - 本用例的固定输入。
 * @param info - 各语言失败时保存实际采样帧。
 */
export async function gameInputCaret(device: AndroidDevice, resource: string, text: string, info?: TestInfo) {
  await gameTap(device, resource);
  await device.fill({ res: resource }, text);
  await inputReady(device, resource, text);
  await gameTapTarget(device, resource);
  let last: CaretSample | undefined;
  const samples: { at: number; bounds: CaretSample['input']['bounds']; focused: boolean }[] = [];
  try {
    const caret = await focusedCaretMask(device, { res: resource, focused: true }, sample => {
      last = sample;
      samples.push({ at: Date.now(), bounds: { ...sample.input.bounds }, focused: sample.input.focused });
    });
    expect(caret, '键盘可见时应检测到真实光标，不能遮掉整行文字').toBeDefined();
    return caret!;
  } catch (error) {
    await preserveCaretFailure(info, resource, last, samples).catch(() => undefined);
    throw error;
  }
}

/** 不重新点击或重复填写，等待真实焦点、业务文字和键盘状态。
 * @param device - 原生设备。
 * @param resource - 输入框标记。
 * @param text - 必须保留的文字。
 */
async function inputReady(device: AndroidDevice, resource: string, text: string): Promise<void> {
  await expect(async () => {
    const input = await device.info({ res: resource });
    expect(input.focused, '目标输入框必须获得焦点').toBe(true);
    expect(input.text).toBe(text);
    expect((await device.shell('dumpsys input_method')).toString()).toContain('mInputShown=true');
  }).toPass({ timeout: 30_000, intervals: [100] });
}

/** 失败时保留最后一组原图；附件故障不能代替光标错误。
 * @param info - 当前报告。
 * @param resource - 固定输入框标记。
 * @param sample - 最后一组真实采样。
 * @param samples - 原有各次采样的脱敏几何状态。
 */
async function preserveCaretFailure(info: TestInfo | undefined, resource: string, sample: CaretSample | undefined,
  samples: object[]): Promise<void> {
  if (!info) return;
  await info.attach(`${resource}-caret-state`, {
    body: JSON.stringify({ at: Date.now(), ...samples.at(-1), samples }),
    contentType: 'application/json',
  }).catch(() => undefined);
  if (!sample) return;
  await info.attach(`${resource}-caret-before`, { body: sample.before, contentType: 'image/png' }).catch(() => undefined);
  await info.attach(`${resource}-caret-after`, { body: sample.after, contentType: 'image/png' }).catch(() => undefined);
}
