import { complexityContract } from './android-animation-complexity-fixture.mjs';

complexityContract({
  name: '动画与截图', script: 'scripts/android-animation-complexity.mjs',
  supportFile: 'android/animation-transition-probe.ts',
  testFiles: ['android/animation-transition.test.mjs', 'android/animation-transition-probe.ts',
    'android/asset-sequence-probe.ts', 'android/screenshot-probe.ts', 'scripts/android-animation-probe.test.mjs',
    'scripts/android-animation-complexity-fixture.mjs'],
  toolFiles: ['scripts/android-animation-probe.mjs', 'eslint.config.mjs'],
});
