import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { scanPythonLines } from './lint-python-lines.mjs';
import { repository } from './source-files.mjs';

/**
 * 建立独立临时 Git 仓库，以真实扫描器和忽略规则验证命令行行为。
 * @param context - 测试上下文，用于注册清理。
 */
function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'python-lines-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', root]);
  mkdirSync(join(root, 'scripts'));
  for (const file of ['scripts/source-files.mjs', 'scripts/lint-python-lines.mjs', '.gitignore']) {
    copyFileSync(join(repository, file), join(root, file));
  }
  return root;
}

/**
 * 在任意嵌套路径写入临时源码。
 * @param root - 临时仓库根目录。
 * @param file - 仓库内相对路径。
 * @param source - 文件的完整内容。
 */
function writeSource(root, file, source) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), source);
}

/**
 * 从仓库外调用独立扫描入口，保留真实退出码与诊断。
 * @param root - 临时仓库根目录。
 * @param env - 子进程环境，可用于验证缺失工具。
 */
function runGate(root, env = process.env) {
  return spawnSync(process.execPath, [join(root, 'scripts/lint-python-lines.mjs')],
    { cwd: tmpdir(), encoding: 'utf8', env });
}

for (const ending of ['\n', '\r\n']) {
  for (const trailing of [true, false]) {
    test(`500 行通过、501 行失败：${JSON.stringify(ending)}，末尾换行 ${trailing}`, context => {
      const root = fixture(context);
      const file = 'nested/含 空格的源码.py';
      for (const lines of [500, 501]) {
        const source = Array(lines).fill('# 注释').join(ending) + (trailing ? ending : '');
        writeSource(root, file, source);
        assert.deepEqual(scanPythonLines(root), [{ file, lines }]);
        const result = runGate(root);
        assert.equal(result.status, lines === 500 ? 0 : 1, result.stderr);
        assert.match(result.stdout, new RegExp(`扫描 1 个文件；最长 ${file}: ${lines} 行；上限 500 行`));
        if (lines === 501) assert.match(result.stderr, /501 行（上限 500 行）/);
        assert.equal(readFileSync(join(root, file), 'utf8'), source);
      }
    });
  }
}

test('空文件为零行，空行、注释和 docstring 全部计数', context => {
  const root = fixture(context);
  writeSource(root, 'empty.py', '');
  writeSource(root, 'blank.py', '\n');
  writeSource(root, 'documented.py', '# 注释\n\n"""\n文档\n"""');
  assert.deepEqual(scanPythonLines(root), [
    { file: 'blank.py', lines: 1 }, { file: 'documented.py', lines: 5 }, { file: 'empty.py', lines: 0 },
  ]);
  assert.equal(runGate(root).status, 0);
});

test('覆盖已跟踪、新增、代理、测试、fixture 和工具，跳过已删除文件', context => {
  const root = fixture(context);
  const tracked = ['tracked.py', 'deleted.py', 'nested/deleted.py', 'staged-deleted.py', 'app/tracked.py'];
  for (const file of tracked) writeSource(root, file, '# tracked\n');
  execFileSync('git', ['add', '--force', ...tracked], { cwd: root });
  for (const file of ['deleted.py', 'nested', 'staged-deleted.py']) rmSync(join(root, file), { recursive: true });
  execFileSync('git', ['add', '--update', '--', 'staged-deleted.py'], { cwd: root });
  const added = ['android/proxy-addon.py', 'tests/test_probe.py', 'android/fixtures/nested/probe.py', 'tools/probe.py'];
  for (const file of added) writeSource(root, file, '\n'.repeat(501));
  writeSource(root, 'other.ts', '\n'.repeat(501));
  assert.deepEqual(scanPythonLines(root).map(entry => entry.file), [...added, 'tracked.py', 'app/tracked.py'].sort());
  const result = runGate(root);
  assert.equal(result.status, 1);
  for (const file of added) assert.ok(result.stderr.includes(`${file}: 501 行（上限 500 行）`));
  assert.match(result.stdout, /扫描 6 个文件/);
});

test('沿用忽略规则和明确排除目录，排除项即使已跟踪也跳过', context => {
  const root = fixture(context);
  writeSource(root, 'kept.py', '# kept');
  const excluded = ['node_modules', '.venv', 'test-results', 'playwright-report', 'blob-report', 'snapshots', '.ttyctl'];
  for (const directory of excluded) {
    const file = `nested/${directory}/excluded.py`;
    writeSource(root, file, '\n'.repeat(501));
    execFileSync('git', ['add', '--force', '--', file], { cwd: root });
  }
  for (const directory of ['app', 'android/artifacts', '__pycache__', '.ruff_cache']) {
    writeSource(root, `${directory}/ignored.py`, '\n'.repeat(501));
  }
  assert.deepEqual(scanPythonLines(root), [{ file: 'kept.py', lines: 1 }]);
  assert.equal(runGate(root).status, 0);
});

test('没有适用 Python 文件时失败', context => {
  const root = fixture(context);
  writeSource(root, 'app/ignored.py', '# ignored');
  const result = runGate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未发现 Python 源文件，拒绝空扫描/);
});

test('损坏的源码符号链接触发读取失败，不当作已删除文件跳过', context => {
  const root = fixture(context);
  writeSource(root, 'kept.py', '# kept');
  symlinkSync('missing-target', join(root, 'unreadable.py'));
  const result = runGate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT.*unreadable\.py/);
});

test('缺少 Git 或不在 Git 仓库中时失败', context => {
  const root = fixture(context);
  writeSource(root, 'kept.py', '# kept');
  const missingTool = runGate(root, { ...process.env, PATH: root });
  assert.equal(missingTool.status, 1);
  assert.match(missingTool.stderr, /git.*ENOENT/);
  rmSync(join(root, '.git'), { recursive: true });
  const outsideGit = runGate(root);
  assert.equal(outsideGit.status, 1);
  assert.match(outsideGit.stderr, /not a git repository/);
});

test('真实 npm Python 静态入口在 Ruff 之前拒绝超长的新文件', context => {
  const root = fixture(context);
  copyFileSync(join(repository, 'package.json'), join(root, 'package.json'));
  writeSource(root, 'probe.py', '\n'.repeat(501));
  const result = spawnSync('npm', ['run', 'lint:python'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /probe\.py: 501 行（上限 500 行）/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
});
