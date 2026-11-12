const transparentNodes = new Set(['ChainExpression', 'TSAsExpression', 'TSTypeAssertion',
  'TSNonNullExpression', 'TSSatisfiesExpression', 'TSInstantiationExpression']);
/**
 * 只遍历真正的写入槽位，跳过属性键、默认值和成员对象中的读取。
 * @param pattern - 赋值目标或循环左侧。
 * @param visit - 对每个实际目标执行检查。
 */
export function writeTargets(pattern, visit) {
  const target = unwrap(pattern);
  const writers = {
    /** Handle the ObjectPattern syntax node. */
    ObjectPattern: () => target.properties.forEach(property => writeTargets(property.value ?? property.argument, visit)),
    /** Handle the ArrayPattern syntax node. */
    ArrayPattern: () => target.elements.forEach(item => writeTargets(item, visit)),
    /** Handle the RestElement syntax node. */
    RestElement: () => writeTargets(target.argument, visit),
    /** Handle the AssignmentPattern syntax node. */
    AssignmentPattern: () => writeTargets(target.left, visit),
    /** Handle the MemberExpression syntax node. */
    MemberExpression: () => visit(target),
    /** Handle the Identifier syntax node. */
    Identifier: () => visit(target),
  };
  writers[target?.type]?.();
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
  return templateKey(key);
}
/**
 * 统一成员与模式的静态属性键。
 * @param node - 成员或属性节点。
 */
export function propertyName(node) {
  const key = node.property ?? node.key;
  return !node.computed && key?.type === 'Identifier' ? key.name : stringKey(key);
}
/** Accept only interpolation-free templates.
 * @param key - Unwrapped key node.
 */
function templateKey(key) {
  if (key?.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0].value.cooked;
  return undefined;
}


/**
 * 数据键额外支持数组下标；网络入口的字符串键策略保持不变。
 * @param node - 成员或模式属性。
 */
export function dataKey(node) {
  const key = unwrap(node.property ?? node.key);
  return key?.type === 'Literal' && typeof key.value === 'number' ? String(key.value) : propertyName(node);
}
