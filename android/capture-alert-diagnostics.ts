import type { TestInfo } from '@playwright/test';
import type { NativeNode } from './game-controls';

/** 保存失败断言实际读取的提示类型，避免收尾阶段的设备查询掩盖现场。
 * @param info - 本次尝试报告。
 * @param name - 截图阶段。
 * @param nodes - 断言已经读取的原生树。
 */
export async function preserveCaptureAlert(info: TestInfo, name: string, nodes: NativeNode[]): Promise<void> {
  try {
    const alerts = nodes.filter(node => ['android:id/message', 'common-alert-message'].includes(String(node.res)))
      .map(node => ({ res: node.res, bounds: node.bounds,
        roomProfile502: node.text === 'Request failed with status code 502-room_profile',
        timeout: node.text === 'timeout' }));
    await info.attach(`${name}-unexpected-alert`, {
      body: JSON.stringify({ alerts }), contentType: 'application/json',
    });
  } catch { /* 不保存未知消息、身份或异常正文，保持原始失败。 */ }
}
