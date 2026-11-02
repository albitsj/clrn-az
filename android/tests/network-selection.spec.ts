import { expect, test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { artifacts, launchApplication, waitForStagingNotice } from '../device';
import { dismissKeyboard } from '../keyboard';
import { signIn } from '../navigation';
import { withAndroidProxy } from '../proxy';
import { captureFailure } from '../diagnostics';

type SelectionEvent = {
  event: string; host: string; path: string; status?: number;
  candidates?: string[]; backend_delay?: number; kind?: string;
};
type Selection = { events: SelectionEvent[] };

/**
 * 节点编号保持验收含义，地区域名由真实 metadata 提供。
 * @param host - 本次代理观察到的节点域名。
 */
function nodeNumber(host: string): string { return host.split('.')[0]; }

// 两个异常模式独立冷启动同一固定 APK；正常视觉和登录不启用它们。
test.describe('Android native network selection', () => {
  test.describe.configure({ retries: 0 });
  for (const scene of ['network-64-unavailable', 'network-without-64'] as const) {
    test(scene, async ({}, testInfo) => {
      test.skip((process.env.ANDROID_LOCALE || 'en') !== 'en'
        || !['all', 'guest'].includes(process.env.ANDROID_GROUP || 'all'), '在英文游客任务验证原生客户端选线');
      await withAndroidProxy(async proxy => {
        let device: AndroidDevice | undefined;
        try {
          device = await launchApplication();
          await waitForStagingNotice(device);
          await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
          await dismissKeyboard(device);
          await device.tap({ res: 'confirm-button' });
          // 不点击初始化错误的 RETRY；要求本次初始化直接完成。
          await device.wait({ res: 'settings-tab' }, { timeout: 120_000 });
          await testInfo.attach('initialized-hall', { body: await device.screenshot(), contentType: 'image/png' });
          await signIn(device);
          await expect.poll(async () => {
            const { events } = await proxy.command<Selection>('android/network-selection');
            const metadata = events.filter(event => event.candidates);
            expect(metadata.length, '必须使用本次代理返回的 metadata').toBeGreaterThan(0);
            const candidates = metadata.flatMap(event => event.candidates!);
            if (scene === 'network-64-unavailable') {
              expect(new Set(candidates.map(nodeNumber))).toEqual(new Set(['64', '67', '68']));
              for (const node of ['64', '68']) expect(events.some(event => nodeNumber(event.host) === node
                && event.path === '/node/v1/status' && event.status === 503), `${node} 必须确实收到故障响应`).toBe(true);
              expect(events.some(event => nodeNumber(event.host) === '67' && event.path === '/node/v1/status'
                && event.status === 200 && typeof event.backend_delay === 'number'), '67 必须保留真实健康响应').toBe(true);
            } else {
              expect(candidates.map(nodeNumber)).not.toContain('64');
              expect(candidates.length).toBeGreaterThan(0);
            }
            const connections = events.filter(event => event.event === 'websocket-connected' && event.status === 101);
            expect(connections.length, '必须建立原生 WebSocket 连接').toBeGreaterThan(0);
            for (const connection of connections) {
              expect(nodeNumber(connection.host)).not.toBe('64');
              expect(candidates).toContain(connection.host);
              if (scene === 'network-64-unavailable') expect(nodeNumber(connection.host)).toBe('67');
            }
            return events.some(event => event.event === 'websocket-ack' && event.kind === 'connect'
              && connections.some(connection => connection.host === event.host));
          }, { timeout: 30_000 }).toBe(true);
        } catch (error) {
          if (device) await captureFailure(device, testInfo);
          throw error;
        } finally {
          try {
            await testInfo.attach('network-selection', {
              body: JSON.stringify({ scene, ...await proxy.command<Selection>('android/network-selection') }),
              contentType: 'application/json',
            });
            await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
          } finally { await device?.close(); }
        }
      }, scene);
    });
  }
});
