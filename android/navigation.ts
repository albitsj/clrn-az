import type { AndroidDevice } from 'playwright';
import { expect } from '@playwright/test';
import { dismissKeyboard } from './keyboard';
import { tap } from './navigation-tap';
import { reveal } from './navigation-reveal';
import { returnToTabs } from './navigation-tabs';
export { tap, reveal, returnToTabs };
export { navigateScenario } from './navigation-scenario';

/**
 * 使用账号池的真实凭据完成原生登录，不注入伪造会话。
 * @param device - 专用模拟器连接。
 */
export async function signIn(device: AndroidDevice): Promise<void> {
  const { VISUAL_USERNAME: username, VISUAL_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error('安卓登录测试必须通过账号池启动。');
  await returnToTabs(device);
  await tap(device, 'settings-tab');
  await tap(device, 'sign-in-button');
  await tap(device, 'username-or-email-sign-in-button');
  await device.wait({ res: 'username-input' });
  await device.fill({ res: 'username-input' }, username);
  await dismissKeyboard(device);
  await reveal(device, { res: 'password-input' });
  await device.fill({ res: 'password-input' }, password);
  await dismissKeyboard(device);
  await tap(device, 'sign-in-button');
  await device.wait({ res: 'settings-tab' }, { timeout: 60_000 });
  await tap(device, 'settings-tab');
  await expect(async () => {
    await device.wait({ res: 'user-info-button' }, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * 通过应用语言设置选择与 Web 相同的语言，保留系统的固定英文显示条件。
 * @param device - 专用模拟器连接。
 * @param locale - 应用语言代码。
 */
export async function selectLanguage(device: AndroidDevice, locale: string): Promise<void> {
  const identifier = { en: 'english', 'zh-Hans': 'zh-hans', 'zh-Hant': 'zh-hant' }[locale];
  if (!identifier) throw new Error(`不支持的测试语言：${locale}`);
  await returnToTabs(device);
  await tap(device, 'settings-tab');
  await tap(device, 'sign-in-button');
  await tap(device, 'switch-language-button');
  await tap(device, identifier);
  await tap(device, 'confirm-button');
  await device.wait({ res: 'username-or-email-sign-in-button' }, { timeout: 30_000 });
  const expectedLabel = { en: 'English', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' }[locale];
  await device.wait({ res: 'switch-language-label', text: expectedLabel });
  await tap(device, 'close-user-authentication-button');
  await device.wait({ res: 'settings-tab' });
}
