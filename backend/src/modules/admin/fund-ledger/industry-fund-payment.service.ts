import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { IndustryFundError, IndustryFundService, yuanToCents } from '../../fund-ledger/industry-fund.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FundPaymentConfirmDto, FundPaymentCreateDto, FundPaymentReasonDto, FundRecoveryDto } from './fund-ledger.dto';

/** 所有付款记账均为 Serializable；重试只重放本地事务，绝不重复发起银行付款。 */
@Injectable()
export class IndustryFundPaymentService {
  constructor(private readonly prisma: PrismaService, private readonly core: IndustryFundService) {}

  private readonly paymentInclude = { items: true } as const;

  private normalizeRequestKey(value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException('幂等键不能为空');
    return normalized;
  }

  /** 只持久化摘要和结果标识，绝不把付款资料写入幂等表或日志。 */
  private requestFingerprint(input: {
    operation: string;
    targetId: string;
    actorId: string;
    requestKey: string;
    payload: Record<string, unknown>;
  }): string {
    const canonical = JSON.stringify({
      operation: input.operation,
      targetId: input.targetId,
      actorId: input.actorId,
      requestKey: input.requestKey,
      payload: input.payload,
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  private async replayPayment(tx: Prisma.TransactionClient, resultId: string) {
    return tx.industryFundPayment.findUniqueOrThrow({ where: { id: resultId }, include: this.paymentInclude });
  }

  private async replayRecovery(tx: Prisma.TransactionClient, resultId: string) {
    const recovery = await tx.industryFundRecovery.findUnique({
      where: { id: resultId },
      include: { ledgers: { select: { id: true } } },
    });
    if (!recovery) throw new IndustryFundError('IDEMPOTENCY_RESULT_MISSING', '幂等请求的回款结果不存在');
    return {
      amountCents: yuanToCents(recovery.amount),
      recoveryId: recovery.id,
      ledgerIds: recovery.ledgers.map((ledger) => ledger.id),
    };
  }

  private async withRequestIdempotency<T>(
    tx: Prisma.TransactionClient,
    request: {
      operation: string;
      targetId: string;
      actorId: string;
      requestKey: string;
      fingerprint: string;
    },
    execute: () => Promise<{ value: T; resultType: 'PAYMENT' | 'RECOVERY'; resultId: string }>,
    replay: (resultType: string, resultId: string) => Promise<T>,
  ): Promise<T> {
    type RequestRow = {
      requestKey: string;
      operation: string;
      targetId: string;
      actorId: string;
      fingerprint: string;
      resultType: string;
      resultId: string;
    };
    const existingRows = await tx.$queryRaw<RequestRow[]>`
      SELECT "requestKey", operation, "targetId", "actorId", fingerprint, "resultType", "resultId"
      FROM "industry_fund_payment_requests"
      WHERE "requestKey" = ${request.requestKey}
      LIMIT 1
    `;
    const existing = existingRows[0];
    if (existing) {
      if (
        existing.operation !== request.operation
        || existing.targetId !== request.targetId
        || existing.actorId !== request.actorId
        || existing.fingerprint !== request.fingerprint
      ) {
        throw new IndustryFundError('IDEMPOTENCY_CONFLICT', `payment request key already belongs to another request: ${request.requestKey}`);
      }
      return replay(existing.resultType, existing.resultId);
    }

    const result = await execute();
    await tx.$executeRaw`
      INSERT INTO "industry_fund_payment_requests"
        ("id", "requestKey", operation, "targetId", "actorId", fingerprint, "resultType", "resultId")
      VALUES
        (${randomUUID()}, ${request.requestKey}, ${request.operation}, ${request.targetId}, ${request.actorId}, ${request.fingerprint}, ${result.resultType}, ${result.resultId})
    `;
    return result.value;
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
      } catch (error) {
        const retry = error instanceof Prisma.PrismaClientKnownRequestError && (['P2034', 'P2002'].includes(error.code) || error.code === 'P2010' && ['23505', '40001', '40P01'].includes(String(error.meta?.code)))
          || error instanceof IndustryFundError && error.code.startsWith('CONCURRENT_');
        if (retry && attempt < 3) continue;
        if (error instanceof IndustryFundError) {
          const messages: Record<string, string> = {
            INSUFFICIENT_PAYABLE_BALANCE: '公司可支付余额不足',
            RECOVERY_DUE_BLOCKS_PAYMENT: '该公司存在待追偿金额，暂不能创建新付款单',
            PAYMENT_NEEDS_REVIEW: '该付款单涉及售后，请先核实是否已经实际付款',
            PAYMENT_AMOUNT_MISMATCH: '实际付款金额必须与预留金额一致',
            PAYMENT_ALREADY_CONFIRMED: '该付款已登记，提交的凭证与原记录不一致',
            DUPLICATE_BANK_REFERENCE: '该银行流水已被登记，请核对原记录',
            PAYMENT_REVERSE_BLOCKED: '该付款已关联售后或后续处理，不能直接冲正',
            IDEMPOTENCY_CONFLICT: '同一请求编号已用于其他内容，请核对原记录',
            IDEMPOTENCY_RESULT_MISSING: '幂等请求的原始结果不存在，请联系管理员核对账本',
            RECOVERY_EXCEEDS_DUE: '回款金额超过待追偿金额',
            AFTER_SALE_ACTIVE: '相关订单有售后，暂不能付款',
            INVALID_PAYEE: '请核对公司名称及对公账户信息',
            COMPANY_NOT_ACTIVE: '公司当前状态不允许付款',
          };
          if (error.code.endsWith('NOT_FOUND')) throw new NotFoundException('对应账本或付款记录不存在');
          throw new ConflictException(messages[error.code] ?? `账本状态不满足操作条件（${error.code}），请刷新后核对`);
        }
        if (retry) throw new ConflictException('账本正被其他操作更新，请查询最新状态后重试');
        throw error;
      }
    }
  }

  private async reconcile(tx: Prisma.TransactionClient, companyId: string) {
    const result = await this.core.reconcileAccount(tx, companyId);
    if (!result.ok) throw new ConflictException('公司账本对账不一致，已暂停付款，请先核对');
  }

  async createPayment(body: FundPaymentCreateDto, actorId: string) {
    if (!body.reason?.trim()) throw new BadRequestException('请填写登记原因');
    const requestKey = this.normalizeRequestKey(body.idempotencyKey);
    const normalized = {
      companyId: body.companyId.trim(),
      amount: body.amount,
      payeeName: body.payeeName.trim(),
      bankAccount: body.bankAccount.trim(),
      bankName: body.bankName.trim(),
      reason: body.reason.trim(),
      idempotencyKey: requestKey,
    };
    return this.write(async tx => {
      const request = {
        operation: 'CREATE_PAYMENT',
        targetId: normalized.companyId,
        actorId,
        requestKey,
        fingerprint: this.requestFingerprint({
          operation: 'CREATE_PAYMENT',
          targetId: normalized.companyId,
          actorId,
          requestKey,
          payload: normalized,
        }),
      };
      return this.withRequestIdempotency(tx, request, async () => {
        await this.reconcile(tx, normalized.companyId);
        const value = await this.core.reservePayment(tx, { ...normalized, actorId, actorType: 'ADMIN' });
        return { value, resultType: 'PAYMENT', resultId: value.id };
      }, (resultType, resultId) => {
        if (resultType !== 'PAYMENT') throw new IndustryFundError('IDEMPOTENCY_RESULT_MISSING', '幂等请求结果类型不匹配');
        return this.replayPayment(tx, resultId);
      });
    });
  }
  private async paymentCompany(tx: Prisma.TransactionClient, id: string) {
    const payment = await tx.industryFundPayment.findUnique({ where: { id }, select: { companyId: true } });
    if (!payment) throw new NotFoundException('付款单不存在');
    await this.reconcile(tx, payment.companyId);
    return payment.companyId;
  }
  async confirmPayment(id: string, body: FundPaymentConfirmDto, actorId: string) {
    const requestKey = this.normalizeRequestKey(body.idempotencyKey);
    const paidAt = new Date(body.paidAt);
    if (paidAt.getTime() > Date.now() + 60000) throw new BadRequestException('实际付款时间不能在未来');
    const normalized = {
      actualAmount: body.actualAmount,
      paidAt: paidAt.toISOString(),
      sourceAccountRef: body.sourceAccountRef.trim(),
      bankReference: body.bankReference.trim(),
      proofKey: body.proofKey.trim(),
      confirmActualPayment: Boolean(body.confirmActualPayment),
      reviewReason: body.reviewReason?.trim() || null,
    };
    return this.write(async tx => {
      const request = {
        operation: 'CONFIRM_PAYMENT',
        targetId: id,
        actorId,
        requestKey,
        fingerprint: this.requestFingerprint({ operation: 'CONFIRM_PAYMENT', targetId: id, actorId, requestKey, payload: normalized }),
      };
      return this.withRequestIdempotency(tx, request, async () => {
        await this.paymentCompany(tx, id);
        const value = await this.core.confirmPayment(tx, id, {
          ...normalized,
          idempotencyKey: requestKey,
          confirmationReason: normalized.reviewReason ?? undefined,
          paidAt,
          actorId,
          actorType: 'ADMIN',
        });
        return { value, resultType: 'PAYMENT', resultId: value.id };
      }, (resultType, resultId) => {
        if (resultType !== 'PAYMENT') throw new IndustryFundError('IDEMPOTENCY_RESULT_MISSING', '幂等请求结果类型不匹配');
        return this.replayPayment(tx, resultId);
      });
    });
  }

  async cancelPayment(id: string, body: FundPaymentReasonDto, actorId: string) {
    if (!body.reason?.trim()) throw new BadRequestException('请填写登记原因');
    const requestKey = this.normalizeRequestKey(body.idempotencyKey);
    const normalized = { reason: body.reason.trim() };
    return this.write(async tx => {
      const request = {
        operation: 'CANCEL_PAYMENT',
        targetId: id,
        actorId,
        requestKey,
        fingerprint: this.requestFingerprint({ operation: 'CANCEL_PAYMENT', targetId: id, actorId, requestKey, payload: normalized }),
      };
      return this.withRequestIdempotency(tx, request, async () => {
        await this.paymentCompany(tx, id);
        const value = await this.core.cancelPayment(tx, id, { ...normalized, idempotencyKey: requestKey, actorId, actorType: 'ADMIN' });
        return { value, resultType: 'PAYMENT', resultId: value.id };
      }, (resultType, resultId) => {
        if (resultType !== 'PAYMENT') throw new IndustryFundError('IDEMPOTENCY_RESULT_MISSING', '幂等请求结果类型不匹配');
        return this.replayPayment(tx, resultId);
      });
    });
  }

  async reversePayment(id: string, body: FundPaymentReasonDto, actorId: string) {
    if (!body.reason?.trim()) throw new BadRequestException('请填写登记原因');
    const requestKey = this.normalizeRequestKey(body.idempotencyKey);
    const normalized = { reason: body.reason.trim() };
    return this.write(async tx => {
      const request = {
        operation: 'REVERSE_PAYMENT',
        targetId: id,
        actorId,
        requestKey,
        fingerprint: this.requestFingerprint({ operation: 'REVERSE_PAYMENT', targetId: id, actorId, requestKey, payload: normalized }),
      };
      return this.withRequestIdempotency(tx, request, async () => {
        await this.paymentCompany(tx, id);
        const value = await this.core.reversePayment(tx, id, { ...normalized, idempotencyKey: requestKey, actorId, actorType: 'ADMIN' });
        return { value, resultType: 'PAYMENT', resultId: value.id };
      }, (resultType, resultId) => {
        if (resultType !== 'PAYMENT') throw new IndustryFundError('IDEMPOTENCY_RESULT_MISSING', '幂等请求结果类型不匹配');
        return this.replayPayment(tx, resultId);
      });
    });
  }

  async recordRecovery(id: string, body: FundRecoveryDto, actorId: string) {
    if (!body.reason?.trim()) throw new BadRequestException('请填写登记原因');
    const requestKey = this.normalizeRequestKey(body.idempotencyKey);
    const recoveredAt = new Date(body.recoveredAt);
    if (recoveredAt.getTime() > Date.now() + 60000) throw new BadRequestException('实际回款时间不能在未来');
    const normalized = {
      amount: body.amount,
      recoveredAt: recoveredAt.toISOString(),
      bankReference: body.bankReference.trim(),
      proofKey: body.proofKey.trim(),
      reason: body.reason.trim(),
    };
    return this.write(async tx => {
      const request = {
        operation: 'RECOVERY',
        targetId: id,
        actorId,
        requestKey,
        fingerprint: this.requestFingerprint({ operation: 'RECOVERY', targetId: id, actorId, requestKey, payload: normalized }),
      };
      return this.withRequestIdempotency(tx, request, async () => {
        await this.paymentCompany(tx, id);
        const value = await this.core.recordRecovery(tx, id, { ...normalized, idempotencyKey: requestKey, recoveredAt, actorId, actorType: 'ADMIN' });
        return { value, resultType: 'RECOVERY', resultId: value.recoveryId };
      }, (resultType, resultId) => {
        if (resultType !== 'RECOVERY') throw new IndustryFundError('IDEMPOTENCY_RESULT_MISSING', '幂等请求结果类型不匹配');
        return this.replayRecovery(tx, resultId);
      });
    });
  }
}
