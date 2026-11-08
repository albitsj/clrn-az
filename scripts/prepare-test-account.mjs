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
  return testingToken(environment, deploymentFile);
}

/** Prefer explicit credentials before considering local deployment secrets.
 * @param environment - Current environment.
 * @param deploymentFile - Local deployment file.
 */
async function testingToken(environment, deploymentFile) {
  const configured = environment.TESTING_API_TOKEN?.trim();
  if (configured) return configured;
  return localTestingToken(environment, deploymentFile);
}

/** Refuse local secret fallback in CI and redact read failures.
 * @param environment - Current environment.
 * @param deploymentFile - Local deployment file.
 */
async function localTestingToken(environment, deploymentFile) {
  if (canReadLocalToken(environment)) {
    const token = await deploymentToken(deploymentFile);
    if (token) return token;
  }
  throw new Error('缺少 TESTING_API_TOKEN，无法准备测试账号金币余额');
}

/** Read the local secret without exposing filesystem or parsing errors.
 * @param deploymentFile - Local deployment file.
 */
async function deploymentToken(deploymentFile) {
  try { return secretToken(await readFile(deploymentFile, 'utf8')); }
  catch { return undefined; }
}

/** Select only the named staging Secret document.
 * @param deployment - Deployment YAML text.
 */
function secretToken(deployment) {
  const secret = deployment.split(/^---\s*$/m).find(document =>
    /^kind:\s*Secret\s*$/m.test(document)
    && /^\s+name:\s*test-api-token\s*$/m.test(document)
    && /^\s+namespace:\s*goplay-staging\s*$/m.test(document));
  return secret?.match(/^stringData:\s*\n(?:\s*#.*\n)*\s+token:\s*["']?([A-Za-z0-9_=-]+)["']?\s*$/m)?.[1];
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
    const response = await accountRequest(client, path, method, body, headers);
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
  validatePreparedBalance(result, userId);
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
  validateCredentials(account);
}

/** Validate the account name before reading the password.
 * @param account - Locked account.
 */
function validateCredentials(account) {
  if (!validUsername(account?.username)) throw new Error('测试账号凭据无效');
  requirePassword(account.password);
}

/** Check the UI-compatible username format.
 * @param value - Configured name.
 */
function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9.]{6,30}$/.test(value);
}

/** Check password type and UI length before control characters.
 * @param value - Configured password.
 */
function validPassword(value) {
  if (typeof value !== 'string') return false;
  return validPasswordText(value);
}

/** Validate identity and authorization before wallet operations.
 * @param session - Real login result.
 * @param account - Expected account.
 */
function validateSession(session, account) {
  if (!validUserId(session.user_id)) throw new Error('准备账号登录返回身份或会话不符');
  validateIdentity(session, account);
  if (!validSessionToken(session.api_token)) throw new Error('准备账号登录返回身份或会话不符');
}

/** Verify a UUID before using it in a request path.
 * @param value - Returned identity.
 */
function validUserId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Require both configured identity fields to match.
 * @param session - Login result.
 * @param account - Expected account.
 */
function validateIdentity(session, account) {
  if (session.username !== account.username) throw new Error('准备账号登录返回身份或会话不符');
  validateRegisteredId(session.user_id, account.userId);
}

/** Compare the optional pre-registered ID.
 * @param actual - Returned ID.
 * @param registered - Optional configured ID.
 */
function validateRegisteredId(actual, registered) {
  if (registered !== undefined && registered !== actual) throw new Error('准备账号登录返回身份或会话不符');
}

/** Reject malformed authorization tokens without logging them.
 * @param token - Service token object.
 */
function validSessionToken(token) {
  if (!/^Bearer$/i.test(token?.token_type)) return false;
  return validAccessToken(token.access_token);
}

/** Require a nonempty, single-line access token.
 * @param value - Access token.
 */
function validAccessToken(value) {
  if (typeof value !== 'string') return false;
  return Boolean(value) && !/[\r\n]/.test(value);
}

/** Verify the management response belongs to the requested wallet and currency.
 * @param result - Returned balance.
 * @param userId - Current wallet ID.
 */
function validatePreparedBalance(result, userId) {
  const fields = [[result.wallet_id, userId], [result.currency_name, 'coin'],
    [Number(result.balance), Number(initialCoinBalance)]];
  if (!fields.every(([actual, expected]) => actual === expected)) throw new Error('设置测试金币返回钱包、币种或余额不符');
}

/** Require exactly one coin balance matching the requested preparation.
 * @param wallet - Real wallet result.
 */
function validateCoins(wallet) {
  const coins = Array.isArray(wallet.currencies) ? wallet.currencies.filter(currency => currency?.code === 'coin') : [];
  requireCoinBalance(coins);
}

/** Check the unique selected coin balance.
 * @param coins - Matching currencies.
 */
function requireCoinBalance(coins) {
  if (coins.length !== 1 || Number(coins[0].balance) !== Number(initialCoinBalance)) {
    throw new Error('核对测试金币失败，实际余额不是 10000');
  }
}

/** Keep management writes on their fixed endpoint.
 * @param client - Business client.
 * @param path - Request path.
 * @param method - Request method.
 * @param body - JSON payload.
 * @param headers - Request credentials.
 */
function accountRequest(client, path, method, body, headers) {
  if (path.endsWith('/set_balance/testing')) return setTestingBalance(path, body, headers['X-Testing-Api-Token']);
  return businessRequest(client, path, method, body, headers.Authorization);
}

/** Validate a credential's password after its username.
 * @param password - Configured password.
 */
function requirePassword(password) {
  if (!validPassword(password)) throw new Error('测试账号凭据无效');
}

/** Keep the original nonempty UI password restrictions.
 * @param value - Password string.
 */
function validPasswordText(value) {
  return Boolean(value) && value.length <= 20 && !/[\r\n\0]/.test(value);
}
