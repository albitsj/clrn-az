import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { packageName, releaseRepository } from './release.mjs';

const retryDelays = [3000, 6000, 12000, 24000, 30000];
const temporaryFailure = /\bHTTP(?:\/\d(?:\.\d)?)?\s+(?:408|500|502|503|504)\b|\bEOF\b|\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|connection (?:reset|closed|aborted|refused)|(?:network|i\/o|TLS handshake) timeout|timed? out|no such host|temporary failure in name resolution|error connecting to|Egress is over the account limit/i;
const permanentFailure = /\bHTTP(?:\/\d(?:\.\d)?)?\s+(?:401|403|404|422)\b|authentication|bad credentials|permission denied|no assets match|release not found/i;

/**
 * 分类使用完整错误文本，抛出时仅保留脱敏副本，避免签名地址沿 cause 泄露。
 * @param error - gh 命令产生的原始错误。
 * @param attempt - 从零开始的尝试次数。
 */
function githubFailure(error, attempt) {
  const details = `${error.stderr ?? ''}\n${error.message ?? ''}`;
  const safeDetails = details.replace(/https?:\/\/[^\s"'<>]+/g, '[已隐藏下载地址]').trim();
  return { details, error: new Error(`GitHub 读取失败，已尝试 ${attempt + 1} 次：${safeDetails}`) };
}

/**
 * 仅对 GitHub 只读请求的临时网络故障退避重试，不输出带签名的下载地址。
 * @param args - 传给 gh 的只读查询或下载参数。
 * @param options - 可替换的命令执行、等待与日志接口，供离线回归验证。
 */
export async function readGitHub(args, { execute = execFileSync, wait = setTimeout, report = console.warn } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return execute('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const failure = githubFailure(error, attempt);
      const { details } = failure;
      if (attempt === retryDelays.length || permanentFailure.test(details) || !temporaryFailure.test(details)) {
        throw failure.error;
      }
      const delay = retryDelays[attempt];
      report(`GitHub 读取遇到临时网络故障，${delay / 1000} 秒后进行第 ${attempt + 2} 次尝试。`);
      await wait(delay);
    }
  }
}

/**
 * 串行下载固定版本的附件；仅覆盖正在重试的附件，保留此前已完成的文件。
 * @param tag - 部署记录指定并已校验的发布标签。
 * @param directory - 本轮专用下载目录。
 * @param options - 传给只读请求的离线验证接口。
 */
export async function downloadReleaseAssets(tag, directory, options) {
  for (const name of ['build-info.json', packageName]) {
    await readGitHub(['release', 'download', tag, '--repo', releaseRepository,
      '--dir', directory, '--pattern', name, '--clobber'], options);
  }
}
