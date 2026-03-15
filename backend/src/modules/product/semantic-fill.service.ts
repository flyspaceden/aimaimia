import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// AI 语义字段来源标注
type SemanticSource = 'ai' | 'seller' | 'ops';

// 单个语义字段的元数据
interface SemanticFieldMeta {
  source: SemanticSource;
  updatedAt: string; // ISO 字符串
}

// 存储在 product.attributes.semanticMeta 中的结构
interface SemanticMeta {
  flavorTags?: SemanticFieldMeta;
  seasonalMonths?: SemanticFieldMeta;
  usageScenarios?: SemanticFieldMeta;
  dietaryTags?: SemanticFieldMeta;
  originRegion?: SemanticFieldMeta;
}

// Qwen 返回的语义字段推断结果
interface QwenSemanticResult {
  flavorTags?: string[];
  seasonalMonths?: number[];
  usageScenarios?: string[];
  dietaryTags?: string[];
  originRegion?: string | null;
}

const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

@Injectable()
export class SemanticFillService {
  private readonly logger = new Logger(SemanticFillService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为单个商品填充 AI 语义字段。
   * 若已有 seller/ops 来源的字段则跳过，只更新 ai 来源（或空白）的字段。
   * 出错时静默跳过，不抛异常。
   */
  async fillProduct(productId: string): Promise<void> {
    // 检查功能开关
    if (process.env.AI_PRODUCT_SEMANTIC_FIELDS_ENABLED !== 'true') {
      this.logger.debug('AI_PRODUCT_SEMANTIC_FIELDS_ENABLED 未开启，跳过语义填充');
      return;
    }

    try {
      // 加载商品及分类
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          title: true,
          subtitle: true,
          description: true,
          flavorTags: true,
          seasonalMonths: true,
          usageScenarios: true,
          dietaryTags: true,
          originRegion: true,
          attributes: true,
          category: {
            select: { name: true },
          },
        },
      });

      if (!product) {
        this.logger.warn(`[SemanticFill] 商品不存在：productId=${productId}`);
        return;
      }

      // 读取已有 semanticMeta
      const attributes = (product.attributes as Record<string, unknown>) ?? {};
      const semanticMeta: SemanticMeta = (attributes['semanticMeta'] as SemanticMeta) ?? {};

      // 判断哪些字段可以被 AI 填充（来源为 'ai' 或为空）
      const canFill = {
        flavorTags: this.canAiFill(semanticMeta.flavorTags),
        seasonalMonths: this.canAiFill(semanticMeta.seasonalMonths),
        usageScenarios: this.canAiFill(semanticMeta.usageScenarios),
        dietaryTags: this.canAiFill(semanticMeta.dietaryTags),
        originRegion: this.canAiFill(semanticMeta.originRegion),
      };

      // 若所有字段均已由 seller/ops 填写，则无需调用 AI
      const anyFillable = Object.values(canFill).some(Boolean);
      if (!anyFillable) {
        this.logger.debug(`[SemanticFill] 商品 ${productId} 所有语义字段均已由人工填写，跳过`);
        return;
      }

      // 构建 AI 输入
      const inputText = [
        `商品名称：${product.title}`,
        product.subtitle ? `副标题：${product.subtitle}` : null,
        product.description ? `描述：${product.description}` : null,
        product.category ? `分类：${product.category.name}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      // 调用 Qwen 推断语义字段
      const result = await this.callQwenForSemanticFill(inputText);
      if (!result) {
        this.logger.warn(`[SemanticFill] Qwen 返回空结果，跳过商品 ${productId}`);
        return;
      }

      // 构建更新数据（仅更新可被 AI 填充的字段）
      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {};
      const newMeta: SemanticMeta = { ...semanticMeta };

      if (canFill.flavorTags && result.flavorTags && result.flavorTags.length > 0) {
        updateData['flavorTags'] = result.flavorTags;
        newMeta.flavorTags = { source: 'ai', updatedAt: now };
      }

      if (canFill.seasonalMonths && result.seasonalMonths && result.seasonalMonths.length > 0) {
        // 校验 seasonalMonths 值范围为 1-12
        const validMonths = result.seasonalMonths.filter((m) => m >= 1 && m <= 12);
        if (validMonths.length > 0) {
          updateData['seasonalMonths'] = validMonths;
          newMeta.seasonalMonths = { source: 'ai', updatedAt: now };
        }
      }

      if (canFill.usageScenarios && result.usageScenarios && result.usageScenarios.length > 0) {
        updateData['usageScenarios'] = result.usageScenarios;
        newMeta.usageScenarios = { source: 'ai', updatedAt: now };
      }

      if (canFill.dietaryTags && result.dietaryTags && result.dietaryTags.length > 0) {
        updateData['dietaryTags'] = result.dietaryTags;
        newMeta.dietaryTags = { source: 'ai', updatedAt: now };
      }

      if (canFill.originRegion && result.originRegion) {
        updateData['originRegion'] = result.originRegion;
        newMeta.originRegion = { source: 'ai', updatedAt: now };
      }

      // 若没有任何有效推断结果，直接返回
      if (Object.keys(updateData).length === 0) {
        this.logger.debug(`[SemanticFill] 商品 ${productId} Qwen 未推断出有效字段，跳过写入`);
        return;
      }

      // 将 semanticMeta 写回 attributes
      const updatedAttributes = { ...attributes, semanticMeta: newMeta };
      updateData['attributes'] = updatedAttributes;

      await this.prisma.product.update({
        where: { id: productId },
        data: updateData as any,
      });

      this.logger.log(
        `[SemanticFill] 商品 ${productId} 语义字段更新成功：${Object.keys(updateData)
          .filter((k) => k !== 'attributes')
          .join(', ')}`,
      );
    } catch (err) {
      // 静默失败，不影响主流程
      this.logger.warn(`[SemanticFill] 商品 ${productId} 处理失败（静默跳过）：${(err as Error)?.message}`);
    }
  }

  /**
   * 批量填充语义字段。
   * 筛选 ACTIVE 状态且至少 3 个语义字段为空的商品。
   * 每次调用之间延迟 200ms 以避免 API 限速。
   */
  async batchFill(batchSize = 50): Promise<void> {
    if (process.env.AI_PRODUCT_SEMANTIC_FIELDS_ENABLED !== 'true') {
      this.logger.debug('AI_PRODUCT_SEMANTIC_FIELDS_ENABLED 未开启，跳过批量语义填充');
      return;
    }

    this.logger.log(`[SemanticFill] 开始批量语义填充，batchSize=${batchSize}`);

    // 查询 ACTIVE 商品（多取一些以确保过滤后达到 batchSize）
    // Prisma 不直接支持按数组字段空值计数过滤，在 JS 层完成筛选
    const products = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        flavorTags: true,
        seasonalMonths: true,
        usageScenarios: true,
        dietaryTags: true,
        originRegion: true,
      },
      take: batchSize * 5,
    });

    // 过滤：至少 3 个语义字段为空
    const targets = products
      .filter((p) => {
        const emptyCount = [
          p.flavorTags.length === 0,
          p.seasonalMonths.length === 0,
          p.usageScenarios.length === 0,
          p.dietaryTags.length === 0,
          !p.originRegion,
        ].filter(Boolean).length;
        return emptyCount >= 3;
      })
      .slice(0, batchSize);

    this.logger.log(`[SemanticFill] 筛选到 ${targets.length} 个待填充商品`);

    for (const product of targets) {
      await this.fillProduct(product.id);
      // 每次调用之间等待 200ms，避免触发 API 限速
      await this.sleep(200);
    }

    this.logger.log(`[SemanticFill] 批量语义填充完成，共处理 ${targets.length} 个商品`);
  }

  // ────────────────────────── 私有方法 ──────────────────────────

  /**
   * 判断某字段是否可被 AI 填充。
   * 来源为 'ai' 或无记录（空白）时允许 AI 填充；'seller'/'ops' 时跳过。
   */
  private canAiFill(meta?: SemanticFieldMeta): boolean {
    if (!meta) return true;
    return meta.source === 'ai';
  }

  /**
   * 调用 Qwen 推断商品语义字段。
   * 使用与 ai.service.ts 相同的 DashScope HTTP API（兼容模式）。
   */
  private async callQwenForSemanticFill(inputText: string): Promise<QwenSemanticResult | null> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      this.logger.warn('[SemanticFill] DASHSCOPE_API_KEY 未配置');
      return null;
    }

    const model = process.env.AI_INTENT_MODEL || 'qwen-turbo';

    const systemPrompt = `你是一个农业电商商品信息结构化助手。
根据用户提供的商品信息，推断以下语义字段，并以纯 JSON 对象格式返回，不要输出任何多余内容，不要 markdown 代码块，不要解释：
- flavorTags: string[] （口味标签，如 ["香甜","鲜嫩","清淡"]，最多5个，无法推断则返回 []）
- seasonalMonths: number[] （适销月份，1-12 的整数，如 [3,4,5] 表示春季，无法推断则返回 []）
- usageScenarios: string[] （使用场景，如 ["家庭餐桌","送礼","宴请"]，最多5个，无法推断则返回 []）
- dietaryTags: string[] （饮食标签，如 ["有机","无农药","低糖"]，最多5个，无法推断则返回 []）
- originRegion: string | null （产地，如 "云南省昆明市"，无法推断则返回 null）`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: inputText },
          ],
          temperature: 0.1,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(`[SemanticFill] Qwen API 调用失败：${response.status} ${errText}`);
        return null;
      }

      const data = (await response.json()) as any;
      const content = data?.choices?.[0]?.message?.content as string | undefined;
      if (!content) {
        this.logger.warn('[SemanticFill] Qwen 返回内容为空');
        return null;
      }

      // 清理可能的 markdown 代码块包裹
      const jsonStr = content
        .replace(/```json\s*\n?/g, '')
        .replace(/```\s*\n?/g, '')
        .trim();

      const parsed = JSON.parse(jsonStr) as QwenSemanticResult;
      return parsed;
    } catch (err) {
      this.logger.warn(`[SemanticFill] Qwen 调用异常：${(err as Error)?.message}`);
      return null;
    }
  }

  /** 睡眠工具方法 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
