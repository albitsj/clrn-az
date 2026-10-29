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

JSON 夹具和图片属于数据；带函数的场景及 Python 响应实现仍接受扫描。依赖、虚拟环境、设备产物及测试报告等生成目录维持原有明确排除。ESLint 行内禁用和 Ruff noqa 不能绕过统一入口。

## 工作流与验证证据

工作流继续使用完整 Git 历史和原有完整检查，新增归档初始测量、实际 `QUALITY_BASE_REV`、本轮提交及父提交，以便核对首次来源与真实集成身份。每轮四种工具的报告、依赖版本和仓库身份继续上传，成功失败均保留，保存 14 天。

`scripts/quality.test.mjs` 保留复杂度、嵌套、Python 复杂度、语法夹具、依赖分层、导出解析和重复代码负例，补充拒绝旧主分支、同位置恶化、虚构旧环及独立测量可重现验证。全部测试使用真实生产规则，不修改阈值。

本轮现场及实际执行结果见 [验证记录](validation-35.md)。原提交的 [仓库检查日志](https://github.com/albitsj/clrn-az/actions/runs/40832908727/job/123310960271) 记录比较基准仍为旧主分支，140 项单元测试通过；不能据此认定此次集成通过。本轮最终结果必须由脚本提交上传后，在新提交的全部必要自动测试中确认。

应用部署记录仍是 `69f9251d3b5f2b93aa2d880d27abbeefe16ee645`，发布版本 `android-staging-300001001-69f9251d3b5f`。已读取 [原英文德州牌桌日志](https://github.com/albitsj/clrn-az/actions/runs/40832908665/job/123311104831)，确认相同应用提交、版本和安装包指纹 `27618d750fc306b1a75d52d642b2d90f361501fd1b9998bc3cd65ca5874196f5`。本轮不改变应用部署，不新增截图候选；图片删除、动画简化及视觉断言完整继承最新主分支，不额外修改图片、容差、重试或遮罩。

工具规则参考：[ESLint complexity](https://eslint.org/docs/latest/rules/complexity)、[max-depth](https://eslint.org/docs/latest/rules/max-depth)、[Ruff C901](https://docs.astral.sh/ruff/rules/complex-structure/)、[dependency-cruiser 17.3.9](https://github.com/sverweij/dependency-cruiser/tree/v17.3.9)、[jscpd 5.1.2 基线文档](https://github.com/kucherenko/jscpd/blob/v5.1.2/docs/ci-and-hooks.md)。
