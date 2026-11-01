// 只分类引用的语法消费位置，不执行源码，也不解析任意运行时别名。
/**
 * 引用可能经容器、分支或回调返回传递；继续找到真正消费它的位置。
 * @param node - 当前引用或其包装。
 * @param unwrap - 共享的透明包装归一化。
 */
export function referenceTarget(node, unwrap) {
  let next;
  while ((next = forwardedValue(node, unwrap))) node = next;
  return node;
}

/**
 * 识别仍可能携带同一引用的表达式，不把条件测试或非末尾逗号项当返回值。
 * @param node - 当前值。
 * @param unwrap - 透明包装归一化。
 */
function forwardedValue(node, unwrap) {
  const parent = node.parent;
  if (!parent) return undefined;
  if (unwrap(parent) !== parent) return parent;
  if (['ArrayExpression', 'SpreadElement', 'AwaitExpression', 'LogicalExpression'].includes(parent.type)) return parent;
  if (parent.type === 'MemberExpression' && parent.object === node) return parent;
  if (parent.type === 'Property' && parent.value === node && parent.parent.type === 'ObjectExpression') return parent.parent;
  return forwardedResult(node, parent);
}

/**
 * 分支和回调的返回值仍可共享来源，包括块函数里的 return。
 * @param node - 当前值。
 * @param parent - 直接父节点。
 */
function forwardedResult(node, parent) {
  if (parent.type === 'ConditionalExpression' && parent.test !== node) return parent;
  if (parent.type === 'SequenceExpression' && parent.expressions.at(-1) === node) return parent;
  if (parent.type === 'ArrowFunctionExpression' && parent.body === node) return parent;
  if (parent.type !== 'ReturnStatement') return undefined;
  let owner = parent.parent;
  while (owner && !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(owner.type)) owner = owner.parent;
  return owner;
}

/**
 * 从一个实际目标向上定位写入，跳过计算键或默认值中的读取。
 * @param node - 最外层成员目标。
 */
export function writeOwner(node) {
  const parent = node.parent;
  if (!parent) return undefined;
  if (parent.type === 'Property' && parent.value === node) return writeOwner(parent.parent);
  if (['ArrayPattern', 'RestElement'].includes(parent.type)) return writeOwner(parent);
  if (parent.type === 'AssignmentPattern' && parent.left === node) return writeOwner(parent);
  return parent.left === node ? parent : undefined;
}

/**
 * 声明和直接赋值都可把共享来源交给局部绑定，后续用途须继续检查。
 * @param node - 来源引用。
 */
export function aliasPattern(node) {
  const parent = node.parent;
  if (parent.type === 'VariableDeclarator' && parent.init === node) return parent.id;
  if (parent.type === 'AssignmentExpression' && parent.right === node) return parent.left;
  return undefined;
}

/**
 * 只允许已知不传递共享引用的消费；未知父节点不能获得稳定性证明。
 * @param node - 已展开的实际使用位置。
 */
export function safeValueUse(node) {
  const parent = node.parent;
  if (['ExpressionStatement', 'BinaryExpression', 'TSTypeQuery', 'TSQualifiedName'].includes(parent?.type)) return true;
  if (parent?.type === 'UnaryExpression') return parent.operator !== 'delete';
  if (parent?.type === 'TemplateLiteral') return parent.parent.type !== 'TaggedTemplateExpression';
  return scalarPosition(node, parent);
}

/**
 * 条件、属性键和被丢弃的逗号项只读取值，不把引用传给调用者。
 * @param node - 实际使用位置。
 * @param parent - 消费节点。
 */
function scalarPosition(node, parent) {
  if (!parent) return false;
  if (parent.test === node || parent.discriminant === node) return true;
  if (parent.type === 'MemberExpression') return parent.property === node;
  if (parent.type === 'Property') return parent.key === node && !parent.shorthand;
  return parent.type === 'SequenceExpression' && parent.expressions.at(-1) !== node;
}
