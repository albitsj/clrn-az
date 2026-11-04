# 提交前检查

根目录 `.pre-commit-config.yaml` 通过 Python pre-commit 管理 Git hook，复用现有 npm 检查入口。
规则、阈值和历史门禁仍见 [静态质量门禁](../quality/README.md)。

## 工具与首次安装

本地与 `.github/workflows/check.yml` 使用以下版本：

| 依赖 | 固定版本 | 用途 |
| --- | --- | --- |
| Node.js | 24.14.0 | 仓库要求 Node 24+，执行静态工具与测试 |
| npm | 11.9.0 | 按 `package-lock.json` 安装 Node 依赖 |
| uv | 0.11.32 | 创建虚拟环境，运行现有固定版本 Ruff、ShellCheck、actionlint |
| CPython | 3.12.12 | 在本机和 CI 使用相同的 Python 环境 |
| pre-commit | 4.6.0 | 版本集中声明于 `requirements-dev.txt` |

先安装上述 Node.js、npm、uv 和 Git；uv 会在需要时下载指定 Python。
从仓库根目录执行（macOS / Linux，bash / zsh）：

```sh
node --version
npm --version
uv --version
npm ci
uv venv --python 3.12.12 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt
source .venv/bin/activate
python --version
pre-commit --version
pre-commit install
pre-commit run --all-files
```

pre-commit 只安装在被 Git 忽略的 `.venv/` 内，不需要全局 Python 包。
首次检查需要网络下载现有 `uvx` 工具及其依赖，之后使用 uv 缓存。
`language: system` 表示 hook 使用当前 `PATH` 中的 Node、npm、uv 和已经安装的 `node_modules`；
pre-commit 不负责安装这些工具。确保命令行和 IDE 的 Git 进程都能找到它们。
安装脚本记录虚拟环境中的 Python 路径；后续提交无需每次激活虚拟环境。
手动执行时可激活环境，或使用 `.venv/bin/pre-commit`。

Git 不会复制 `.git/hooks`；每次新克隆或在新的 Git hooks 目录中工作都要执行 `pre-commit install`。
移动仓库或重建 `.venv` 后重新安装 hook，使脚本指向有效的解释器。
如果设置了 `core.hooksPath` 或已有其他 hook 管理器，先确认自己的配置；不要直接覆盖已有 hook。
pre-commit 默认会保留原有 hook 并以迁移模式运行它。

## 执行范围

| Hook | 入口 | 匹配范围 | 文件名参数 | 执行方式 |
| --- | --- | --- | --- | --- |
| `repository-lint` | `npm run lint` | `files: ^`、`types: [file]`，匹配所有普通文件 | `pass_filenames: false` | `language: system`，`require_serial: true`，整仓一次 |
| `repository-typecheck` | `npm run typecheck` | 同上 | 同上 | 同上 |

两者均设置 `always_run: true`：包括只改文档、配置、依赖、夹具、只删文件或空提交，都会执行。
整仓检查会受配置、导入和历史门禁影响，因此不按扩展名跳过；匹配仅用于触发，不限制工具扫描范围。
`pass_filenames: false` 配合串行执行，保证多个文件也不会分批启动整仓命令。
默认只在 `pre-commit` 阶段运行。

hook 只读检查，不运行自动修复、用例收集、完整测试、浏览器截图、Staging 请求、账号分配、
Android 设备或 iOS 模拟器。CI 在运行同一份配置后，继续执行 `npm run test:android:collect`、
`npm test` 和原有 Python 代理单元测试；`npm run check` 仍可手动运行全部本机检查。
CI 不依赖开发者是否安装或跳过本地 hook。

## 手动检查与失败处理

```sh
pre-commit run --all-files             # 与 CI 相同的两个整仓检查
pre-commit run                       # 按当前暂存内容检查
pre-commit run repository-lint --all-files
pre-commit run repository-typecheck --all-files
```

失败时会显示原 npm 命令的错误、文件位置和退出状态，并阻止本次提交。
按原始诊断手动修复，然后 `git add <修复的文件>` 并重新提交；hook 不会替你修改或暂存源码。
可分别运行 `npm run lint:js`、`npm run lint:python`、`npm run lint:shell`、
`npm run lint:workflows`、`npm run lint:lines`、`npm run lint:architecture`、
`npm run lint:duplicates` 和 `npm run typecheck` 定位问题。

Python 源文件另有 **500 物理行**硬门禁，独立运行 `npm run lint:python:lines`
（或 `node scripts/lint-python-lines.mjs`）。`npm run lint:python` 先执行行数门禁，再执行 Ruff；
因此 `npm run lint`、提交前的 `repository-lint` hook 和 CI 共用的 pre-commit 入口都会阻断超长文件。
扫描器只读检查 Git 已跟踪及未忽略的新 `.py` 文件，包含代理、测试、fixture、工具及嵌套目录；
沿用 `scripts/source-files.mjs` 的依赖、快照和报告目录排除，以及 `.gitignore` 对新文件的忽略规则。
已跟踪文件不会仅因匹配 `.gitignore` 被放过，已删除文件正常跳过。
空行、注释和 docstring 均计入行数；空文件为 0 行，最后一行没有换行符也计为一行，支持 LF/CRLF。
成功时报告扫描文件数和最长文件；超限时列出文件、实际行数与 500 行上限并非零退出。
读取失败、Git 缺失和没有适用 Python 文件均会失败；此限制没有历史额度或单文件豁免。

确需自动修复时可另外显式运行 `npx eslint <文件> --fix` 或
`uvx --from ruff==0.15.12 ruff check <文件> --config ruff.toml --fix`，审阅差异后再暂存；
这不会自动解决复杂度、架构或重复违规。
工具缺失时按首次安装步骤恢复依赖，不要通过跳过检查解决。

部分暂存时，pre-commit 临时保存未暂存的已跟踪修改，检查暂存版本，并在成功或失败后恢复修改。
未跟踪文件可能仍被现有整仓检查发现；将相关文件加入暂存区，或自行移出工作目录后再提交。
若进程被强制结束且修改没有恢复，按输出中的备份路径检查、用 `git apply` 恢复并核对差异；
确认前不要删除缓存、覆盖文件或重置工作树。手动 `--all-files` 检查当前工作树，不模拟暂存快照。

## 升级与卸载

升级 pre-commit 时修改 `requirements-dev.txt` 中的固定版本及配置的最低版本，同步更新本文档，
重新安装并执行 `pre-commit install`、`pre-commit validate-config`、`pre-commit run --all-files`、
`npm run check`。Python、Node、npm、uv 升级同时更新 CI 与本文档的版本，并在干净克隆复验。
`pre-commit autoupdate` 仅更新远程 hook；本仓库是本地 hook，应升级已有 npm/uv 工具入口，
不要复制一套独立检查规则。

卸载本地 Git hook（源码和 CI 配置仍保留）：

```sh
.venv/bin/pre-commit uninstall
```

确认不再需要此虚拟环境后可删除 `.venv/`。重新启用时执行首次安装步骤。
行为依据：[pre-commit 官方文档](https://pre-commit.com/)。
