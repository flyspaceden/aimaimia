import { Injectable } from '@nestjs/common';
import { AfterSaleOperatorType, AfterSaleStatus, Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AfterSaleStatusHistoryService {
  create(tx: Tx, input: {
    afterSaleId: string;
    fromStatus?: AfterSaleStatus | null;
    toStatus: AfterSaleStatus;
    reason?: string;
    operatorType?: AfterSaleOperatorType;
    operatorId?: string;
    meta?: Prisma.InputJsonValue;
  }) {
    return tx.afterSaleStatusHistory.create({
      data: {
        afterSaleId: input.afterSaleId,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        reason: input.reason,
        operatorType: input.operatorType,
        operatorId: input.operatorId,
        meta: input.meta ?? Prisma.JsonNull,
      },
    });
  }
}
