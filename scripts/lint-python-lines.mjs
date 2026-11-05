import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, sourceFiles } from './source-files.mjs';

const limit = 500;

/**
 * 按物理行统计全部适用 Python 文件，包括空行、注释及 docstring。
 * @param root - 待扫描的 Git 仓库根目录。
 * @returns 每个文件的相对路径及物理行数。
 */
export function scanPythonLines(root = repository) {
  const files = sourceFiles(root).filter(file => file.endsWith('.py'));
  if (files.length === 0) throw new Error('未发现 Python 源文件，拒绝空扫描。');
  return files.map(file => {
    const source = readFileSync(join(root, file), 'utf8');
    const lines = source === '' ? 0 : source.split(/\r\n|[\r\n]/).length - Number(/[\r\n]$/.test(source));
    return { file, lines };
  });
}

/** 执行整仓 Python 行数硬门禁，输出当前文件数、最长文件及所有超限位置。 */
function checkPythonLines() {
  const files = scanPythonLines();
  const failures = files.filter(entry => entry.lines > limit);
  const longest = files.reduce((previous, entry) => entry.lines > previous.lines ? entry : previous);
  for (const { file, lines } of failures) console.error(`${file}: ${lines} 行（上限 ${limit} 行）`);
  console.log(`Python 行数检查${failures.length ? '失败' : '通过'}：扫描 ${files.length} 个文件；最长 ${longest.file}: ${longest.lines} 行；上限 ${limit} 行。`);
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  checkPythonLines();
}
