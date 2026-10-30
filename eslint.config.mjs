import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';
import globals from 'globals';

import { unwrap, stringKey, propertyName, syntaxContext, writeTargets } from './scripts/network-syntax.mjs';

const routingMethods = new Set(['route', 'fulfill', 'routeFromHAR', 'routeWebSocket']);

/**
 * 检查直接属性对象，不递归扫描业务数据。
 * @param argument - 属性 API 的源对象或描述符对象。
 */
function hasFetchProperty(argument) {
  const properties = unwrap(argument);
  return properties?.type === 'ObjectExpression' && properties.properties.some(
    property => property.type === 'Property' && propertyName(property) === 'fetch');
}

/**
 * 判断调用是否用静态属性 API 替换 fetch，保留原有属性 API 边界。
 * @param call - 已解析的调用节点。
 * @param member - 去除包装的被调用成员。
 * @param syntax - 词法来源及纯数据检查。
 */
function replacesFetch(call, member, syntax) {
  if (syntax.pureUpdate(call)) return false;
  const method = propertyName(member);
  const objectAPI = syntax.origin(member.object) === 'Object';
  const reflectAPI = syntax.origin(member.object) === 'Reflect';
  if ((objectAPI || reflectAPI) && method === 'defineProperty'
    || reflectAPI && method === 'set' && syntax.origin(call.arguments[0]) === 'global') return stringKey(call.arguments[1]) === 'fetch';
  if (!objectAPI || !['assign', 'defineProperties'].includes(method)) return false;
  return call.arguments.slice(1).some(hasFetchProperty);
}

// 独立于离线 Response 例外；保留路由禁止语义，仅豁免可证明的纯数据。
const networkRoutingSyntax = {
  meta: {
    type: 'problem', schema: [],
    messages: { forbidden: '普通测试禁止新增 TypeScript 网络响应伪造；通过代理控制接口使用共享夹具。' },
  },
  /**
   * 检查路由成员读取和静态解构，不执行源码或追踪动态别名。
   * @param context - ESLint 规则上下文。
   */
  create(context) {
    const syntax = syntaxContext(context);
    /**
     * 报告已知路由方法的静态访问。
     * @param node - 成员或解构属性节点。
     */
    function check(node) {
      if (routingMethods.has(propertyName(node)) && !pureRoutingSource(node)) context.report({ node, messageId: 'forbidden' });
    }
    /**
     * 找出嵌套模式的根来源；未知参数仍受路由禁令约束。
     * @param node - 路由成员或模式属性。
     */
    function pureRoutingSource(node) {
      if (node.type === 'MemberExpression') return syntax.pureData(node.object);
      let pattern = node.parent;
      while (['Property', 'AssignmentPattern', 'ArrayPattern', 'RestElement'].includes(pattern.parent?.type)) {
        pattern = pattern.parent.type === 'Property' ? pattern.parent.parent : pattern.parent;
      }
      const parent = pattern.parent;
      if (parent?.type === 'VariableDeclarator') return syntax.purePattern(pattern, parent.init, node);
      if (parent?.type === 'AssignmentExpression') return syntax.purePattern(pattern, parent.right, node);
      return false;
    }
    return { MemberExpression: check, 'ObjectPattern > Property': check };
  },
};

// 各入口独立报告：替换 fetch 不要求同时出现 Response，制造 Response 也不要求替换 fetch。
const networkResponses = {
  meta: {
    type: 'problem', schema: [],
    messages: { forbidden: '普通测试禁止伪造 fetch 响应；适配器单元测试例外必须精确登记。' },
  },
  /**
   * 使用生产解析器的 AST 检查直接语法族。
   * @param context - ESLint 规则上下文。
   */
  create(context) {
    const syntax = syntaxContext(context);
    /**
     * 报告当前独立违规入口。
     * @param node - 违规节点。
     */
    function report(node) {
      context.report({ node, messageId: 'forbidden' });
    }
    /**
     * 仅检查来源明确为 Response 构造器的直接解构。
     * @param pattern - 声明或赋值的目标模式。
     * @param source - 直接来源表达式。
     */
    function checkResponsePattern(pattern, source) {
      checkPattern(pattern, syntax.origin(source));
    }
    /**
     * 沿静态解构键递归传播明确来源。
     * @param pattern - 当前嵌套模式。
     * @param origin - 当前来源分类。
     */
    function checkPattern(pattern, origin) {
      const target = unwrap(pattern);
      if (target?.type === 'AssignmentPattern') return checkPattern(target.left, origin);
      if (target?.type !== 'ObjectPattern') return;
      for (const property of target.properties) {
        if (property.type !== 'Property') continue;
        const key = propertyName(property);
        if (origin === 'Response' && key === 'json') report(property);
        checkPattern(property.value, syntax.childOrigin(origin, key));
      }
    }
    /**
     * 对嵌套模式和循环统一检查实际写入目标；不扫描键或默认值中的读取。
     * @param pattern - 赋值左侧。
     * @param source - 直接赋值载荷；循环来源保持未知。
     */
    function checkWrites(pattern, source) {
      writeTargets(pattern, target => {
        if (target.type === 'MemberExpression' && propertyName(target) === 'fetch'
          && !(syntax.pureData(target.object) && syntax.pureWrite(pattern, source))) report(target);
      });
    }
    /**
     * 循环中的左侧同样会替换网络入口，右侧并非直接写入值。
     * @param node - for-in 或 for-of 节点。
     */
    function checkLoop(node) {
      checkWrites(node.left);
    }
    return {
      ForOfStatement: checkLoop,
      ForInStatement: checkLoop,
      /**
       * 覆盖直接声明解构，包括静态计算键及方法重命名。
       * @param node - 变量声明节点。
       */
      VariableDeclarator(node) {
        checkResponsePattern(node.id, node.init);
      },
      /**
       * 默认参数的直接来源同样可以静态确定。
       * @param node - 带默认值的模式。
       */
      AssignmentPattern(node) {
        checkResponsePattern(node.left, node.right);
      },
      /**
       * 成员读取也覆盖取出 Response.json 再调用的直接写法。
       * @param node - 成员访问节点。
       */
      MemberExpression(node) {
        if (syntax.origin(node.object) === 'Response' && propertyName(node) === 'json') report(node);
      },
      /**
       * 识别直接及全局限定的 Response 构造器。
       * @param node - 构造表达式。
       */
      NewExpression(node) {
        if (syntax.origin(node.callee) === 'Response') report(node);
      },
      /**
       * 保留原有 fetch 成员赋值限制，并统一计算属性和透明包装。
       * @param node - 赋值表达式。
       */
      AssignmentExpression(node) {
        checkWrites(node.left, node.right);
        checkResponsePattern(node.left, node.right);
      },
      /**
       * 识别属性 API 及原有 mock.method 入口。
       * @param node - 调用表达式。
       */
      CallExpression(node) {
        const member = unwrap(node.callee);
        if (member?.type !== 'MemberExpression') return;
        if (propertyName(member) === 'method' && stringKey(node.arguments[1]) === 'fetch'
          || replacesFetch(node, member, syntax)) report(node);
      },
    };
  },
};

export default [
  { ignores: ['**/node_modules/**', '**/.venv/**', '**/test-results/**', '**/playwright-report/**', '**/blob-report/**', '.ttyctl/**', '**/snapshots/**'] },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { jsdoc, tsdoc },
    rules: {
      ...js.configs.recommended.rules,
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      // require-jsdoc 要求注释存在；tsdoc/syntax 再校验其遵循 TSDoc 格式。
      'jsdoc/require-jsdoc': ['error', {
        enableFixer: false,
        require: {
          FunctionDeclaration: true,
          FunctionExpression: true,
          ArrowFunctionExpression: true,
          ClassDeclaration: true,
          ClassExpression: true,
          MethodDefinition: true,
        },
      }],
      'jsdoc/require-description': 'error',
      // TSDoc 只允许形参名；对象字段写在该形参的说明里，避免不合法的 a.b 标签。
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-param-description': 'error',
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'tsdoc/syntax': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin,
      quality: { rules: { 'no-network-responses': networkResponses, 'no-network-routing': networkRoutingSyntax } } },
    rules: {
      'quality/no-network-routing': 'error',
      'quality/no-network-responses': 'error',
      // TypeScript 编译器检查类型名称；使用识别类型引用的未使用变量规则。
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Playwright 用空解构参数声明不依赖其他 fixture，不能改成普通参数名。
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
  {
    // 房间清理适配器单元测试：离线断言 DELETE 地址、凭据和错误传播，不运行界面用例。
    files: ['visual/cases/_shared/room.test.ts'],
    rules: { 'quality/no-network-responses': 'off' },
  },
];
