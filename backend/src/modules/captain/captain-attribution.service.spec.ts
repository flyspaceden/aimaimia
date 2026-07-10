import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';
import { CaptainAttributionService } from './captain-attribution.service';

function makeV2Config(enabled = true) {
  return {
    schemaVersion: 2,
    enabled,
    programCode: 'SEAFOOD_PREPACKAGED',
  };
}

function makeV3Config(enabled = true) {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled,
  };
}

function createHarness(config: any) {
  const configService = {
    getSnapshot: jest.fn().mockResolvedValue(config),
  };
  const tx: any = {
    captainOrderAttribution: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    order: { findUnique: jest.fn() },
    captainRelation: { findUnique: jest.fn() },
    captainProfile: { findMany: jest.fn() },
    captainCommissionLedger: { create: jest.fn() },
  };

  return {
    tx,
    service: new CaptainAttributionService(configService as any),
  };
}

describe('CaptainAttributionService activation boundary', () => {
  it.each([
    ['enabled persisted V2', makeV2Config(true)],
    ['disabled persisted V2', makeV2Config(false)],
    ['enabled V3 before the V3 attribution path is installed', makeV3Config(true)],
    ['disabled V3', makeV3Config(false)],
  ])('creates no new legacy sales attribution for %s', async (_label, config) => {
    const { service, tx } = createHarness(config);

    await expect(service.createFrozenForPaidOrder(tx, 'order-1')).resolves.toBe('skipped');

    expect(tx.captainOrderAttribution.findUnique).not.toHaveBeenCalled();
    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.captainRelation.findUnique).not.toHaveBeenCalled();
    expect(tx.captainProfile.findMany).not.toHaveBeenCalled();
    expect(tx.captainOrderAttribution.create).not.toHaveBeenCalled();
    expect(tx.captainCommissionLedger.create).not.toHaveBeenCalled();
  });
});
