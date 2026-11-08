import { registerComplexityChecks } from './android-complexity-probes.mjs';

registerComplexityChecks({
  name: 'android-navigation', probe: 'android/device-probe.ts',
  testPaths: ['android/device.test.mjs', 'android/navigation-probe.ts', 'android/fixtures.ts',
    'android/tests/support/probe.ts', 'android/release.test.mjs', 'scripts/android-navigation-probe.test.mjs'],
  toolPaths: ['scripts/android-navigation-probe.mjs', 'android/release.mjs', 'android/playwright.config.ts', 'eslint.config.mjs'],
  fixturePaths: ['android/game-probe.ts', 'android/texas-probe.ts', 'android/zhajinhua-gameplay-probe.ts',
    'android/device-probe.ts', 'android/release.mjs', 'android/release.test.mjs', 'android/playwright.config.ts', 'android/tests/probe.spec.ts'],
});
