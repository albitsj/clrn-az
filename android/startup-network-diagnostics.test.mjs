import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { attachStartupNetwork } = require('./startup-network-diagnostics.ts');

test('启动失败只读取已有选线记录，代理与报告失败均保留原异常', async () => {
  const selection = { total: 1, events: [{ event: 'error', host: '67.hk.api.staging.laiwan.shafayouxi.com',
    path: '/node/v1/status', method: 'GET', at: 1000 }] };
  const original = new Error('hall startup timeout');
  const attachments = new Map();
  const reads = [];
  const proxy = { /** 仅允许读取快照。
   * @param command - 原有诊断端点。
   */ command: async command => { reads.push(command); return selection; } };
  const info = { /** 保存脱敏事件原值。
   * @param name - 附件名称。
   * @param attachment - 当前记录。
   */ attach: async (name, attachment) => attachments.set(name, JSON.parse(attachment.body)) };
  /** 模拟调用方在诊断后继续传播同一个启动异常。 */
  const fail = async () => {
    try { throw original; }
    catch (error) { await attachStartupNetwork(proxy, info); throw error; }
  };
  await assert.rejects(fail(), error => error === original);
  assert.deepEqual(reads, ['android/network-selection']);
  assert.deepEqual(attachments.get('startup-network-selection'), selection);
  /** 模拟代理记录无法读取。 */
  proxy.command = async () => { throw new Error('proxy unavailable'); };
  await assert.rejects(fail(), error => error === original);
  /** 恢复只读快照。 */
  proxy.command = async () => selection;
  /** 模拟报告附件写入失败。 */
  info.attach = async () => { throw new Error('attachment unavailable'); };
  await assert.rejects(fail(), error => error === original);
});
