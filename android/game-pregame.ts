import { type TestInfo } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { gameReady } from './game-controls';
import type { PreGameContext } from './game-pregame-context';
import { preGameFinal, preGameOpening, preGamePanels } from './game-pregame-phases';

type Capture = (state: string) => Promise<void>;

/** 共用开局前操作，按房间阶段保留原有执行顺序。
 * @param device - 专用模拟器连接。
 * @param game - 当前玩法。
 * @param capture - 共享截图入口。
 * @param animationInfo - 英文原生动画报告。
 * @param phase - 本次房间阶段。
 */
export async function gamePreGame(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', capture: Capture,
  animationInfo?: TestInfo, phase?: 'all' | 'first' | 'middle' | 'second'): Promise<void> {
  await gameReady(device, game === 'texas-holdem' ? 'texas-holdem-room-name-text' : 'zhajinhua-text-room-name', 'TestRoom');
  const context: PreGameContext = { device, game, capture, animationInfo };
  const steps = preGameSteps[game][preGamePhase(phase)];
  for (const step of steps) await step(context);
}

const preGameSteps = {
  'texas-holdem': {
    all: [preGameOpening, preGamePanels, preGameFinal], first: [preGameOpening],
    middle: [preGamePanels], second: [preGameFinal],
  },
  zhajinhua: {
    all: [preGameOpening, preGamePanels, preGameFinal], first: [preGameOpening, preGamePanels],
    middle: [preGamePanels], second: [preGameFinal],
  },
};

/** 未指定阶段时保持完整开局前流程。
 * @param phase - 当前房间阶段。
 */
function preGamePhase(phase: 'all' | 'first' | 'middle' | 'second' = 'all'): 'all' | 'first' | 'middle' | 'second' { return phase; }

export { captureGameThemes, closeAnimatedGameMask, closeGameMask, gameMenu } from './game-pregame-helpers';
