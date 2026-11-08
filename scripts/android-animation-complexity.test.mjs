import { registerComplexityChecks } from './android-complexity-probes.mjs';

registerComplexityChecks({
  name: 'android-animation', probe: 'android/animation-transition-probe.ts',
  testPaths: ['android/animation-transition.test.mjs', 'android/animation-transition-probe.ts',
    'android/asset-sequence-probe.ts', 'android/screenshot-probe.ts', 'scripts/android-animation-probe.test.mjs'],
  toolPaths: ['scripts/android-animation-probe.mjs', 'eslint.config.mjs'],
  fixturePaths: ['android/animation-transition-probe.ts'],
});
