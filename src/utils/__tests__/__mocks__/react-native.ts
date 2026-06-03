/**
 * jest 环境下的 react-native 极简 mock。
 * 测试用例可在 setup 阶段通过 (require('react-native') as any).Platform.OS = 'ios' 覆盖。
 */
export const Platform = {
  OS: 'android' as 'android' | 'ios' | 'web',
  select: <T,>(spec: { android?: T; ios?: T; default?: T }): T | undefined =>
    spec[Platform.OS as 'android' | 'ios'] ?? spec.default,
};
