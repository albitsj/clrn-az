// Issue #50 的测试辅助模块及同名相邻测试；提取模块沿用这些职责前缀。
export const androidGameFiles = [
  'android/game-*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
  'android/texas-*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
  'android/zhajinhua-gameplay*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
];
export const androidGameTools = ['eslint.config.mjs', 'scripts/android-game-*.mjs'];
export const androidGameChecks = ['scripts/android-game-*.test.mjs'];
