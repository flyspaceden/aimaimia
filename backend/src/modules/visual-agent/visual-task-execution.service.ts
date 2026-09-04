import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, VisualCreditQuote } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export type VisualTaskAdvanceResult = { done: boolean; retryAfterMs?: number };
export type VisualTaskHandler = {
  accepts: (quote: VisualCreditQuote) => boolean | Promise<boolean>;
  advance: (quote: VisualCreditQuote) => Promise<VisualTaskAdvanceResult>;
};
type Claim = { id: string; quoteId: string; leaseToken: string; leaseGeneration: number; attemptCount: number };

@Injectable()
export class VisualTaskExecutionService {
  private readonly logger = new Logger(VisualTaskExecutionService.name);
  private readonly handlers = new Map<string, VisualTaskHandler>();
  private ticking = false;
  constructor(private readonly prisma: PrismaService) {}

  registerHandler(name: string, handler: VisualTaskHandler) {
    if (this.handlers.has(name)) throw new Error(`Duplicate visual task handler: ${name}`);
    this.handlers.set(name, handler);
  }

  async discoverLegacy() {
    const quotes = await this.prisma.visualCreditQuote.findMany({
      where: { confirmedAt: { not: null }, status: { in: ['RESERVED', 'RECONCILING', 'SETTLED'] }, taskExecution: null },
      select: { id: true }, orderBy: { createdAt: 'asc' }, take: 100,
    });
    for (const quote of quotes) {
      await this.prisma.visualTaskExecution.upsert({ where: { quoteId: quote.id }, create: { quoteId: quote.id }, update: {} });
    }
  }

  async claim(): Promise<Claim | null> {
    const token = randomUUID();
    // Atomic short statement; never hold a DB transaction during provider I/O.
    const rows = await this.prisma.$queryRaw<Claim[]>(Prisma.sql`
      UPDATE "VisualTaskExecution" SET
        "leaseToken" = ${token}, "leaseGeneration" = "leaseGeneration" + 1,
        "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '120 seconds',
        "attemptCount" = "attemptCount" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = (
        SELECT "id" FROM "VisualTaskExecution"
        WHERE "state" = 'PENDING' AND "nextAttemptAt" <= CURRENT_TIMESTAMP
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= CURRENT_TIMESTAMP)
        ORDER BY "nextAttemptAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING "id", "quoteId", "leaseToken", "leaseGeneration", "attemptCount"
    `);
    return rows[0] ?? null;
  }

  async heartbeat(claim: Claim) {
    const result = await this.prisma.visualTaskExecution.updateMany({
      where: { id: claim.id, state: 'PENDING', leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration, leaseExpiresAt: { gt: new Date() } },
      data: { leaseExpiresAt: new Date(Date.now() + 120_000) },
    });
    return result.count === 1;
  }

  async finish(claim: Claim, outcome: VisualTaskAdvanceResult, errorCode: string | null = null) {
    return this.prisma.visualTaskExecution.updateMany({
      where: { id: claim.id, state: 'PENDING', leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration, leaseExpiresAt: { gt: new Date() } },
      data: {
        state: outcome.done ? 'DONE' : 'PENDING',
        nextAttemptAt: new Date(Date.now() + Math.max(5_000, Math.min(outcome.retryAfterMs ?? 10_000, 300_000))),
        leaseToken: null, leaseExpiresAt: null, lastErrorCode: errorCode,
      },
    });
  }

  async runClaim(claim: Claim) {
    let leaseLost = false;
    const timer = setInterval(() => {
      void this.heartbeat(claim).then((held) => { if (!held) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, 30_000);
    timer.unref();
    try {
      const quote = await this.prisma.visualCreditQuote.findUnique({ where: { id: claim.quoteId } });
      if (!quote) throw new Error('VISUAL_TASK_QUOTE_MISSING');
      if (['RELEASED', 'EXPIRED', 'CANCELLED'].includes(quote.status)) {
        await this.finish(claim, { done: true });
        return;
      }
      const handlers: VisualTaskHandler[] = [];
      for (const handler of this.handlers.values()) if (await handler.accepts(quote)) handlers.push(handler);
      if (handlers.length !== 1) {
        await this.finish(claim, { done: false, retryAfterMs: 60_000 }, 'TASK_HANDLER_UNAVAILABLE');
        return;
      }
      if (leaseLost || !await this.heartbeat(claim)) return;
      const outcome = await handlers[0].advance(quote);
      if (!leaseLost) await this.finish(claim, outcome);
    } catch {
      if (!leaseLost) await this.finish(claim, { done: false, retryAfterMs: Math.min(300_000, 10_000 * 2 ** Math.min(claim.attemptCount, 5)) }, 'TASK_ADVANCE_RETRY');
      this.logger.warn(`Visual task ${claim.id} scheduled for recovery`);
    } finally {
      clearInterval(timer);
    }
  }

  @Cron('*/10 * * * * *')
  async tick() {
    if (this.ticking || this.handlers.size === 0) return;
    this.ticking = true;
    try {
      await this.discoverLegacy();
      const claims: Claim[] = [];
      for (let i = 0; i < 2; i++) { const claim = await this.claim(); if (claim) claims.push(claim); }
      await Promise.allSettled(claims.map((claim) => this.runClaim(claim)));
    } catch {
      this.logger.warn('Visual task discovery temporarily unavailable');
    } finally {
      this.ticking = false;
    }
  }
}
