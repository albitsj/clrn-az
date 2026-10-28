import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { downloadReleaseAssets, readGitHub } from './release-download.mjs';

for (const [description, failure] of [
  ['连接重置', 'read: connection reset by peer'], ['数据流意外结束', 'unexpected EOF'],
  ['域名解析失败', 'lookup: no such host'], ['域名解析暂时不可用', 'EAI_AGAIN'],
  ['接口连接失败', 'error connecting to api.github.com'], ['加密连接握手超时', 'TLS handshake timeout'],
  ['读写超时', 'i/o timeout'], ['请求超时', 'HTTP 408'], ['服务器错误', 'HTTP 500'],
  ['网关错误', 'HTTP 502'], ['产物服务流量超限', 'HTTP 503: Egress is over the account limit'],
  ['网关超时', 'HTTP 504'],
]) {
  test(`临时下载故障恢复后返回真实结果：${description}`, async context => {
    const execute = context.mock.fn(() => {
      if (execute.mock.callCount() === 0) throw Object.assign(new Error('下载失败'), { stderr: failure });
      return '{"id":1}';
    });
    const wait = context.mock.fn();
    const report = context.mock.fn();
    assert.equal(await readGitHub(['api', 'repos/example/releases/tags/fixed'], { execute, wait, report }), '{"id":1}');
    assert.equal(execute.mock.callCount(), 2, '网络恢复后应停止重试');
    assert.deepEqual(execute.mock.calls[0].arguments, execute.mock.calls[1].arguments, '重试必须继续读取同一发布版本');
    assert.deepEqual(wait.mock.calls[0].arguments, [3000]);
    assert.equal(report.mock.callCount(), 1);
  });
}

test('持续断线按上限退避后失败，日志和最终错误均隐藏签名地址', async context => {
  const execute = context.mock.fn(() => {
    throw Object.assign(new Error('下载失败'), {
      stderr: 'Get "https://release-assets.githubusercontent.com/file?sig=测试签名": connection reset by peer',
    });
  });
  const wait = context.mock.fn();
  const report = context.mock.fn();
  await assert.rejects(readGitHub(['release', 'download', 'fixed'], { execute, wait, report }), error => {
    assert.match(error.message, /已尝试 6 次/);
    assert.match(error.message, /connection reset by peer/);
    assert.doesNotMatch(error.stack, /测试签名|https:\/\//);
    assert.equal(error.cause, undefined, '原始命令错误不得随错误堆栈泄露签名地址');
    return true;
  });
  assert.equal(execute.mock.callCount(), 6);
  assert.deepEqual(wait.mock.calls.map(call => call.arguments[0]), [3000, 6000, 12000, 24000, 30000]);
  assert.doesNotMatch(JSON.stringify(report.mock.calls), /测试签名|https:\/\//);
});

test('认证、权限、附件缺失和本机命令错误立即失败', async context => {
  for (const failure of ['HTTP 401: Bad credentials', 'HTTP 403: permission denied; connection reset',
    'HTTP 404: Not Found', 'HTTP 422', 'no assets match the file pattern', 'release not found', 'spawn gh ENOENT']) {
    const execute = context.mock.fn(() => { throw new Error(failure); });
    const wait = context.mock.fn();
    const report = context.mock.fn();
    await assert.rejects(readGitHub(['api', 'repos/example/releases/tags/fixed'], { execute, wait, report }), /读取失败/);
    assert.equal(execute.mock.callCount(), 1, `此类错误不应重复请求：${failure}`);
    assert.equal(wait.mock.callCount(), 0);
    assert.equal(report.mock.callCount(), 0);
  }
});

test('附件串行下载，安装包断线重试覆盖残片且保留已完成的构建信息', async context => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-download-test-'));
  const names = [];
  const tag = 'android-staging-300001001-69f9251d3b5f';
  const execute = context.mock.fn((command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args.slice(0, 5), ['release', 'download', tag, '--repo', 'kevinanew/clrn']);
    assert.deepEqual(args.slice(5, 7), ['--dir', directory]);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(args.at(-1), '--clobber', '重试必须覆盖当前失败附件，不能复用残片');
    const name = args[args.indexOf('--pattern') + 1];
    names.push(name);
    const path = join(directory, name);
    if (name === 'build-info.json') writeFileSync(path, '已下载的构建信息');
    else if (names.length === 2) {
      writeFileSync(path, '下载残片');
      throw new Error('unexpected EOF');
    } else {
      assert.equal(readFileSync(path, 'utf8'), '下载残片');
      assert.equal(readFileSync(join(directory, 'build-info.json'), 'utf8'), '已下载的构建信息');
      writeFileSync(path, '完整安装包');
    }
    return '';
  });
  try {
    await downloadReleaseAssets(tag, directory, { execute, wait: context.mock.fn(), report: context.mock.fn() });
    assert.deepEqual(names, ['build-info.json', 'android-staging.apk', 'android-staging.apk']);
    assert.equal(readFileSync(join(directory, 'android-staging.apk'), 'utf8'), '完整安装包');
    assert.equal(readFileSync(join(directory, 'build-info.json'), 'utf8'), '已下载的构建信息');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
