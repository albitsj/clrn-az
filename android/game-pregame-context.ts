import type { TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';

export type PreGameContext = {
  device: AndroidDevice; game: 'texas-holdem' | 'zhajinhua'; capture: (state: string) => Promise<void>;
  animationInfo?: TestInfo;
};
