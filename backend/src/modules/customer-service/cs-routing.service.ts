import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CsFaqService } from './cs-faq.service';
import { CsRouteResult, CsAiContext } from './types/cs.types';

const TRANSFER_KEYWORDS = ['转人工', '找客服', '找人工', '人工客服', '真人客服'];
const EMOTION_KEYWORDS = ['投诉', '骗子', '欺诈', '举报', '报警', '工商', '消协', '12315'];

@Injectable()
export class CsRoutingService {
  private readonly logger = new Logger(CsRoutingService.name);

  private readonly QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  private readonly CS_INTENT_MODEL = process.env.AI_CS_INTENT_MODEL || 'qwen-flash';
  private readonly CONFIDENCE_THRESHOLD = 0.6;

  constructor(
    private prisma: PrismaService,
    private faqService: CsFaqService,
  ) {}

  /**
   * 三层路由：FAQ → AI → 转人工判断
   */
  async route(message: string, context: CsAiContext, consecutiveFailures: number): Promise<CsRouteResult> {
    // 检查是否主动要求转人工
    const normalized = message.toLowerCase();
    if (TRANSFER_KEYWORDS.some((kw) => normalized.includes(kw))) {
      return { layer: 3, shouldTransferToAgent: true };
    }

    // 检查情绪激动/投诉升级
    if (EMOTION_KEYWORDS.some((kw) => normalized.includes(kw))) {
      return {
        layer: 3,
        reply: '非常抱歉给您带来不好的体验，正在为您转接人工客服...',
        contentType: 'TEXT',
        shouldTransferToAgent: true,
      };
    }

    // 第一层：FAQ 关键词匹配
    const faqResult = await this.faqService.match(message);
    if (faqResult) {
      return {
        layer: 1,
        reply: faqResult.answer,
        contentType: faqResult.answerType === 'RICH_CARD' ? 'RICH_CARD' : 'TEXT',
        metadata: faqResult.metadata ?? undefined,
        shouldTransferToAgent: false,
      };
    }

    // 第二层：AI 意图理解
    try {
      const aiResult = await this.classifyIntent(message, context);
      if (aiResult) {
        return {
          layer: 2,
          reply: aiResult.reply,
          contentType: aiResult.contentType ?? 'TEXT',
          metadata: aiResult.metadata,
          shouldTransferToAgent: false,
          aiIntent: aiResult.intent,
          aiConfidence: aiResult.confidence,
        };
      }
    } catch (e) {
      this.logger.warn('AI 意图分类失败', e);
    }

    // AI 连续失败 2 次，自动转人工
    if (consecutiveFailures + 1 >= 2) {
      return {
        layer: 3,
        reply: '抱歉我暂时无法理解您的问题，正在为您转接人工客服...',
        contentType: 'TEXT',
        shouldTransferToAgent: true,
      };
    }

    // AI 单次失败，返回兜底回复
    return {
      layer: 2,
      reply: '抱歉我没太理解您的意思，能再描述一下您的问题吗？或者您可以说"转人工"由客服人员为您处理。',
      contentType: 'TEXT',
      shouldTransferToAgent: false,
    };
  }

  private async classifyIntent(message: string, context: CsAiContext): Promise<{
    intent: string;
    confidence: number;
    reply: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
  } | null> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) return null;

    const contextInfo = context.orderId
      ? `用户来自订单详情页，订单ID: ${context.orderId}。${context.orderInfo ? `订单信息: ${JSON.stringify(context.orderInfo)}` : ''}`
      : context.afterSaleId
        ? `用户来自售后详情页，售后单ID: ${context.afterSaleId}。${context.afterSaleInfo ? `售后信息: ${JSON.stringify(context.afterSaleInfo)}` : ''}`
        : '用户来自个人中心。';

    const historyText = context.conversationHistory
      .slice(-6)
      .map((m) => `${m.role === 'user' ? '用户' : '客服'}: ${m.content}`)
      .join('\n');

    const response = await fetch(this.QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.CS_INTENT_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是爱买买电商平台的智能客服，帮助买家解决购物问题。

## 上下文
${contextInfo}

## 对话历史
${historyText || '（无）'}

## 你能处理的问题类型
- query_logistics: 查询物流/快递状态
- query_aftersale: 查询退换货/退款进度
- apply_aftersale: 用户想申请退货退款（引导用户操作，不直接执行）
- cancel_order: 用户想取消订单（提醒确认，不直接执行）
- query_coupon: 查询优惠券/余额
- general_qa: 平台规则、运费政策、VIP权益等常见问答

## 回复要求
用 JSON 格式回复:
{"intent":"意图名","confidence":0.0-1.0,"reply":"自然语言回复"}

如果无法判断意图，返回 {"intent":"unknown","confidence":0.0,"reply":""}`,
          },
          { role: 'user', content: message },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    try {
      const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      if (parsed.intent === 'unknown' || parsed.confidence < this.CONFIDENCE_THRESHOLD) {
        return null;
      }

      let metadata: Record<string, unknown> | undefined;
      if (parsed.intent === 'apply_aftersale' || parsed.intent === 'cancel_order') {
        metadata = {
          actionType: parsed.intent,
          requiresConfirm: true,
          orderId: context.orderId,
        };
      }

      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        reply: parsed.reply,
        contentType: metadata ? 'ACTION_CONFIRM' : 'TEXT',
        metadata,
      };
    } catch {
      this.logger.warn('AI 意图解析 JSON 失败', raw);
      return null;
    }
  }
}
