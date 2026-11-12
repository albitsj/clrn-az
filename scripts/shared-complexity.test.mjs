import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repository } from './source-files.mjs';

/** Lint a temporary source string with the actual production overrides.
 * @param source - Probe source, never executed.
 * @param filePath - Responsibility path used by the gate.
 */
async function diagnostics(source, filePath) {
  const [result] = await new ESLint().lintText(source, { filePath });
  assert.equal(result.fatalErrorCount, 0);
  return result.messages.filter(message => message.ruleId === 'complexity');
}

const supportPaths = ['e2e/helpers/mitmproxy-process-extra.ts', 'e2e/helpers/mitmproxy-session.test.mjs',
  'visual/cases/_shared/room.ts', 'visual/cases/hall/new-helper.ts', 'visual/scenarios-build.ts',
  'visual/test-account-extra.ts', 'scripts/prepare-test-account-extra.mjs', 'scripts/account-network-fixture.mjs',
  'scripts/ci-accounts.mjs', 'scripts/configure-ci-account.mjs', 'scripts/plan-ci-accounts.mjs',
  'scripts/with-test-account.mjs', 'scripts/shared-test-cases.mjs', 'scripts/shared-complexity.test.mjs',
  'scripts/staging-deployment-extra.test.mjs'];
const toolPaths = ['eslint.config.mjs', '.dependency-cruiser.cjs', 'lint-lines.mjs',
  'scripts/network-syntax-nodes.mjs', 'scripts/lint-ratchet.mjs', 'scripts/shared-complexity.mjs'];

for (const [maximum, paths] of [[3, supportPaths], [6, toolPaths]]) {
  for (const file of paths) {
    test(`${file}: accepts ${maximum} and rejects ${maximum + 1}`, async () => {
      await assertBoundary(file, maximum);
    });
  }
}

/** Check the exact passing and failing side of a responsibility limit.
 * @param file - Scoped source path.
 * @param maximum - Applicable classic complexity limit.
 */
async function assertBoundary(file, maximum) {
  const passing = 'if(a) return 1;'.repeat(maximum - 1);
  const accepted = await diagnostics(`function probe(a) { ${passing} }`, file);
  const rejected = await diagnostics(`function probe(a) { ${passing} if(a) return 2; }`, file);
  assert.deepEqual([accepted.length, rejected.length], [0, 1]);
}

for (const source of [
  'function outer() { return () => { if(a) return 1; if(b) return 2; if(c) return 3; }; }',
  '/* eslint-disable complexity */ function helper(a) { return a?.b?.c || 0; }',
  '/* eslint complexity: off */ function helper(a = 0) { return a && b || c; }',
  'const helper = { get value() { if(a) return 1; if(b) return 2; if(c) return 3; } };',
  'class Helper { constructor(a = 0) { if(a) return; if(b) return; } }',
]) {
  test(`classic counting and inline-disable protection: ${source}`, async () => {
    assert.equal((await diagnostics(source, 'visual/cases/_shared/probe.ts')).length, 1);
  });
}

/** Create an isolated repository using the gate's real scripts and configuration.
 * @param context - Test cleanup owner.
 */
function temporaryProject(context) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'shared-complexity-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(join(directory, 'scripts'));
  for (const file of ['package.json', 'eslint.config.mjs', 'scripts/shared-scope.mjs',
    'scripts/shared-complexity.mjs', 'scripts/shared-complexity-runner.mjs', 'scripts/source-files.mjs', 'scripts/android-game-scope.mjs',
    'scripts/android-navigation-scope.mjs', 'scripts/network-syntax.mjs', 'scripts/network-syntax-nodes.mjs', 'scripts/network-reference.mjs']) {
    fs.cpSync(join(repository, file), join(directory, file));
  }
  fs.symlinkSync(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir');
  fs.mkdirSync(join(directory, 'visual/cases/_shared'), { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  return directory;
}

test('standalone and lint:js entry points block violations and parsing failures', context => {
  const directory = temporaryProject(context);
  const options = { cwd: directory, encoding: 'utf8' };
  const path = join(directory, 'visual/cases/_shared/probe.ts');
  fs.writeFileSync(path, 'export const probe = 1;');
  const clean = spawnSync(process.execPath, ['scripts/shared-complexity.mjs'], options);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  fs.writeFileSync(path, '/* eslint-disable complexity */ function helper(a) { if(a) return 1; if(a) return 2; if(a) return 3; }');
  for (const [command, args] of [[process.execPath, ['scripts/shared-complexity.mjs']], ['npm', ['run', 'lint:js']]]) {
    const result = spawnSync(command, args, options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /probe\.ts/);
    assert.match(result.stderr, /complexity of 4.*Maximum allowed is 3/);
  }
  fs.writeFileSync(path, 'function broken( {');
  const broken = spawnSync(process.execPath, ['scripts/shared-complexity.mjs'], options);
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /Parsing error/);
  const report = spawnSync(process.execPath, ['scripts/shared-complexity.mjs', '--report'], options);
  assert.notEqual(report.status, 0);
  assert.match(report.stderr, /无法解析/);
});

test('missing ESLint dependency fails without accepting an empty result', context => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'shared-missing-dependency-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of ['shared-complexity.mjs', 'shared-complexity-runner.mjs', 'shared-scope.mjs', 'source-files.mjs']) {
    fs.writeFileSync(join(directory, file), fs.readFileSync(join(repository, 'scripts', file), 'utf8'));
  }
  const result = spawnSync(process.execPath, [join(directory, 'shared-complexity.mjs')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(result.stderr, /Cannot find package 'eslint'/);
});
