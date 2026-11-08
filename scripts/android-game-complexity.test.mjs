import { registerComplexityChecks } from './android-complexity-probes.mjs';

registerComplexityChecks({
  name: 'android-game', probe: 'android/game-probe.ts',
  testPaths: ['android/game-controls.test.mjs', 'android/game-probe.ts', 'android/texas-probe.ts',
    'android/zhajinhua-gameplay-probe.ts', 'scripts/android-game-probe.test.mjs'],
  toolPaths: ['scripts/android-game-probe.mjs', 'eslint.config.mjs'],
  fixturePaths: ['android/game-probe.ts', 'android/texas-probe.ts', 'android/zhajinhua-gameplay-probe.ts'],
});
