import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CompanyStaffRole,
  CompanyStaffStatus,
  CompanyStatus,
  ProductVisualMode,
  ProductVisualRiskProfile,
  VisualAgentBudgetScope,
  VisualCreditQuoteStatus,
  VisualRateCardStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VisualAgentInvocationService } from '../visual-agent/visual-agent-invocation.service';
import { VisualCreditService } from '../visual-agent/visual-credit.service';
import { VisualPaidExecutionService } from '../visual-agent/visual-paid-execution.service';
import { AIMAI_VISUAL_CLIENT_ID, AIMAI_VISUAL_TENANT_ID } from './aimai-product-visual.constants';

const ADAPTER_NAMESPACE = 'aimai-product';
const PROVIDER = 'BAILIAN_WAN';
const MODEL = 'wan2.7-image-pro';
const MODEL_PROFILE = 'BAILIAN_WAN_PRO';
const RESERVE_CENTS = 50;
const CREDIT_COST = 10;
const MAX_ACCESS_MS = 30 * 24 * 60 * 60_000;
const EFFECTIVELY_UNLIMITED_BUDGET_CENTS = 2_000_000_000;

@Injectable()
export class ProductVisualTestAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invocations: VisualAgentInvocationService,
    private readonly credits: VisualCreditService,
    private readonly config: ConfigService,
    private readonly execution: VisualPaidExecutionService,
  ) {}

  isAllMerchantMode() {
    return this.isStagingAccessEnabled()
      && this.config.get('AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED', 'false') === 'true';
  }

  status() {
    const stagingAccessEnabled = this.isStagingAccessEnabled();
    return {
      stagingAccessEnabled,
      allMerchantsEnabled: stagingAccessEnabled && this.isAllMerchantMode(),
      providerReady: this.execution.isModelProfileAvailable(MODEL_PROFILE),
      model: MODEL,
      creditCost: CREDIT_COST,
      merchantConfirmationRequired: true,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseDisabledAutomaticReservations() {
    if (this.isAllMerchantMode()) return 0;
    const reserved = await this.prisma.visualCreditQuote.findMany({
      where: { status: VisualCreditQuoteStatus.RESERVED, visualAgentInvocationId: null },
      select: { id: true, rateCardSnapshot: true },
      take: 500,
    });
    const automatic = reserved.filter((quote) => {
      const code = (quote.rateCardSnapshot as { code?: unknown } | null)?.code;
      return typeof code === 'string' && code.startsWith('STAGING_AUTO_');
    });
    for (const quote of automatic) {
      await this.credits.releaseUnboundReservedQuote(quote.id, 'ALL_TEST_MERCHANT_ACCESS_DISABLED');
    }
    return automatic.length;
  }

  ensureDefaultAccess(input: {
    companyId: string;
    staffId: string;
    productId: string;
    visualMode: ProductVisualMode;
  }) {
    if (!this.isAllMerchantMode()) {
      throw new ConflictException('测试环境尚未默认开放全部测试商家');
    }
    return this.grant({
      ...input,
      dailyCallLimit: 1,
      weeklyCallLimit: 1,
      expiresAt: new Date(Date.now() + MAX_ACCESS_MS),
      grantWelcomeCredits: true,
      unlimited: true,
      automaticAllMerchants: true,
    });
  }

  async grant(input: {
    companyId: string;
    staffId: string;
    productId: string;
    visualMode: ProductVisualMode;
    dailyCallLimit: number;
    weeklyCallLimit: number;
    expiresAt: Date;
    grantWelcomeCredits: boolean;
    unlimited?: boolean;
    automaticAllMerchants?: boolean;
  }) {
    if (!this.isStagingAccessEnabled()) {
      throw new ConflictException('测试商家开通接口只允许在 staging 环境使用');
    }
    const now = new Date();
    if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > MAX_ACCESS_MS) {
      throw new ConflictException('测试授权有效期必须在未来 30 天内');
    }
    if (input.weeklyCallLimit < input.dailyCallLimit) {
      throw new ConflictException('每周调用上限不能小于每日调用上限');
    }
    const [company, staff, product] = await Promise.all([
      this.prisma.company.findFirst({ where: { id: input.companyId, status: CompanyStatus.ACTIVE, deletedAt: null }, select: { id: true } }),
      this.prisma.companyStaff.findFirst({
        where: {
          id: input.staffId,
          companyId: input.companyId,
          status: CompanyStaffStatus.ACTIVE,
          role: { in: [CompanyStaffRole.OWNER, CompanyStaffRole.MANAGER] },
        },
        select: { id: true },
      }),
      this.prisma.product.findFirst({ where: { id: input.productId, companyId: input.companyId }, select: { id: true } }),
    ]);
    if (!company || !staff || !product) {
      throw new NotFoundException('测试商家、操作人员或商品不存在，或不属于同一商家');
    }

    const rateCard = await this.credits.upsertRateCard({
      tenantId: AIMAI_VISUAL_TENANT_ID,
      clientId: AIMAI_VISUAL_CLIENT_ID,
      adapterNamespace: ADAPTER_NAMESPACE,
      code: this.rateCode(input.visualMode, input.automaticAllMerchants === true),
      displayName: input.visualMode === ProductVisualMode.MARKETING_SCENE ? 'Pro 营销场景图（测试）' : 'Pro 商品图片精修（测试）',
      description: input.visualMode === ProductVisualMode.MARKETING_SCENE
        ? '按受控模板重新布置营销展示场景；仅供私密预览，不能替换商品事实主图。'
        : '使用百炼万相专业模型改善光线、构图和背景，同时执行商品事实保护检查。',
      modelProfile: MODEL_PROFILE,
      outputSpec: { providerManaged: true },
      allowedDirections: [input.visualMode],
      allowedRiskProfiles: this.allowedRiskProfiles(input.visualMode),
      candidateRole: input.visualMode === ProductVisualMode.MARKETING_SCENE ? 'MARKETING_IMAGE' : 'FACT_MAIN_IMAGE',
      requiresHumanReview: true,
      candidateCount: 1,
      creditCost: CREDIT_COST,
      status: VisualRateCardStatus.ACTIVE,
      version: 'staging-test-access-v1',
      effectiveFrom: now,
      effectiveUntil: null,
    });

    const keys = this.scopeKeys(input);
    const testRatePolicyVersion = this.ratePolicyVersion(rateCard.code);
    const existingObjectPolicy = (await this.invocations.listBudgetPolicies({ provider: PROVIDER, model: MODEL, take: 500 }))
      .find((policy) => policy.scope === VisualAgentBudgetScope.EXTERNAL_OBJECT
        && policy.scopeKey === keys[VisualAgentBudgetScope.EXTERNAL_OBJECT]
        && policy.visualMode === input.visualMode
        && policy.policyVersion === testRatePolicyVersion
        && policy.enabled);
    const requestedDailyCapCents = input.unlimited ? EFFECTIVELY_UNLIMITED_BUDGET_CENTS : input.dailyCallLimit * RESERVE_CENTS;
    const requestedWeeklyCapCents = input.unlimited ? EFFECTIVELY_UNLIMITED_BUDGET_CENTS : input.weeklyCallLimit * RESERVE_CENTS;
    const objectDailyCapCents = Math.max(existingObjectPolicy?.dailyCapCents ?? 0, requestedDailyCapCents);
    const objectWeeklyCapCents = Math.max(existingObjectPolicy?.weeklyCapCents ?? 0, requestedWeeklyCapCents);
    const objectEffectiveUntil = existingObjectPolicy?.effectiveUntil && existingObjectPolicy.effectiveUntil > input.expiresAt
      ? existingObjectPolicy.effectiveUntil
      : input.expiresAt;
    for (const scope of [
      VisualAgentBudgetScope.PLATFORM,
      VisualAgentBudgetScope.PROVIDER,
      VisualAgentBudgetScope.TENANT,
      VisualAgentBudgetScope.CLIENT,
      VisualAgentBudgetScope.EXTERNAL_OBJECT,
      VisualAgentBudgetScope.ACTOR,
    ]) {
      const objectScope = scope === VisualAgentBudgetScope.EXTERNAL_OBJECT;
      const actorScope = scope === VisualAgentBudgetScope.ACTOR;
      await this.invocations.upsertBudgetPolicy({
        scope,
        scopeKey: keys[scope],
        provider: PROVIDER,
        model: MODEL,
        visualMode: input.visualMode,
        reserveCents: RESERVE_CENTS,
        perTaskCapCents: RESERVE_CENTS,
        dailyCapCents: input.unlimited
          ? EFFECTIVELY_UNLIMITED_BUDGET_CENTS
          : objectScope ? objectDailyCapCents : actorScope ? 500 : 2_000,
        weeklyCapCents: input.unlimited
          ? EFFECTIVELY_UNLIMITED_BUDGET_CENTS
          : objectScope ? objectWeeklyCapCents : actorScope ? 2_500 : 10_000,
        policyVersion: objectScope || actorScope ? testRatePolicyVersion : 'staging-tester-shared-v1',
        enabled: true,
        effectiveFrom: now,
        effectiveUntil: objectScope ? objectEffectiveUntil : null,
      });
    }

    if (input.grantWelcomeCredits) {
      await this.credits.grantWelcomeCredits({
        tenantId: AIMAI_VISUAL_TENANT_ID,
        billingOwnerType: 'COMPANY',
        billingOwnerId: input.companyId,
      });
    }
    const account = await this.credits.getAccount({
      tenantId: AIMAI_VISUAL_TENANT_ID,
      billingOwnerType: 'COMPANY',
      billingOwnerId: input.companyId,
    });
    return {
      companyId: input.companyId,
      staffId: input.staffId,
      productId: input.productId,
      visualMode: input.visualMode,
      provider: PROVIDER,
      model: MODEL,
      reserveCents: RESERVE_CENTS,
      dailyCallLimit: objectDailyCapCents / RESERVE_CENTS,
      weeklyCallLimit: objectWeeklyCapCents / RESERVE_CENTS,
      expiresAt: objectEffectiveUntil,
      rateCard: { code: rateCard.code, creditCost: rateCard.creditCost },
      providerReady: this.execution.isModelProfileAvailable(MODEL_PROFILE),
      unlimited: input.unlimited === true,
      automaticAllMerchants: input.automaticAllMerchants === true,
      account,
    };
  }

  private isStagingAccessEnabled() {
    let apiHostname = '';
    try {
      apiHostname = new URL(this.config.get<string>('PUBLIC_API_BASE_URL', '')).hostname;
    } catch {
      apiHostname = '';
    }
    return this.config.get('AI_VISUAL_AGENT_TEST_ACCESS_ENABLED', 'false') === 'true'
      && apiHostname === 'test-api.ai-maimai.com';
  }

  private rateCode(mode: ProductVisualMode, automaticAllMerchants: boolean) {
    const prefix = automaticAllMerchants ? 'STAGING_AUTO_WAN_PRO' : 'STAGING_WAN_PRO';
    return mode === ProductVisualMode.MARKETING_SCENE
      ? `${prefix}_MARKETING_V1`
      : `${prefix}_${mode}_V1`;
  }

  private ratePolicyVersion(rateCode: string) {
    return `rate-${rateCode}`;
  }

  private allowedRiskProfiles(mode: ProductVisualMode): ProductVisualRiskProfile[] {
    if (mode === ProductVisualMode.MARKETING_SCENE) {
      return [ProductVisualRiskProfile.ORGANIC_FACTS, ProductVisualRiskProfile.STANDARD_FACTS];
    }
    if (mode === ProductVisualMode.PRODUCT_RETOUCH) {
      return [ProductVisualRiskProfile.CONSERVATIVE_FACTS, ProductVisualRiskProfile.STANDARD_FACTS];
    }
    return [
      ProductVisualRiskProfile.STRICT_FACTS,
      ProductVisualRiskProfile.CONSERVATIVE_FACTS,
      ProductVisualRiskProfile.ORGANIC_FACTS,
      ProductVisualRiskProfile.STANDARD_FACTS,
    ];
  }

  private scopeKeys(input: { productId: string; staffId: string }) {
    const part = (value: string) => `${value.length}:${value}`;
    const tenant = `tenant:${part(AIMAI_VISUAL_TENANT_ID)}`;
    const client = `${tenant}:client:${part(AIMAI_VISUAL_CLIENT_ID)}`;
    const adapter = `${client}:adapter:${part(ADAPTER_NAMESPACE)}`;
    return {
      [VisualAgentBudgetScope.PLATFORM]: 'GLOBAL',
      [VisualAgentBudgetScope.PROVIDER]: `provider:${part(PROVIDER)}`,
      [VisualAgentBudgetScope.TENANT]: tenant,
      [VisualAgentBudgetScope.CLIENT]: client,
      [VisualAgentBudgetScope.EXTERNAL_OBJECT]: `${adapter}:object:${part(input.productId)}`,
      [VisualAgentBudgetScope.ACTOR]: `${adapter}:actor:${part(input.staffId)}`,
    };
  }
}
