import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { stageError } from '../network/errors.ts';
import { businessRequest, createStagingClient, setTestingBalance } from '../network/staging.ts';
export const initialCoinBalance = '10000';

/**
 * 从环境或本机 staging 部署文件读取测试令牌，持续集成禁止回退到文件。
 * @param environment - 当前进程的环境配置。
 * @param deploymentFile - 本机共用 staging Secret 所在文件。
 */
export async function readTestingApiToken(environment = process.env,
  deploymentFile = new URL('../../goplay_staging_auto_stack/user_transaction_flask/deploy.yaml', import.meta.url)) {
  const configured = environment.TESTING_API_TOKEN?.trim();
  if (configured) return configured;
  if (canReadLocalToken(environment)) {
    try {
      const deployment = await readFile(deploymentFile, 'utf8');
      const secret = deployment.split(/^---\s*$/m).find(document =>
        /^kind:\s*Secret\s*$/m.test(document)
        && /^\s+name:\s*test-api-token\s*$/m.test(document)
        && /^\s+namespace:\s*goplay-staging\s*$/m.test(document));
      const token = secret?.match(/^stringData:\s*\n(?:\s*#.*\n)*\s+token:\s*["']?([A-Za-z0-9_=-]+)["']?\s*$/m)?.[1];
      if (token) return token;
    } catch {
      // 只报告缺少配置，不输出部署文件或底层错误中的凭据。
    }
  }
  throw new Error('缺少 TESTING_API_TOKEN，无法准备测试账号金币余额');
}

/**
 * 业务请求独立选线，管理写入保留固定入口；失败保留阶段且去除敏感正文。
 * @param client - 当前账号独立网络客户端。
 * @param path - 相对业务路径。
 * @param method - 请求方法。
 * @param body - 请求 JSON 数据。
 * @param headers - 当前接口所需的认证头。
 * @param stage - 不含凭据的阶段描述。
 */
async function requestJson(client, path, method, body, headers, stage) {
  try {
    const response = path.endsWith('/set_balance/testing')
      ? await setTestingBalance(path, body, headers['X-Testing-Api-Token'])
      : await businessRequest(client, path, method, body, headers.Authorization);
    if (!response.result) throw new Error('业务响应失败');
    return response.result;
  } catch (error) {
    throw stageError(error, stage);
  }
}

/**
 * 在账号独占锁内、启动客户端前设置固定金币，再通过真实钱包接口核对。
 * 此准备会创建短期登录会话，客户端仍需完成正常初始化及真实登录。
 * @param account - 本任务已独占账号的用户名、密码及可选的已登记用户 ID。
 * @param token - 仅在 Node 进程使用的测试接口令牌。
 */
export async function prepareTestAccountCoins(account, token) {
  const client = createStagingClient();
  try { return await prepareCoins(client, account, token); }
  finally { client.dispose(); }
}

/** Prepare coins within the caller-owned account client lifetime.
 * @param client - Independent business client.
 * @param account - Locked current test account.
 * @param token - Fixed staging management token.
 */
async function prepareCoins(client, account, token) {
  validateAccount(account, token);
  const session = await requestJson(client, '/public/v10/user/login/username/password', 'POST', {
    username: account.username, password: account.password, device_id: randomUUID(),
  }, {}, '准备账号登录');
  const userId = session.user_id;
  validateSession(session, account);
  const result = await requestJson(client, `/public/v1/wallet/${userId}/set_balance/testing`, 'POST', {
    currency_name: 'coin', balance: initialCoinBalance,
  }, { 'X-Testing-Api-Token': token }, '设置测试金币');
  if (result.wallet_id !== userId || result.currency_name !== 'coin'
    || Number(result.balance) !== Number(initialCoinBalance)) throw new Error('设置测试金币返回钱包、币种或余额不符');
  const wallet = await requestJson(client, `/v10/wallet/${userId}`, 'PUT', { currencies: ['coin'] }, {
    Authorization: `${session.api_token.token_type} ${session.api_token.access_token}`,
  }, '核对测试金币');
  validateCoins(wallet);
  return { userId, authorization: `${session.api_token.token_type} ${session.api_token.access_token}` };
}

/** Permit local deployment secrets only outside CI.
 * @param environment - Process configuration.
 */
function canReadLocalToken(environment) {
  return !environment.CI && environment.GITHUB_ACTIONS !== 'true';
}

/** Validate current account credentials before making requests.
 * @param account - Locked test account.
 * @param token - Testing token.
 */
function validateAccount(account, token) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('缺少 TESTING_API_TOKEN');
  if (typeof account?.username !== 'string' || !/^[a-zA-Z0-9.]{6,30}$/.test(account.username)
    || typeof account.password !== 'string' || !account.password || account.password.length > 20
    || /[\r\n\0]/.test(account.password)) throw new Error('测试账号凭据无效');
}

/** Validate returned identity and session separately from credentials.
 * @param session - Real login result.
 * @param account - Expected account.
 */
function validateSession(session, account) {
  const userId = session.user_id;
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    || session.username !== account.username || (account.userId !== undefined && account.userId !== userId)
    || !validSessionToken(session.api_token)) throw new Error('准备账号登录返回身份或会话不符');
}

/** Reject malformed authorization tokens without logging them.
 * @param token - Service token object.
 */
function validSessionToken(token) {
  return /^Bearer$/i.test(token?.token_type) && typeof token?.access_token === 'string'
    && Boolean(token.access_token) && !/[\r\n]/.test(token.access_token);
}

/** Require exactly one coin balance matching the requested preparation.
 * @param wallet - Real wallet result.
 */
function validateCoins(wallet) {
  const coins = Array.isArray(wallet.currencies) ? wallet.currencies.filter(currency => currency?.code === 'coin') : [];
  if (coins.length !== 1 || Number(coins[0].balance) !== Number(initialCoinBalance)) {
    throw new Error('核对测试金币失败，实际余额不是 10000');
  }
}
