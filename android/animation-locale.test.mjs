import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireEnglishAnimation } from './animation-locale.ts';

test('动画采集入口只接受英文，拒绝中文或未知语言', () => {
  assert.doesNotThrow(() => requireEnglishAnimation('en'));
  for (const locale of ['zh-Hans', 'zh-Hant', 'none', 'fr']) {
    assert.throws(() => requireEnglishAnimation(locale), /动画截图仅允许英文/);
  }
  const previous = process.env.ANDROID_LOCALE;
  try {
    delete process.env.ANDROID_LOCALE;
    assert.doesNotThrow(() => requireEnglishAnimation());
    process.env.ANDROID_LOCALE = 'zh-Hans';
    assert.throws(() => requireEnglishAnimation(), /当前语言：zh-Hans/);
  } finally {
    if (previous === undefined) delete process.env.ANDROID_LOCALE;
    else process.env.ANDROID_LOCALE = previous;
  }
});
