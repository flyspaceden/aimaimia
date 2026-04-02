import { Injectable } from '@nestjs/common';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';

@Injectable()
export class SellerConfigService {
  constructor(private readonly bonusConfig: BonusConfigService) {}

  async getMarkupRate(): Promise<{ markupRate: number }> {
    const config = await this.bonusConfig.getConfig();
    return { markupRate: config.markupRate ?? 1.3 };
  }
}
