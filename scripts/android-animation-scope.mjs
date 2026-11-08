// Issue #48：测试辅助实现、同名测试及提取模块始终采用测试上限。
export const androidAnimationFiles = [
  'animation-assets', 'animation-baselines', 'animation-locale', 'animation-transition',
  'asset-sequence', 'caret-mask', 'launch-artwork', 'loop-animation', 'loop-keyframes',
  'motion-regions', 'record-extra', 'record-navigation', 'record-states',
  'recorded-transitions', 'screenshot-comparison', 'screenshot-policy', 'screenshot',
  'scroll-end', 'video-frames', 'video-motion',
].map(prefix => `android/${prefix}*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`);
export const androidAnimationTools = ['eslint.config.mjs', 'scripts/android-animation-*.mjs', 'scripts/android-game-complexity.mjs'];
export const androidAnimationChecks = ['scripts/android-animation-*.test.mjs', 'scripts/android-animation-*-fixture.mjs'];
