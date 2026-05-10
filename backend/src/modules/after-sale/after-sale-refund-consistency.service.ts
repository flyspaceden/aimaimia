import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

export type AfterSaleRefundMismatch = {
  afterSaleId: string | null;
  requestRefundId: string | null;
  refundId: string | null;
  refundAfterSaleId: string | null;
};

@Injectable()
export class AfterSaleRefundConsistencyService {
  private readonly logger = new Logger(AfterSaleRefundConsistencyService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 5 3 * * *')
  async scan(): Promise<AfterSaleRefundMismatch[]> {
    const mismatches = await this.prisma.$queryRaw<AfterSaleRefundMismatch[]>`
      SELECT
        a.id AS "afterSaleId",
        a."refundId" AS "requestRefundId",
        r.id AS "refundId",
        r."afterSaleId" AS "refundAfterSaleId"
      FROM after_sale_request a
      FULL JOIN "Refund" r
        ON r."afterSaleId" = a.id OR a."refundId" = r.id
      WHERE r."afterSaleId" IS NOT NULL
        AND (
          a.id IS NULL
          OR a."refundId" IS NULL
          OR a."refundId" <> r.id
          OR r."afterSaleId" <> a.id
        )
      LIMIT 100
    `;

    if (mismatches.length > 0) {
      this.logger.error(`售后退款双向关系不一致: ${JSON.stringify(mismatches)}`);
    }
    return mismatches;
  }
}
