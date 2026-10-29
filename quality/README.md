# 复杂度与架构门禁（#30）

统一入口是 `npm run check`。保留 ESLint 文档规则、Ruff、ShellCheck、工作流检查、400 行辅助检查、类型检查、原生用例收集和全部本机单元测试。Python 代理单元测试继续由原有工作流执行；不跳过用例，不修改应用仓库。原生用例收集不会启动设备。

## 固定来源与历史测量

本轮先确认本地目录、分支 `albitsj-clrn-az-pr-35`、干净现场及原提交 `4b669e8a92b594840f906e46f2512bebb14371ea`，再核对原仓库源分支 `issue-repair/30` 和目标分支 `master`。抓取后执行 `git merge --no-commit --no-ff origin/master`，无冲突，保留未提交的合并状态。真实合并父提交分别为原提交和最新主分支 `4cc323f746c4b15f97848dd7791590196b101ad8`。

首次门禁现在固定对照 [最新主分支 4cc323f](https://github.com/albitsj/clrn-az/commit/4cc323f746c4b15f97848dd7791590196b101ad8)，不能继续把 [旧主分支 24e4686](https://github.com/albitsj/clrn-az/commit/24e46865d9f36075915d81360c495381564d7e95) 当作最新版本。旧实现、当时验证限制和尝试记录保存在 [历史记录](history/24e4686.md)，旧迁移清单保存在 `measurements/24e46865d9f36075915d81360c495381564d7e95/accepted-lint.json`。

两个提交均用同一组锁定工具和规则独立归档扫描，报告保存在各自完整提交编号对应的 `measurements/` 目录。`source.json` 记录确切来源、工具版本及规则文件指纹；`eslint.json`、`ruff.json` 和 `dependency-cruiser.json` 保存全部诊断；`duplicates.json` 保存每对重复的路径、范围、片段和统计；`fingerprints.json` 保存原生重复指纹。报告包含原始工具字段及诊断，不是当前自动测试通过证明。

| 工具 | 规则与固定版本 | 旧主分支 24e4686 | 最新主分支 4cc323f | 合并后迁移清单 |
| --- | --- | --- | --- | --- |
| ESLint 10.12.0 | complexity 10，max-depth 3 | 35 处复杂度、11 处嵌套 | 34 处复杂度、9 处嵌套 | 33 处复杂度、9 处嵌套 |
| ESLint 语法规则 | TypeScript 响应伪造入口 | 0 | 0 | 0 |
| Ruff 0.15.12 | C901，复杂度 10 | 12 | 12 | 12 |
| dependency-cruiser 17.3.9 | 循环、越层、反向依赖、未解析导入 | 2 个旧环 | 2 个旧环 | 2 个旧环 |
| jscpd 5.1.2 | mild，至少 50 个词法单元且 5 行，新增重复为 0 | 47 对 | 47 对 | 无新增 |

两个主分支还各有一项 `preserve-caught-error` 诊断，未进入豁免清单。原合并请求的下载器修复已消除该问题及下载器复杂度超限，全部保留。此次只更新最新主分支已有诊断的位置与实测值，并删除已失效条目，不能登记本合并请求的新问题。

独立复测命令（先运行 `npm ci`，使用 Node 24 和 uv）：

```sh
node scripts/measure-quality.mjs 4cc323f746c4b15f97848dd7791590196b101ad8 /tmp/clrn-quality-master
node scripts/lint-ratchet.mjs eslint --report
node scripts/lint-ratchet.mjs ruff --report
node scripts/lint-ratchet.mjs dependency-cruiser --report
node scripts/lint-duplicates.mjs --report
npm run check
```

测量命令只输出报告，不提供接受迁移项的入口。历史源码从固定提交只读归档到临时目录，当前规则从仓库载入，依赖使用锁定安装版本；结束后删除临时快照。macOS 的临时目录别名在诊断路径中归一化，报告不保存宿主绝对路径。

## 首次登记及后续只减

`initialRevision` 固定为上述最新主分支。`QUALITY_BASE_REV` 使用合并请求的目标提交或推送前提交；首次接入时该比较提交必须等于固定主分支。每个工具会再次独立扫描固定主分支，逐项核对规则、位置、诊断值、源码指纹或完整依赖环，不能仅凭同一行源码或文件存在登记遗留问题。已修复的诊断不能残留在清单。

本地无 `QUALITY_BASE_REV` 时通常对照 `HEAD`。仅在本次首次合并尚未提交、且 `MERGE_HEAD` 精确等于固定主分支时，对照该主分支。合并提交形成后及未来合并均不使用这一例外。变更前提交一旦已有迁移清单，逐项比较包含原因的完整条目，拒绝新增、改写或重复，只允许删除。规则与排除项不得通过普通基线更新降低。

重复门禁以初始主分支和变更前提交的原生指纹及次数交集作为允许量，阻止新增片段和新增相同副本。已删除的重复不能恢复允许量，其他地方的减少不能抵扣新增。基线只在临时目录生成，不使用会更改工作目录注册信息的 `--baseline-from-ref`。

## 分层与网络夹具

普通原生、视觉、集成测试、场景和辅助函数均受门禁约束。界面层通过 `android/proxy.ts` 和 `e2e/helpers/` 使用代理控制接口，不直接导入响应实现。精确保留原有适配器调用者例外，不扩大测试目录豁免。两个既有依赖环的具体路径和迁移原因保存在 `legacy-cycles.json`。

TypeScript 的 route、fulfill、routeFromHAR、routeWebSocket 成员访问、Response 构造、Response.json 和 fetch 替换使用语法检查，涵盖可选链、字符串计算属性、别名和解构；普通注释、链接及字符串不会误报。`visual/cases/_shared/room.test.ts` 仅获原有 fetch/Response 单元测试例外，仍禁止路由伪造并受其他门禁约束。动态方法名及自定义伪造库仍需代码审阅。

### 属性 API 漏检回归

在登记基线 `a11c646d9b4de63895c85fb01225ca9f33dd76cf` 的规则下，已独立复现
`Object.assign(globalThis, { fetch: /** 返回伪造响应。 */ async () => Response["json"]({ fake: true }) });`
及等价 `Object.defineProperty` 写法在 Android、visual、e2e 普通测试路径均为零错误、零警告。
原有工具接入和历史 CI 成功没有覆盖该缺陷。

规则补充检查 `Object.assign`、`Object.defineProperty`、`Object.defineProperties` 和
`Reflect.defineProperty` 中显式替换 `fetch` 的语法，以及 `Response["json"]` 的成员访问。
属性 API 与 Response 入口分别用负例验证，防止一个错误掩盖另一个漏检；同时检查可选调用、
字符串计算属性、取出 Response 方法后的别名、普通数据操作和精确适配器例外。
这些是静态语法检查，不执行伪响应代码；动态键、间接传入的属性对象和 API 自身的别名仍需审阅。
初始来源、阈值、迁移清单和历史测量保持原值。

可复现的定向命令（生产配置，锁定 ESLint 10.12.0）：

```sh
node --test --test-name-pattern='属性 API|语法级|注释|房间适配器' scripts/quality.test.mjs
```

### Reflect 与全局 Response 漏检回归

在 `d9aab377bcd18c287dd90c07e411ae270d58efb3` 的生产配置下重新复现了
`Reflect.set(globalThis, "fetch", /** fake reply */ async () => globalThis.Response.json({ fake: true }));`：
Android、visual、e2e 三种普通路径均为零错误、零警告。
拆开后的 fetch 替换与全局 Response.json 也各自零诊断，不能用此前的 CI 成功替代该反例。

上一轮由配置内的 `quality/no-network-responses` AST 规则统一识别 Response 构造、json 成员、
fetch 赋值及属性 API；当时路由限制继续使用原有规则。新增 Reflect.set 全局 fetch 检查，保留
Object.assign/defineProperty/defineProperties、Reflect.defineProperty 和 mock.method 的既有边界。
globalThis/window/self/global 上的 Response 与直接 Response 一致；方法自身和属性键支持
点访问、字符串字面量、无表达式模板及 TypeScript 的 as、类型断言、非空断言、satisfies、
实例化表达式和可选链包装。每个入口独立报告，不能靠另一条已禁写法掩盖漏检。
不推断运行时别名、动态模板键、间接属性对象或动态执行；这些仍需审阅。
room.test.ts 的精确离线例外及其路由限制、工具版本、阈值、固定初始债务和两套历史测量保持不变。

复测命令（只解析内存源码，不执行伪响应）：

```sh
node --test --test-name-pattern='needs-repair|语法级|注释|属性 API|Response 入口' scripts/quality.test.mjs
```

上一轮该命令 8 项通过，包括原始完整反例的真实 TypeScript 类型检查、两个独立负例族的普通路径
矩阵、字符串/业务数据/相似命名正例及精确适配器例外。ESLint、dependency-cruiser、jscpd、
类型检查、400 行检查和原生用例收集已实际通过；收集不代表真实设备通过。
完整 `npm run check` 在 Ruff 因用户缓存写权限不足而停止；改用独立临时缓存和工具目录后，
锁定 Ruff 下载又因 PyPI DNS 不可达失败，未降低版本或跳过检查。
另外执行的完整 `npm test` 出现本地端口相关失败，未取得完整汇总后中止；单独定位
`android/proxy.test.mjs` 的 8 项中有 6 项失败，错误均源自 `listen EPERM 127.0.0.1`，保留未通过状态。
Python 六目录共运行 118 项：Android 的 `test_hung_adb_probes_do_not_block_host_collectors`
出现已有 #38 所记录的 `offline probe` 丢失断言失败；e2e 本地服务集成测试因沙箱禁止绑定端口报错；
其余四目录 64 项通过。失败保持未通过状态，未重试掩盖、修改无关实现或更新截图基准。
宿主仍须执行全部固定检查，并核对新提交的 CI 及附件；本轮尚未读取这些新附件或运行真实设备。

### 静态路由与 Response 解构漏检回归（2026-10-30）

本轮 HEAD 为 `d9aab377bcd18c287dd90c07e411ae270d58efb3`，`origin/master` 为登记比较基线
`a11c646d9b4de63895c85fb01225ca9f33dd76cf`，无合并冲突或进行中的合并。
原有三处暂存修改与宿主登记树 `e6c0aea66390534d791e9f859cc13a298047fc28` 一致并保留，
未修改项目索引、HEAD、分支、Git 配置或历史。仓库内不存在 AGENTS.md、AGENTS.txt、
DEVELOPMENT.md 或 `.codegraph/`；已核对 README、质量说明及三份现有工作流。

实际读取恢复的 needs-repair 记录和宿主的路由/解构探针记录后，在修改前使用生产配置、
`allowInlineConfig: false` 及锁定 ESLint 重新解析了以下内存源码，未执行伪响应：

- 真实 Playwright Page 类型的 `page[\`route\`](..., async route => route[\`fulfill\`](...))`：
  Android、visual、e2e 普通路径均零错误、零警告。
- `const { ["json"]: reply } = globalThis.Response;` 后调用 `reply.call(Response, ...)`：
  同样三路径零错误、零警告。
- 原 Reflect.set 加全局 Response.json 反例：三路径均已有两处响应规则错误，保留该修复。

新增独立 `quality/no-network-routing` 规则复用静态键和透明包装归一化，覆盖 route、fulfill、
routeFromHAR、routeWebSocket 的调用、成员读取、别名提取及静态解构；原 no-restricted-syntax
路由守护继续启用。Response 规则补齐直接声明、赋值和默认参数中来源明确的 json 解构。
`room.test.ts` 仍只允许离线 fetch/Response；新增路由规则在该精确路径同样必须报错。
不追踪任意运行时别名或动态执行，不修改阈值、固定初始债务、历史测量、工作流、应用或截图。

复测命令：

```sh
node --test --test-name-pattern='needs-repair|语法级|注释|属性 API|Response 入口|房间适配器|路由' scripts/quality.test.mjs scripts/quality-routing.test.mjs
node --test scripts/quality.test.mjs scripts/quality-routing.test.mjs
```

第一条实际 12 项通过；三个完整原始反例均经过真实 TypeScript 类型检查。独立路由负例覆盖
普通路径矩阵及精确适配器，Response 解构矩阵覆盖直接与四种全局对象来源、静态字符串/模板键、
透明包装及合法适配器例外，正例包含文案、业务数据和相似命名。
第二条共 21 项，19 项通过，历史重测和 C901 两项因 uv 缓存权限失败，未计为通过。
`npm run lint:js`、`lint:lines`、`lint:architecture`、`lint:duplicates`、`typecheck`、
`test:android:collect` 均退出 0；仍为 42 项精确 ESLint 债务、2 个旧环、47 对旧重复，无新增。

完整 `npm run check` 在 Ruff 初始化宿主 uv 缓存时因权限退出 1；单独 ShellCheck 和工作流检查
也因同一缓存权限失败。另行启动的完整 `npm test` 60 秒未完成而中止，没有最终汇总，不能视作通过。
Python 六目录共执行 118 项：Android 31 项中仍有 #38 已记录的 `offline probe` 丢失断言失败；
e2e 23 项中本地上游集成用例因绑定端口权限失败；其余四目录 64 项通过。未重试掩盖失败。
本轮未重新安装依赖、读取新 CI 附件或运行设备；宿主须重新执行全部固定检查，并按修复后的提交
收集必要 CI 日志、身份与附件及独立验收证据。原生用例收集不代表真实设备运行通过。

JSON 夹具和图片属于数据；带函数的场景及 Python 响应实现仍接受扫描。依赖、虚拟环境、设备产物及测试报告等生成目录维持原有明确排除。ESLint 行内禁用和 Ruff noqa 不能绕过统一入口。

## 工作流与验证证据

工作流继续使用完整 Git 历史和原有完整检查，新增归档初始测量、实际 `QUALITY_BASE_REV`、本轮提交及父提交，以便核对首次来源与真实集成身份。每轮四种工具的报告、依赖版本和仓库身份继续上传，成功失败均保留，保存 14 天。

`scripts/quality.test.mjs` 保留复杂度、嵌套、Python 复杂度、语法夹具、依赖分层、导出解析和重复代码负例，补充拒绝旧主分支、同位置恶化、虚构旧环及独立测量可重现验证。全部测试使用真实生产规则，不修改阈值。

本轮现场及实际执行结果见 [验证记录](validation-35.md)。原提交的 [仓库检查日志](https://github.com/albitsj/clrn-az/actions/runs/40832908727/job/123310960271) 记录比较基准仍为旧主分支，140 项单元测试通过；不能据此认定此次集成通过。本轮最终结果必须由脚本提交上传后，在新提交的全部必要自动测试中确认。

应用部署记录仍是 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`，发布版本 `android-staging-300001001-69f9251d3b5f`。已读取 [原英文德州牌桌日志](https://github.com/albitsj/clrn-az/actions/runs/40832908665/job/123311104831)，确认相同应用提交、版本和安装包指纹 `27618d750fc306b1a75d52d642b2d90f361501fd1b9998bc3cd65ca5874196f5`。本轮不改变应用部署，不新增截图候选；图片删除、动画简化及视觉断言完整继承最新主分支，不额外修改图片、容差、重试或遮罩。

工具规则参考：[ESLint complexity](https://eslint.org/docs/latest/rules/complexity)、[max-depth](https://eslint.org/docs/latest/rules/max-depth)、[Ruff C901](https://docs.astral.sh/ruff/rules/complex-structure/)、[dependency-cruiser 17.3.9](https://github.com/sverweij/dependency-cruiser/tree/v17.3.9)、[jscpd 5.1.2 基线文档](https://github.com/kucherenko/jscpd/blob/v5.1.2/docs/ci-and-hooks.md)。

### 嵌套来源与纯数据误报修复（2026-10-30）

本轮实施起点为 `aa6ce0fedc5f6d0731ee3b78495f26eade8a4a71`，工作树干净；
宿主已抓取的 `origin/master` 仍为 `a11c646d9b4de63895c85fb01225ca9f33dd76cf`，
没有 MERGE_HEAD 或冲突。已读取仓库 README、质量说明、三份工作流、恢复的 needs-repair
记录及 `pr37-aa6ce-nested-data-preimplementation-and-finding.json`。仓库中没有
AGENTS.md、AGENTS.txt、DEVELOPMENT.md 或 `.codegraph/`，未套用外部工具仓库规则。

修改前用生产配置、`allowInlineConfig: false` 在 Android、visual、e2e 三类普通路径复现：
嵌套 `const { Response: { json: reply } } = globalThis` 零诊断；读取纯数据 `settings.route`
产生两条误报；`Object.assign(settings, { fetch: "updated" })` 产生一条误报。
以上仅解析内存源码，没有执行网络伪造。三个完整探针加入原真实 TypeScript strict/noEmit
验证，原 Reflect、模板路由和直接 Response 解构探针继续保留。

`network-syntax.mjs` 统一静态键、透明包装和 ESLint 词法绑定查询；明确的全局来源沿成员和
嵌套模式递归传播。局部同名数据绑定不视为内建网络入口。纯数据证明只接受字面量、数组、
无 getter/函数的对象及无重赋值的初始化绑定；检查直接写入和现有属性 API 的载荷。
未知参数、函数、getter、调用返回值和逃逸给未知调用的对象不能获得纯数据例外。
不执行函数或 getter，不宣称证明任意运行时别名、原型修改或动态执行安全。

将已证明误报的 `no-restricted-syntax` 盲路由选择器等价迁移至独立的
`quality/no-network-routing` 上下文规则，仅对可证明纯数据免报；原真实网络负例全部保留。
`room.test.ts` 仍只关闭 Response 规则，路由规则独立生效。新增矩阵使用真实 route、fulfill、
routeFromHAR、routeWebSocket、fetch、json 字段，覆盖读取、可选链、计算键、嵌套解构、
数据更新、局部同名绑定和带函数的负例。默认值不能把未知实参或嵌套来源证明为纯数据。
阈值、依赖版本、固定 4cc323f 初始债务、历史测量、工作流、应用和截图均未修改。

复测命令：

```sh
node --test scripts/quality.test.mjs scripts/quality-routing.test.mjs
npm run check
```

本轮完整质量测试实际为 26 项、24 项通过、2 项失败：历史重测和 C901 测试受 uv 缓存
写权限限制，后者未收到 JSON。网络相关定向矩阵 17 项通过，包含真实 TypeScript 探针。
ESLint（42 项旧债务）、架构（2 个旧环）、重复门禁（无新增）、400 行检查、类型检查及
原生用例收集实际通过；收集不代表真实设备运行通过。
完整 `npm run check` 在 Ruff 初始化 `/Users/kevina/.cache/uv` 时因权限停止，未计为通过。
另行启动的 `npm test` 在 75 秒仍无最终汇总后被有界终止，也未计为通过；不据此推断根因。
本轮未运行 Python 六目录、重新安装依赖、读取新 CI 附件或运行真实设备。
仍须宿主运行全部固定检查，并按发布后的当前提交收集 CI 日志、身份、附件及独立验收证据。
