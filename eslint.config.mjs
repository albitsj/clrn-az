import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// 检查成员访问也能阻止取出方法后使用别名；解构访问由 ObjectPattern 选择器覆盖。
const networkRouting = [
  {
    selector: 'MemberExpression[computed=false][property.name=/^(route|fulfill|routeFromHAR|routeWebSocket)$/], MemberExpression[computed=true][property.value=/^(route|fulfill|routeFromHAR|routeWebSocket)$/], ObjectPattern > Property[key.name=/^(route|fulfill|routeFromHAR|routeWebSocket)$/], ObjectPattern > Property[key.value=/^(route|fulfill|routeFromHAR|routeWebSocket)$/]',
    message: '普通测试禁止新增 TypeScript 网络响应伪造；通过代理控制接口使用共享夹具。',
  },
];

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
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-restricted-syntax': ['error',
        ...networkRouting,
        {
          selector: 'NewExpression[callee.name="Response"], CallExpression[callee.object.name="Response"][callee.property.name="json"], CallExpression[callee.property.name="method"][arguments.1.value="fetch"], AssignmentExpression[left.type="MemberExpression"][left.property.name="fetch"], AssignmentExpression[left.type="MemberExpression"][left.property.value="fetch"]',
          message: '普通测试禁止伪造 fetch 响应；适配器单元测试例外必须精确登记。',
        },
      ],
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
    rules: { 'no-restricted-syntax': ['error', ...networkRouting] },
  },
];
