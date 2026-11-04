/** 静态依赖分层：界面调用代理控制 API，响应实现留在适配器层。 */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'ui-no-response-implementation',
      severity: 'error',
      from: {
        path: '.',
        // scenarios.test.mjs 离线核对适配器响应及节点透传，不能据此豁免其他测试。
        pathNot: '^(android/(proxy\\.ts|network-routes\\.ts|scenarios\\.test\\.mjs)|visual/src/support/networkMocks\\.ts)$',
      },
      to: {
        path: '(^visual/src/support/networkMocks\\.ts$|^android/network-routes\\.ts$|/mitmproxy/)',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'response-no-ui', severity: 'error',
      from: { path: '^(visual/src/support/|android/network-routes\\.ts$|e2e/helpers/)' },
      to: { path: '^android/', pathNot: '^android/network-routes\\.ts$' },
    },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|\\.venv|snapshots|test-results|playwright-report|blob-report|artifacts|\\.ttyctl)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'],
      // 现代包可能只有 exports、没有 main；同时遵守未导出子路径的封装边界。
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
