import { InviteH5Controller } from './invite-h5.controller';

describe('InviteH5Controller', () => {
  const dto = {
    inviteCode: 'KYY12345',
    userAgent: 'Mozilla/5.0',
    screenWidth: 393,
    screenHeight: 873,
    language: 'zh-CN',
    devicePixelRatio: 2.75,
    colorDepth: 24,
    timezoneOffset: -480,
    maxTouchPoints: 5,
  };

  it('uses the Express trusted-proxy IP instead of a spoofable forwarded header', () => {
    const service = {
      recordLanding: jest.fn().mockReturnValue({ landingSessionId: 'ih5_1' }),
      resumeDownloadPass: jest.fn().mockReturnValue({ valid: false }),
    };
    const controller = new InviteH5Controller(service as any);
    const request = {
      headers: { 'x-forwarded-for': '198.51.100.99' },
      ips: ['203.0.113.10'],
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    controller.recordLanding(dto, request);
    controller.resumeDownloadPass(dto, request);

    expect(service.recordLanding).toHaveBeenCalledWith(dto, '203.0.113.10');
    expect(service.resumeDownloadPass).toHaveBeenCalledWith(dto, '203.0.113.10');
  });

  it('falls back to req.ip when no trusted proxy chain is present', () => {
    const service = {
      recordLanding: jest.fn().mockReturnValue({ landingSessionId: 'ih5_1' }),
    };
    const controller = new InviteH5Controller(service as any);
    const request = {
      headers: { 'x-forwarded-for': '198.51.100.99' },
      ips: [],
      ip: '192.0.2.20',
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    controller.recordLanding(dto, request);

    expect(service.recordLanding).toHaveBeenCalledWith(dto, '192.0.2.20');
  });
});
