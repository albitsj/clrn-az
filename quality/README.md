# 复杂度与架构门禁（#30）

统一入口是 `npm run check`，现有 CI 的 Repository checks 继续使用该入口，原有 ESLint 文档规则、类型检查、Shell/工作流检查、400 行辅助检查、原生用例收集、Node 和 Python 单元测试全部保留。检查不启动设备，不访问业务接口，不修改项目源码、索引、Git 配置或历史。临时扫描快照及报告只写系统临时目录并自动删除。

本次核对的目标仓库没有 AGENTS.md、AGENTS.txt、DEVELOPMENT.md 或 .codegraph/；已阅读根 README、android/README.md 与三个现有工作流。未套用宿主工具仓库的规范。当前 Git 基线是 `d9ebf4d232a2511f9f486eb3985334acb52cdacd`，工作树开始时干净，没有 MERGE_HEAD。开放 PR 查询未发现需要复用的实施分支；#25 的 hook 安装不在本次范围。

## 阈值、覆盖与测量

| 工具 | 固定版本 | 最终规则 | 首次本地测量 |
| --- | --- | --- | --- |
| ESLint | 10.12.0 | complexity 10（classic）；max-depth 3 | 36 处复杂度超限、11 处嵌套超限 |
| ESLint 语法选择器 | 同上 | TypeScript 响应伪造入口 | 25 处旧成员访问 |
| Ruff | 0.15.12 | C901，max-complexity 10 | 10 个超限函数 |
| dependency-cruiser | 17.3.9 | 循环、界面越层、响应层反向依赖、无法解析的导入 | 原生工具扫描待宿主；TypeScript 导入预调查找到两个旧环 |
| jscpd | 5.1.2 | mild；至少 50 tokens 且 5 行；新增 clone 数为 0 | 本地依赖安装被沙箱 DNS 阻止，完整测量与负例待宿主 |

版本写入 package.json/package-lock.json 和 Ruff 命令。新增 npm 工具的依赖闭包来自对应发布标签的上游锁文件，并经 `npm install --package-lock-only --offline --ignore-scripts --audit=false` 验证锁文件结构；这不等同于成功安装工具或完整门禁通过。

保留建议的 10/3，而不是提高全局上限来让旧代码通过；现存超限都进入精确清单。行数仅是已有辅助检查，不据此判断代码是否有用。可复现命令（Node 24+、uv；先 `npm ci`）：

```sh
node scripts/lint-ratchet.mjs eslint --report
node scripts/lint-ratchet.mjs ruff --report
node scripts/lint-ratchet.mjs dependency-cruiser --report
npm run lint:duplicates -- --report
npm run check
```

前三条输出含规则、位置/环路径的 JSON。最后一条报告命令输出固定基线的完整 jscpd JSON，列出每一对旧重复的文件、范围及统计；它是报告模式，不能代替 `npm run lint:duplicates` 的失败门禁。初次未取得的原生 dependency-cruiser/jscpd 数值明确保留待验证，不能当作 0 违规或已经通过。

## 分层与伪造入口

- 普通原生、视觉及集成测试，以及场景、辅助函数均在 ESLint/Ruff/依赖/重复扫描范围内，不宽泛排除测试目录。
- 界面操作层只使用 `android/proxy.ts` 和 `e2e/helpers/` 等代理控制 API。禁止直接导入 `networkMocks.ts`、`network-routes.ts` 或 mitmproxy 响应实现；代理控制层也不能反向依赖原生界面代码。现有 `android/proxy.ts`、`android/network-routes.ts` 是桥接层；`android/scenarios.test.mjs` 离线核对适配器响应和节点透传，是精确登记的合法单元测试调用者。
- TypeScript 的 route、fulfill、routeFromHAR、routeWebSocket 成员访问，以及 Response 构造、Response.json、fetch 替换受到语法级检查；覆盖可选链、字符串计算属性、方法别名及解构，不扫描注释、URL 或普通字符串。现有 networkMocks.ts 中的 25 处旧访问逐条登记，不豁免整个文件。动态计算方法名及任意自定义 Mock 库仍需代码审阅，静态语法检查不是任意程序行为分析。
- `visual/cases/_shared/room.test.ts` 是唯一 TypeScript fetch/Response 例外：它离线验证房间清理适配器的 DELETE 地址、凭据、错误传播。该文件仍禁止路由伪造，并受复杂度、架构和重复检查约束。其他 `.test.ts` 不继承这个例外。现有 `.mjs` 代理单元测试可以隔离进程/传输，但仍受其他门禁约束。
- JSON 夹具和截图是数据；不把它们算作源码重复。带函数的 replayData.ts、mitmproxy/data.py 仍检查。node_modules、.venv、截图、设备产物、测试报告和 .ttyctl 是生成物，按明确目录排除。

## 历史迁移清单与单调缩减

`legacy-lint.json` 记录每个旧项的工具、规则、文件、起止位置、实际超限值/消息、源码 SHA-256 和迁移原因。只接受 complexity、max-depth、C901 和已存在的伪造访问，其他原有 ESLint/Ruff 诊断不允许进入该清单。源码或超限数发生变化将重新失败；消失的诊断也失败，要求同时删除对应旧项。不要重生成清单来接受新问题。

`legacy-cycles.json` 单独记录两条具体的旧环与迁移原因。dependency-cruiser 仍扫描这些文件，新增环、扩大旧环、越层依赖或未解析导入全部失败；旧环消失时删除对应项。本轮只登记旧耦合，不为了指标移动设备或截图实现。

CI 使用完整 Git 历史，并通过 QUALITY_BASE_REV 指定 PR base SHA 或 push 前 SHA；本地默认对照 HEAD。迁移清单与变更前提交逐项比较，仅可删除，不可改写或增加。首次引入 lint 清单时还校验每个源码指纹确实来自固定 Git 基线。改动引起位置移动时，也须处理对应旧债务，不能自动扩大清单。ESLint 行内禁用和 Ruff noqa 不能绕过统一入口；规则、阈值、语法选择器、例外及排除配置的变化必须作为门禁策略变更审查。

重复代码复用 jscpd 原生的源码片段指纹与出现次数。每次只读展开固定初始基线及变更前提交，用同一配置测量，原生指纹清单取次数交集，再检查当前源码。初始报告中的每对旧重复是迁移项，原因是保留既有场景/协议回归覆盖，按业务修改逐步归并，避免本轮机械重构。新增片段或新增相同副本都会失败；已从前一提交移除的指纹不能再恢复允许量，减少其他重复也不能抵扣新增。基线只在临时目录生成，不提供写回当前源码的“接受全部重复”命令。没有调用 jscpd 会修改 Git 工作树注册的 `--baseline-from-ref`。

## 回归与验证状态

`scripts/quality.test.mjs` 使用真实配置和临时源码负例验证复杂度 11、嵌套 4、C901、循环/越层/反向依赖、伪造调用和新增重复；同时验证精确单元测试例外、字符串不误报、迁移只减以及重复副本次数。测试由原有 `npm test` 自动发现，不在项目内留下负例。

CI 在执行门禁前保存四种工具的测量 JSON、依赖版本及当前仓库完整 SHA，并在成功或失败后上传 `quality-reports-<run_id>-<attempt>` 附件，保留 14 天。完整旧重复报告来自固定基线，当前重复门禁结果见同轮检查日志；没有将报告模式作为门禁入口。

本轮已通过 ESLint/精确历史清单、Ruff/精确历史清单、ESLint 与 Ruff 负例、迁移匹配测试、类型检查、原生用例收集以及已有 Shell/工作流检查。新增 dependency-cruiser 和 jscpd 在本地无法通过 npm DNS 安装，完整 `npm run check` 在这两个工具处仍未验证；其负例不会跳过，由宿主安装后执行。原生收集只是静态收集，没有启动模拟器，不能宣称真实设备运行通过；没有更新原生/H5 截图或视觉批准记录，也没有使用旧 CI 为本轮背书。

完整本地 Node 单元测试实际运行 127 项，109 通过、18 失败：16 项在回环端口监听时遇到 EPERM，另两项是新工具缺失；没有跳过测试。Android Python 实际运行 34 项，存在 3 个回环服务权限错误和 1 个诊断采集超时断言失败，仍保留未通过状态，未修改这些测试或其实现。宿主须在具备依赖和端口权限的环境执行全部固定检查，不能用上述局部通过结果替代。

工具规则参考：[ESLint complexity](https://eslint.org/docs/latest/rules/complexity)、[max-depth](https://eslint.org/docs/latest/rules/max-depth)、[Ruff C901](https://docs.astral.sh/ruff/rules/complex-structure/)、[dependency-cruiser 17.3.9](https://github.com/sverweij/dependency-cruiser/tree/v17.3.9)、[jscpd 5.1.2 基线文档](https://github.com/kucherenko/jscpd/blob/v5.1.2/docs/ci-and-hooks.md)。
