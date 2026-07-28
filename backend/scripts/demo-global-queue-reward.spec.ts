import {
  buildGlobalQueueRewardDemoOrders,
  runGlobalQueueRewardDemo,
} from './demo-global-queue-reward';

describe('global queue reward 21-to-22 virtual demo', () => {
  it('rotates the first two positions at the 21st and 22nd entries', () => {
    const report = runGlobalQueueRewardDemo();

    expect(report.steps).toHaveLength(22);
    expect(report.steps[20]).toMatchObject({
      sequence: 21,
      priorWindowSize: 20,
      completedPositionIds: ['位置01'],
    });
    expect(report.steps[21]).toMatchObject({
      sequence: 22,
      priorWindowSize: 20,
      completedPositionIds: ['位置02'],
    });
  });

  it('keeps every cent conserved and pending until the after-sale window closes', () => {
    const report = runGlobalQueueRewardDemo();

    expect(
      report.totals.distributedCents +
        report.totals.platformRetainedCents,
    ).toBe(report.totals.nominalRewardPoolCents);
    expect(report.totals.pendingWalletCentsBeforeRelease).toBe(
      report.totals.distributedCents,
    );
    expect(report.totals.availableWalletCentsBeforeRelease).toBe(0);
    expect(report.totals.availableWalletCentsAfterRelease).toBe(
      report.totals.distributedCents,
    );
    expect(report.totals.notificationCountAfterRelease).toBe(
      report.distributions.length,
    );
    expect(report.totals.firstPositionBellCount).toBe(20);
  });

  it('uses one global queue across identities, merchants and repeat buyers', () => {
    const orders = buildGlobalQueueRewardDemoOrders();
    const report = runGlobalQueueRewardDemo(orders);

    expect(new Set(orders.map((order) => order.merchantId)).size).toBe(3);
    expect(new Set(orders.map((order) => order.identity))).toEqual(
      new Set(['NORMAL', 'VIP']),
    );
    expect(report.totals.crossMerchantRewardCount).toBeGreaterThan(0);
    expect(report.totals.sameUserHistoricalRewardCount).toBeGreaterThan(0);
  });
});
