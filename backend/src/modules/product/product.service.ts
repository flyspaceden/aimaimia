import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TtlCache } from '../../common/ttl-cache';
import type { AiRecommendTheme } from '../ai/voice-intent.types';
import { computeSemanticScore, determineDegradeLevel, type SemanticSlots, type ProductSemanticFields } from './semantic-score';

type ProductCategory = {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  path: string;
};

type SearchEntityResolution = {
  normalizedKeyword: string;
  matchedCategoryId?: string;
  matchedCategoryName?: string;
  matchedCategoryIds: string[];
  source: 'direct' | 'model' | 'none';
  confidence?: number;
};

type ListableProduct = {
  id: string;
  title: string;
  subtitle?: string | null;
  aiKeywords?: string[];
  categoryId?: string | null;
  createdAt: Date;
  origin?: unknown;
  basePrice?: number;
  media?: Array<{ url: string }>;
  tags?: Array<{ tag?: { name?: string | null } }>;
  skus?: Array<{ id: string; price: number; stock?: number | null }>;
  category?: { id: string; name: string } | null;
  companyId?: string;
  // 语义搜索字段（Task 7 新增）
  flavorTags?: string[];
  seasonalMonths?: number[];
  usageScenarios?: string[];
  dietaryTags?: string[];
  originRegion?: string | null;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private readonly categoriesCache = new TtlCache<ProductCategory[]>(5 * 60_000); // 5 分钟
  private readonly searchEntityCache = new TtlCache<SearchEntityResolution>(10 * 60_000);
  private readonly productKeywordSignalCache = new TtlCache<boolean>(10 * 60_000);
  private readonly QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  private readonly QWEN_SEARCH_ENTITY_MODEL =
    process.env.AI_SEARCH_ENTITY_MODEL || process.env.AI_SEARCH_REWRITE_MODEL || 'qwen-flash';
  private readonly RECOMMEND_THEMES: AiRecommendTheme[] = ['hot', 'discount', 'tasty', 'seasonal', 'recent'];

  constructor(private prisma: PrismaService) {}

  /** 商品分页列表 */
  async list(
    page = 1,
    pageSize = 8,
    categoryId?: string,
    keyword?: string,
    preferRecommended = false,
    constraints: string[] = [],
    maxPrice?: number,
    recommendThemes: AiRecommendTheme[] = [],
    slots?: SemanticSlots,
  ) {
    const skip = (page - 1) * pageSize;
    const categories = categoryId || keyword ? await this.getCategories() : [];
    const categoryScopeIds = categoryId ? this.collectCategoryScopeIds(categories, categoryId) : [];
    const searchEntity = keyword ? await this.resolveSearchEntity(keyword, categories) : null;
    const normalizedKeyword = searchEntity?.normalizedKeyword || this.normalizeSearchKeyword(keyword || '');
    const normalizedConstraints = constraints.map((constraint) => constraint.trim()).filter(Boolean);
    const normalizedRecommendThemes = Array.from(new Set(
      recommendThemes.filter((theme): theme is AiRecommendTheme => this.RECOMMEND_THEMES.includes(theme)),
    ));
    const normalizedMaxPrice = typeof maxPrice === 'number' && Number.isFinite(maxPrice) && maxPrice > 0
      ? maxPrice
      : undefined;

    const where: any = {
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      company: { isPlatform: false }, // F4: 用户端搜索排除平台公司奖励商品（奖品商品只在抽奖/购物车中可见）
    };

    if (categoryScopeIds.length > 0) {
      where.categoryId = { in: categoryScopeIds };
    } else if (categoryId) {
      where.categoryId = categoryId;
    }

    if (normalizedKeyword) {
      const searchClauses: any[] = [
        { title: { contains: normalizedKeyword, mode: 'insensitive' } },
        { subtitle: { contains: normalizedKeyword, mode: 'insensitive' } },
        { aiKeywords: { has: normalizedKeyword } },
        { category: { name: { contains: normalizedKeyword, mode: 'insensitive' } } },
        { category: { path: { contains: normalizedKeyword, mode: 'insensitive' } } },
        { tags: { some: { tag: { name: { contains: normalizedKeyword, mode: 'insensitive' } } } } },
        { tags: { some: { tag: { synonyms: { has: normalizedKeyword } } } } },
      ];

      if (searchEntity?.matchedCategoryIds.length) {
        searchClauses.push({ categoryId: { in: searchEntity.matchedCategoryIds } });
      }

      where.OR = searchClauses;

      this.logger.log(
        `[ProductSearch] keyword="${keyword}" normalized="${normalizedKeyword}" ` +
        `matchedCategory="${searchEntity?.matchedCategoryName || ''}" ` +
        `source=${searchEntity?.source ?? 'none'} matchedIds=${searchEntity?.matchedCategoryIds.length ?? 0} ` +
        `preferRecommended=${preferRecommended} constraints=${normalizedConstraints.join('|') || '-'} ` +
        `maxPrice=${normalizedMaxPrice ?? '-'} recommendThemes=${normalizedRecommendThemes.join('|') || '-'}`,
      );
    } else if (preferRecommended || normalizedConstraints.length > 0 || normalizedMaxPrice !== undefined || normalizedRecommendThemes.length > 0) {
      this.logger.log(
        `[ProductSearch] discovery-search categoryId="${categoryId || ''}" ` +
        `preferRecommended=${preferRecommended} constraints=${normalizedConstraints.join('|') || '-'} ` +
        `maxPrice=${normalizedMaxPrice ?? '-'} recommendThemes=${normalizedRecommendThemes.join('|') || '-'}`,
      );
    }

    const shouldRankSearchResults =
      !!normalizedKeyword
      || preferRecommended
      || normalizedConstraints.length > 0
      || normalizedMaxPrice !== undefined
      || normalizedRecommendThemes.length > 0;
    const include = {
      media: { where: { type: 'IMAGE' as const }, orderBy: { sortOrder: 'asc' as const }, take: 1 },
      tags: { include: { tag: true } },
      skus: { where: { status: 'ACTIVE' as const }, take: 1 },
      category: { select: { id: true, name: true } },
    };

    let items: ListableProduct[] = [];
    let total = 0;

    if (shouldRankSearchResults) {
      const matchedItems = await this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include,
      });

      const budgetMatchedItems = normalizedMaxPrice !== undefined
        ? matchedItems.filter((product) => this.getDisplayPrice(product as ListableProduct) <= normalizedMaxPrice)
        : matchedItems;

      const rankedItems = budgetMatchedItems
        .map((product) => ({
            product,
            score: this.computeSearchScore(
              product as ListableProduct,
              normalizedKeyword,
              searchEntity,
              preferRecommended,
              normalizedConstraints,
              categories,
              normalizedRecommendThemes,
              slots,
            ),
          }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.product.createdAt.getTime() - a.product.createdAt.getTime();
        });

      total = rankedItems.length;
      items = rankedItems.slice(skip, skip + pageSize).map((entry) => entry.product);

      // 语义评分降级日志（仅在开关开启且有槽位时输出）
      const scoringEnabled = (process.env.AI_SEMANTIC_SCORING_ENABLED ?? '') === 'true';
      if (scoringEnabled && slots) {
        // 取第一条结果计算 matchedDimensions 用于降级判断（代表性样本）
        const firstProduct = items[0];
        if (firstProduct) {
          const semanticFields: ProductSemanticFields = {
            categoryName: firstProduct.category?.name,
            categoryPath: categories.find((c) => c.id === firstProduct.categoryId)?.path,
            usageScenarios: firstProduct.usageScenarios || [],
            originRegion: firstProduct.originRegion,
            dietaryTags: firstProduct.dietaryTags || [],
            flavorTags: firstProduct.flavorTags || [],
            seasonalMonths: firstProduct.seasonalMonths || [],
          };
          const { matchedDimensions } = computeSemanticScore(slots as SemanticSlots, semanticFields);
          const degradeLevel = determineDegradeLevel(slots as SemanticSlots, matchedDimensions);
          this.logger.log(JSON.stringify({
            message: 'search-scored',
            degradeLevel,
            resultCount: rankedItems.length,
            matchedDimensions,
          }));
        }
      }
    } else {
      const result = await Promise.all([
        this.prisma.product.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
          include,
        }),
        this.prisma.product.count({ where }),
      ]);
      items = result[0] as ListableProduct[];
      total = result[1];
    }

    const nextPage = skip + pageSize < total ? page + 1 : undefined;

    return {
      items: items.map((p) => this.mapToListItem(p)),
      total,
      page,
      pageSize,
      nextPage,
    };
  }

  /** 为“加购物车”语音动作挑选唯一且可信的商品候选；不确定时返回空，交给前端人工确认 */
  async resolveAddToCartCandidate(
    keyword: string,
    categoryId?: string,
  ): Promise<{ productId?: string; productName?: string }> {
    const normalizedKeyword = this.normalizeSearchKeyword(keyword).replace(/\s+/g, '');
    if (!normalizedKeyword) {
      return {};
    }

    const result = await this.list(1, 5, categoryId, keyword, false, [], undefined, []);
    const items = result.items;
    if (items.length === 0) {
      return {};
    }

    const exactMatches = items.filter((item) => (
      this.normalizeSearchKeyword(item.title).replace(/\s+/g, '') === normalizedKeyword
    ));
    if (exactMatches.length === 1) {
      return {
        productId: exactMatches[0].id,
        productName: exactMatches[0].title,
      };
    }

    if (items.length === 1) {
      return {
        productId: items[0].id,
        productName: items[0].title,
      };
    }

    return {};
  }

  private getDisplayPrice(product: ListableProduct): number {
    return product.skus?.[0]?.price ?? product.basePrice ?? 0;
  }

  /** 商品详情（完整 SKU + 媒体 + 分类） */
  async getById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        tags: { include: { tag: true } },
        skus: { where: { status: 'ACTIVE' }, orderBy: { price: 'asc' } },
        category: true,
        company: { select: { id: true, name: true, isPlatform: true } },
      },
    });
    if (!product) throw new NotFoundException('商品已下架');
    if (product.company?.isPlatform) {
      throw new NotFoundException('商品已下架');
    }
    if ((product as any).auditStatus !== 'APPROVED') {
      throw new NotFoundException('商品已下架');
    }

    return this.mapToDetail(product);
  }

  /** 分类树（5 分钟内存缓存） */
  async getCategories() {
    const cached = this.categoriesCache.get('categories:all');
    if (cached) return cached;

    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });

    const result = categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId ?? null,
      level: c.level,
      path: c.path,
    }));

    this.categoriesCache.set('categories:all', result);
    return result;
  }

  /** 分类缓存失效（供管理端修改分类后调用） */
  invalidateCategoriesCache() {
    this.categoriesCache.invalidate('categories:all');
    this.searchEntityCache.clear();
    this.productKeywordSignalCache.clear();
  }

  /** 搜索关键词规范化，尽量降低口语和标点噪声的影响 */
  private normalizeSearchKeyword(value: string): string {
    return value
      .toLowerCase()
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 父分类命中时，递归召回全部子分类商品 */
  private collectCategoryScopeIds(categories: ProductCategory[], categoryId: string): string[] {
    const root = categories.find((category) => category.id === categoryId);
    if (!root) return [categoryId];

    const prefix = root.path.endsWith('/') ? root.path : `${root.path}/`;
    return categories
      .filter((category) => category.id === root.id || category.path.startsWith(prefix))
      .map((category) => category.id);
  }

  /** 直接基于当前分类树做字面匹配，能命中时无需调用模型 */
  private matchCategoryByKeywordDirect(keyword: string, categories: ProductCategory[]): ProductCategory | null {
    const compactKeyword = this.normalizeSearchKeyword(keyword).replace(/\s+/g, '');
    if (!compactKeyword || compactKeyword.length < 2) return null;

    let bestCategory: ProductCategory | null = null;
    let bestScore = 0;

    categories.forEach((category) => {
      const normalizedName = this.normalizeSearchKeyword(category.name).replace(/\s+/g, '');
      const normalizedPath = this.normalizeSearchKeyword(category.path.replace(/\//g, ' ')).replace(/\s+/g, '');

      let score = 0;
      if (normalizedName === compactKeyword) score += 120;
      if (normalizedPath.includes(compactKeyword)) score += 80;
      if (compactKeyword.includes(normalizedName) && normalizedName.length >= 2) score += 60 + normalizedName.length;
      if (normalizedName.includes(compactKeyword) && compactKeyword.length >= 2) score += 30 + compactKeyword.length;

      if (score > bestScore) {
        bestCategory = category;
        bestScore = score;
      }
    });

    if (!bestCategory || bestScore < 60) {
      return null;
    }

    return bestCategory;
  }

  /** 搜索实体解析：在实时分类树内解析用户 query，对接结构化搜索 */
  async resolveSearchEntity(
    keyword: string,
    categories?: ProductCategory[],
  ): Promise<SearchEntityResolution> {
    const activeCategories = categories ?? await this.getCategories();
    const normalizedKeyword = this.normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return {
        normalizedKeyword: '',
        matchedCategoryIds: [],
        source: 'none',
      };
    }

    const cacheKey = `entity:${normalizedKeyword}`;
    const cached = this.searchEntityCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const directCategory = this.matchCategoryByKeywordDirect(normalizedKeyword, activeCategories);
    if (directCategory) {
      const directResolution = {
        normalizedKeyword,
        matchedCategoryId: directCategory.id,
        matchedCategoryName: directCategory.name,
        matchedCategoryIds: this.collectCategoryScopeIds(activeCategories, directCategory.id),
        source: 'direct' as const,
        confidence: 1,
      };
      this.searchEntityCache.set(cacheKey, directResolution);
      return directResolution;
    }

    if (await this.shouldShortCircuitEntityModel(normalizedKeyword)) {
      const fastResolution = {
        normalizedKeyword,
        matchedCategoryIds: [],
        source: 'none' as const,
        confidence: 0.95,
      };
      this.searchEntityCache.set(cacheKey, fastResolution);
      this.logger.log(`[ProductSearch] fast-path query="${keyword}" normalized="${normalizedKeyword}" reason=direct-product-signal`);
      return fastResolution;
    }

    const modelResolution = await this.resolveCategoryWithModel(normalizedKeyword, activeCategories);
    if (modelResolution) {
      this.searchEntityCache.set(cacheKey, modelResolution);
      return modelResolution;
    }

    const fallbackResolution = {
      normalizedKeyword,
      matchedCategoryIds: [],
      source: 'none' as const,
    };
    this.searchEntityCache.set(cacheKey, fallbackResolution);
    return fallbackResolution;
  }

  private async shouldShortCircuitEntityModel(normalizedKeyword: string): Promise<boolean> {
    if (!this.shouldPreferDirectProductSignal(normalizedKeyword)) {
      return false;
    }

    const cacheKey = `product-signal:${normalizedKeyword}`;
    const cached = this.productKeywordSignalCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const matched = await this.prisma.product.findFirst({
      where: {
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { isPlatform: false },
        OR: [
          { title: { contains: normalizedKeyword, mode: 'insensitive' } },
          { subtitle: { contains: normalizedKeyword, mode: 'insensitive' } },
          { aiKeywords: { has: normalizedKeyword } },
          { tags: { some: { tag: { name: { contains: normalizedKeyword, mode: 'insensitive' } } } } },
          { tags: { some: { tag: { synonyms: { has: normalizedKeyword } } } } },
        ],
      },
      select: { id: true },
    });

    const hasSignal = !!matched;
    this.productKeywordSignalCache.set(cacheKey, hasSignal);
    return hasSignal;
  }

  /** 供语音一级分类快速判断：当前关键词是否足够明确，可以直接按商品搜索处理 */
  async canFastClassifySearchKeyword(keyword: string): Promise<boolean> {
    const normalizedKeyword = this.normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return false;
    }

    const categories = await this.getCategories();
    if (this.matchCategoryByKeywordDirect(normalizedKeyword, categories)) {
      return true;
    }

    return this.shouldShortCircuitEntityModel(normalizedKeyword);
  }

  private shouldPreferDirectProductSignal(normalizedKeyword: string): boolean {
    const compactKeyword = normalizedKeyword.replace(/\s+/g, '');
    if (!compactKeyword || compactKeyword.length < 2 || compactKeyword.length > 8) {
      return false;
    }

    if (/[0-9]/.test(compactKeyword)) {
      return true;
    }

    if (/(商品|产品|东西|食物|美食|食材|生鲜|推荐|爆款|折扣|当季|最近|全部|好物|看看|有没有|哪里|什么)/u.test(compactKeyword)) {
      return false;
    }

    return true;
  }

  /** 使用 Qwen-Flash 在“当前有效分类集合”里做受约束语义映射 */
  private async resolveCategoryWithModel(
    keyword: string,
    categories: ProductCategory[],
  ): Promise<SearchEntityResolution | null> {
    if (!keyword || categories.length === 0 || keyword.length > 24) {
      return null;
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return null;
    }

    const categoryCandidates = categories.map((category) => ({
      id: category.id,
      name: category.name,
      path: category.path,
      level: category.level,
    }));

    const systemPrompt = `你是农脉App的商品搜索实体解析器。你的任务是把用户搜索词映射到“当前系统真实存在的分类候选集合”。

严格要求：
1. 只能从候选集合中选择 matchedCategoryId，不允许编造不存在的分类
2. 如果用户想搜的是具体商品而不是分类，matchedCategoryId 返回空字符串
3. normalizedQuery 只保留最适合检索商品的核心词
4. 严格只返回 JSON，不要输出解释

返回格式：
{"normalizedQuery":"核心搜索词","matchedCategoryId":"","matchedCategoryName":"","confidence":0.0}

示例：
- 用户说“有没有鲜果”，若候选里有“水果”，返回 {"normalizedQuery":"水果","matchedCategoryId":"cat-fruit","matchedCategoryName":"水果","confidence":0.92}
- 用户说“有没有海产”，若候选里有“海鲜”，返回 {"normalizedQuery":"海鲜","matchedCategoryId":"cat-seafood","matchedCategoryName":"海鲜","confidence":0.9}
- 用户说“蓝莓”，如果这是具体商品而不是分类，返回 {"normalizedQuery":"蓝莓","matchedCategoryId":"","matchedCategoryName":"","confidence":0.7}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.QWEN_SEARCH_ENTITY_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `query=${keyword}\ncategory_candidates=${JSON.stringify(categoryCandidates)}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 180,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`搜索实体解析模型失败：${response.status} ${errText}`);
        return null;
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      const jsonStr = content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr) as {
        normalizedQuery?: string;
        matchedCategoryId?: string;
        matchedCategoryName?: string;
        confidence?: number;
      };

      const normalizedQuery = this.normalizeSearchKeyword(parsed.normalizedQuery || keyword) || keyword;
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(parsed.confidence, 1))
        : 0.5;

      let matchedCategory =
        categories.find((category) => category.id === parsed.matchedCategoryId) ||
        categories.find((category) => category.name === parsed.matchedCategoryName);

      if (!matchedCategory && confidence < 0.7) {
        return {
          normalizedKeyword: normalizedQuery,
          matchedCategoryIds: [],
          source: 'none',
          confidence,
        };
      }

      if (!matchedCategory) {
        return {
          normalizedKeyword: normalizedQuery,
          matchedCategoryIds: [],
          source: 'none',
          confidence,
        };
      }

      const resolution = {
        normalizedKeyword: normalizedQuery,
        matchedCategoryId: matchedCategory.id,
        matchedCategoryName: matchedCategory.name,
        matchedCategoryIds: this.collectCategoryScopeIds(categories, matchedCategory.id),
        source: 'model' as const,
        confidence,
      };

      this.logger.log(
        `[ProductSearch] model-resolve query="${keyword}" normalized="${resolution.normalizedKeyword}" ` +
        `matchedCategory="${resolution.matchedCategoryName}" confidence=${confidence.toFixed(2)}`,
      );

      return resolution;
    } catch (err) {
      this.logger.error(`搜索实体解析异常：${err.message}`);
      return null;
    }
  }

  /** 结构化搜索排序：关键词命中、分类命中、推荐偏好和约束信号共同决定结果顺序 */
  private computeSearchScore(
    product: ListableProduct,
    normalizedKeyword: string,
    searchEntity: SearchEntityResolution | null,
    preferRecommended: boolean,
    constraints: string[],
    categories: ProductCategory[],
    recommendThemes: AiRecommendTheme[],
    slots?: SemanticSlots,
  ): number {
    const title = this.normalizeSearchKeyword(product.title || '');
    const subtitle = this.normalizeSearchKeyword(product.subtitle || '');
    const categoryName = this.normalizeSearchKeyword(product.category?.name || '');
    const categoryPath = this.normalizeSearchKeyword(
      categories.find((category) => category.id === product.categoryId)?.path.replace(/\//g, ' ') || '',
    );
    const aiKeywords = (product.aiKeywords || []).map((keyword) => this.normalizeSearchKeyword(keyword));
    const tagNames = (product.tags || [])
      .map((tagLink) => this.normalizeSearchKeyword(tagLink.tag?.name || ''))
      .filter(Boolean);
    const origin = this.normalizeSearchKeyword((product.origin as any)?.text || (product.origin as any)?.name || '');

    let score = 0;

    if (normalizedKeyword) {
      if (title === normalizedKeyword) score += 120;
      if (title.includes(normalizedKeyword)) score += 80;
      if (subtitle.includes(normalizedKeyword)) score += 36;
      if (categoryName === normalizedKeyword) score += 70;
      if (categoryPath.includes(normalizedKeyword)) score += 48;
      if (aiKeywords.some((keyword) => keyword === normalizedKeyword)) score += 38;
      if (aiKeywords.some((keyword) => keyword.includes(normalizedKeyword))) score += 18;
      if (tagNames.some((tag) => tag === normalizedKeyword)) score += 34;
      if (tagNames.some((tag) => tag.includes(normalizedKeyword))) score += 16;
      if (origin.includes(normalizedKeyword)) score += 10;
    }

    if (searchEntity?.matchedCategoryIds.length && product.categoryId && searchEntity.matchedCategoryIds.includes(product.categoryId)) {
      score += 72;
    }

    const recommendationSignals = this.getRecommendationSignalScore(tagNames, title, subtitle);
    if (preferRecommended) {
      score += recommendationSignals * 1.6;
    } else {
      score += recommendationSignals * 0.45;
    }

    const constraintBoost = constraints.reduce(
      (sum, constraint) => sum + this.getConstraintSignalScore(constraint, title, subtitle, tagNames, aiKeywords, categoryName),
      0,
    );
    score += constraintBoost;
    score += recommendThemes.reduce(
      (sum, theme) => (
        sum + this.getRecommendThemeScore(theme, product, title, subtitle, tagNames, aiKeywords, categoryName)
      ),
      0,
    );

    // 语义评分（由 AI_SEMANTIC_SCORING_ENABLED 特性开关控制）
    const scoringEnabled = (process.env.AI_SEMANTIC_SCORING_ENABLED ?? '') === 'true';

    if (scoringEnabled && slots) {
      const semanticFields: ProductSemanticFields = {
        categoryName: product.category?.name,
        categoryPath: categories.find((c) => c.id === product.categoryId)?.path,
        usageScenarios: product.usageScenarios || [],
        originRegion: product.originRegion,
        dietaryTags: product.dietaryTags || [],
        flavorTags: product.flavorTags || [],
        seasonalMonths: product.seasonalMonths || [],
      };

      const { score: semanticScore } = computeSemanticScore(slots as SemanticSlots, semanticFields);
      score += semanticScore;
    }

    // 折扣分
    if (product.basePrice && product.skus?.[0]?.price) {
      const discountRate = (product.basePrice - product.skus[0].price) / product.basePrice;
      if (discountRate > 0) {
        score += 10 + Math.round(discountRate * 15);
      }
    }

    // 热度分：Phase 2 暂用 createdAt 新鲜度替代，Redis 缓存在 C 阶段实现
    const daysSinceCreated = (Date.now() - new Date(product.createdAt).getTime()) / 86400000;
    if (daysSinceCreated < 7) {
      score += Math.round((7 - daysSinceCreated) / 7 * 10);
    }

    return score;
  }

  private getRecommendationSignalScore(tags: string[], title: string, subtitle: string): number {
    const highQualitySignals: Array<{ pattern: RegExp; score: number }> = [
      { pattern: /有机/u, score: 16 },
      { pattern: /可信溯源|溯源/u, score: 14 },
      { pattern: /地理标志/u, score: 12 },
      { pattern: /检测报告/u, score: 10 },
      { pattern: /当季|鲜采/u, score: 8 },
      { pattern: /生态/u, score: 6 },
      { pattern: /冷链/u, score: 6 },
    ];

    const haystack = `${title} ${subtitle} ${tags.join(' ')}`;
    return highQualitySignals.reduce((sum, signal) => (
      signal.pattern.test(haystack) ? sum + signal.score : sum
    ), 0);
  }

  private getConstraintSignalScore(
    constraint: string,
    title: string,
    subtitle: string,
    tags: string[],
    aiKeywords: string[],
    categoryName: string,
  ): number {
    const haystack = `${title} ${subtitle} ${tags.join(' ')} ${aiKeywords.join(' ')} ${categoryName}`;
    const constraintPatterns: Record<string, RegExp> = {
      organic: /有机/u,
      'low-sugar': /低糖|控糖/u,
      seasonal: /当季|应季|鲜采/u,
      traceable: /可信溯源|溯源/u,
      'cold-chain': /冷链/u,
      'geo-certified': /地理标志/u,
      healthy: /健康|轻食/u,
      fresh: /新鲜|鲜/u,
    };

    const pattern = constraintPatterns[constraint];
    if (!pattern) return 0;
    return pattern.test(haystack) ? 28 : 0;
  }

  private getRecommendThemeScore(
    theme: AiRecommendTheme,
    product: ListableProduct,
    title: string,
    subtitle: string,
    tags: string[],
    aiKeywords: string[],
    categoryName: string,
  ): number {
    const haystack = `${title} ${subtitle} ${tags.join(' ')} ${aiKeywords.join(' ')} ${categoryName}`;

    switch (theme) {
      case 'hot': {
        let score = this.getRecommendationSignalScore(tags, title, subtitle) * 0.9;
        if (/(?:热销|爆款|热门|畅销|人气|招牌|必买|值得买)/u.test(haystack)) score += 42;
        score += this.getRecencyScore(product.createdAt) * 0.35;
        return score;
      }
      case 'discount': {
        let score = 0;
        if (/(?:折扣|优惠|特价|特惠|促销|秒杀|活动价|直降|超值|省钱)/u.test(haystack)) score += 52;
        const displayPrice = this.getDisplayPrice(product);
        if (displayPrice > 0) {
          score += Math.max(0, 28 - Math.min(displayPrice, 168) / 6);
        }
        return score;
      }
      case 'tasty': {
        let score = 0;
        if (/(?:好吃|好喝|美味|鲜甜|香甜|脆甜|鲜美|回甘|口感|下饭|浓香|软糯|清甜)/u.test(haystack)) score += 46;
        score += this.getRecommendationSignalScore(tags, title, subtitle) * 0.75;
        score += this.getConstraintSignalScore('fresh', title, subtitle, tags, aiKeywords, categoryName) * 0.45;
        return score;
      }
      case 'seasonal':
        return this.getConstraintSignalScore('seasonal', title, subtitle, tags, aiKeywords, categoryName) + this.getRecencyScore(product.createdAt) * 0.2;
      case 'recent': {
        let score = this.getRecencyScore(product.createdAt);
        if (/(?:新品|新上|上新|最新)/u.test(haystack)) score += 26;
        return score;
      }
      default:
        return 0;
    }
  }

  private getRecencyScore(createdAt: Date): number {
    const ageMs = Date.now() - createdAt.getTime();
    const ageDays = Math.max(0, ageMs / 86_400_000);
    return Math.max(0, 40 - Math.min(ageDays, 40));
  }

  /** 列表项映射（精简） */
  private mapToListItem(product: any) {
    const firstImage = product.media?.[0]?.url || '';
    const firstSku = product.skus?.[0];
    const origin = product.origin as any;
    const tagNames = (product.tags || []).map((pt: any) => pt.tag?.name).filter(Boolean);

    return {
      id: product.id,
      title: product.title,
      price: firstSku?.price ?? product.basePrice,
      defaultSkuId: firstSku?.id ?? null,
      unit: origin?.unit || '斤',
      origin: origin?.text || origin?.name || '',
      image: firstImage,
      tags: tagNames.length > 0 ? tagNames : product.aiKeywords || [],
      strikePrice: undefined,
      categoryId: product.categoryId,
      categoryName: product.category?.name || '',
      companyId: product.companyId,
      rating: undefined,
    };
  }

  /** 详情映射（完整信息） */
  private mapToDetail(product: any) {
    const origin = product.origin as any;
    const tagNames = (product.tags || []).map((pt: any) => pt.tag?.name).filter(Boolean);

    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      detailRich: product.detailRich,
      basePrice: product.basePrice,
      origin: origin?.text || origin?.name || '',
      unit: origin?.unit || '斤',
      companyId: product.companyId,
      companyName: product.company?.name || '',
      categoryId: product.categoryId,
      categoryName: product.category?.name || '',
      tags: tagNames.length > 0 ? tagNames : product.aiKeywords || [],
      images: (product.media || [])
        .filter((m: any) => m.type === 'IMAGE')
        .map((m: any) => ({ id: m.id, url: m.url, alt: m.alt })),
      videos: (product.media || [])
        .filter((m: any) => m.type === 'VIDEO')
        .map((m: any) => ({ id: m.id, url: m.url })),
      skus: (product.skus || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        price: s.price,
        stock: s.stock,
        skuCode: s.skuCode,
      })),
      attributes: product.attributes || {},
      aiKeywords: product.aiKeywords || [],
      // 兼容前端旧 Product 类型
      price: product.skus?.[0]?.price ?? product.basePrice,
      image: product.media?.find((m: any) => m.type === 'IMAGE')?.url || '',
    };
  }
}
