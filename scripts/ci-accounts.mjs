import { readFileSync } from 'node:fs';

// 这里只维护公开账号名，密码统一保存在 CLRN_CI_TEST_ACCOUNTS_V2 Secret。
export const ciAccounts = JSON.parse(readFileSync(new URL('./ci-test-accounts.json', import.meta.url), 'utf8')).accounts;
if (ciAccounts.length !== 100 || new Set(ciAccounts.map(name => name.toLowerCase())).size !== 100) {
  throw new Error('CI 账号清单必须包含 100 个不同账号。');
}

// 两个仓库固定使用互不相交的账号；GitHub concurrency 仅在本仓库生效。
export const executionAccounts = ciAccounts.slice(30);

/**
 * 按运行 ID 轮转账号槽位；账号级 GitHub concurrency 才负责跨 runner 互斥。
 * 同一次重跑复用相同槽位；不同任务若选到同一账号会排队，不会重复登录。
 * @param runId - GitHub Actions 运行 ID，使用字符串以免大整数丢失精度。
 * @param offset - 本轮任务相对起始槽位的偏移。
 * @returns 本任务使用的公开账号名。
 */
export function allocateCiAccount(runId, offset = 0) {
  if (!validAllocation(runId, offset)) {
    throw new Error('CI 账号分配需要有效运行 ID 和账号槽位偏移。');
  }
  return executionAccounts[Number((BigInt(runId) + BigInt(offset)) % BigInt(executionAccounts.length))];
}

/**
 * 安卓各业务组与语言使用新建的 70 个账号，与 Web 的老 30 个账号隔离。
 * @param runId - 当前 GitHub Actions 运行编号。
 * @param selectedGroup - 全部业务组或一个指定组。
 * @param selectedLocale - 全部语言或一种指定语言。
 */
export function androidAccountMatrix(runId, selectedGroup = 'all', selectedLocale = 'all') {
  // 保留业务组的固定槽位，德州、拼三张的全部语言优先进入矩阵。
  const groups = ['guest', 'account', 'social', 'rooms', 'wallet-help', 'records', 'texas', 'zhajinhua'];
  const executionOrder = ['texas', 'zhajinhua', ...groups.filter(group => group !== 'texas' && group !== 'zhajinhua')];
  const locales = ['zh-Hans', 'zh-Hant', 'en'];
  const texasTable = 'signed_in_texas_(?:pre_game|optional_pre_game|game|panels)$';
  const texasOther = 'signed_in_texas_(?:hall|records_v2|controls|table_states|panel_variants|hall_variants)$';
  const shards = {
    'texas/zh-Hans': [['table', texasTable], ['other', texasOther]],
    'texas/zh-Hant': [['table', texasTable], ['other', texasOther]],
    'texas/en': [
      ['pregame-first', 'signed_in_texas_pre_game_first$'],
      ['pregame-middle', 'signed_in_texas_pre_game_middle$'],
      ['pregame-second', 'signed_in_texas_(?:pre_game_second|optional_pre_game)$'],
      ['game-table', 'signed_in_texas_game_table$'],
      ['game-effects', 'signed_in_texas_game_(?:effects|profiles)$'],
      ['panels', 'signed_in_texas_(?:panels|panel_variants)$'],
      ['other', 'signed_in_texas_(?:hall|records_v2|controls|table_states|hall_variants)$'],
    ],
    'zhajinhua/en': [
      ['pregame-first', 'signed_in_zhajinhua_pre_game_first$'],
      ['pregame-second', 'signed_in_zhajinhua_pre_game_second$'],
      ['game-table', 'signed_in_zhajinhua_game_table$'],
      ['game-effects', 'signed_in_zhajinhua_game_effects$'],
    ],
  };
  const shardOffsets = {
    'texas/zh-Hans': 24, 'texas/zh-Hant': 25, 'texas/en': 26, 'zhajinhua/en': 32,
  };
  validateSelection(selectedGroup, groups, '未知安卓业务组。');
  validateSelection(selectedLocale, locales, '未知安卓语言。');
  return { include: executionOrder.filter(group => selectedGroup === 'all' || group === selectedGroup)
    .flatMap(group => locales.filter(locale => selectedLocale === 'all' || locale === selectedLocale)
      .flatMap(locale => {
        const key = `${group}/${locale}`;
        const parts = shards[key] || [['all', '']];
        return parts.map(([shard, filter], index) => ({ group, locale, shard, filter,
          label: `${group} / ${locale}${shard === 'all' ? '' : ` / ${shard}`}`,
          account: allocateCiAccount(runId, index === 0
            ? groups.indexOf(group) * 3 + locales.indexOf(locale) : shardOffsets[key] + index - 1) }));
      })) };
}

/**
 * 从 Secret 中读取指定槽位的凭据，校验完整账号池并隐藏所有解析细节。
 * @param serialized - GitHub Actions Secret 中的账号池 JSON。
 * @param username - 调度阶段选出的公开账号名，必须属于 CI 专用清单。
 * @returns 指定 CI 账号的用户名和密码。
 */
export function ciAccountCredentials(serialized, username) {
  const accounts = secretAccounts(serialized);
  const seen = new Set();
  for (const account of accounts) {
    validatePoolAccount(account, seen);
    seen.add(account.username);
  }
  validatePartition(seen, username);
  const selected = accounts.find(account => account.username === username);
  if (!selected) throw new Error('所选账号不属于 CI 专用池。');
  return { username: selected.username, password: selected.password };
}

/** Parse credentials without exposing the secret or JSON diagnostics.
 * @param serialized - Secret JSON.
 */
function parseSecret(serialized) {
  try { return JSON.parse(serialized); }
  catch { throw new Error('CLRN_CI_TEST_ACCOUNTS Secret 缺失或不是有效 JSON。'); }
}

/** Require an account array before inspecting its length.
 * @param serialized - Secret JSON.
 */
function secretAccounts(serialized) {
  const accounts = parseSecret(serialized)?.accounts;
  if (!Array.isArray(accounts)) throw new Error('CI Secret 必须包含完整的 70 个 Android 专用账号，或迁移前的 100 个账号。');
  validatePoolSize(accounts);
  return accounts;
}

/** Accept only the complete current pool or the migration pool.
 * @param accounts - Parsed array.
 */
function validatePoolSize(accounts) {
  if (![executionAccounts.length, ciAccounts.length].includes(accounts.length)) {
    throw new Error('CI Secret 必须包含完整的 70 个 Android 专用账号，或迁移前的 100 个账号。');
  }
}

/** Check membership before reading the remaining credential fields.
 * @param account - Secret entry.
 * @param seen - Previously registered names.
 */
function validatePoolAccount(account, seen) {
  validatePoolName(account?.username, seen);
  validateReadyCredentials(account);
}

/** Reject unknown or duplicate names.
 * @param username - Entry name.
 * @param seen - Registered names.
 */
function validatePoolName(username, seen) {
  if (!ciAccounts.includes(username) || seen.has(username)) {
    throw new Error('CI Secret 包含重复、未就绪或无效凭据；请核对账号池备份。');
  }
}

/** Require a ready account with a UI-compatible password.
 * @param account - Known pool entry.
 */
function validateReadyCredentials(account) {
  if (account.status !== 'ready' || !validPassword(account.password)) {
    throw new Error('CI Secret 包含重复、未就绪或无效凭据；请核对账号池备份。');
  }
}

/** Check password type before inspecting its contents.
 * @param value - Secret password.
 */
function validPassword(value) {
  return typeof value === 'string' && validPasswordText(value);
}

/** Preserve the H5 password restrictions.
 * @param value - String password.
 */
function validPasswordText(value) {
  return Boolean(value.trim()) && value.length <= 20 && !/[\r\n\0]/.test(value);
}

/** Enforce the repository-specific partition after validating the entire pool.
 * @param seen - Validated account names.
 * @param username - Selected account.
 */
function validatePartition(seen, username) {
  if (!executionAccounts.every(name => seen.has(name)) || !executionAccounts.includes(username)) {
    throw new Error('所选账号或 Secret 不属于本仓库的专用账号分区。');
  }
}

/** Require a nonempty decimal run identifier.
 * @param value - GitHub run ID.
 */
function validRunId(value) {
  if (typeof value !== 'string') return false;
  return Boolean(value) && !/\D/.test(value);
}

/** Check the available account partition bounds.
 * @param value - Slot offset.
 */
function validOffset(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < executionAccounts.length;
}

/** Validate both inputs before converting the run ID to BigInt.
 * @param runId - GitHub run identifier.
 * @param offset - Slot offset.
 */
function validAllocation(runId, offset) {
  return validRunId(runId) && validOffset(offset);
}

/** Validate a named matrix dimension while permitting all entries.
 * @param selected - Requested dimension.
 * @param allowed - Registered values.
 * @param message - Existing diagnostic.
 */
function validateSelection(selected, allowed, message) {
  if (selected !== 'all' && !allowed.includes(selected)) throw new Error(message);
}
