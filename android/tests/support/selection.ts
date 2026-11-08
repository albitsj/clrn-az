import { test } from '@playwright/test';

/** 使用当前运行的业务组，保留 all 的默认值。
 */
export function androidGroup(): string { return process.env.ANDROID_GROUP || 'all'; }

/** 使用当前运行的应用语言。
 */
export function androidLocale(): string { return process.env.ANDROID_LOCALE || 'en'; }

/** 动画和共享素材只在既有的英文业务任务采集。
 * @param group - 对应的业务组。
 */
export function englishGroup(group: string): boolean {
  return ['all', group].includes(androidGroup()) && androidLocale() === 'en';
}

/** 保留英文动画任务的跳过条件、说明与原有单例时限。
 * @param group - 业务组。
 * @param reason - 原有跳过说明。
 * @param timeout - 原有用例时限。
 */
export function configureEnglishAnimation(group: string, reason: string, timeout = 420_000): void {
  test.skip(!englishGroup(group), reason);
  test.setTimeout(timeout);
}
