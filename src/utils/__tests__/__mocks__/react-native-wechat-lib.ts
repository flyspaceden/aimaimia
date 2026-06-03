/**
 * jest 环境下的 react-native-wechat-lib mock 占位。
 * 测试用例通过 jest.mock('react-native-wechat-lib', () => ({...})) 在文件级覆盖。
 */
declare const jest: any;

export const isWXAppInstalled = jest.fn();
export const pay = jest.fn();
export const registerApp = jest.fn();
