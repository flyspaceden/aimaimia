import { AuditLogInterceptor } from './audit-log.interceptor';
import { Reflector } from '@nestjs/core';

describe('基金操作审计快照', () => {
  it('捕获付款状态与核销信息，选择字段不含对公账号或凭证', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'p', status: 'PAID', amount: 16, items: [], recoveries: [] });
    const audit = new AuditLogInterceptor(new Reflector(), { industryFundPayment: { findUnique } } as never);
    const snapshot = await (audit as any).captureSnapshot('IndustryFundPayment', 'p');
    expect(snapshot.status).toBe('PAID');
    expect(findUnique.mock.calls[0][0].select).toMatchObject({ amount: true, status: true, items: expect.any(Object), recoveries: expect.any(Object) });
    expect(JSON.stringify(findUnique.mock.calls[0][0].select)).not.toMatch(/bankAccount|proofKey|content/);
  });
  it('凭证审计不读取二进制文件内容', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'proof', mimeType: 'application/pdf' });
    const audit = new AuditLogInterceptor(new Reflector(), { fundPrivateProof: { findUnique } } as never);
    await (audit as any).captureSnapshot('FundPrivateProof', 'proof');
    expect(findUnique.mock.calls[0][0].select.content).toBeUndefined();
  });
});
