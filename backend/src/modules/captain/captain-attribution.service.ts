import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CaptainConfigService } from './captain-config.service';

export type CaptainAttributionResult = 'credited' | 'skipped';

@Injectable()
export class CaptainAttributionService {
  constructor(private readonly configService: CaptainConfigService) {}

  async createFrozenForPaidOrder(
    _tx: Prisma.TransactionClient,
    _orderId: string,
  ): Promise<CaptainAttributionResult> {
    const config = await this.configService.getSnapshot();

    // V2 remains readable only for historical release/refund/audit flows.
    // Profit-based attribution is activated only by the dedicated V3 path.
    if (config.schemaVersion === 2 || !config.enabled) {
      return 'skipped';
    }
    return 'skipped';
  }
}
