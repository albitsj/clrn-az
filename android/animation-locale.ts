/**
 * 所有动画关键帧固定使用英文；普通页面的多语言截图继续独立运行。
 * @param locale - 本轮应用语言，默认读取 Android 测试配置。
 */
export function requireEnglishAnimation(locale = animationLocale()): void {
  if (locale !== 'en') throw new Error(`动画截图仅允许英文（en），当前语言：${locale}`);
}

/** 读取动画语言的既有默认值。 */
function animationLocale(): string { return process.env.ANDROID_LOCALE || 'en'; }
