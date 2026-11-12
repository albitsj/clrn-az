import { captureNativeTransition } from './animation-transition';
import { preserveAnimationFailure } from './animation-diagnostics';
import { preserveRenderStatistics } from './render-diagnostics';
import { tracePanelTarget, type PanelTrace } from './game-panel-diagnostics';
import type { PreGameContext } from './game-pregame-context';

/** 每次聊天退场独立保存既有日志和触发时序，不增加采样期间的设备查询。
 * @param context - 当前房间与本次测试报告。
 * @param closeChat - 原有真实遮罩点击，只执行一次。
 */
export async function captureChatExitWithDiagnostics(context: PreGameContext, closeChat: () => void): Promise<void> {
  const { device, game, animationInfo } = context;
  const name = `${game}-chat-exit`;
  const startedAt = Date.now();
  const trace: PanelTrace = { testID: 'in-game-chat-mask', events: [] };
  /** 只记录宿主时间，不读取控件树或改变采样窗口。
   * @param event - 固定阶段名。
   */
  const observe = (event: string) => tracePanelTarget(trace, event);
  /** 原点击即使失败也记录完成时间，原异常由调用方继续传播。 */
  const trigger = () => {
    observe('trigger-start');
    try { closeChat(); } finally { observe('trigger-complete'); }
  };
  try {
    await captureNativeTransition(device, name, animationInfo!,
      { x: 110, y: 760, width: 140, height: 500 }, trigger, [], [], 0, 'videoFrames',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, observe);
  } catch (error) {
    await preserveChatExitFailure(context, name, startedAt);
    throw error;
  } finally {
    if (game === 'texas-holdem') await animationInfo!.attach(`${name}-input-trace`, {
      body: JSON.stringify(trace), contentType: 'application/json',
    }).catch(() => undefined);
  }
}

/** 在原有重开抽屉动作之前固定首败现场，各诊断互不阻断。
 * @param context - 当前测试报告。
 * @param name - 固定转场名。
 * @param startedAt - 本次尝试开始时间。
 */
async function preserveChatExitFailure(context: PreGameContext, name: string, startedAt: number): Promise<void> {
  if (context.game !== 'texas-holdem') return;
  await preserveAnimationFailure(name, startedAt, context.animationInfo!).catch(() => undefined);
  await preserveRenderStatistics(name, context.animationInfo!).catch(() => undefined);
}
