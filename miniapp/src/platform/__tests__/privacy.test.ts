import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMiniappPrivacyContractName,
  MINIAPP_PRIVACY_AGREE_BUTTON_ID,
  openMiniappPrivacyContract,
  registerMiniappPrivacyAuthorization,
  resolveMiniappPrivacyRequest,
} from '../privacy';

const onNeedPrivacyAuthorization = vi.hoisted(() => vi.fn());
const getPrivacySetting = vi.hoisted(() => vi.fn());
const openPrivacyContract = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: { onNeedPrivacyAuthorization, getPrivacySetting, openPrivacyContract },
}));

describe('mini program privacy authorization', () => {
  beforeEach(() => {
    onNeedPrivacyAuthorization.mockReset();
    getPrivacySetting.mockReset();
    openPrivacyContract.mockReset();
  });

  it('exposes the authorization UI and resolves from the real agree button', () => {
    const handler = vi.fn();
    const unregister = registerMiniappPrivacyAuthorization(handler);
    const listener = onNeedPrivacyAuthorization.mock.calls[0]?.[0];
    const resolve = vi.fn();

    listener(resolve, { referrer: 'chooseMedia' });
    expect(resolve).toHaveBeenCalledWith({ event: 'exposureAuthorization' });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ resolve, referrer: 'chooseMedia' }));

    resolveMiniappPrivacyRequest(handler.mock.calls[0][0], 'agree');
    expect(resolve).toHaveBeenLastCalledWith({ event: 'agree', buttonId: MINIAPP_PRIVACY_AGREE_BUTTON_ID });
    unregister();
  });

  it('reads and opens the WeChat privacy contract', async () => {
    getPrivacySetting.mockImplementation(({ success }) => success({ needAuthorization: true, privacyContractName: '爱买买隐私保护指引', errMsg: 'ok' }));
    openPrivacyContract.mockImplementation(({ success }) => success({ errMsg: 'ok' }));

    await expect(getMiniappPrivacyContractName()).resolves.toBe('爱买买隐私保护指引');
    await expect(openMiniappPrivacyContract()).resolves.toBeUndefined();
  });
});
