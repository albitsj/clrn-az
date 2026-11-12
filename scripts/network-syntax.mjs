import { unwrap, stringKey, propertyName, writeTargets, dataKey } from './network-syntax-nodes.mjs';
export { unwrap, stringKey, propertyName, writeTargets } from './network-syntax-nodes.mjs';
// 有界的语法及词法来源分析；不求值调用、getter 或任意运行时别名。
import { referenceTarget, writeOwner, safeValueUse, aliasPattern } from './network-reference.mjs';
const globalObjects = new Set(['globalThis', 'window', 'self', 'global']);
const unknown = Symbol('unknown data');
// 仍只含数据，但发生变更后不能继续使用初始化时的属性值或字段存在性。
const mutableData = Symbol('pure data without a stable snapshot');
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
  if (value instanceof Map) return mapProperty(value, key);
  if (Array.isArray(value)) return arrayProperty(value, key);
  return unknown;
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
    return bindingValue(node, variable, definition, seen);
  }
  /** Project a validated single-definition binding.
   * @param node - Requested identifier.
   * @param variable - Lexical binding.
   * @param definition - Variable definition.
   * @param seen - Visited bindings.
   */
  function bindingValue(node, variable, definition, seen) {
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
   * @param introduced - 正在分析的别名赋值槽位。
   */
  function referenceSafety(variable, seen, introduced) {
    const states = variable.references.filter(ref => ref.identifier !== introduced
      && !(ref.init || ref.isTypeReference && !ref.isValueReference))
      .map(ref => safeReference(ref, seen));
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
    if (target.type === 'AssignmentPattern') return projectDefault(target, value, seen, visit);
    visit(target, value);
    if (target.type === 'ObjectPattern') projectObject(target, value, seen, visit);
    if (target.type === 'ArrayPattern') projectArray(target, value, seen, visit);
  }
  /** Project a default value only when the source is known to be missing.
   * @param target - Assignment pattern.
   * @param value - Source value.
   * @param seen - Visited bindings.
   * @param visit - Projection callback.
   */
  function projectDefault(target, value, seen, visit) {
    if (value === mutableData && !pureData(target.right, seen)) value = unknown;
    return project(target.left, value === undefined ? dataValue(target.right, seen) : value, seen, visit);
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
    const node = referenceTarget(reference.identifier, unwrap);
    const parent = node.parent;
    const owner = writeOwner(node);
    if (owner?.type === 'AssignmentExpression') return pureWrite(owner.left, owner.right, seen) && mutableData;
    if (['ForOfStatement', 'ForInStatement'].includes(owner?.type)) return false;
    return safeRead(node, parent, seen);
  }
  /** Classify deletes, aliases and other reads after handling writes.
   * @param node - Reference target.
   * @param parent - Direct consumer.
   * @param seen - Visited bindings.
   */
  function safeRead(node, parent, seen) {
    if (parent.type === 'UpdateExpression') return false;
    if (parent.operator === 'delete') return mutableData;
    const alias = aliasPattern(node);
    if (alias) return safeAliases(alias, seen);
    return safeCall(node, seen);
  }
  /**
   * 接收者和参数使用同一调用边界；只证明无回调的标量读取、输出及纯数据属性 API。
   * @param node - 引用及其成员链。
   * @param seen - 已访问绑定。
   */
  function safeCall(node, seen) {
    const parent = node.parent;
    if (parent.type !== 'CallExpression') return safeValueUse(node);
    const member = unwrap(parent.callee);
    if (member?.type !== 'MemberExpression') return false;
    if (parent.callee === node) {
      return scalarCall(parent, member, seen);
    }
    return safeArgumentCall(parent, member, seen);
  }
  /** Recognize console reads and pure-data property API writes.
   * @param call - Call expression.
   * @param member - Method member.
   * @param seen - Visited bindings.
   */
  function safeArgumentCall(call, member, seen) {
    if (['console.log', 'console.info', 'console.warn', 'console.error', 'console.debug', 'console.dir', 'console.table']
      .includes(`${origin(member.object)}.${propertyName(member)}`)) return true;
    return dataMutation(call, member, seen) && mutableData;
  }
  /** Prove a receiver call returns only a scalar and has no callback arguments.
   * @param call - Call expression.
   * @param member - Method member.
   * @param seen - Visited bindings.
   */
  function scalarCall(call, member, seen) {
    return ['includes', 'indexOf', 'lastIndexOf', 'join'].includes(propertyName(member))
      && call.arguments.every(argument => pureData(argument, seen));
  }
  /**
   * 声明投影形成共享引用；不允许通过新绑定把数据传入未知调用或改成函数。
   * @param pattern - 新绑定模式。
   * @param seen - 已检查的词法绑定。
   */
  function safeAliases(pattern, seen) {
    let safe = true;
    writeTargets(pattern, target => {
      if (target.type !== 'Identifier') { safe = false; return; }
      const variable = binding(target);
      if (!variable || seen.has(variable)) return;
      const next = new Set([...seen, variable]);
      const state = referenceSafety(variable, next, target);
      safe = combinedSafety(safe, state);
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
    const readers = {
      /** Handle the Literal syntax node. */
      Literal: () => primitiveValue(value),
      /** Handle the TemplateLiteral syntax node. */
      TemplateLiteral: () => primitiveValue(value),
      /** Handle the UnaryExpression syntax node. */
      UnaryExpression: () => primitiveValue(value),
      /** Handle the Identifier syntax node. */
      Identifier: () => dataBinding(value, seen),
      /** Handle the ArrayExpression syntax node. */
      ArrayExpression: () => arrayValue(value, seen),
      /** Handle the ObjectExpression syntax node. */
      ObjectExpression: () => objectValue(value, seen),
      /** Handle the MemberExpression syntax node. */
      MemberExpression: () => dataProperty(dataValue(value.object, seen), dataKey(value)),
    };
    const read = readers[value.type];
    return read ? read() : unknown;
  }
  /**
   * 读取静态原语；正负号只作用于数值字面量，不调用强制转换。
   * @param node - 字面量、模板或一元表达式。
   */
  function primitiveValue(node) {
    if (node.type === 'Literal') return node.regex ? unknown : node.value;
    if (node.type === 'TemplateLiteral') return stringKey(node) ?? unknown;
    return signedNumber(node);
  }
  /** Read only unary signs on numeric literals, without coercion.
   * @param node - Unary expression.
   */
  function signedNumber(node) {
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
      if (!dataField(property)) return unknown;
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

/** Read only map-owned data, treating inherited properties as unknown.
 * @param value - Static object map.
 * @param key - Requested key.
 */
function mapProperty(value, key) {
  if (value.has(key)) return value.get(key);
  return key in Object.prototype ? unknown : undefined;
}

/** Read only array-owned data without evaluating prototype methods.
 * @param value - Static array.
 * @param key - Requested key.
 */
function arrayProperty(value, key) {
  if (Object.hasOwn(value, key)) return value[key];
  return key in Array.prototype ? unknown : undefined;
}


/** Combine alias safety without recovering a previously unsafe source.
 * @param current - Aggregate safety.
 * @param next - Next alias safety.
 */
function combinedSafety(current, next) {
  if (!next) return false;
  return current && next === mutableData ? mutableData : current;
}

/** Accept only data properties, never methods or accessors.
 * @param property - Object member.
 */
function dataField(property) {
  return property.type === 'Property' && property.kind === 'init' && !property.method;
}
