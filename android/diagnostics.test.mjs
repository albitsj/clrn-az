import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { diagnosticSource, preserveAnimationFailure } from './diagnostics-test-support.mjs';

const require = createRequire(import.meta.url);
const source = diagnosticSource('./diagnostics.ts');

/** 使用真实文件和附件边界，仅替换外部 ADB 与采集器目录。
 * @param directory - 当前测试独占的脱敏日志目录。
 */
function capture(directory) {
  const exports = {};
  runInNewContext(source, { exports, Date, process, /** 注入独占目录，其他文件操作使用实际实现。
     * @param name - 生产模块名称。
     */ require: name => {
    if (name === './device') return { /** 不执行设备命令。 */ adb: () => '' };
    if (name === './animation-diagnostics') return {
      /** 沿用已有脱敏文件复制器。
       * @param prefix - 附件前缀。
       * @param startedAt - 失败时间。
       * @param info - 当前尝试报告。
       */ preserveAnimationFailure: (prefix, startedAt, info) => preserveAnimationFailure(prefix, startedAt, info, directory),
    };
    return require(name);
  } });
  return exports.captureFailure;
}

test('普通首败在设备诊断及重试轮转前固定日志，附件失败不覆盖原始异常', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-failure-diagnostics-'));
  try {
    const original = 'first attempt: request failed [REDACTED]\n';
    writeFileSync(path.join(directory, 'logcat.log'), original);
    const attachments = new Map();
    const failure = new Error('androidDevice.wait: Timeout exceeded');
    const device = {
      /** 模拟后续设备诊断或重试使首败日志轮转。 */ screenshot: async () => {
        writeFileSync(path.join(directory, 'logcat.log'), 'later attempt\n');
        throw new Error('screenshot unavailable');
      },
      /** 无真实设备连接。 */ close: async () => {},
    };
    const info = {
      /** 保存当前报告附件。
       * @param name - 附件名。
       * @param value - 附件内容。
       */ attach: async (name, value) => attachments.set(name, value.body),
      /** 写入当前独占输出目录。
       * @param file - 诊断文件名。
       */ outputPath: file => path.join(directory, file),
    };
    /** 保留实际调用方在诊断后重新抛出原始失败的方式。 */
    const run = async () => {
      try { throw failure; }
      catch (error) { await capture(directory)(device, info); throw error; }
    };
    await assert.rejects(run(), error => error === failure);
    assert.equal(attachments.get('failure-diagnostics-logcat.log').toString(), original);
    assert.notEqual(readFileSync(path.join(directory, 'logcat.log'), 'utf8'), original);
    assert.ok(attachments.has('failure-diagnostics-window'));
    /** 模拟报告不可写，诊断失败也不得覆盖原始超时。 */
    info.attach = async () => { throw new Error('attachment failed secret=do-not-log'); };
    await assert.rejects(run(), error => error === failure);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
