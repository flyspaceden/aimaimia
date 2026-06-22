/**
 * 买家 App 单元测试配置（轻量版）
 *
 * 覆盖 src/utils 与 src/repos 下的轻量纯 TS 单元测试。
 * 不接 jest-expo / @testing-library/react-native 等 RN 完整渲染栈，
 * 因为这些会拉一大堆原生依赖且经常和 EAS prebuild 打架。
 *
 * 范围：Repo 归一化、纯函数、工具、类型守卫等不依赖 RN 渲染的 unit test。
 * UI 组件测试请走真机 / @testing-library/react-native（未引入）。
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/utils/__tests__/**/*.test.ts',
    '<rootDir>/src/repos/__tests__/**/*.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  // mock RN 原生模块，避免 ts-jest 编译时报 import 错
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/utils/__tests__/__mocks__/react-native.ts',
    '^react-native-wechat-lib$':
      '<rootDir>/src/utils/__tests__/__mocks__/react-native-wechat-lib.ts',
  },
  // ts-jest 用项目 tsconfig，但 isolatedModules + 跳过 strict 减少噪音
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
  // 跳过 backend / admin / seller / website / node_modules
  testPathIgnorePatterns: [
    '/node_modules/',
    '/backend/',
    '/admin/',
    '/seller/',
    '/website/',
    '/tests/',
  ],
};
