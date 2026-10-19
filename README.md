# clrn-az

来玩 Android Staging 原生回归测试，主分支为 `master`。测试从 [kevinanew/clrn Releases](https://github.com/kevinanew/clrn/releases) 下载 APK，应用构建继续由 `laiwan_react_native` 的 Woodpecker 流水线负责。

- `android/`：全部原生用例、下载与校验工具、763 张正式截图基准。
- `visual/`、`e2e/`：从 CLRN 同步的场景定义、业务夹具及代理依赖；保留路径以减少迁移变化，不包含 H5 测试入口或网页截图基准。来源提交：`kevinanew/clrn@2777b8b`，后续变更在本仓库维护。
- `scripts/`：检查工具、账号分区、staging 部署记录解析。
- `deployments/staging.json`：发布后提交的部署身份，触发 master 上的安卓工作流。

安装与静态验证（Node.js 24+、uv）：

```sh
npm ci
npm run check
python3 -m unittest discover -s android -p 'test_*.py'
npx playwright test --config android/playwright.config.ts --list
```

运行真实 APK、更新截图与 CI 配置见 [Android 测试说明](android/README.md)。本地执行需独立测试账号；已有本机池可通过 `CLRN_TEST_ACCOUNT_POOL` 指向同一文件并用 `node scripts/with-test-account.mjs -- node android/run-visual.mjs` 获取本机锁。禁止借用 CI 账号。

Actions 只需 `CLRN_CI_TEST_ACCOUNTS_V2`（安卓新 70 个账号）和 `TESTING_API_TOKEN`。APK 仍存放在 CLRN，两个测试仓库都由 `deployments/staging.json` 的提交触发，不配置 `CLRN_AZ_DISPATCH_TOKEN`。

账号分配器在独占锁内、启动模拟器测试前，将当前任务账号设置为 10000 金币，并通过真实钱包接口回读核对。
持续集成和本机共用同一准备逻辑；失败时停止测试，本机释放账号锁。详见 [余额准备](android/README.md#测试开始前的金币准备)。

应用各工作分支 push 会发布独立测试 Release。CI 默认使用当前检出提交的 `deployments/staging.json`，定时和未指定标签的手动任务同样固定该记录，避免自动选中新上传的候选包。测试应用 PR 时，可在手动工作流的 `release_tag` 中指定分支标签，或在测试 PR 的部署记录中固定该 Release 和完整应用提交。
