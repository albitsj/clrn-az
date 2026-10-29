// 有界的语法及词法来源分析；不求值调用、getter 或任意运行时别名。
const transparentNodes = new Set(['ChainExpression', 'TSAsExpression', 'TSTypeAssertion',
  'TSNonNullExpression', 'TSSatisfiesExpression', 'TSInstantiationExpression']);
const globalObjects = new Set(['globalThis', 'window', 'self', 'global']);

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
    else break;
  }
  return node;
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
    if (!variable || seen.has(variable) || variable.defs.length !== 1) return false;
    const definition = variable.defs[0];
    if (definition.type !== 'Variable' || definition.node.id.type !== 'Identifier') return false;
    if (variable.references.some(ref => ref.isWrite() && !ref.init)) return false;
    const next = new Set([...seen, variable]);
    return pureData(definition.node.init, next) && variable.references.every(ref => safeReference(ref, next));
  }
  /**
   * 写入只有纯数据时仍是数据；函数和 getter 永不求值或豁免。
   * @param reference - ESLint 词法引用。
   * @param seen - 已访问绑定。
   */
  function safeReference(reference, seen) {
    const node = referenceTarget(reference.identifier);
    const parent = node.parent;
    if (!parent) return true;
    if (parent.type === 'AssignmentExpression') return parent.left !== node || pureData(parent.right, seen);
    if (parent.type === 'UpdateExpression') return false;
    if (parent.type !== 'CallExpression' || !parent.arguments.includes(node)) return true;
    const member = unwrap(parent.callee);
    if (member?.type !== 'MemberExpression') return false;
    if (origin(member.object) === 'console') return true;
    return dataMutation(parent, member, seen);
  }
  /**
   * 只识别现有属性 API 的纯数据载荷，不执行该 API。
   * @param call - 调用节点。
   * @param member - 方法成员。
   * @param seen - 已访问绑定。
   */
  function dataMutation(call, member, seen) {
    if (!['Object', 'Reflect'].includes(origin(member.object))) return false;
    if (!['assign', 'set', 'defineProperty', 'defineProperties'].includes(propertyName(member))) return false;
    return call.arguments.slice(1).every(argument => pureData(argument, seen));
  }
  /**
   * 保守接受 JSON 风格数据；不调用静态值工具中的内建函数或访问器。
   * @param node - 数据表达式。
   * @param seen - 已访问绑定。
   */
  function pureData(node, seen = new Set()) {
    const value = unwrap(node);
    if (!value) return false;
    if (value.type === 'Literal') return !value.regex;
    if (value.type === 'TemplateLiteral') return value.expressions.length === 0;
    if (value.type === 'Identifier') return dataBinding(value, seen);
    if (value.type === 'ArrayExpression') return value.elements.every(item => pureData(item, seen));
    if (value.type === 'ObjectExpression') return value.properties.every(property =>
      property.type === 'Property' && property.kind === 'init' && !property.method
        && propertyName(property) !== undefined && pureData(property.value, seen));
    if (value.type === 'MemberExpression') return pureData(value.object, seen)
      && pureData(ownValue(value), seen);
    return false;
  }
  /**
   * 只读取对象字面量自身的数据属性；不将原型链成员视为数据。
   * @param node - 已证明目标为纯数据的成员表达式。
   */
  function ownValue(node) {
    const object = dataObject(node.object);
    if (object?.type !== 'ObjectExpression') return undefined;
    return object.properties.findLast(property => propertyName(property) === propertyName(node))?.value;
  }
  /**
   * 解析纯数据初始化器中的直接静态成员，不执行源码。
   * @param node - 已证明为纯数据的表达式。
   */
  function dataObject(node) {
    const target = unwrap(node);
    if (target?.type === 'Identifier') return dataObject(binding(target)?.defs[0]?.node.init);
    if (target?.type === 'MemberExpression') return dataObject(ownValue(target));
    return target;
  }
  /**
   * 判断属性 API 是否同时具有纯数据目标和载荷。
   * @param call - 属性 API 调用。
   */
  function pureUpdate(call) {
    return call.arguments.every(argument => pureData(argument));
  }
  return { origin, childOrigin, pureData, pureUpdate };
}
