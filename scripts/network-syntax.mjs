// 有界的语法及词法来源分析；不求值调用、getter 或任意运行时别名。
const transparentNodes = new Set(['ChainExpression', 'TSAsExpression', 'TSTypeAssertion',
  'TSNonNullExpression', 'TSSatisfiesExpression', 'TSInstantiationExpression']);
const globalObjects = new Set(['globalThis', 'window', 'self', 'global']);
const unknown = Symbol('unknown data');
// 仍只含数据，但发生变更后不能继续使用初始化时的属性值或字段存在性。
const mutableData = Symbol('pure data without a stable snapshot');

/**
 * 只遍历真正的写入槽位，跳过属性键、默认值和成员对象中的读取。
 * @param pattern - 赋值目标或循环左侧。
 * @param visit - 对每个实际目标执行检查。
 */
export function writeTargets(pattern, visit) {
  const target = unwrap(pattern);
  switch (target?.type) {
    case 'ObjectPattern':
      target.properties.forEach(property => writeTargets(property.value ?? property.argument, visit));
      break;
    case 'ArrayPattern':
      for (const item of target.elements) writeTargets(item, visit);
      break;
    case 'RestElement': writeTargets(target.argument, visit); break;
    case 'AssignmentPattern': writeTargets(target.left, visit); break;
    case 'MemberExpression':
    case 'Identifier': visit(target); break;
  }
}

/**
 * 仅读取分析器自己建立的数据容器，不访问源码对象或原型。
 * @param value - 静态数据。
 * @param key - 静态键。
 */
function dataProperty(value, key) {
  if (key === undefined) return unknown;
  if (value === mutableData) {
    return [Object, Array, String, Number, Boolean, BigInt].some(type => key in type.prototype) ? unknown : mutableData;
  }
  if (value instanceof Map) {
    if (value.has(key)) return value.get(key);
    return key in Object.prototype ? unknown : undefined;
  }
  if (Array.isArray(value)) {
    if (Object.hasOwn(value, key)) return value[key];
    return key in Array.prototype ? unknown : undefined;
  }
  return unknown;
}

/**
 * 数据键额外支持数组下标；网络入口的字符串键策略保持不变。
 * @param node - 成员或模式属性。
 */
function dataKey(node) {
  const key = unwrap(node.property ?? node.key);
  return key?.type === 'Literal' && typeof key.value === 'number' ? String(key.value) : propertyName(node);
}

/**
 * 去掉不改变值的 TypeScript 和可选链包装。
 * @param node - 语法节点。
 */
export function unwrap(node) {
  while (node && transparentNodes.has(node.type)) node = node.expression;
  return node;
}

/**
 * 读取字面量或无插值模板字符串。
 * @param node - 键表达式。
 */
export function stringKey(node) {
  const key = unwrap(node);
  if (key?.type === 'Literal' && typeof key.value === 'string') return key.value;
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0].value.cooked;
  return undefined;
}

/**
 * 统一成员与模式的静态属性键。
 * @param node - 成员或属性节点。
 */
export function propertyName(node) {
  const key = node.property ?? node.key;
  return !node.computed && key?.type === 'Identifier' ? key.name : stringKey(key);
}

/**
 * 沿成员和透明包装定位引用的实际使用位置。
 * @param node - 词法引用节点。
 */
function referenceTarget(node) {
  while (node.parent) {
    const parent = node.parent;
    if (transparentNodes.has(parent.type) || parent.type === 'MemberExpression' && parent.object === node) node = parent;
    else if (parent.type === 'ArrayExpression') node = parent;
    else if (parent.type === 'Property' && parent.value === node && parent.parent.type === 'ObjectExpression') node = parent.parent;
    else break;
  }
  return node;
}

/**
 * 从一个实际目标向上定位写入，不能把计算键或默认值中的读取当成写入。
 * @param node - 最外层成员目标。
 */
function writeOwner(node) {
  const parent = node.parent;
  if (!parent) return undefined;
  if (parent.type === 'Property' && parent.value === node) return writeOwner(parent.parent);
  if (['ArrayPattern', 'RestElement'].includes(parent.type)) return writeOwner(parent);
  if (parent.type === 'AssignmentPattern' && parent.left === node) return writeOwner(parent);
  return parent.left === node ? parent : undefined;
}

/**
 * 由 ESLint 词法作用域找绑定，不按变量拼写豁免业务对象。
 * @param context - 生产规则上下文。
 */
export function syntaxContext(context) {
  /**
   * 找到最近的词法绑定。
   * @param node - 标识符。
   */
  function binding(node) {
    let scope = context.sourceCode.getScope(node);
    while (scope && !scope.set.has(node.name)) scope = scope.upper;
    return scope?.set.get(node.name);
  }
  /**
   * 区分内建标识符与局部同名绑定。
   * @param node - 目标表达式。
   */
  function unshadowed(node) {
    return node?.type === 'Identifier' && !binding(node)?.defs.length;
  }
  /**
   * 分类明确的全局和内建来源，也允许递归成员链。
   * @param node - 来源表达式。
   */
  function origin(node) {
    const target = unwrap(node);
    if (unshadowed(target)) return globalObjects.has(target.name) ? 'global' : target.name;
    if (target?.type === 'MemberExpression') return childOrigin(origin(target.object), propertyName(target));
    return undefined;
  }
  /**
   * 沿明确来源的静态键继续分类；其他属性不能假定为内建。
   * @param source - 已知来源分类。
   * @param key - 静态属性名。
   */
  function childOrigin(source, key) {
    if (source !== 'global') return undefined;
    return globalObjects.has(key) ? 'global' : key;
  }
  /**
   * 仅接受无重赋值的初始化绑定；循环引用终止为未知。
   * @param node - 标识符。
   * @param seen - 递归中的绑定集合。
   */
  function dataBinding(node, seen) {
    const variable = binding(node);
    if (!variable || seen.has(variable) || variable.defs.length !== 1) return unknown;
    const definition = variable.defs[0];
    if (definition.type !== 'Variable') return unknown;
    if (variable.references.some(ref => ref.isWrite() && !ref.init)) return unknown;
    const next = new Set([...seen, variable]);
    const safety = referenceSafety(variable, next);
    if (!safety) return unknown;
    const source = dataValue(definition.node.init, next);
    let result = unknown;
    project(definition.node.id, source, next, (target, value) => {
      if (target.name === node.name) result = value;
    });
    return safety === mutableData && result !== unknown ? mutableData : result;
  }
  /**
   * 合并引用及声明别名的安全性，同时保留属性快照是否已失效。
   * @param variable - ESLint 词法绑定。
   * @param seen - 已访问绑定。
   */
  function referenceSafety(variable, seen) {
    const states = variable.references.map(ref => safeReference(ref, seen));
    if (states.includes(false)) return false;
    return states.includes(mutableData) ? mutableData : true;
  }
  /**
   * 投影确定的数据来源；未知来源的默认值仍然未知。
   * @param pattern - 声明模式。
   * @param value - 当前静态来源。
   * @param seen - 已访问的绑定。
   * @param visit - 接收叶子绑定及来源。
   */
  function project(pattern, value, seen, visit) {
    const target = unwrap(pattern);
    if (!target) return;
    if (target.type === 'AssignmentPattern') {
      if (value === mutableData && !pureData(target.right, seen)) value = unknown;
      return project(target.left, value === undefined ? dataValue(target.right, seen) : value, seen, visit);
    }
    visit(target, value);
    if (target.type === 'ObjectPattern') projectObject(target, value, seen, visit);
    if (target.type === 'ArrayPattern') projectArray(target, value, seen, visit);
  }
  /**
   * 对象剩余属性只保留未被静态键取走的自有数据。
   * @param pattern - 对象模式。
   * @param value - 静态来源。
   * @param seen - 已访问绑定。
   * @param visit - 叶子回调。
   */
  function projectObject(pattern, value, seen, visit) {
    const keys = pattern.properties.filter(property => property.type === 'Property').map(dataKey);
    const remainder = value instanceof Map && !keys.includes(undefined)
      ? new Map([...value].filter(([key]) => !keys.includes(key))) : unknown;
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') project(property.argument, remainder, seen, visit);
      else project(property.value, dataProperty(value, dataKey(property)), seen, visit);
    }
  }
  /**
   * 数组空位和越界元素为 undefined，只有已知数组可以投影剩余元素。
   * @param pattern - 数组模式。
   * @param value - 静态来源。
   * @param seen - 已访问绑定。
   * @param visit - 叶子回调。
   */
  function projectArray(pattern, value, seen, visit) {
    pattern.elements.forEach((item, index) => {
      if (item?.type === 'RestElement') {
        project(item.argument, Array.isArray(value) ? value.slice(index) : unknown, seen, visit);
      } else project(item, dataProperty(value, String(index)), seen, visit);
    });
  }
  /**
   * 写入只有纯数据时仍是数据；函数和 getter 永不求值或豁免。
   * @param reference - ESLint 词法引用。
   * @param seen - 已访问绑定。
   */
  function safeReference(reference, seen) {
    const node = referenceTarget(reference.identifier);
    const parent = node.parent;
    const owner = writeOwner(node);
    if (owner?.type === 'AssignmentExpression') return pureWrite(owner.left, owner.right, seen) && mutableData;
    if (['ForOfStatement', 'ForInStatement'].includes(owner?.type)) return false;
    if (parent.type === 'UpdateExpression') return false;
    if (parent.operator === 'delete') return mutableData;
    if (parent.type === 'VariableDeclarator' && parent.init === node) return safeAliases(parent.id, seen);
    return safeCall(node, seen);
  }
  /**
   * 传入未知调用即发生逃逸，只保留已知输出及纯数据属性 API。
   * @param node - 引用及其成员链。
   * @param seen - 已访问绑定。
   */
  function safeCall(node, seen) {
    const parent = node.parent;
    if (parent.type !== 'CallExpression' || !parent.arguments.includes(node)) return true;
    const member = unwrap(parent.callee);
    if (member?.type !== 'MemberExpression') return false;
    if (origin(member.object) === 'console') return true;
    return dataMutation(parent, member, seen) && mutableData;
  }
  /**
   * 声明投影形成共享引用；不允许通过新绑定把数据传入未知调用或改成函数。
   * @param pattern - 新绑定模式。
   * @param seen - 已检查的词法绑定。
   */
  function safeAliases(pattern, seen) {
    let safe = true;
    writeTargets(pattern, target => {
      const variable = binding(target);
      if (!variable || seen.has(variable)) return;
      const next = new Set([...seen, variable]);
      const state = referenceSafety(variable, next);
      if (!state) safe = false;
      else if (safe && state === mutableData) safe = mutableData;
    });
    return safe;
  }
  /**
   * 只识别现有属性 API 的纯数据载荷，不执行该 API。
   * @param call - 调用节点。
   * @param member - 方法成员。
   * @param seen - 已访问绑定。
   */
  function dataMutation(call, member, seen) {
    if (!['Object', 'Reflect'].includes(origin(member.object))) return false;
    if (!['assign', 'set', 'defineProperty', 'defineProperties', 'deleteProperty'].includes(propertyName(member))) return false;
    return call.arguments.slice(1).every(argument => pureData(argument, seen));
  }
  /**
   * 保守接受 JSON 风格数据；不调用静态值工具中的内建函数或访问器。
   * @param node - 数据表达式。
   * @param seen - 已访问绑定。
   */
  function pureData(node, seen = new Set()) {
    return dataValue(node, seen) !== unknown;
  }
  /**
   * 有界解析 JSON 原语、容器和声明来源；不执行调用、getter 或工厂。
   * @param node - 数据表达式。
   * @param seen - 已访问绑定。
   */
  function dataValue(node, seen) {
    const value = unwrap(node);
    if (!value) return unknown;
    switch (value.type) {
      case 'Literal':
      case 'TemplateLiteral':
      case 'UnaryExpression': return primitiveValue(value);
      case 'Identifier': return dataBinding(value, seen);
      case 'ArrayExpression': return arrayValue(value, seen);
      case 'ObjectExpression': return objectValue(value, seen);
      case 'MemberExpression': return dataProperty(dataValue(value.object, seen), dataKey(value));
      default: return unknown;
    }
  }
  /**
   * 读取静态原语；正负号只作用于数值字面量，不调用强制转换。
   * @param node - 字面量、模板或一元表达式。
   */
  function primitiveValue(node) {
    if (node.type === 'Literal') return node.regex ? unknown : node.value;
    if (node.type === 'TemplateLiteral') return stringKey(node) ?? unknown;
    const argument = unwrap(node.argument);
    if (argument?.type !== 'Literal' || typeof argument.value !== 'number') return unknown;
    if (node.operator === '-') return -argument.value;
    return node.operator === '+' ? argument.value : unknown;
  }
  /**
   * 仅处理静态数组，不调用迭代器或展开未知来源。
   * @param node - 数组字面量。
   * @param seen - 已访问绑定。
   */
  function arrayValue(node, seen) {
    const values = node.elements.map(item => item === null ? undefined : dataValue(item, seen));
    return values.includes(unknown) ? unknown : values;
  }
  /**
   * 整个对象必须由自有数据属性组成；函数或 getter 使来源变为未知。
   * @param node - 对象字面量。
   * @param seen - 已访问绑定。
   */
  function objectValue(node, seen) {
    const values = new Map();
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.kind !== 'init' || property.method) return unknown;
      const key = dataKey(property);
      const value = dataValue(property.value, seen);
      if (key === undefined || key === '__proto__' || value === unknown) return unknown;
      values.set(key, value);
    }
    return values;
  }
  /**
   * 判断属性 API 是否同时具有纯数据目标和载荷。
   * @param call - 属性 API 调用。
   */
  function pureUpdate(call) {
    return call.arguments.every(argument => pureData(argument));
  }
  /**
   * 赋值载荷按模式投影，防止未知默认值或函数默认值冒充纯数据写入。
   * @param pattern - 实际目标模式。
   * @param source - 直接右值。
   * @param seen - 已访问绑定。
   */
  function pureWrite(pattern, source, seen = new Set()) {
    let safe = true;
    project(pattern, dataValue(source, seen), seen, (_target, value) => { safe &&= value !== unknown; });
    return safe;
  }
  /**
   * 路由解构使用所在模式的实际投影，不能用纯数据根掩盖函数默认值。
   * @param pattern - 完整声明或赋值模式。
   * @param source - 静态根来源。
   * @param wanted - 被检查的路由属性，默认值按实际选中的分支投影。
   */
  function purePattern(pattern, source, wanted) {
    let projected = unknown;
    const seen = new Set();
    const valueTarget = unwrap(wanted.value);
    const selected = valueTarget?.type === 'AssignmentPattern' ? unwrap(valueTarget.left) : valueTarget;
    project(pattern, dataValue(source, seen), seen, (target, value) => {
      if (target === selected) projected = value;
    });
    return projected !== unknown;
  }
  return { origin, childOrigin, pureData, pureUpdate, pureWrite, purePattern };
}
