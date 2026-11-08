// Issue #49：设备、导航、代理与用例；提取模块沿用职责前缀或 tests/support 目录。
export const androidNavigationFiles = [
  'android/{device,diagnostics,fixtures,form-inputs,keyboard,native-state,navigation,proxy,scenarios}{,-*,.test}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
  'android/tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
];
export const androidNavigationTools = [
  'android/{build-driver,download-release,release-download,release,run-visual}{,-*}.mjs',
  'android/playwright.config.ts', 'eslint.config.mjs', 'scripts/android-navigation-*.mjs', 'scripts/android-game-complexity.mjs',
];
export const androidNavigationChecks = [
  'android/{build-driver,download-release,release-download,release,run-visual}{,-*}.test.mjs',
  'scripts/android-navigation-*.test.mjs', 'scripts/android-complexity-*.mjs',
];
