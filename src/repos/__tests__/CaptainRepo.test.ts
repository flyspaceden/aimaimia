/// <reference types="jest" />

jest.mock('../http/config', () => ({
  API_BASE_URL: 'https://api.example.test',
  USE_MOCK: false,
}));

jest.mock('../../utils/logout', () => ({
  logoutAndClearClientState: jest.fn(),
}));

import { CaptainRepo } from '../CaptainRepo';

describe('CaptainRepo', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
    jest.clearAllMocks();
  });

  function mockFetch(data: unknown) {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: jest.fn().mockResolvedValue({ ok: true, data }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    return fetchMock;
  }

  it('calls the dedicated captain me endpoint', async () => {
    const fetchMock = mockFetch({ isCaptain: false, profile: null, account: null, metric: null });

    const result = await CaptainRepo.getMyCaptainProfile();

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/captain/me');
  });

  it('calls the dedicated captain landing endpoint', async () => {
    const fetchMock = mockFetch({ code: 'SEA001', valid: true, captain: null });

    await CaptainRepo.getLanding('SEA001');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/captain/landing/SEA001');
  });

  it('posts captain code binding without using VIP referral endpoint', async () => {
    const fetchMock = mockFetch({ success: true, relation: { id: 'relation-1' } });

    await CaptainRepo.bindByCode('SEA001');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/captain/bind');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code: 'SEA001' }),
    }));
  });

  it('calls the dedicated captain application status endpoint', async () => {
    const fetchMock = mockFetch({ isCaptain: false, application: null, canSubmit: true });

    const result = await CaptainRepo.getMyApplication();

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/captain/applications/me');
  });

  it('submits captain application through the independent captain application endpoint', async () => {
    const fetchMock = mockFetch({ id: 'application-1', status: 'PENDING' });
    const payload = {
      realName: '林小海',
      contact: 'wx:linxiaohai',
      city: '杭州',
      communityScale: 'BETWEEN_50_200',
      expectedMonthlyGmv: 'BETWEEN_10000_30000',
      resourceTypes: ['WECHAT_GROUP'],
      promotionPlan: '小区团购',
      seafoodExperience: 'SOLD_BEFORE',
      complianceAccepted: true,
    };

    await CaptainRepo.submitApplication(payload);

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/captain/applications');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
  });
});
