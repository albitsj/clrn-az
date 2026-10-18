import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { allocateCiAccount, ciAccountCredentials, ciAccounts, executionAccounts, androidAccountMatrix } from './ci-accounts.mjs';

test('连续 70 个运行 ID 只轮转 Android 新账号，重跑和大整数 ID 分配稳定', () => {
  assert.equal(new Set(Array.from({length:70},(_,i)=>allocateCiAccount(String(100+i)))).size,70);
  assert.equal(allocateCiAccount('90071992547409931'), allocateCiAccount('90071992547409931'));
  assert.equal(allocateCiAccount('90071992547409931'), executionAccounts[Number(90071992547409931n % 70n)]);
  for (const id of ['', '1\n', 'abc', '-1', undefined]) assert.throws(()=>allocateCiAccount(id));
  for (const offset of [-1,70,0.5]) assert.throws(()=>allocateCiAccount('1',offset));
});

test('凭据按公开账号名读取，不依赖 Secret 排序，错误不包含密码', () => {
  const password='SensitiveTest1234';
  const accounts=ciAccounts.map(username=>({username,password,status:'ready'}));
  assert.deepEqual(ciAccountCredentials(JSON.stringify({accounts:[...accounts].reverse()}),executionAccounts[5]),{username:executionAccounts[5],password});
  for (const invalid of [password,JSON.stringify({accounts:accounts.slice(1)}),
    JSON.stringify({accounts:[accounts[0],...accounts.slice(0,-1)]}),
    JSON.stringify({accounts:accounts.map((a,i)=>i===0?{...a,status:'registered'}:a)}),
    JSON.stringify({accounts:accounts.map((a,i)=>i===0?{...a,password:'x'.repeat(21)}:a)}),
    JSON.stringify({accounts:accounts.map((a,i)=>i===0?{...a,password:'injected\nKEY=value'}:a)})]) {
    assert.throws(()=>ciAccountCredentials(invalid,executionAccounts[5]), error=>!error.message.includes(password));
  }
  assert.throws(()=>ciAccountCredentials(JSON.stringify({accounts}),'laiwanvisual01'));
});

test('Actions 调度输出与注入凭据一致，只导出一个账号，配置缺失时拒绝默认账号', () => {
  const directory=mkdtempSync(join(tmpdir(),'ci-account-env-'));
  const output=join(directory,'outputs');
  const environment=join(directory,'environment');
  try {
    writeFileSync(output, '');
    const planned=spawnSync(process.execPath,['scripts/plan-ci-accounts.mjs','android'],{
      encoding:'utf8',env:{...process.env,GITHUB_RUN_ID:'29',GITHUB_OUTPUT:output,CI_ANDROID_GROUP:'all'},
    });
    assert.equal(planned.status,0,planned.stderr);
    const {include}=JSON.parse(readFileSync(output,'utf8').slice('matrix='.length));
    const selected=include[0].account;
    const accounts=ciAccounts.map((username,i)=>({username,password:`FakePassword${i}123`,status:'ready'}));
    const configured=spawnSync(process.execPath,['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'albitsj/clrn-az',GITHUB_ENV:environment,
        CLRN_CI_ACCOUNT:selected,CLRN_CI_TEST_ACCOUNTS:JSON.stringify({accounts}),TESTING_API_TOKEN:'test-token'},
    });
    assert.equal(configured.status,0,configured.stderr);
    assert.equal(readFileSync(join(directory, 'prepared-accounts'), 'utf8'), `${selected}\n`);
    const values=Object.fromEntries(readFileSync(environment,'utf8').trim().split('\n').map(line=>{
      const delimiter=line.indexOf('=');return [line.slice(0,delimiter),line.slice(delimiter+1)];
    }));
    const password=accounts.find(account=>account.username===selected).password;
    for(const prefix of ['E2E_TEST','E2E_CREATION','VISUAL']) {
      assert.equal(values[`${prefix}_USERNAME`],selected);
      assert.equal(values[`${prefix}_PASSWORD`],password);
    }
    assert.equal(Object.keys(values).length,6);
    assert.ok(configured.stdout.includes(`::add-mask::${password}`));
    assert.ok(!configured.stdout.includes(accounts.find(account=>account.username!==selected).password));
    for (const failedPath of ['/set_balance/testing', '/v10/wallet/', '/v10/house/user/', '/v2/building/rooms']) {
      writeFileSync(environment, '');
      writeFileSync(join(directory, 'reject-wallet'), failedPath);
      const rejected = spawnSync(process.execPath,
        ['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'], {
          encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true',
            GITHUB_REPOSITORY: 'albitsj/clrn-az', GITHUB_ENV: environment, TESTING_API_TOKEN: 'test-token',
            CLRN_CI_ACCOUNT: selected, CLRN_CI_TEST_ACCOUNTS: JSON.stringify({ accounts }) },
        });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /失败（HTTP 401）/);
      assert.equal(readFileSync(environment, 'utf8'), '');
      assert.ok(!rejected.stderr.includes('private-token'));
    }
    rmSync(join(directory, 'reject-wallet'));
    writeFileSync(environment, '');
    const foreignRepository = spawnSync(process.execPath, ['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'], {
      encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'kevinanew/laiwan_react_native', GITHUB_ENV: environment,
        CLRN_CI_ACCOUNT: selected, CLRN_CI_TEST_ACCOUNTS: JSON.stringify({ accounts }) },
    });
    assert.notEqual(foreignRepository.status, 0);
    assert.match(foreignRepository.stderr, /只允许在 albitsj\/clrn-az/);
    assert.equal(readFileSync(environment, 'utf8'), '');
    assert.ok(!foreignRepository.stdout.includes(password));
    const missing=spawnSync(process.execPath,['--import', './scripts/account-network-fixture.mjs', 'scripts/configure-ci-account.mjs'],{
      encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'albitsj/clrn-az',GITHUB_ENV:environment,
        CLRN_CI_ACCOUNT:selected,CLRN_CI_TEST_ACCOUNTS:''},
    });
    assert.notEqual(missing.status,0);
    assert.equal(readFileSync(environment,'utf8'),'');
  } finally {rmSync(directory,{recursive:true,force:true});}
});


test('仓库账号分区固定，不能选用另一仓库账号，接受分区凭据', () => {
  assert.equal(executionAccounts.length, 70);
  const reserved = ciAccounts.slice(0, 30);
  const accounts = executionAccounts.map(username => ({ username, password: 'Partition123', status: 'ready' }));
  const serialized = JSON.stringify({ accounts });
  for (let run = 0; run < 200; run += 1) {
    assert.ok(!reserved.includes(allocateCiAccount(String(run))));
  }
  assert.equal(ciAccountCredentials(serialized, executionAccounts[0]).username, executionAccounts[0]);
  assert.throws(() => ciAccountCredentials(serialized, reserved[0]));
  const full = JSON.stringify({ accounts: ciAccounts.map(username => ({ username, password: 'Partition123', status: 'ready' })) });
  assert.throws(() => ciAccountCredentials(full, reserved[0]));
});


test('安卓超时场景分片后独占账号，筛选保持槽位，牌桌优先', () => {
  const full = androidAccountMatrix('29').include;
  assert.equal(full.length, 32);
  assert.equal(new Set(full.map(item => item.account)).size, 32);
  const groups = ['guest', 'account', 'social', 'rooms', 'wallet-help', 'records', 'texas', 'zhajinhua'];
  const locales = ['zh-Hans', 'zh-Hant', 'en'];
  assert.deepEqual([...new Set(full.map(item => `${item.group}/${item.locale}`))],
    ['texas', 'zhajinhua', ...groups.slice(0, 6)].flatMap(group => locales.map(locale => `${group}/${locale}`)));
  for (const group of groups) for (const locale of locales) {
    const parts = full.filter(item => item.group === group && item.locale === locale);
    assert.equal(parts[0].account, allocateCiAccount('29', groups.indexOf(group) * 3 + locales.indexOf(locale)));
    assert.deepEqual(androidAccountMatrix('29', group, locale).include, parts);
  }
  const labels = {
    'texas/zh-Hans': ['pre_game', 'optional_pre_game', 'game', 'panels', 'hall', 'records_v2',
      'controls', 'table_states', 'panel_variants', 'hall_variants'],
    'texas/zh-Hant': ['pre_game', 'optional_pre_game', 'game', 'panels', 'hall', 'records_v2',
      'controls', 'table_states', 'panel_variants', 'hall_variants'],
    'texas/en': ['pre_game_first', 'pre_game_second', 'optional_pre_game', 'game', 'panels', 'hall', 'records_v2',
      'controls', 'table_states', 'panel_variants', 'hall_variants'],
    'zhajinhua/en': ['pre_game_first', 'pre_game_second', 'game'],
  };
  for (const [key, suffixes] of Object.entries(labels)) {
    const [group, locale] = key.split('/');
    const parts = full.filter(item => item.group === group && item.locale === locale);
    for (const suffix of suffixes) {
      const title = `${locale} / ${group} / signed_in_${group}_${suffix}`;
      assert.equal(parts.filter(item => new RegExp(item.filter).test(title)).length, 1, title);
    }
  }
  assert.throws(() => androidAccountMatrix('29', 'typo'));
  assert.throws(() => androidAccountMatrix('29', 'all', 'typo'));
});
