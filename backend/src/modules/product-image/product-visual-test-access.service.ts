import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CompanyStaffRole,
  CompanyStaffStatus,
  CompanyStatus,
  Prisma,
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
      providerReady: ['BAILIAN_WAN_STANDARD', 'BAILIAN_WAN_PRO', 'BAILIAN_QWEN_IMAGE', 'BAILIAN_QWEN_IMAGE_PRO']
        .some((profile) => this.execution.isModelProfileAvailable(profile)),
      model: MODEL,
      creditCost: CREDIT_COST,
      merchantConfirmationRequired: true,
    };
  }

  /** Test infrastructure, not a per-merchant permission grant or an extra credit charge. */
  async ensureStructureTestBudget(input: { companyId: string; productId: string; staffId: string }) {
    if (!this.isAllMerchantMode()
      || this.config.get('AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED', 'false') !== 'true'
      || this.config.get('AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED', 'false') !== 'true') return;
    const product = await this.prisma.product.findFirst({ where: { id: input.productId, companyId: input.companyId }, select: { id: true } });
    if (!product) throw new NotFoundException('图片任务所属商品不存在');
    const provider = 'BAILIAN_QWEN_STRUCTURE';
    const keys = this.scopeKeys(input, provider);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const scope of Object.values(VisualAgentBudgetScope)) {
            const scopeKey = keys[scope];
            if (!scopeKey) throw new ConflictException('结构检查预算范围不完整');
            const where = { scope, scopeKey, provider, model: 'qwen3-vl-flash', visualMode: 'STRUCTURE_VERIFY' };
            const lock = `VISUAL_AGENT_BUDGET_POLICY:${scope}:${scopeKey}:${provider}:${where.model}:${where.visualMode}`;
            await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lock}))`);
            // An administrator's paused/expired policy is authoritative as well.
            if (await tx.visualAgentBudgetPolicy.findFirst({ where, select: { id: true } })) continue;
            await tx.visualAgentBudgetPolicy.create({ data: { ...where, policyVersion: 'staging-structure-v1',
              reserveCents: 1, perTaskCapCents: 1, dailyCapCents: EFFECTIVELY_UNLIMITED_BUDGET_CENTS,
              weeklyCapCents: EFFECTIVELY_UNLIMITED_BUDGET_CENTS, enabled: true, effectiveFrom: new Date(), effectiveUntil: null } });
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt >= 4) throw new ServiceUnavailableException('结构检查配置暂时繁忙，请稍后重试');
      }
    }
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

    const automaticRateCode = this.rateCode(input.visualMode, input.automaticAllMerchants === true);
    const expectedDisplayName = input.visualMode === ProductVisualMode.MARKETING_SCENE
      ? 'Pro 营销场景图（测试）'
      : 'Pro 商品图片精修（测试）';
    const expectedDescription = input.visualMode === ProductVisualMode.MARKETING_SCENE
      ? '按受控模板重新布置营销展示场景；仅供私密预览，不能替换商品事实主图。'
      : '使用百炼万相专业模型改善光线、构图和背景，同时执行商品事实保护检查。';
    const expectedRiskProfiles = this.allowedRiskProfiles(input.visualMode);
    const expectedCandidateRole = input.visualMode === ProductVisualMode.MARKETING_SCENE
      ? 'MARKETING_IMAGE'
      : 'FACT_MAIN_IMAGE';
    if (input.automaticAllMerchants && input.unlimited) {
      const [existingCards, existingAccount] = await Promise.all([
        this.credits.listRateCards({
          tenantId: AIMAI_VISUAL_TENANT_ID,
          clientId: AIMAI_VISUAL_CLIENT_ID,
          adapterNamespace: ADAPTER_NAMESPACE,
        }),
        this.credits.getAccount({
          tenantId: AIMAI_VISUAL_TENANT_ID,
          billingOwnerType: 'COMPANY',
          billingOwnerId: input.companyId,
        }),
      ]);
      const matchingCards = existingCards.filter((card) => card.code === automaticRateCode);
      const existingRateCard = matchingCards.find((card) => card.status === VisualRateCardStatus.ACTIVE
        && card.effectiveFrom <= now && (!card.effectiveUntil || card.effectiveUntil > now))
        ?? matchingCards[0];
      const route = this.routeForProfile(existingRateCard?.modelProfile ?? MODEL_PROFILE);
      if (existingRateCard && existingAccount.exists && await this.invocations.hasActiveBudgetCoverage({
        tenantId: AIMAI_VISUAL_TENANT_ID,
        ownerClientId: AIMAI_VISUAL_CLIENT_ID,
        adapterNamespace: ADAPTER_NAMESPACE,
        externalObjectId: input.productId,
        actorId: input.staffId,
        provider: route.provider,
        model: route.model,
        visualMode: input.visualMode,
        expectedPolicyVersions: {
          EXTERNAL_OBJECT: this.ratePolicyVersion(automaticRateCode),
          ACTOR: this.ratePolicyVersion(automaticRateCode),
        },
      })) {
        return {
          companyId: input.companyId,
          staffId: input.staffId,
          productId: input.productId,
          visualMode: input.visualMode,
          provider: route.provider,
          model: route.model,
          reserveCents: RESERVE_CENTS,
          dailyCallLimit: EFFECTIVELY_UNLIMITED_BUDGET_CENTS / RESERVE_CENTS,
          weeklyCallLimit: EFFECTIVELY_UNLIMITED_BUDGET_CENTS / RESERVE_CENTS,
          expiresAt: null,
          rateCard: { code: existingRateCard.code, creditCost: existingRateCard.creditCost },
          providerReady: this.execution.isModelProfileAvailable(existingRateCard.modelProfile),
          unlimited: true,
          automaticAllMerchants: true,
          account: existingAccount,
        };
      }
    }

    const rateCard = await this.ensureInitialRateCard({
      tenantId: AIMAI_VISUAL_TENANT_ID,
      clientId: AIMAI_VISUAL_CLIENT_ID,
      adapterNamespace: ADAPTER_NAMESPACE,
      code: automaticRateCode,
      displayName: expectedDisplayName,
      description: expectedDescription,
      modelProfile: MODEL_PROFILE,
      outputSpec: { providerManaged: true },
      allowedDirections: [input.visualMode],
      allowedRiskProfiles: expectedRiskProfiles,
      candidateRole: expectedCandidateRole,
      requiresHumanReview: true,
      candidateCount: 1,
      creditCost: CREDIT_COST,
      status: VisualRateCardStatus.ACTIVE,
      version: 'staging-test-access-v1',
      effectiveFrom: now,
      effectiveUntil: null,
    });

    const route = this.routeForProfile(rateCard.modelProfile);
    const keys = this.scopeKeys(input, route.provider);
    const testRatePolicyVersion = this.ratePolicyVersion(rateCard.code);
    const existingObjectPolicy = (await this.invocations.listBudgetPolicies({ provider: route.provider, model: route.model, take: 500 }))
      .find((policy) => policy.scope === VisualAgentBudgetScope.EXTERNAL_OBJECT
        && policy.scopeKey === keys[VisualAgentBudgetScope.EXTERNAL_OBJECT]
        && policy.visualMode === input.visualMode
        && policy.policyVersion === testRatePolicyVersion
        && policy.enabled);
    const requestedDailyCapCents = input.unlimited ? EFFECTIVELY_UNLIMITED_BUDGET_CENTS : input.dailyCallLimit * RESERVE_CENTS;
    const requestedWeeklyCapCents = input.unlimited ? EFFECTIVELY_UNLIMITED_BUDGET_CENTS : input.weeklyCallLimit * RESERVE_CENTS;
    const objectDailyCapCents = Math.max(existingObjectPolicy?.dailyCapCents ?? 0, requestedDailyCapCents);
    const objectWeeklyCapCents = Math.max(existingObjectPolicy?.weeklyCapCents ?? 0, requestedWeeklyCapCents);
    const objectEffectiveUntil = input.automaticAllMerchants
      ? null
      : existingObjectPolicy?.effectiveUntil && existingObjectPolicy.effectiveUntil > input.expiresAt
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
        provider: route.provider,
        model: route.model,
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
      const policy = await this.credits.getWelcomePolicy(AIMAI_VISUAL_TENANT_ID);
      if (policy?.enabled && policy.effectiveFrom <= now
        && (!policy.effectiveUntil || policy.effectiveUntil > now)) {
        try {
          await this.credits.grantWelcomeCredits({
            tenantId: AIMAI_VISUAL_TENANT_ID,
            billingOwnerType: 'COMPANY',
            billingOwnerId: input.companyId,
          });
        } catch (error) {
          // 活动可能在读策略后被暂停；仅忽略该明确业务状态，数据库错误继续暴露。
          if (!(error instanceof ServiceUnavailableException)
            || error.message !== '当前没有可用的新商家图片积分赠送策略') throw error;
        }
      }
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
      provider: route.provider,
      model: route.model,
      reserveCents: RESERVE_CENTS,
      dailyCallLimit: objectDailyCapCents / RESERVE_CENTS,
      weeklyCallLimit: objectWeeklyCapCents / RESERVE_CENTS,
      expiresAt: objectEffectiveUntil,
      rateCard: { code: rateCard.code, creditCost: rateCard.creditCost },
      providerReady: this.execution.isModelProfileAvailable(rateCard.modelProfile),
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

  private async ensureInitialRateCard(input: Parameters<VisualCreditService['upsertRateCard']>[0]) {
    // 与管理员编辑使用相同锁；商家请求只能创建缺失项，不能恢复已暂停版本。
    return this.prisma.$transaction(async (tx) => {
      const key = `VISUAL_RATE_CARD:${input.tenantId}:${input.clientId}:${input.adapterNamespace}:${input.code}`;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      const cards = await tx.visualRateCard.findMany({
        where: { tenantId: input.tenantId, clientId: input.clientId, adapterNamespace: input.adapterNamespace, code: input.code },
        orderBy: { effectiveFrom: 'desc' },
      });
      const now = new Date();
      const existing = cards.find((card) => card.status === VisualRateCardStatus.ACTIVE
        && card.effectiveFrom <= now && (!card.effectiveUntil || card.effectiveUntil > now)) ?? cards[0];
      if (existing) return existing;
      return tx.visualRateCard.create({ data: { ...input, effectiveUntil: input.effectiveUntil ?? null } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private routeForProfile(profile: string) {
    switch (profile) {
      case 'BAILIAN_WAN_STANDARD': return { provider: 'BAILIAN_WAN', model: 'wan2.7-image' };
      case 'BAILIAN_WAN_PRO': return { provider: 'BAILIAN_WAN', model: 'wan2.7-image-pro' };
      case 'BAILIAN_QWEN_IMAGE': return { provider: 'BAILIAN_QWEN_IMAGE', model: 'qwen-image-3.0' };
      case 'BAILIAN_QWEN_IMAGE_PRO': return { provider: 'BAILIAN_QWEN_IMAGE', model: 'qwen-image-3.0-pro' };
      default: throw new ConflictException('该图片方案尚未配置可用模型，请联系平台管理员');
    }
  }

  private scopeKeys(input: { productId: string; staffId: string }, provider: string) {
    const part = (value: string) => `${value.length}:${value}`;
    const tenant = `tenant:${part(AIMAI_VISUAL_TENANT_ID)}`;
    const client = `${tenant}:client:${part(AIMAI_VISUAL_CLIENT_ID)}`;
    const adapter = `${client}:adapter:${part(ADAPTER_NAMESPACE)}`;
    return {
      [VisualAgentBudgetScope.PLATFORM]: 'GLOBAL',
      [VisualAgentBudgetScope.PROVIDER]: `provider:${part(provider)}`,
      [VisualAgentBudgetScope.TENANT]: tenant,
      [VisualAgentBudgetScope.CLIENT]: client,
      [VisualAgentBudgetScope.EXTERNAL_OBJECT]: `${adapter}:object:${part(input.productId)}`,
      [VisualAgentBudgetScope.ACTOR]: `${adapter}:actor:${part(input.staffId)}`,
    };
  }
}
