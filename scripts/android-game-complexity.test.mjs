import { complexityContract } from './android-animation-complexity-fixture.mjs';

complexityContract({
  name: '玩法', script: 'scripts/android-game-complexity.mjs', supportFile: 'android/game-probe.ts',
  testFiles: ['android/game-controls.test.mjs', 'android/game-probe.ts', 'android/texas-probe.ts',
    'android/zhajinhua-gameplay-probe.ts', 'scripts/android-game-probe.test.mjs'],
  toolFiles: ['scripts/android-game-probe.mjs', 'eslint.config.mjs'],
});
