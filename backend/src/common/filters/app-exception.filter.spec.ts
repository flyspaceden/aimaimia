import { ArgumentsHost } from '@nestjs/common';
import { AppExceptionFilter } from './app-exception.filter';
import { ProfitSafetyViolationError } from '../../modules/profit/profit-safety-validator';

describe('AppExceptionFilter profit safety response', () => {
  it('returns HTTP 400 and preserves structured profit safety details', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'PUT', url: '/admin/captain/settings', headers: {} }),
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;
    const summary: any = {
      safe: false,
      scenarios: [{ key: 'VIP_BUYER_VIP_INVITER', safe: false }],
      limitingSkus: [{ skuId: 'sku-1', shortfall: 0.02 }],
      shortfall: 0.02,
      evaluatedSkuCount: 1,
      platformRequiredRevenueRate: 0.215,
      captainMaximumProfitRate: 0,
      captainConfiguredCap: 0.1,
      captainConfigState: 'ENABLED',
      errors: ['UNSAFE'],
      profitSafetyConfigCompleteness: {
        complete: true,
        requiredKeys: ['MARKUP_RATE'],
        presentKeys: ['MARKUP_RATE'],
        missingKeys: [],
      },
    };

    new AppExceptionFilter().catch(new ProfitSafetyViolationError(summary), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({
        code: 'INVALID',
        businessCode: 'CAPTAIN_PROFIT_SAFETY_VIOLATION',
        scenarios: summary.scenarios,
        limitingSkus: summary.limitingSkus,
        shortfall: 0.02,
        captainConfigState: 'ENABLED',
        profitSafetyConfigCompleteness: summary.profitSafetyConfigCompleteness,
      }),
    });
  });
});
