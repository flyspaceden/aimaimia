import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AsrService } from './asr.service';
import { CompanyService } from '../company/company.service';
import {
  AiVoiceClarifyCandidate,
  AiVoiceDemandSlots,
  AiRecommendTheme,
  AiVoiceSortIntent,
  AiVoiceCompanyMode,
  AiVoiceIntent,
  AiVoiceIntentSlots,
  AiVoiceResolved,
  AiVoiceTiming,
  AiVoiceNavigateTarget,
  AiVoiceTransactionAction,
  VALID_NAVIGATE_TARGETS,
  VoiceIntentClassification,
  AiChatResponse,
  AiSuggestedAction,
} from './voice-intent.types';
import { ProductService } from '../product/product.service';
import {
  FLASH_SEMANTIC_PROMPT,
  PLUS_SEMANTIC_PROMPT,
  OUT_OF_DOMAIN_BRIDGE_PROMPT,
  isFlashResultGood,
} from './semantic-slot.constants';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly RECOMMEND_THEMES: AiRecommendTheme[] = ['hot', 'discount', 'tasty', 'seasonal', 'recent'];
  private readonly COMPANY_MATCH_BATCH_SIZE = 80;
  private readonly COMPANY_MATCH_EARLY_EXIT_CONFIDENCE = 0.9;
  private readonly INTENT_CONFIDENCE_THRESHOLDS = {
    navigate: 0.6,
    search: 0.6,
    chat: 0.6,
    company: 0.7,
    recommend: 0.7,
    transaction: 0.8,
  } as const;

  /** Qwen API 地址（OpenAI 兼容格式） */
  private readonly QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  private readonly QWEN_SEARCH_REWRITE_MODEL = process.env.AI_SEARCH_REWRITE_MODEL || 'qwen-flash';
  private readonly QWEN_COMPANY_MATCH_MODEL = process.env.AI_COMPANY_MATCH_MODEL || 'qwen-flash';
  private readonly QWEN_INTENT_MODEL = process.env.AI_INTENT_MODEL || 'qwen-flash';
  private readonly QWEN_RECOMMEND_MODEL = process.env.AI_RECOMMEND_MODEL || 'qwen3.5-plus';
  private readonly QWEN_CHAT_MODEL = process.env.AI_CHAT_MODEL || 'qwen3.5-plus';
  private readonly CHAT_MAX_ROUNDS = 8;           // 最多保留最近 8 轮（16 条消息）
  private readonly CHAT_MAX_INPUT_TOKENS = 7000;   // 输入 token 预算（粗估）

  /** 隐私保护：日志中截断转录文本，避免泄露用户语音内容 */
  private redactTranscript(t: string): string {
    return t.length > 20 ? t.substring(0, 20) + '...' : t;
  }

  private readonly CHAT_SYSTEM_PROMPT = `你是"农脉 AI 助手"，一个农业电商平台的智能客服。

## 角色
- 帮助用户了解平台商品、企业、农产品知识
- 回答农业电商相关问题
- 当用户表达购物意图时，建议相关操作（不自动执行）

## 回答边界
- 只回答与农业、食品、电商、平台功能相关的问题
- 对超出范围的问题（如医疗、法律、政治），礼貌告知无法回答
- 不编造商品信息、不承诺价格、不代替用户做支付决策

## 安全规则
- 绝不输出用户隐私信息
- 绝不伪造订单、交易状态
- 所有建议动作由用户确认后才执行

## 输出格式
你必须以 JSON 格式回复，结构如下：
{
  "reply": "你的自然语言回答",
  "suggestedActions": [
    {
      "type": "search|navigate|company|recommend",
      "label": "按钮显示文字",
      "resolved": { "query": "搜索词", ... }
    }
  ],
  "followUpQuestions": ["追问建议1", "追问建议2"]
}

规则：
- reply 字段必须有值
- suggestedActions 最多 2 个，只在用户有明确购物/浏览意图时才给
- followUpQuestions 最多 3 个，用于引导对话继续
- 如果没有建议动作或追问，对应数组为空 []
- type 白名单：search / navigate / company / recommend
- navigate 的 resolved 必须包含 target 字段，值为：home / cart / checkout / orders / settings / discover / me / search / ai-chat
- search 的 resolved 必须包含 query 字段，可选 constraints 数组
- company 的 resolved 必须包含 name 字段
- recommend 的 resolved 可包含 query / budget / constraints`;

  private readonly RECOMMEND_CONSTRAINT_LABELS: Record<string, string> = {
    organic: '有机',
    'low-sugar': '低糖',
    seasonal: '当季',
    traceable: '可溯源',
    'cold-chain': '冷链',
    'geo-certified': '地理标志',
    healthy: '健康',
    fresh: '新鲜',
  };

  constructor(
    private prisma: PrismaService,
    private asrService: AsrService,
    private productService: ProductService,
    private companyService: CompanyService,
  ) {}

  // ========== 前端简化 API ==========

  /** 快捷入口列表 */
  getShortcuts() {
    return [
      { id: 's-1', title: '智能补货提醒', prompt: '根据我的购买记录，本周需要补货什么？' },
      { id: 's-2', title: '健康饮食建议', prompt: '推荐一些低糖健康的水果' },
      { id: 's-3', title: '查订单物流', prompt: '我最近的订单到哪了？' },
      { id: 's-4', title: '产地溯源', prompt: '帮我查一下这个商品的产地信息' },
      { id: 's-5', title: '企业考察', prompt: '附近有什么值得考察的农场？' },
      { id: 's-6', title: '优惠活动', prompt: '最近有什么优惠活动？' },
    ];
  }

  /** 问候语 */
  getGreeting() {
    const greeting = this.getGreetingPrefix();

    return {
      id: `greeting-${Date.now()}`,
      role: 'assistant',
      content: `${greeting}！我是农脉 AI 农管家，可以帮你查订单、推荐商品、溯源产地。有什么需要帮忙的吗？`,
      createdAt: new Date().toISOString(),
    };
  }

  private getGreetingPrefix() {
    const hour = new Date().getHours();
    let greeting = '你好';
    if (hour < 6) greeting = '夜深了';
    else if (hour < 12) greeting = '早上好';
    else if (hour < 18) greeting = '下午好';
    else greeting = '晚上好';
    return greeting;
  }

  private getShortGreetingReply() {
    return `${this.getGreetingPrefix()}！我是农脉 AI 农管家，可以帮你查订单、推荐商品、溯源产地，也能帮你打开页面。`;
  }

  /** 将首页已完成的一问一答写入 session（不调 Qwen），确保后续多轮有历史上下文 */
  async seedMessage(
    sessionId: string,
    userId: string,
    dto: { transcript: string; reply: string },
  ) {
    const session = await this.prisma.aiSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new NotFoundException('会话不存在');

    const utterance = await this.prisma.aiUtterance.create({
      data: { sessionId, transcript: dto.transcript },
    });

    await this.prisma.aiIntentResult.create({
      data: {
        utteranceId: utterance.id,
        intent: 'chat',
        slots: this.toJsonValue({}),
        confidence: 1.0,
        modelInfo: this.toJsonValue({ model: 'seeded-from-home', phase: 'phase2-seed' }),
        actionExecutions: {
          create: {
            actionType: 'SHOW_CHOICES',
            actionPayload: this.toJsonValue({
              chatResponse: { reply: dto.reply, suggestedActions: [], followUpQuestions: [] },
              message: dto.reply,
            }),
            success: true,
          },
        },
      },
    });

    return { seeded: true };
  }

  /** 简单聊天（自动管理 session，返回前端期望的 AiChatMessage 格式） */
  async simpleChat(userId: string, message: string) {
    // 查找或创建默认会话
    let session = await this.prisma.aiSession.findFirst({
      where: { userId, page: 'assistant' },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) {
      session = await this.prisma.aiSession.create({
        data: { userId, page: 'assistant' },
      });
    }

    // 利用已有的 sendMessage 逻辑
    const utterance = await this.sendMessage(session.id, userId, { transcript: message });

    // 从 utterance 的 intentResults 中提取回复（兼容 Phase 2 chatResponse 格式）
    const payload = utterance.intentResults?.[0]?.actions?.[0]?.payload as any;
    const reply = payload?.chatResponse?.reply || payload?.message || '我已收到你的问题，稍后为你生成详细建议。';

    return {
      id: utterance.id,
      role: 'assistant',
      content: reply,
      createdAt: utterance.createdAt,
    };
  }

  private toStoredIntentType(intent: AiVoiceIntent): string {
    return intent.intent ?? intent.type;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toStoredSlotsPayload(transcript: string, intent: AiVoiceIntent) {
    return {
      schemaVersion: 2,
      authority: 'resolved',
      transcript,
      intent: intent.intent ?? intent.type,
      slots: intent.slots ?? null,
      resolved: intent.resolved ?? null,
      fallbackReason: intent.fallbackReason ?? null,
      timing: intent.timing ?? null,
    };
  }

  private toStoredCandidates(intent: AiVoiceIntent) {
    if (intent.type !== 'clarify' || !intent.clarify?.candidates?.length) {
      return null;
    }

    return intent.clarify.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      type: candidate.intent ?? candidate.type,
      confidence: candidate.confidence ?? null,
      legacyParam: candidate.param ?? null,
      slots: candidate.slots ?? null,
      resolved: candidate.resolved ?? null,
      fallbackReason: candidate.fallbackReason ?? null,
    }));
  }

  private toStoredModelInfo(intent: AiVoiceIntent) {
    return {
      schemaVersion: 2,
      authority: 'resolved',
      type: intent.type,
      intent: intent.intent ?? intent.type,
      confidence: intent.confidence ?? null,
      legacy: {
        param: intent.param ?? null,
        search: intent.search ?? null,
        company: intent.company ?? null,
        transaction: intent.transaction ?? null,
        recommend: intent.recommend ?? null,
      },
      fallbackReason: intent.fallbackReason ?? null,
      timing: intent.timing ?? null,
    };
  }

  private toStoredActionType(intent: AiVoiceIntent): 'NAVIGATE' | 'CALL_API' | 'SHOW_CHOICES' {
    if ((intent.intent ?? intent.type) === 'navigate') {
      return 'NAVIGATE';
    }
    if ((intent.intent ?? intent.type) === 'clarify') {
      return 'SHOW_CHOICES';
    }
    return 'CALL_API';
  }

  private async persistStructuredIntentResult(
    utteranceId: string,
    transcript: string,
    intent: AiVoiceIntent,
  ) {
    const intentResult = await this.prisma.aiIntentResult.create({
      data: {
        utteranceId,
        intent: this.toStoredIntentType(intent),
        slots: this.toJsonValue(this.toStoredSlotsPayload(transcript, intent)),
        confidence: intent.confidence ?? null,
        candidates: this.toJsonValue(this.toStoredCandidates(intent)),
        modelInfo: this.toJsonValue(this.toStoredModelInfo(intent)),
      },
    });

    await this.prisma.aiActionExecution.create({
      data: {
        intentResultId: intentResult.id,
        actionType: this.toStoredActionType(intent),
        actionPayload: this.toJsonValue({
          schemaVersion: 2,
          authority: 'resolved',
          message: intent.feedback,
          type: intent.type,
          intent: intent.intent ?? intent.type,
          resolved: intent.resolved ?? null,
          slots: intent.slots ?? null,
          fallbackReason: intent.fallbackReason ?? null,
          timing: intent.timing ?? null,
        }),
        requiresConfirmation: (intent.intent ?? intent.type) === 'clarify',
        success: true,
      },
    });

    return intentResult.id;
  }

  private async resolveVoiceSession(userId: string, sessionId?: string, page?: string) {
    if (sessionId) {
      const existing = await this.prisma.aiSession.findUnique({ where: { id: sessionId } });
      if (existing && existing.userId === userId) {
        return existing;
      }
    }

    const normalizedPage = page?.trim() || 'home';
    const latest = await this.prisma.aiSession.findFirst({
      where: { userId, page: normalizedPage },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      return latest;
    }

    return this.prisma.aiSession.create({
      data: {
        userId,
        page: normalizedPage,
      },
    });
  }

  private async persistVoiceIntentResult(
    userId: string | undefined,
    transcript: string,
    format: string | undefined,
    intent: AiVoiceIntent,
    sessionId?: string,
    page?: string,
  ) {
    if (!userId) return;

    const session = await this.resolveVoiceSession(userId, sessionId, page);
    const utterance = await this.prisma.aiUtterance.create({
      data: {
        sessionId: session.id,
        transcript,
        language: 'zh',
        asrProvider: 'ALI',
        rawAsrPayload: this.toJsonValue({
          format: format ?? null,
          timing: intent.timing ?? null,
          feedback: intent.feedback,
        }),
      },
    });

    await this.persistStructuredIntentResult(utterance.id, transcript, intent);
  }

  // ========== 语音意图解析 ==========

  private addTiming(
    timing: AiVoiceTiming | undefined,
    key: keyof AiVoiceTiming,
    value: number,
  ) {
    if (!timing) return;
    timing[key] = Math.round((timing[key] ?? 0) + value);
  }

  private withResolvedIntent(
    intent: AiVoiceIntent,
    options: {
      confidence?: number;
      slots?: AiVoiceIntentSlots;
      resolved?: AiVoiceResolved;
      fallbackReason?: string;
    } = {},
  ): AiVoiceIntent {
    const nextIntent: AiVoiceIntent = {
      ...intent,
      intent: intent.type,
    };

    if (typeof options.confidence === 'number') {
      nextIntent.confidence = options.confidence;
    }
    if (options.slots && Object.keys(options.slots).length > 0) {
      nextIntent.slots = options.slots;
    }
    if (options.resolved && Object.keys(options.resolved).length > 0) {
      nextIntent.resolved = options.resolved;
    }
    if (options.fallbackReason) {
      nextIntent.fallbackReason = options.fallbackReason;
    }

    return nextIntent;
  }

  /**
   * 解析语音意图：ASR 转文字 → 意图识别
   * @param audioBuffer 音频二进制数据
   * @param format 音频格式
   * @param prepareId 预建连 ID
   * @returns AiVoiceIntent 包含类型、转录文本、参数和反馈
   */
  async parseVoiceIntent(
    audioBuffer: Buffer,
    format?: string,
    prepareId?: string,
    userId?: string,
    sessionId?: string,
    page?: string,
  ): Promise<AiVoiceIntent> {
    const totalStartedAt = Date.now();
    const timing: AiVoiceTiming = {};
    this.logger.log(`[VoiceASR] prepareId=${prepareId || '-'} format=${format || 'unknown'} bytes=${audioBuffer.length}`);

    // 第一步：语音转文字
    let transcript: string;
    const asrStartedAt = Date.now();
    try {
      const asrResult = await this.asrService.recognize(audioBuffer, format, prepareId);
      transcript = asrResult.text;
      timing.asr_ms = Date.now() - asrStartedAt;
      timing.asr_connect_ms = asrResult.timing.asr_connect_ms;
      timing.asr_wait_final_ms = asrResult.timing.asr_wait_final_ms;
    } catch (err) {
      this.logger.error(`语音识别失败：${err.message}`);
      return this.withResolvedIntent({
        type: 'chat',
        transcript: '',
        param: '',
        feedback: '语音识别失败，请重试或使用文字输入',
        timing: {
          asr_ms: Date.now() - asrStartedAt,
          total_ms: Date.now() - totalStartedAt,
        },
      }, {
        confidence: 0,
        fallbackReason: 'asr-failed',
      });
    }

    if (!transcript || transcript.trim().length === 0) {
      return this.withResolvedIntent({
        type: 'chat',
        transcript: '',
        param: '',
        feedback: '未能识别到语音内容，请重试',
        timing: {
          asr_ms: timing.asr_ms,
          total_ms: Date.now() - totalStartedAt,
        },
      }, {
        confidence: 0,
        fallbackReason: 'empty-transcript',
      });
    }

    this.logger.log(`语音转录结果：${this.redactTranscript(transcript)}`);

    // 第二步：意图解析
    const intent = await this.parseIntent(transcript, 'voice', timing);
    timing.total_ms = Date.now() - totalStartedAt;
    await this.persistVoiceIntentResult(userId, transcript, format, {
      ...intent,
      timing,
    }, sessionId, page);
    this.logger.log(`[VoiceSearch] final-intent type=${intent.type} param="${intent.param}" feedback="${intent.feedback}"`);
    this.logger.log(
      `[VoicePerf] asr=${timing.asr_ms ?? 0}ms connect=${timing.asr_connect_ms ?? 0}ms wait_final=${timing.asr_wait_final_ms ?? 0}ms ` +
      `classify=${timing.classify_ms ?? 0}ms clarify=${timing.clarify_ms ?? 0}ms entity=${timing.entity_resolve_ms ?? 0}ms handler=${timing.handler_ms ?? 0}ms total=${timing.total_ms ?? 0}ms`,
    );

    return {
      ...intent,
      transcript,
      timing,
    };
  }

  async prepareVoiceIntent(): Promise<{ prepareId: string }> {
    return this.asrService.prepareSession();
  }

  /**
   * 意图解析：规则引擎 + Qwen 大模型双层识别
   * @param transcript 转录文本
   * @returns AiVoiceIntent
   */
  async parseIntent(
    transcript: string,
    source: 'voice' | 'text' = 'text',
    timing?: AiVoiceTiming,
  ): Promise<AiVoiceIntent> {
    const classifyStartedAt = Date.now();
    const classification = await this.classifyIntent(transcript);
    this.addTiming(timing, 'classify_ms', Date.now() - classifyStartedAt);

    this.logger.log(
      `[VoiceRoute] classified intent=${classification.intent} source=${classification.source} ` +
      `confidence=${classification.confidence.toFixed(2)} paramKeys=${classification.params ? Object.keys(classification.params).filter(k => classification.params[k] != null).join(',') : 'none'}`,
    );

    if (this.shouldClarifyClassification(classification)) {
      const clarifyStartedAt = Date.now();
      const clarifyIntent = await this.buildClarifyIntent(transcript, source, classification);
      this.addTiming(timing, 'clarify_ms', Date.now() - clarifyStartedAt);
      if (clarifyIntent) {
        return clarifyIntent;
      }
    }

    if (!this.shouldAcceptClassification(classification)) {
      return this.buildLowConfidenceFallbackIntent(transcript, classification);
    }

    return this.dispatchClassification(transcript, source, classification, timing);
  }

  // ========== 规则引擎 ==========

  /**
   * 一级意图分类：硬指令规则优先，其他交给 Qwen-Flash
   */
  private async classifyIntent(transcript: string): Promise<VoiceIntentClassification> {
    const startTime = Date.now();
    let result: VoiceIntentClassification;

    const ruleClassification = this.classifyIntentByRules(transcript);
    if (ruleClassification) {
      result = ruleClassification;
    } else {
      const fastSearchClassification = await this.classifyFastSearchIntent(transcript);
      if (fastSearchClassification) {
        this.logger.log(`快速搜索分类命中：query="${this.pickFirstString(fastSearchClassification.params.query)}"`);
        result = fastSearchClassification;
      } else {
        this.logger.log('硬指令规则未命中，调用 Qwen-Flash 进行一级分类');
        const semanticSlotsEnabled =
          (process.env.AI_SEMANTIC_SLOTS_ENABLED ?? '') === 'true';
        let modelClassification: VoiceIntentClassification | null = null;
        try {
          modelClassification = await this.qwenIntentClassify(transcript, semanticSlotsEnabled);
        } catch (err) {
          this.logger.error(`Qwen 一级分类失败：${err.message}`);
        }

        if (modelClassification) {
          result = modelClassification;
        } else {
          result = {
            intent: 'chat',
            confidence: 0.2,
            source: 'fallback',
            params: {
              message: transcript,
              reply: '我来帮你处理这个问题。',
            },
          };
        }
      }
    }

    this.logger.log(JSON.stringify({
      message: 'voice-intent-processed',
      transcript: transcript.length > 20 ? transcript.substring(0, 20) + '...' : transcript,
      pipeline: result.pipeline || 'rule',
      wasUpgraded: result.wasUpgraded || false,
      intent: result.intent,
      confidence: result.confidence,
      slotKeys: result.params ? Object.keys(result.params).filter(k => result.params[k] != null) : [],
      fallbackReason: result.fallbackReason,
      latencyMs: Date.now() - startTime,
    }));

    return result;
  }

  private async classifyFastSearchIntent(transcript: string): Promise<VoiceIntentClassification | null> {
    const trimmed = transcript.trim();
    if (!trimmed) return null;

    // 只覆盖“明显是商品搜索”的高频短句，避免重新引入规则误判。
    if (this.extractNavigationTarget(trimmed)) return null;
    if (/(订单|物流|快递|到哪了|发货|退[款货换]|付款|支付|买单|售后)/u.test(trimmed)) return null;
    if (this.shouldTreatAsRecommend(trimmed) || this.extractBudget(trimmed)) return null;
    if (/(企业|公司|店铺|农场|商家|旗舰店)/u.test(trimmed)) return null;
    if (/(今天几号|几号|几点|时间|日期|天气|你是谁|你能干什么)/u.test(trimmed)) return null;

    const compact = trimmed.replace(/\s+/g, '');
    const hasSearchSignal = /(?:帮我)?(?:找|搜|搜一下|搜索|查(?:一下)?|看看|看下|看一下|有没有|想买|买点|来点)/u.test(compact);
    if (!hasSearchSignal) return null;
    if (compact.length > 18) return null;

    const query = this.extractSearchKeyword(trimmed);
    if (!query || query.length < 2) return null;

    const normalizedConstraints = this.extractSearchConstraints(trimmed);
    const recommendThemes = this.extractRecommendThemes(trimmed);
    const normalizedQuery = recommendThemes.length > 0
      ? this.normalizeRecommendQuery(query, normalizedConstraints, recommendThemes)
      : query;
    if (!normalizedQuery || normalizedQuery.length < 2) return null;

    const canFastPath = this.shouldFastAcceptSearchQuery(normalizedQuery)
      || await this.productService.canFastClassifySearchKeyword(normalizedQuery);
    if (!canFastPath) return null;

    return {
      intent: 'search',
      confidence: 0.92,
      source: 'rule',
      params: {
        query: normalizedQuery,
        preferRecommended: /推荐/u.test(compact) || recommendThemes.length > 0,
        constraints: normalizedConstraints,
        recommendThemes,
      },
    };
  }

  private shouldFastAcceptSearchQuery(query: string): boolean {
    const compact = this.cleanupSearchKeyword(query).replace(/\s+/g, '');
    if (!compact || compact.length < 2 || compact.length > 10) {
      return false;
    }

    if (/[0-9a-z]/iu.test(compact) && compact.length < 3) {
      return false;
    }

    if (/^(?:这个|那个|这个东西|那个东西|东西|商品|产品|食物|吃的|好物|内容|推荐|全部|更多|这里|那里|附近|最近|今天|现在|目前|一下|一下子)$/u.test(compact)) {
      return false;
    }

    if (/(?:订单|物流|快递|企业|公司|店铺|农场|商家|旗舰店|设置|首页|发现页|我的|聊天|结算|付款|支付|退款|售后)/u.test(compact)) {
      return false;
    }

    return true;
  }

  private getIntentConfidenceThreshold(intent: VoiceIntentClassification['intent']): number {
    if (intent === 'navigate') return this.INTENT_CONFIDENCE_THRESHOLDS.navigate;
    if (intent === 'search') return this.INTENT_CONFIDENCE_THRESHOLDS.search;
    if (intent === 'company') return this.INTENT_CONFIDENCE_THRESHOLDS.company;
    if (intent === 'transaction') return this.INTENT_CONFIDENCE_THRESHOLDS.transaction;
    if (intent === 'recommend') return this.INTENT_CONFIDENCE_THRESHOLDS.recommend;
    return this.INTENT_CONFIDENCE_THRESHOLDS.chat;
  }

  private getClarifyFloor(intent: VoiceIntentClassification['intent']): number {
    if (intent === 'transaction') return 0.65;
    if (intent === 'company' || intent === 'recommend') return 0.55;
    if (intent === 'search' || intent === 'navigate') return 0.5;
    return 0.5;
  }

  private shouldAcceptClassification(classification: VoiceIntentClassification): boolean {
    if (classification.source === 'rule') return true;
    return classification.confidence >= this.getIntentConfidenceThreshold(classification.intent);
  }

  private shouldClarifyClassification(classification: VoiceIntentClassification): boolean {
    if (classification.source === 'rule') return false;
    if (classification.intent === 'chat') return false;
    const confidence = classification.confidence;
    return confidence >= this.getClarifyFloor(classification.intent)
      && confidence < this.getIntentConfidenceThreshold(classification.intent);
  }

  private buildLowConfidenceFallbackIntent(
    transcript: string,
    classification: VoiceIntentClassification,
  ): AiVoiceIntent {
    const fallbackMessage = classification.intent === 'transaction'
      ? '这条指令和订单、付款有关，我还不够确定。你可以再说一次，或者换一种更明确的说法。'
      : '我还不太确定你的意思。你可以换一种说法，或者直接说你想搜索、打开哪个页面。';

    return this.withResolvedIntent({
      type: 'chat',
      transcript,
      param: transcript,
      feedback: fallbackMessage,
    }, {
      confidence: classification.confidence,
      fallbackReason: 'low-confidence',
    });
  }

  /**
   * 将一级分类结果分发到具体 handler，保持当前前端 API 契约不变
   */
  private async dispatchClassification(
    transcript: string,
    source: 'voice' | 'text',
    classification: VoiceIntentClassification,
    timing?: AiVoiceTiming,
  ): Promise<AiVoiceIntent> {
    const handlerStartedAt = Date.now();
    try {
      switch (classification.intent) {
        case 'navigate':
          return this.handleNavigateClassification(transcript, classification);
        case 'search':
          return this.handleSearchClassification(transcript, source, classification, timing);
        case 'company':
          return this.handleCompanyClassification(transcript, classification, timing);
        case 'transaction':
          return this.handleTransactionClassification(transcript, classification);
        case 'recommend':
          return this.handleRecommendClassification(transcript, classification, timing);
        case 'chat':
        default:
          return this.handleChatClassification(transcript, classification);
      }
    } finally {
      this.addTiming(timing, 'handler_ms', Date.now() - handlerStartedAt);
    }
  }

  /**
   * 规则引擎做一级分类，只回答“这句话属于哪一类任务”
   */
  private classifyIntentByRules(text: string): VoiceIntentClassification | null {
    const trimmed = text.trim();

    // 规则层只处理 100% 确定的硬指令，避免和模型分类互相打架。
    // 页面/动作导航：打开购物车、去结算、回首页等
    const navigateTarget = this.extractNavigationTarget(trimmed);
    if (navigateTarget) {
      return {
        intent: 'navigate',
        params: { target: navigateTarget },
        confidence: 0.95,
        source: 'rule',
      };
    }

    const greetingReply = this.matchShortGreeting(trimmed);
    if (greetingReply) {
      this.logger.log(`[VoiceRoute] short-greeting-hit transcript="${this.redactTranscript(trimmed)}"`);
      return {
        intent: 'chat',
        params: {
          reply: greetingReply,
        },
        confidence: 0.99,
        source: 'rule',
      };
    }

    // 订单/物流/退款/退货 → 交易类，优先级高于 generic search，避免“有没有待付款订单”被识别成商品搜索
    const orderPattern = /订单|物流|快递|到哪了|发货|退[款货换]|付款|支付|买单|售后/;
    if (orderPattern.test(trimmed)) {
      const action = this.extractTransactionAction(trimmed);
      return {
        intent: 'transaction',
        params: {
          action,
          status: this.inferTransactionStatus(action),
          reply: this.getTransactionFeedback(action),
        },
        confidence: 0.9,
        source: 'rule',
      };
    }

    // 天气问题当前没有接入实时天气服务，直接稳定回复，避免被模型误答成日期。
    if (/(?:天气|天氣|气温|氣溫|温度|溫度|下雨|下雪|晴天|陰天|阴天|多云|多雲|刮风|颳風|空气质量|空氣品質)/u.test(trimmed)) {
      return {
        intent: 'chat',
        params: {
          reply: '我现在还不能查询实时天气，所以没法准确回答天气情况。你可以继续问我商品搜索、企业、订单或页面跳转。',
        },
        confidence: 0.98,
        source: 'rule',
      };
    }

    // 加购物车 → 先进入商品搜索/确认，再执行加购；需要先于 generic search 命中以保留动作语义
    const cartPattern = /加.*购物车|加购/;
    if (cartPattern.test(trimmed)) {
      const productName = this.extractCartProduct(trimmed);
      return {
        intent: 'search',
        params: {
          query: productName,
          action: 'add-to-cart',
        },
        confidence: productName ? 0.9 : 0.7,
        source: 'rule',
      };
    }

    return null;
  }

  private matchShortGreeting(text: string): string | null {
    const compact = text
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?~～]/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();

    if (!compact || compact.length > 8) return null;

    const greetingPattern = /^(?:你好|您好|哈喽|哈囉|hello|hi|嗨|嘿|在吗|在嘛|在不在|有人吗|早上好|上午好|中午好|下午好|晚上好|晚安)$/u;
    const followupPattern = /^(?:你好啊|您好呀|哈喽啊|哈喽呀|在吗啊|在吗呀|在吗呢|在不在啊)$/u;

    if (!greetingPattern.test(compact) && !followupPattern.test(compact)) {
      return null;
    }

    if (/^(?:晚安)$/u.test(compact)) {
      return '晚安，我在呢。需要我帮你查商品、订单，还是直接打开某个页面？';
    }
    if (/^(?:在吗|在嘛|在不在|有人吗|hi|hello|嗨|嘿)$/u.test(compact)) {
      return '我在呢。你可以直接告诉我想找什么商品、想看哪个企业，或者让我帮你查订单。';
    }

    return this.getShortGreetingReply();
  }

  private async handleNavigateClassification(
    transcript: string,
    classification: VoiceIntentClassification,
  ): Promise<AiVoiceIntent> {
    const target = this.parseNavigateTarget(classification.params.target) ?? 'home';
    return this.withResolvedIntent({
      type: 'navigate',
      transcript,
      param: target,
      feedback: this.getNavigationFeedback(target),
    }, {
      confidence: classification.confidence,
      slots: {
        targetPage: target,
      },
      resolved: {
        navigateTarget: target,
      },
    });
  }

  private async handleSearchClassification(
    transcript: string,
    source: 'voice' | 'text',
    classification: VoiceIntentClassification,
    timing?: AiVoiceTiming,
  ): Promise<AiVoiceIntent> {
    const rawQuery = this.pickFirstString(
      classification.params.query,
      classification.params.categoryHint,
      classification.params.category,
      classification.params.keyword,
      classification.params.param,
    );
    const extractedKeyword = rawQuery || this.extractSearchKeyword(transcript);

    if (source === 'voice') {
      this.logger.log(
        `[VoiceSearch] transcript="${this.redactTranscript(transcript)}" extracted="${extractedKeyword}" confidence=${classification.confidence}`,
      );
    }

    const entityStartedAt = Date.now();
    const shouldSkipRewrite = this.shouldSkipVoiceSearchRewrite(source, classification, rawQuery, extractedKeyword);
    const keyword = shouldSkipRewrite
      ? extractedKeyword
      : source === 'voice'
        ? await this.rewriteVoiceSearchKeyword(transcript, extractedKeyword)
        : extractedKeyword;

    if (source === 'voice') {
      if (shouldSkipRewrite) {
        this.logger.log(`[VoiceSearch] skip-rewrite query="${keyword}" source=${classification.source} confidence=${classification.confidence.toFixed(2)}`);
      } else {
        this.logger.log(`[VoiceSearch] rewritten="${keyword}" from="${extractedKeyword}"`);
      }
    }

    const constraints = this.pickStringArray(classification.params.constraints);
    const recommendThemes = this.pickRecommendThemes(classification.params.recommendThemes);
    const action = this.pickFirstString(classification.params.action) === 'add-to-cart'
      ? 'add-to-cart'
      : undefined;
    const normalizedConstraints = constraints.length > 0 ? constraints : this.extractSearchConstraints(transcript);
    const fallbackRecommendThemes = recommendThemes.length > 0 ? recommendThemes : this.extractRecommendThemes(transcript);
    const preferRecommended = this.pickBoolean(classification.params.preferRecommended) || fallbackRecommendThemes.length > 0;
    const normalizedSearchKeyword = fallbackRecommendThemes.length > 0
      ? this.normalizeRecommendQuery(keyword, normalizedConstraints, fallbackRecommendThemes)
      : keyword;
    const searchEntity = normalizedSearchKeyword
      ? await this.productService.resolveSearchEntity(normalizedSearchKeyword)
      : {
          normalizedKeyword: '',
          matchedCategoryIds: [],
          source: 'none' as const,
        };
    const normalizedQuery = searchEntity.normalizedKeyword || normalizedSearchKeyword;
    const feedbackKeyword = normalizedQuery || normalizedSearchKeyword;
    const matchedProduct = action === 'add-to-cart' && feedbackKeyword
      ? await this.productService.resolveAddToCartCandidate(feedbackKeyword, searchEntity.matchedCategoryId)
      : {};
    this.addTiming(timing, 'entity_resolve_ms', Date.now() - entityStartedAt);
    const hasStructuredSearch = !!(feedbackKeyword || fallbackRecommendThemes.length > 0);
    const feedback = feedbackKeyword
      ? `正在为你搜索"${feedbackKeyword}"...`
      : this.buildRecommendFeedback('', undefined, normalizedConstraints, fallbackRecommendThemes).replace(/^正在为你推荐/u, '正在为你搜索');
    const slots = this.buildDemandSlots({
      transcript,
      query: feedbackKeyword || undefined,
      categoryHint: this.pickFirstString(
        classification.params.categoryHint,
        classification.params.category,
        searchEntity.matchedCategoryName,
      ),
      constraints: normalizedConstraints,
      preferRecommended,
      recommendThemes: fallbackRecommendThemes,
      usage: this.pickFirstString(
        classification.params.usage,
        classification.params.scene,
        classification.params.scenario,
      ),
      audience: this.pickFirstString(
        classification.params.audience,
        classification.params.persona,
        classification.params.people,
        classification.params.group,
      ),
      slots: classification.params,
    });

    return this.withResolvedIntent({
      type: 'search',
      transcript,
      param: feedbackKeyword || this.buildRecommendThemeLabel(fallbackRecommendThemes),
      feedback: hasStructuredSearch ? feedback : '请问你想搜索什么商品？',
      search: hasStructuredSearch ? {
        query: feedbackKeyword,
        action,
        matchedProductId: matchedProduct.productId,
        matchedProductName: matchedProduct.productName,
        matchedCategoryId: searchEntity.matchedCategoryId,
        matchedCategoryName: searchEntity.matchedCategoryName,
        preferRecommended,
        constraints: normalizedConstraints,
        recommendThemes: fallbackRecommendThemes,
        slots,
      } : undefined,
    }, {
      confidence: classification.confidence,
      slots,
      resolved: hasStructuredSearch ? {
        query: feedbackKeyword || undefined,
        matchedProductId: matchedProduct.productId,
        matchedProductName: matchedProduct.productName,
        matchedCategoryId: searchEntity.matchedCategoryId,
        matchedCategoryName: searchEntity.matchedCategoryName,
        constraints: normalizedConstraints.length > 0 ? normalizedConstraints : undefined,
        preferRecommended,
        recommendThemes: fallbackRecommendThemes.length > 0 ? fallbackRecommendThemes : undefined,
        sortIntent: slots.sortIntent,
        usageScenario: (classification.params?.usageScenario as string) || slots?.usageScenario,
        originPreference: (classification.params?.originPreference as string) || slots?.originPreference,
        dietaryPreference: (classification.params?.dietaryPreference as string) || slots?.dietaryPreference,
        promotionIntent: slots?.promotionIntent,
        bundleIntent: slots?.bundleIntent,
        flavorPreference: (classification.params?.flavorPreference as string) || undefined,
        categoryHint: (classification.params?.categoryHint as string) || undefined,
      } : undefined,
      fallbackReason: hasStructuredSearch ? undefined : 'missing-query',
    });
  }

  private shouldSkipVoiceSearchRewrite(
    source: 'voice' | 'text',
    classification: VoiceIntentClassification,
    rawQuery: string,
    extractedKeyword: string,
  ): boolean {
    if (source !== 'voice') return true;
    if (!rawQuery || !extractedKeyword) return false;

    const normalizedRaw = rawQuery.replace(/\s+/g, '').trim();
    const normalizedExtracted = extractedKeyword.replace(/\s+/g, '').trim();
    if (!normalizedRaw || normalizedRaw !== normalizedExtracted) {
      return false;
    }

    if (classification.source === 'rule' && this.shouldFastAcceptSearchQuery(normalizedExtracted)) {
      return true;
    }

    return classification.source === 'model' && classification.confidence >= 0.9;
  }

  private async handleCompanyClassification(
    transcript: string,
    classification: VoiceIntentClassification,
    timing?: AiVoiceTiming,
  ): Promise<AiVoiceIntent> {
    const initialCompanyName = this.cleanupStoreName(this.pickFirstString(
      classification.params.name,
      classification.params.companyName,
      classification.params.param,
    ) || this.extractStoreName(transcript));
    const mode = this.normalizeCompanyMode(
      classification.params.mode,
      transcript,
      initialCompanyName,
      Boolean(
        this.pickFirstString(
          classification.params.industryHint,
          classification.params.categoryHint,
          classification.params.category,
          classification.params.business,
          classification.params.mainBusiness,
          classification.params.location,
          classification.params.region,
          classification.params.city,
          classification.params.district,
          classification.params.area,
        ) || this.pickStringArray(classification.params.featureTags ?? classification.params.tags ?? classification.params.features).length,
      ),
    );
    const rawCompanyName = this.cleanupCompanyQueryName(transcript, initialCompanyName, mode);
    const companyContext = this.buildCompanyContext(transcript, classification.params, rawCompanyName, mode);
    const entityStartedAt = Date.now();
    const companyEntity = mode === 'list'
      ? { companyId: undefined, companyName: '' }
      : await this.resolveCompanyTargetName(transcript, companyContext);
    this.addTiming(timing, 'entity_resolve_ms', Date.now() - entityStartedAt);

    return this.withResolvedIntent({
      type: 'company',
      transcript,
      param: companyEntity.companyId || companyEntity.companyName,
      feedback: this.getCompanyFeedback(mode, companyEntity.companyName, companyContext),
      company: {
        mode,
        name: companyEntity.companyName || undefined,
        industryHint: companyContext.industryHint,
        location: companyContext.location,
        companyType: companyContext.companyType,
        featureTags: companyContext.featureTags.length ? companyContext.featureTags : undefined,
      },
    }, {
      confidence: classification.confidence,
      slots: {
        companyMode: mode,
        companyName: companyContext.companyName || undefined,
        companyIndustryHint: companyContext.industryHint,
        companyLocation: companyContext.location,
        companyType: companyContext.companyType,
        companyFeatureTags: companyContext.featureTags.length ? companyContext.featureTags : undefined,
      },
      resolved: {
        companyMode: mode,
        companyId: companyEntity.companyId,
        companyName: companyEntity.companyName || undefined,
        companyIndustryHint: companyContext.industryHint,
        companyLocation: companyContext.location,
        companyType: companyContext.companyType,
        companyFeatureTags: companyContext.featureTags.length ? companyContext.featureTags : undefined,
      },
    });
  }

  private async handleTransactionClassification(
    transcript: string,
    classification: VoiceIntentClassification,
  ): Promise<AiVoiceIntent> {
    const action = this.normalizeTransactionAction(
      classification.params.action,
      this.extractTransactionAction(transcript),
    );
    const reply = this.pickFirstString(classification.params.reply) || this.getTransactionFeedback(action);
    const status = this.pickFirstString(classification.params.status) || this.inferTransactionStatus(action);

    return this.withResolvedIntent({
      type: 'transaction',
      transcript,
      param: action,
      feedback: reply,
      transaction: {
        action,
        status: this.isTransactionStatus(status) ? status : undefined,
      },
    }, {
      confidence: classification.confidence,
      slots: {
        transactionAction: action,
        transactionStatus: this.isTransactionStatus(status) ? status : undefined,
      },
      resolved: {
        transactionAction: action,
        transactionStatus: this.isTransactionStatus(status) ? status : undefined,
      },
    });
  }

  private async handleRecommendClassification(
    transcript: string,
    classification: VoiceIntentClassification,
    timing?: AiVoiceTiming,
  ): Promise<AiVoiceIntent> {
    const rawQuery = this.pickFirstString(
      classification.params.query,
      classification.params.categoryHint,
      classification.params.category,
      classification.params.keyword,
      classification.params.param,
    ) || this.extractRecommendQuery(transcript);
    const rawConstraints = this.pickStringArray(classification.params.constraints);
    const rawBudget = this.pickNumber(classification.params.budget) ?? this.extractBudget(transcript);
    const rawRecommendThemes = this.pickRecommendThemes(classification.params.recommendThemes);
    const preferRecommended = true;
    const entityStartedAt = Date.now();
    const refined = await this.refineRecommendIntent(transcript, {
      query: rawQuery,
      constraints: rawConstraints.length > 0 ? rawConstraints : this.extractSearchConstraints(transcript),
      budget: rawBudget,
      recommendThemes: rawRecommendThemes.length > 0 ? rawRecommendThemes : this.extractRecommendThemes(transcript),
      reply: this.pickFirstString(classification.params.reply),
    });
    const constraints = refined.constraints.length > 0 ? refined.constraints : this.extractSearchConstraints(transcript);
    const recommendThemes = refined.recommendThemes.length > 0 ? refined.recommendThemes : this.extractRecommendThemes(transcript);
    const normalizedRecommendQuery = this.normalizeRecommendQuery(refined.query, constraints, recommendThemes);
    const searchEntity = normalizedRecommendQuery
      ? await this.productService.resolveSearchEntity(normalizedRecommendQuery)
      : {
          normalizedKeyword: '',
          matchedCategoryIds: [],
          source: 'none' as const,
        };
    const normalizedQuery = searchEntity.normalizedKeyword || normalizedRecommendQuery;
    this.addTiming(timing, 'entity_resolve_ms', Date.now() - entityStartedAt);
    const feedback = this.buildRecommendFeedback(normalizedQuery, refined.budget, constraints, recommendThemes);
    const slots = this.buildDemandSlots({
      transcript,
      query: normalizedQuery || undefined,
      categoryHint: this.pickFirstString(
        classification.params.categoryHint,
        classification.params.category,
        searchEntity.matchedCategoryName,
      ),
      constraints,
      budget: refined.budget,
      preferRecommended,
      recommendThemes,
      usage: this.pickFirstString(
        classification.params.usage,
        classification.params.scene,
        classification.params.scenario,
      ),
      audience: this.pickFirstString(
        classification.params.audience,
        classification.params.persona,
        classification.params.people,
        classification.params.group,
      ),
      slots: classification.params,
    });

    return this.withResolvedIntent({
      type: 'recommend',
      transcript,
      param: normalizedQuery || this.buildRecommendThemeLabel(recommendThemes) || String(refined.budget || 'recommend'),
      feedback,
      recommend: {
        query: normalizedQuery || undefined,
        matchedCategoryId: searchEntity.matchedCategoryId,
        matchedCategoryName: searchEntity.matchedCategoryName,
        preferRecommended,
        constraints,
        budget: refined.budget,
        recommendThemes,
        slots,
      },
    }, {
      confidence: classification.confidence,
      slots,
      resolved: {
        query: normalizedQuery || undefined,
        matchedCategoryId: searchEntity.matchedCategoryId,
        matchedCategoryName: searchEntity.matchedCategoryName,
        constraints: constraints.length > 0 ? constraints : undefined,
        budget: refined.budget,
        preferRecommended,
        recommendThemes: recommendThemes.length > 0 ? recommendThemes : undefined,
        sortIntent: slots.sortIntent,
        usageScenario: (classification.params?.usageScenario as string) || slots?.usageScenario,
        originPreference: (classification.params?.originPreference as string) || slots?.originPreference,
        dietaryPreference: (classification.params?.dietaryPreference as string) || slots?.dietaryPreference,
        promotionIntent: slots?.promotionIntent,
        bundleIntent: slots?.bundleIntent,
        flavorPreference: (classification.params?.flavorPreference as string) || undefined,
        categoryHint: (classification.params?.categoryHint as string) || undefined,
      },
    });
  }

  private async buildClarifyIntent(
    transcript: string,
    source: 'voice' | 'text',
    classification: VoiceIntentClassification,
  ): Promise<AiVoiceIntent | null> {
    const candidates = await this.buildClarifyCandidates(transcript, source, classification);
    if (candidates.length === 0) {
      return null;
    }

    return this.withResolvedIntent({
      type: 'clarify',
      transcript,
      param: transcript,
      feedback: this.buildClarifyFeedback(candidates),
      clarify: {
        candidates,
      },
    }, {
      confidence: classification.confidence,
      fallbackReason: 'need-clarification',
    });
  }

  private async buildClarifyCandidates(
    transcript: string,
    source: 'voice' | 'text',
    classification: VoiceIntentClassification,
  ): Promise<AiVoiceClarifyCandidate[]> {
    const tentativeClassifications = [
      classification,
      ...this.buildAlternativeClassifications(transcript, classification),
    ];
    const seen = new Set<string>();
    const candidates: AiVoiceClarifyCandidate[] = [];

    for (const candidateClassification of tentativeClassifications) {
      if (candidates.length >= 3) break;
      const resolvedIntent = await this.dispatchClassification(transcript, source, candidateClassification);
      const candidate = this.toClarifyCandidate(resolvedIntent, candidates.length);
      const signature = this.buildClarifyCandidateSignature(candidate);
      if (seen.has(signature)) continue;
      seen.add(signature);
      candidates.push(candidate);
    }

    return candidates;
  }

  private buildAlternativeClassifications(
    transcript: string,
    primary: VoiceIntentClassification,
  ): VoiceIntentClassification[] {
    const alternatives: VoiceIntentClassification[] = [];
    const trimmed = transcript.trim();
    const hasCompanySignal = /店铺|农场|商家|公司|企业|旗舰店/u.test(trimmed);
    const orderPattern = /订单|物流|快递|到哪了|发货|退[款货换]|付款|支付|买单|售后/u;

    const pushAlternative = (candidate: VoiceIntentClassification | null) => {
      if (!candidate) return;
      if (candidate.intent === primary.intent) return;
      alternatives.push(candidate);
    };

    const navigateTarget = this.extractNavigationTarget(trimmed);
    if (navigateTarget) {
      pushAlternative({
        intent: 'navigate',
        params: { target: navigateTarget },
        confidence: 0.55,
        source: 'fallback',
      });
    }

    if (hasCompanySignal) {
      const companyName = this.extractStoreName(trimmed);
      pushAlternative({
        intent: 'company',
        params: {
          name: companyName,
          mode: this.inferCompanyMode(trimmed, companyName),
        },
        confidence: 0.55,
        source: 'fallback',
      });
    }

    const searchKeyword = this.extractSearchKeyword(trimmed);
    const searchThemes = this.extractRecommendThemes(trimmed);
    const searchConstraints = this.extractSearchConstraints(trimmed);
    if (searchKeyword || searchThemes.length > 0 || searchConstraints.length > 0) {
      pushAlternative({
        intent: 'search',
        params: {
          query: searchKeyword,
          constraints: searchConstraints,
          preferRecommended: searchThemes.length > 0,
          recommendThemes: searchThemes,
        },
        confidence: 0.55,
        source: 'fallback',
      });
    }

    if (this.shouldTreatAsRecommend(trimmed) || this.extractBudget(trimmed) || searchThemes.length > 0) {
      pushAlternative({
        intent: 'recommend',
        params: {
          query: this.extractRecommendQuery(trimmed),
          budget: this.extractBudget(trimmed),
          constraints: searchConstraints,
          recommendThemes: searchThemes,
          preferRecommended: true,
        },
        confidence: 0.55,
        source: 'fallback',
      });
    }

    if (orderPattern.test(trimmed)) {
      const action = this.extractTransactionAction(trimmed);
      pushAlternative({
        intent: 'transaction',
        params: {
          action,
          status: this.inferTransactionStatus(action),
          reply: this.getTransactionFeedback(action),
        },
        confidence: 0.55,
        source: 'fallback',
      });
    }

    if (primary.intent !== 'chat') {
      alternatives.push({
        intent: 'chat',
        params: {
          message: transcript,
          reply: '我先按聊天理解，直接回答你这个问题。',
        },
        confidence: 0.5,
        source: 'fallback',
      });
    }

    return alternatives;
  }

  private toClarifyCandidate(intent: AiVoiceIntent, index: number): AiVoiceClarifyCandidate {
    return {
      id: `clarify-${intent.type}-${index}`,
      label: this.buildClarifyCandidateLabel(intent),
      type: intent.type === 'clarify' ? 'chat' : intent.type,
      intent: intent.type === 'clarify' ? 'chat' : intent.type,
      confidence: intent.confidence,
      param: intent.param,
      feedback: intent.feedback,
      slots: intent.slots,
      resolved: intent.resolved,
      fallbackReason: intent.fallbackReason,
      search: intent.search,
      company: intent.company,
      transaction: intent.transaction,
      recommend: intent.recommend,
    };
  }

  private buildClarifyCandidateSignature(candidate: AiVoiceClarifyCandidate): string {
    return [
      candidate.type,
      candidate.param,
      candidate.search?.query || '',
      candidate.company?.mode || '',
      candidate.company?.name || '',
      candidate.transaction?.action || '',
      candidate.recommend?.query || '',
      candidate.recommend?.recommendThemes?.join('|') || '',
    ].join('::');
  }

  private buildClarifyFeedback(candidates: AiVoiceClarifyCandidate[]): string {
    const labels = candidates.slice(0, 3).map((candidate) => `“${candidate.label}”`);
    if (labels.length === 1) {
      return `你是想 ${labels[0]} 吗？`;
    }
    if (labels.length === 2) {
      return `你是想 ${labels[0]}，还是 ${labels[1]}？`;
    }
    return `你是想 ${labels[0]}、${labels[1]}，还是 ${labels[2]}？`;
  }

  private buildClarifyCandidateLabel(intent: AiVoiceIntent): string {
    switch (intent.type) {
      case 'navigate':
        return this.getNavigationFeedback(this.parseNavigateTarget(intent.param) ?? 'home')
          .replace(/^正在为你|^正在带你|^我来帮你/u, '')
          .replace(/\.\.\.$/, '');
      case 'company':
        if (intent.company?.mode === 'list') return '看看有哪些企业';
        if (intent.company?.mode === 'search') return `查找${intent.company?.name || intent.param}相关企业`;
        return `打开${intent.company?.name || intent.param}`;
      case 'transaction':
        return intent.feedback.replace(/^正在为你|^我来帮你|^先带你去/u, '').replace(/\.\.\.$/, '');
      case 'recommend':
        return intent.recommend?.query
          ? `推荐${intent.recommend.query}`
          : `推荐${this.buildRecommendThemeLabel(intent.recommend?.recommendThemes || []) || '相关商品'}`;
      case 'search':
        if (intent.search?.action === 'add-to-cart') {
          return `把${intent.search.matchedProductName || intent.search.query || intent.param}加入购物车`;
        }
        return `搜索${intent.search?.query || intent.param || '商品'}`;
      case 'chat':
      default:
        return '直接回答这个问题';
    }
  }

  private async handleChatClassification(
    transcript: string,
    classification: VoiceIntentClassification,
  ): Promise<AiVoiceIntent> {
    // fallbackReason 分流：针对不同原因给出专门处理
    const fallbackReason = classification.fallbackReason
      || (typeof classification.params.fallbackReason === 'string' ? classification.params.fallbackReason : undefined);

    if (fallbackReason === 'out-of-domain') {
      // 调用 chat 模型做引导式 bridge 回复
      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (apiKey) {
        try {
          const bridgeResult = await this.callSemanticModel(
            apiKey, transcript, OUT_OF_DOMAIN_BRIDGE_PROMPT, this.QWEN_CHAT_MODEL, 8000,
          );
          if (bridgeResult && typeof bridgeResult.reply === 'string') {
            const suggestedActions = Array.isArray(bridgeResult.suggestedActions)
              ? bridgeResult.suggestedActions
                  .filter((a: any) => a && typeof a.type === 'string' && typeof a.label === 'string')
                  .slice(0, 2)
              : [];

            return this.withResolvedIntent({
              type: 'chat',
              transcript,
              param: transcript,
              feedback: bridgeResult.reply,
              chatResponse: { reply: bridgeResult.reply, suggestedActions },
            }, {
              confidence: classification.confidence,
              fallbackReason: 'out-of-domain',
            });
          }
        } catch (err) {
          this.logger.error(`[ChatFallback] out-of-domain bridge 调用失败：${err.message}`);
        }
      }
      // bridge 失败回退
      return this.withResolvedIntent({
        type: 'chat',
        transcript,
        param: transcript,
        feedback: '这个问题超出了我的专业范围。需要我帮你找点好吃的吗？',
      }, {
        confidence: classification.confidence,
        fallbackReason: 'out-of-domain',
      });
    }

    if (fallbackReason === 'too-vague') {
      return this.withResolvedIntent({
        type: 'chat',
        transcript,
        param: transcript,
        feedback: '你想找什么类型的商品呢？可以告诉我品类、用途或口味偏好',
      }, {
        confidence: classification.confidence,
        fallbackReason: 'too-vague',
      });
    }

    if (fallbackReason === 'unsafe') {
      return this.withResolvedIntent({
        type: 'chat',
        transcript,
        param: transcript,
        feedback: '这个问题我不太方便回答。需要我帮你找点好吃的吗？',
      }, {
        confidence: classification.confidence,
        fallbackReason: 'unsafe',
      });
    }

    // 无 fallbackReason：走现有 chat 逻辑
    const reply = this.pickFirstString(
      classification.params.reply,
      classification.params.feedback,
      classification.params.message,
    ) || '我来帮你处理这个问题。';

    return this.withResolvedIntent({
      type: 'chat',
      transcript,
      param: transcript,
      feedback: reply,
    }, {
      confidence: classification.confidence,
    });
  }

  private pickFirstString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return '';
  }

  private pickStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private pickRecommendThemes(value: unknown): AiRecommendTheme[] {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];

    return Array.from(new Set(
      values
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item): item is AiRecommendTheme => this.RECOMMEND_THEMES.includes(item as AiRecommendTheme)),
    ));
  }

  private pickBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }
    return false;
  }

  private pickNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return undefined;
  }

  private parseNavigateTarget(value: unknown): AiVoiceNavigateTarget | null {
    if (typeof value !== 'string') return null;
    return VALID_NAVIGATE_TARGETS.includes(value as AiVoiceNavigateTarget)
      ? (value as AiVoiceNavigateTarget)
      : null;
  }

  private extractTransactionAction(text: string): AiVoiceTransactionAction {
    const compact = text
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();

    return this.normalizeTransactionAction(compact);
  }

  private normalizeTransactionAction(...values: unknown[]): AiVoiceTransactionAction {
    const merged = values
      .filter((value) => typeof value === 'string')
      .join(' ')
      .replace(/\s+/g, '')
      .toLowerCase();

    if (/(?:after-sale|售后)/u.test(merged)) return 'after-sale';
    if (/(?:refund|退款|退钱)/u.test(merged)) return 'refund';
    if (/(?:return|退货)/u.test(merged)) return 'return';
    if (/(?:exchange|换货)/u.test(merged)) return 'exchange';
    if (/(?:pay-order|pay|付款|支付|买单)/u.test(merged)) return 'pay';
    if (/(?:track-order|tracking|物流|快递|发货|到哪了)/u.test(merged)) return 'track-order';
    if (/(?:view-order|order-list|订单|查订单|我的订单)/u.test(merged)) return 'view-order';

    return 'transaction';
  }

  private inferTransactionStatus(action: AiVoiceTransactionAction): 'pendingPay' | 'shipping' | 'afterSale' | undefined {
    switch (action) {
      case 'pay':
        return 'pendingPay';
      case 'track-order':
        return 'shipping';
      case 'refund':
      case 'return':
      case 'exchange':
      case 'after-sale':
        return 'afterSale';
      default:
        return undefined;
    }
  }

  private isTransactionStatus(value: unknown): value is 'pendingPay' | 'pendingShip' | 'shipping' | 'afterSale' {
    return value === 'pendingPay' || value === 'pendingShip' || value === 'shipping' || value === 'afterSale';
  }

  private getTransactionFeedback(action: AiVoiceTransactionAction): string {
    const feedbackMap: Record<AiVoiceTransactionAction, string> = {
      refund: '我来帮你处理退款相关问题。',
      return: '我来帮你处理退货相关问题。',
      exchange: '我来帮你处理换货相关问题。',
      'after-sale': '我来帮你处理售后相关问题。',
      pay: '我来帮你看看付款相关操作。',
      'track-order': '正在为你查询订单物流信息...',
      'view-order': '正在为你查询订单相关信息...',
      transaction: '我来帮你处理订单相关操作。',
    };

    return feedbackMap[action] || feedbackMap.transaction;
  }

  /**
   * 从搜索语句中提取关键词
   * 去除常见填充词，保留核心搜索词
   */
  private extractSearchKeyword(text: string): string {
    const compact = text
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();

    const extractionPatterns = [
      /^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:找|搜(?:索)?|查|看)(?:一下|一找|一看|一搜)?(.+)$/u,
      /^(?:你)?(?:有没有|哪里有)(.+?)(?:吗|呢|啊|呀|吧|嘛|哦)?$/u,
      /^(?:我)?(?:想买|想要|要买|要|来点|推荐(?:一下)?)(.+)$/u,
    ];

    for (const pattern of extractionPatterns) {
      const match = compact.match(pattern);
      if (!match?.[1]) continue;
      const keyword = this.cleanupSearchKeyword(match[1]);
      if (keyword) return keyword;
    }

    // 回退到宽松删词，但最后仍做一次关键词清洗，避免残留口语噪声
    const fillerWords = /你有没有|我想|我要|请|帮我|给我|搜一下|搜索|搜|找一下|找|有没有|想买|来点|哪里有|推荐一下|推荐|一些|一点|的|吗|呢|啊|吧|了|呀/g;
    return this.cleanupSearchKeyword(compact.replace(fillerWords, ''));
  }

  /** 清理搜索关键词中的口语残留，避免出现“你鸡蛋”“这个苹果”这类噪声关键词 */
  private cleanupSearchKeyword(keyword: string): string {
    let cleaned = keyword
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();

    cleaned = cleaned.replace(/^(?:看看|看下|看一下|查查|搜搜|找找)+/u, '');
    cleaned = cleaned.replace(/^(?:看|查|搜|找)(?=(?:今天|现在|目前|最近|有没有|有没?有|有什么|哪些|哪里有|什么|哪种|哪类))/u, '');
    cleaned = cleaned.replace(/^(?:(?:今天|现在|目前|最近)(?:都)?(?:有没有|有没?有|有什么|哪些|哪里有)?)/u, '');
    cleaned = cleaned.replace(/^(?:有没有|有没?有|有什么|哪些|哪里有)/u, '');
    cleaned = cleaned.replace(/^(?:什么|哪些|哪种|哪类)/u, '');
    cleaned = cleaned.replace(/^(?:这个|那个|这款|那款)/u, '');
    cleaned = cleaned.replace(/(?:吗|呢|啊|呀|吧|嘛|哦)+$/u, '');
    cleaned = cleaned.replace(/^(?:你|我)(?=[\u4e00-\u9fa5]{2,})/u, '');

    return cleaned.trim();
  }

  /** 从搜索语句中抽取常见约束，作为结构化筛选信号传给搜索层 */
  private extractSearchConstraints(text: string): string[] {
    const normalized = text.replace(/\s+/g, '');
    const constraints = new Set<string>();

    if (/有机/u.test(normalized)) constraints.add('organic');
    if (/低糖|控糖/u.test(normalized)) constraints.add('low-sugar');
    if (/当季|应季/u.test(normalized)) constraints.add('seasonal');
    if (/溯源|可溯源|可信溯源/u.test(normalized)) constraints.add('traceable');
    if (/冷链/u.test(normalized)) constraints.add('cold-chain');
    if (/地理标志/u.test(normalized)) constraints.add('geo-certified');
    if (/健康|轻食/u.test(normalized)) constraints.add('healthy');
    if (/新鲜|鲜活|鲜采/u.test(normalized)) constraints.add('fresh');

    return Array.from(constraints);
  }

  private buildDemandSlots(input: {
    transcript: string;
    query?: string;
    categoryHint?: string;
    constraints?: string[];
    usage?: string;
    audience?: string;
    budget?: number;
    preferRecommended?: boolean;
    recommendThemes?: AiRecommendTheme[];
    slots?: Record<string, any>;
  }): AiVoiceDemandSlots {
    const query = this.cleanupSearchKeyword(input.query || '');
    const categoryHint = this.cleanupSearchKeyword(input.categoryHint || '') || undefined;
    const constraints = (input.constraints || []).filter(Boolean);
    const recommendThemes = (input.recommendThemes || []).filter(Boolean);
    const extractedUsage = this.normalizeDemandSlotText(input.usage) || this.extractUsageHint(input.transcript);
    const audience = this.normalizeDemandSlotText(input.audience) || this.extractAudienceHint(input.transcript);
    const sortIntent = this.inferSortIntent(input.preferRecommended, recommendThemes);

    // 语义槽位透传：新增字段从 slots 中读取
    const usageScenario = this.normalizeDemandSlotText(input.slots?.usageScenario) || extractedUsage;
    const originPreference = this.normalizeDemandSlotText(input.slots?.originPreference);
    const dietaryPreference = this.normalizeDemandSlotText(input.slots?.dietaryPreference);
    const freshness = this.normalizeDemandSlotText(input.slots?.freshness);
    const flavorPreference = this.normalizeDemandSlotText(input.slots?.flavorPreference);
    const promotionIntent = input.slots?.promotionIntent === 'threshold-optimization' || input.slots?.promotionIntent === 'best-deal'
      ? input.slots.promotionIntent as 'threshold-optimization' | 'best-deal'
      : undefined;
    const bundleIntent = input.slots?.bundleIntent === 'meal-kit' || input.slots?.bundleIntent === 'complement'
      ? input.slots.bundleIntent as 'meal-kit' | 'complement'
      : undefined;

    return {
      ...(query ? { query } : {}),
      ...(categoryHint ? { categoryHint } : {}),
      ...(constraints.length > 0 ? { constraints } : {}),
      ...(extractedUsage ? { usage: extractedUsage } : {}),
      ...(usageScenario ? { usageScenario } : {}),
      ...(audience ? { audience } : {}),
      ...(typeof input.budget === 'number' && input.budget > 0 ? { budget: input.budget } : {}),
      ...(input.preferRecommended ? { preferRecommended: true } : {}),
      ...(recommendThemes.length > 0 ? { recommendThemes } : {}),
      ...(originPreference ? { originPreference } : {}),
      ...(dietaryPreference ? { dietaryPreference } : {}),
      ...(freshness ? { freshness } : {}),
      ...(flavorPreference ? { flavorPreference } : {}),
      ...(promotionIntent ? { promotionIntent } : {}),
      ...(bundleIntent ? { bundleIntent } : {}),
      sortIntent,
    };
  }

  private normalizeDemandSlotText(value?: string): string | undefined {
    if (!value) return undefined;
    const normalized = value
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();
    return normalized || undefined;
  }

  private extractUsageHint(text: string): string | undefined {
    const compact = text.replace(/\s+/g, '');
    const usagePatterns: Array<[RegExp, string]> = [
      [/早餐|早饭|早点/u, '早餐'],
      [/午餐|中饭/u, '午餐'],
      [/晚餐|晚饭/u, '晚餐'],
      [/夜宵/u, '夜宵'],
      [/做菜|炒菜|做饭|下饭/u, '做菜'],
      [/煲汤|炖汤/u, '煲汤'],
      [/火锅/u, '火锅'],
      [/零食|解馋/u, '零食'],
      [/送礼|礼盒|送人/u, '送礼'],
      [/减脂|健身|控卡/u, '减脂'],
      [/补蛋白/u, '补蛋白'],
    ];

    for (const [pattern, label] of usagePatterns) {
      if (pattern.test(compact)) {
        return label;
      }
    }
    return undefined;
  }

  private extractAudienceHint(text: string): string | undefined {
    const compact = text.replace(/\s+/g, '');
    const audiencePatterns: Array<[RegExp, string]> = [
      [/孩子|小孩|宝宝|儿童/u, '儿童'],
      [/老人|长辈/u, '老人'],
      [/孕妇|宝妈/u, '孕妇'],
      [/家里人|全家|一家人/u, '家庭'],
      [/自己|我自己|我吃/u, '个人'],
    ];

    for (const [pattern, label] of audiencePatterns) {
      if (pattern.test(compact)) {
        return label;
      }
    }
    return undefined;
  }

  private inferSortIntent(
    preferRecommended?: boolean,
    recommendThemes: AiRecommendTheme[] = [],
  ): AiVoiceSortIntent {
    if (recommendThemes.includes('hot')) return 'hot';
    if (recommendThemes.includes('discount')) return 'discount';
    if (recommendThemes.includes('tasty')) return 'tasty';
    if (recommendThemes.includes('seasonal')) return 'seasonal';
    if (recommendThemes.includes('recent')) return 'recent';
    if (preferRecommended) return 'recommended';
    return 'default';
  }

  private shouldTreatAsRecommend(text: string): boolean {
    const compact = text.replace(/\s+/g, '');
    if (!compact) return false;
    if (/有没有推荐的/u.test(compact)) return false;
    if (/(?:预算|块钱|元钱|元以内|预算内)/u.test(compact)) return true;
    if (/(?:买什么|吃什么|选什么|怎么选|怎么搭配|帮我搭配|给我搭配)/u.test(compact)) return true;
    if (/(?:推荐点|推荐些|推荐一下|给我推荐|帮我推荐|推荐给我)/u.test(compact)) return true;
    if (/^推荐/u.test(compact)) return true;
    return false;
  }

  private extractRecommendQuery(text: string): string {
    const compact = text
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();

    const withoutBudget = compact
      .replace(/预算\d+(?:\.\d+)?(?:元|块钱|块)?(?:以内|左右|上下)?/gu, '')
      .replace(/\d+(?:\.\d+)?(?:元|块钱|块)(?:以内|左右|上下)?/gu, '')
      .replace(/^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:推荐(?:点|些|一下)?|搭配(?:一下)?)/u, '')
      .replace(/(?:买什么|吃什么|选什么|怎么选|怎么搭配)$/u, '');

    const query = this.extractSearchKeyword(withoutBudget);
    const cleaned = query === withoutBudget ? this.cleanupSearchKeyword(withoutBudget) : query;
    if (/^(?:买什么|吃什么|选什么|怎么选|怎么搭配)$/u.test(cleaned)) {
      return '';
    }
    return cleaned;
  }

  private extractBudget(text: string): number | undefined {
    const compact = text.replace(/\s+/g, '');
    const match = compact.match(/(?:预算)?(\d+(?:\.\d+)?)(?:元|块钱|块)?(?:以内|左右|上下)?/u);
    if (!match?.[1]) return undefined;
    const budget = Number(match[1]);
    if (!Number.isFinite(budget) || budget <= 0) return undefined;
    return Math.round(budget * 100) / 100;
  }

  private extractRecommendThemes(text: string): AiRecommendTheme[] {
    const normalized = text.replace(/\s+/g, '');
    const themes = new Set<AiRecommendTheme>();

    if (/(?:爆款|热销|热门|畅销|人气|招牌|必买|值得买)/u.test(normalized)) themes.add('hot');
    if (/(?:折扣|优惠|特价|特惠|省钱|便宜|促销|秒杀|活动价)/u.test(normalized)) themes.add('discount');
    if (/(?:好吃|好喝|美味|鲜甜|香甜|脆甜|鲜美|回甘|口感|下饭|香的)/u.test(normalized)) themes.add('tasty');
    if (/(?:当季|应季|时令)/u.test(normalized)) themes.add('seasonal');
    if (/(?:最近|近期|新品|新上|上新|最新)/u.test(normalized)) themes.add('recent');

    return Array.from(themes);
  }

  private normalizeRecommendQuery(query: string, constraints: string[], recommendThemes: AiRecommendTheme[]): string {
    let normalized = this.cleanupSearchKeyword(query);
    if (!normalized) return '';

    const removablePatterns: RegExp[] = [];
    if (constraints.includes('organic')) removablePatterns.push(/有机/u);
    if (constraints.includes('low-sugar')) removablePatterns.push(/低糖|控糖/u);
    if (constraints.includes('seasonal')) removablePatterns.push(/当季|应季/u);
    if (constraints.includes('traceable')) removablePatterns.push(/溯源|可溯源|可信溯源/u);
    if (constraints.includes('cold-chain')) removablePatterns.push(/冷链/u);
    if (constraints.includes('geo-certified')) removablePatterns.push(/地理标志/u);
    if (constraints.includes('healthy')) removablePatterns.push(/健康|轻食/u);
    if (constraints.includes('fresh')) removablePatterns.push(/新鲜|鲜活|鲜采/u);
    if (recommendThemes.includes('hot')) removablePatterns.push(/爆款|热销|热门|畅销|人气|招牌|必买|值得买/u);
    if (recommendThemes.includes('discount')) removablePatterns.push(/折扣|优惠|特价|特惠|省钱|便宜|促销|秒杀|活动价/u);
    if (recommendThemes.includes('tasty')) removablePatterns.push(/好吃|好喝|美味|鲜甜|香甜|脆甜|鲜美|回甘|口感|下饭/u);
    if (recommendThemes.includes('seasonal')) removablePatterns.push(/当季|应季|时令/u);
    if (recommendThemes.includes('recent')) removablePatterns.push(/最近|近期|新品|新上|上新|最新/u);

    removablePatterns.forEach((pattern) => {
      normalized = normalized.replace(pattern, '');
    });

    normalized = normalized
      .replace(/^(?:我今天有钱|今天有钱|我有钱|有钱|今天|今日|现在|最近|近期|我今天有|今天有|我有|有|推荐我|给我|帮我)+/u, '')
      .replace(/(?:推荐我|给我推荐|帮我推荐)+$/u, '')
      .replace(/(?:买什么|吃什么|选什么|怎么选|怎么搭配)$/u, '');

    normalized = this.cleanupSearchKeyword(normalized);
    if (!normalized) return '';
    if (/^(?:我|你|今天|今日|现在|最近|近期|什么|东西|商品|食物|吃的|好物|爆款|折扣商品|优惠商品|推荐|钱|钱我|预算)$/u.test(normalized)) return '';
    return normalized;
  }

  private buildRecommendThemeLabel(recommendThemes: AiRecommendTheme[]): string {
    const themeLabelMap: Record<AiRecommendTheme, string> = {
      hot: '爆款',
      discount: '折扣',
      tasty: '好吃的',
      seasonal: '当季',
      recent: '最近热门',
    };

    return recommendThemes.map((theme) => themeLabelMap[theme]).filter(Boolean).join('、');
  }

  private buildRecommendFeedback(
    query: string,
    budget?: number,
    constraints: string[] = [],
    recommendThemes: AiRecommendTheme[] = [],
  ): string {
    const constraintLabelMap: Record<string, string> = {
      organic: '有机',
      'low-sugar': '低糖',
      seasonal: '当季',
      traceable: '可溯源',
      'cold-chain': '冷链',
      'geo-certified': '地理标志',
      healthy: '健康',
      fresh: '新鲜',
    };
    const localizedConstraints = constraints.map((constraint) => constraintLabelMap[constraint] || constraint);
    const constraintText = localizedConstraints.length > 0 ? `${localizedConstraints.join('、')} ` : '';
    const themeText = this.buildRecommendThemeLabel(recommendThemes);
    const descriptor = `${themeText ? `${themeText} ` : ''}${constraintText}`.trim();
    const descriptorPrefix = descriptor ? `${descriptor}` : '';

    if (query && budget) {
      return `正在按 ¥${budget} 预算为你推荐${descriptorPrefix ? `${descriptorPrefix} ` : ''}${query}...`;
    }
    if (query) {
      return `正在为你推荐${descriptorPrefix ? `${descriptorPrefix} ` : ''}${query}...`;
    }
    if (budget) {
      return `正在按 ¥${budget} 预算为你挑选推荐商品...`;
    }
    if (themeText) {
      return `正在为你挑选${themeText}商品...`;
    }
    if (constraints.length > 0) {
      return `正在按你的偏好为你挑选推荐商品...`;
    }
    return '我来根据你的偏好给你推荐一下。';
  }

  /** 从语音指令中提取页面跳转目标，只允许白名单页面 */
  private extractNavigationTarget(text: string): AiVoiceNavigateTarget | null {
    const compact = text
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();

    const hasNavigationVerb = /(?:打开|去|前往|进入|跳到|跳转到|带我去|带我到|回到|返回|切到|切换到|带我打开)/u.test(compact);

    if (/(?:AI聊天|AI对话|AI农管家|农管家|聊天页|对话页|助手页)/u.test(compact)) return 'ai-chat';
    if (/(?:设置|系统设置|账号设置)/u.test(compact) && hasNavigationVerb) return 'settings';
    if (/(?:购物车|购物袋|购物篮)/u.test(compact) && hasNavigationVerb) return 'cart';
    if (/(?:结算|付款|买单|提交订单)/u.test(compact) && hasNavigationVerb) return 'checkout';
    if (/(?:我的订单|订单页|订单列表)/u.test(compact) && hasNavigationVerb) return 'orders';
    if (/(?:首页|主页|回首页|主页面)/u.test(compact)) return 'home';
    if (/(?:发现页|发现|逛逛)/u.test(compact) && hasNavigationVerb) return 'discover';
    if (/(?:我的页面|个人中心|我的主页|我的)/u.test(compact) && hasNavigationVerb) return 'me';
    if (/(?:搜索页|搜索页面|搜索)/u.test(compact) && hasNavigationVerb) return 'search';

    return null;
  }

  /** 生成导航意图的用户反馈 */
  private getNavigationFeedback(target: AiVoiceNavigateTarget): string {
    const feedbackMap: Record<AiVoiceNavigateTarget, string> = {
      home: '正在带你回首页...',
      discover: '正在带你去发现页...',
      me: '正在打开我的页面...',
      settings: '正在打开设置...',
      cart: '正在为你打开购物车...',
      checkout: '正在带你去结算...',
      orders: '正在打开订单列表...',
      search: '正在打开搜索页面...',
      'ai-chat': '正在打开 AI 对话...',
    };

    return feedbackMap[target];
  }

  /** 判断当前语音搜索是否需要语义改写 */
  private shouldRewriteVoiceSearchKeyword(transcript: string, keyword: string): boolean {
    const normalizedTranscript = transcript.replace(/[“”"'`，。！？,.!?\s]/g, '').trim();
    const normalizedKeyword = keyword.replace(/[“”"'`，。！？,.!?\s]/g, '').trim();

    if (!normalizedKeyword) return true;
    if (normalizedTranscript === normalizedKeyword) return false;
    if (normalizedTranscript.endsWith(normalizedKeyword) && normalizedKeyword.length >= 2) return true;
    return normalizedTranscript.length !== normalizedKeyword.length;
  }

  /** 使用 Qwen 对语音搜索关键词做语义改写，避免被口语前缀或 ASR 幻听干扰 */
  private async rewriteVoiceSearchKeyword(transcript: string, extractedKeyword: string): Promise<string> {
    const shouldRewrite = this.shouldRewriteVoiceSearchKeyword(transcript, extractedKeyword);
    if (!shouldRewrite) {
      this.logger.log(`[VoiceSearch] skip-rewrite transcript="${this.redactTranscript(transcript)}" extracted="${extractedKeyword}"`);
      return extractedKeyword;
    }

    this.logger.log(`[VoiceSearch] rewrite-request model=${this.QWEN_SEARCH_REWRITE_MODEL} transcript="${this.redactTranscript(transcript)}" extracted="${extractedKeyword}"`);

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      this.logger.warn('DASHSCOPE_API_KEY 未设置，跳过语音搜索关键词重写');
      return extractedKeyword;
    }

    const systemPrompt = `你是农脉App的语音搜索改写器。任务是把语音转写内容改写成最适合商品搜索的核心关键词。

要求：
1. 只保留用户真正想搜的商品/品类/属性关键词
2. 删除口语前缀、语气词、误识别噪声词、与商品无关的词
3. 不要解释，不要补充句子
4. 严格只返回 JSON：{"keyword":"关键词"}

示例：
- "找一找鸡蛋" -> {"keyword":"鸡蛋"}
- "你有没有鸡蛋" -> {"keyword":"鸡蛋"}
- "世界杯帮我找一找鸡蛋" -> {"keyword":"鸡蛋"}
- "帮也帮我找一找鸡蛋" -> {"keyword":"鸡蛋"}
- "帮我找有机土鸡蛋" -> {"keyword":"有机土鸡蛋"}`;

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
          model: this.QWEN_SEARCH_REWRITE_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `transcript=${transcript}\ncurrent_keyword=${extractedKeyword || '(empty)'}` },
          ],
          temperature: 0.1,
          max_tokens: 80,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`Qwen 搜索词重写失败：${response.status} ${errText}`);
        return extractedKeyword;
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        this.logger.warn(`[VoiceSearch] rewrite-empty-response transcript="${this.redactTranscript(transcript)}" extracted="${extractedKeyword}"`);
        return extractedKeyword;
      }

      this.logger.log(`[VoiceSearch] rewrite-raw content=${JSON.stringify(content).slice(0, 500)}`);

      const jsonStr = content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const rewritten = this.cleanupSearchKeyword(parsed?.keyword || '');

      if (!rewritten) {
        this.logger.warn(`[VoiceSearch] rewrite-empty-keyword transcript="${this.redactTranscript(transcript)}" extracted="${extractedKeyword}"`);
        return extractedKeyword;
      }

      this.logger.log(`Qwen 搜索词重写："${this.redactTranscript(transcript)}" -> "${rewritten}"（原提取="${extractedKeyword}"）`);
      return rewritten;
    } catch (err) {
      this.logger.error(`Qwen 搜索词重写异常：${err.message}`);
      this.logger.warn(`[VoiceSearch] rewrite-fallback transcript="${this.redactTranscript(transcript)}" extracted="${extractedKeyword}"`);
      return extractedKeyword;
    }
  }

  private async refineRecommendIntent(
    transcript: string,
    fallback: {
      query: string;
      constraints: string[];
      budget?: number;
      recommendThemes: AiRecommendTheme[];
      reply?: string;
    },
  ): Promise<{
    query: string;
    constraints: string[];
    budget?: number;
    recommendThemes: AiRecommendTheme[];
    reply: string;
  }> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const fallbackReply = fallback.reply || this.buildRecommendFeedback(
      fallback.query,
      fallback.budget,
      fallback.constraints,
      fallback.recommendThemes,
    );
    if (!apiKey) {
      return {
        query: fallback.query,
        constraints: fallback.constraints,
        budget: fallback.budget,
        recommendThemes: fallback.recommendThemes,
        reply: fallbackReply,
      };
    }

    const systemPrompt = `你是农脉App的推荐需求解析器。你的任务是把用户的推荐请求改写成结构化推荐参数。

严格只返回 JSON，不要输出其他内容：
{"query":"","constraints":[],"budget":0,"recommendThemes":[],"reply":""}

规则：
1. query 只保留用户想看的商品品类或核心关键词，没有就返回空字符串
2. constraints 只允许输出英文枚举：organic, low-sugar, seasonal, traceable, cold-chain, geo-certified, healthy, fresh
3. recommendThemes 只允许输出英文枚举：hot, discount, tasty, seasonal, recent
4. budget 输出数字；没有预算就输出 0
5. reply 用一句中文自然回复，适合直接展示给用户
6. 不要编造具体商品名，不要输出多余字段

示例：
- "推荐点海鲜给我" -> {"query":"海鲜","constraints":[],"budget":0,"recommendThemes":[],"reply":"正在为你推荐海鲜..."}
- "我今天有100块钱，推荐我买什么" -> {"query":"","constraints":[],"budget":100,"recommendThemes":[],"reply":"正在按 ¥100 预算为你挑选推荐商品..."}
- "推荐一些低糖水果" -> {"query":"水果","constraints":["low-sugar"],"budget":0,"recommendThemes":[],"reply":"正在为你推荐低糖水果..."}
- "推荐今天的爆款" -> {"query":"","constraints":[],"budget":0,"recommendThemes":["hot"],"reply":"正在为你挑选今天的爆款商品..."}
- "推荐最近好吃的食物" -> {"query":"","constraints":[],"budget":0,"recommendThemes":["recent","tasty"],"reply":"正在为你挑选最近好吃的商品..."}
- "推荐今天的折扣商品" -> {"query":"","constraints":[],"budget":0,"recommendThemes":["discount"],"reply":"正在为你挑选折扣商品..."}`
;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.QWEN_RECOMMEND_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                `transcript=${transcript}\n` +
                `fallback_query=${fallback.query || '(empty)'}\n` +
                `fallback_constraints=${fallback.constraints.join(',') || '(none)'}\n` +
                `fallback_budget=${fallback.budget ?? 0}\n` +
                `fallback_recommendThemes=${fallback.recommendThemes.join(',') || '(none)'}`,
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
        this.logger.error(`Qwen 推荐解析失败：${response.status} ${errText}`);
        return {
          query: fallback.query,
          constraints: fallback.constraints,
          budget: fallback.budget,
          recommendThemes: fallback.recommendThemes,
          reply: fallbackReply,
        };
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        return {
          query: fallback.query,
          constraints: fallback.constraints,
          budget: fallback.budget,
          recommendThemes: fallback.recommendThemes,
          reply: fallbackReply,
        };
      }

      const jsonStr = content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const query = this.cleanupSearchKeyword(this.pickFirstString(parsed.query, fallback.query));
      const constraints = this.pickStringArray(parsed.constraints).filter((constraint) =>
        ['organic', 'low-sugar', 'seasonal', 'traceable', 'cold-chain', 'geo-certified', 'healthy', 'fresh'].includes(constraint),
      );
      const recommendThemes = this.pickRecommendThemes(parsed.recommendThemes);
      const budget = this.pickNumber(parsed.budget) ?? fallback.budget;
      const normalizedRecommendThemes = recommendThemes.length > 0 ? recommendThemes : fallback.recommendThemes;
      const reply = this.pickFirstString(parsed.reply) || this.buildRecommendFeedback(query, budget, constraints, normalizedRecommendThemes);

      return {
        query,
        constraints: constraints.length > 0 ? constraints : fallback.constraints,
        budget,
        recommendThemes: normalizedRecommendThemes,
        reply,
      };
    } catch (err) {
      this.logger.error(`Qwen 推荐解析异常：${err.message}`);
      return {
        query: fallback.query,
        constraints: fallback.constraints,
        budget: fallback.budget,
        recommendThemes: fallback.recommendThemes,
        reply: fallbackReply,
      };
    }
  }

  /** 从店铺查询语句中提取店铺名 */
  private extractStoreName(text: string): string {
    const compact = text
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?]/g, '')
      .replace(/\s+/g, '')
      .trim();
    const extractionPatterns = [
      /^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:找|查(?:一下)?|看(?:一下)?|搜(?:索)?|打开|进入|去|逛逛)(.+)$/u,
      /^(?:有(?:没)?有|哪里有)(.+?)(?:吗|呢|啊|呀|吧|嘛|哦)?$/u,
    ];

    for (const pattern of extractionPatterns) {
      const match = compact.match(pattern);
      if (!match?.[1]) continue;
      const cleaned = this.cleanupStoreName(match[1]);
      if (cleaned) return cleaned;
    }

    return this.cleanupStoreName(compact);
  }

  private inferCompanyMode(text: string, companyName: string): AiVoiceCompanyMode {
    if (this.isCompanyListRequest(text, companyName)) return 'list';
    if (/相关(?:企业|公司|商家|店铺|农场|旗舰店)|搜索.+(?:企业|公司|商家|店铺|农场|旗舰店)/u.test(text)) {
      return companyName ? 'search' : 'list';
    }
    return companyName ? 'detail' : 'list';
  }

  private normalizeCompanyMode(
    value: unknown,
    transcript: string,
    companyName: string,
    hasListFilters = false,
  ): AiVoiceCompanyMode {
    if (hasListFilters) {
      return 'list';
    }
    if (
      companyName
      && /^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:打开|进入|去|查看|看看|看看这个|打开这个)/u.test(transcript.replace(/\s+/g, ''))
      && !this.isCompanyListRequest(transcript, companyName)
    ) {
      return 'detail';
    }
    if (value === 'list' || value === 'detail' || value === 'search') {
      if (value !== 'list' && !companyName) return 'list';
      return value;
    }
    return this.inferCompanyMode(transcript, companyName);
  }

  private isCompanyListRequest(text: string, companyName: string): boolean {
    if (!companyName) return true;

    const compact = text.replace(/\s+/g, '');
    if (
      /(?:现在|目前|最近|这边|这里|附近|周边)?(?:都)?(?:有哪(?:些|家)|有哪些|有什么|什么)(?:店铺|农场|商家|公司|企业|旗舰店)/u.test(compact)
      || /(?:看看|看下|看一下|逛逛|浏览)(?:.*)?(?:店铺|农场|商家|公司|企业|旗舰店)/u.test(compact)
      || /^(?:打开|进入|去)(?:看看|逛逛)?(?:店铺|农场|商家|公司|企业|旗舰店)$/u.test(compact)
    ) {
      return true;
    }

    return false;
  }

  private getCompanyFeedback(
    mode: AiVoiceCompanyMode,
    companyName: string,
    companyContext?: {
      industryHint?: string;
      location?: string;
      companyType?: string;
      featureTags?: string[];
    },
  ): string {
    const summaryParts = [
      companyContext?.location,
      companyContext?.industryHint,
      companyContext?.companyType ? this.getCompanyTypeLabel(companyContext.companyType) : '',
      ...(companyContext?.featureTags || []),
    ].filter(Boolean);
    const demandSummary = summaryParts.join(' ');

    if (mode === 'list') {
      return demandSummary ? `先带你看看${demandSummary}相关的农场和企业...` : '先带你去看看农场和企业...';
    }
    if (mode === 'search') {
      return companyName ? `先为你查找"${companyName}"相关企业...` : '先带你去看看农场和企业...';
    }
    return companyName ? `正在为你打开"${companyName}"...` : '先带你去看看农场和企业...';
  }

  private getCompanyTypeLabel(type?: string): string {
    switch (type) {
      case 'farm': return '农场';
      case 'company': return '企业';
      case 'cooperative': return '合作社';
      case 'base': return '基地';
      case 'factory': return '工厂';
      case 'store': return '店铺';
      default: return '';
    }
  }

  private buildCompanyContext(
    transcript: string,
    params: Record<string, unknown>,
    rawCompanyName: string,
    mode: AiVoiceCompanyMode,
  ) {
    const directIndustry = this.cleanupStoreName(this.pickFirstString(
      params.industryHint,
      params.categoryHint,
      params.category,
      params.business,
      params.mainBusiness,
    ));
    const directLocation = this.cleanupStoreName(this.pickFirstString(
      params.location,
      params.region,
      params.city,
      params.district,
      params.area,
    ));
    const directCompanyType = this.normalizeCompanyType(
      this.pickFirstString(params.companyType, params.type),
      transcript,
    );
    const directFeatureTags = this.pickStringArray(params.featureTags ?? params.tags ?? params.features);

    const inferredIndustry = this.extractCompanyIndustryHint(transcript);
    const inferredLocation = this.extractCompanyLocationHint(transcript);
    const inferredCompanyType = this.extractCompanyTypeHint(transcript);
    const inferredFeatureTags = this.extractCompanyFeatureTags(transcript);

    const shouldUseRawNameAsIndustry = mode === 'list'
      && !!rawCompanyName
      && this.shouldTreatCompanyNameAsIndustry(transcript, rawCompanyName);

    const normalizedRawName = this.cleanupCompanyQueryName(transcript, rawCompanyName, mode);
    const companyName = shouldUseRawNameAsIndustry ? '' : normalizedRawName;
    const industryHint = directIndustry || (shouldUseRawNameAsIndustry ? rawCompanyName : '') || inferredIndustry || undefined;
    const location = directLocation || inferredLocation || undefined;
    const companyType = directCompanyType || inferredCompanyType || undefined;
    const featureTags = Array.from(new Set([...(directFeatureTags || []), ...(inferredFeatureTags || [])])).filter(Boolean);

    return {
      companyName,
      industryHint,
      location,
      companyType,
      featureTags,
    };
  }

  private normalizeCompanyType(value: string, transcript: string): 'farm' | 'company' | 'cooperative' | 'base' | 'factory' | 'store' | undefined {
    if (value === 'farm' || value === 'cooperative' || value === 'base' || value === 'factory' || value === 'store') {
      return value;
    }
    // “公司/企业/商家”在自然语言里通常只是泛称，不应作为强筛选条件。
    if (value === 'company') return undefined;
    return this.extractCompanyTypeHint(transcript) || undefined;
  }

  private extractCompanyIndustryHint(text: string): string {
    const match = text.match(/(?:卖|做|主营|经营|种|养|生产|做?的)(.+?)(?:的)?(?:公司|企业|农场|店铺|合作社|基地|工厂)/u);
    if (!match?.[1]) return '';
    return this.cleanupStoreName(match[1]).replace(/^(?:现在|目前|最近|都|还|在|有|有没有|什么|哪些)/u, '').trim();
  }

  private extractCompanyLocationHint(text: string): string {
    const match = text.match(/((?:北京|上海|天津|重庆|武汉|杭州|南京|广州|深圳|成都|西安|苏州|长沙|郑州|合肥|昆明|福州|厦门|青岛|宁波|无锡|常州|南通|佛山|东莞|珠海|中山|惠州|嘉兴|金华|台州|温州|绍兴|湖州|武汉市|北京市|上海市|广州市|深圳市|成都市|杭州市|南京市|苏州市|长沙市|郑州市|合肥市|昆明市|福州市|厦门市|青岛市|宁波市|无锡市|常州市|南通市|佛山市|东莞市|珠海市|中山市|惠州市|武昌区|洪山区|江夏区|黄陂区|蔡甸区|汉阳区|汉南区|江岸区|江汉区|硚口区|青山区|东西湖区|新洲区|湖北|湖南|广东|广西|云南|贵州|四川|浙江|江苏|福建|山东|河南|河北|江西|安徽|山西|陕西|甘肃|青海|海南|辽宁|吉林|黑龙江|内蒙古|新疆|西藏|宁夏)(?:省|市|区|县)?)/u);
    return match?.[1] || '';
  }

  private extractCompanyTypeHint(text: string): 'farm' | 'company' | 'cooperative' | 'base' | 'factory' | 'store' | '' {
    if (/合作社/u.test(text)) return 'cooperative';
    if (/基地/u.test(text)) return 'base';
    if (/工厂|加工厂/u.test(text)) return 'factory';
    if (/店铺|门店|店家/u.test(text)) return 'store';
    if (/农场/u.test(text)) return 'farm';
    return '';
  }

  private extractCompanyFeatureTags(text: string): string[] {
    const tags: string[] = [];
    if (/有机/u.test(text)) tags.push('有机');
    if (/可溯源|溯源/u.test(text)) tags.push('可溯源');
    if (/冷链/u.test(text)) tags.push('冷链');
    if (/认证/u.test(text)) tags.push('认证');
    if (/直供/u.test(text)) tags.push('直供');
    if (/批发/u.test(text)) tags.push('批发');
    return tags;
  }

  private shouldTreatCompanyNameAsIndustry(text: string, rawCompanyName: string): boolean {
    const cleaned = this.cleanupStoreName(rawCompanyName);
    if (!cleaned) return false;
    if (/(农场|公司|企业|合作社|基地|工厂|店铺)/u.test(cleaned)) return false;
    return /(?:卖|做|主营|经营|种|养|生产).+(?:公司|企业|农场|店铺|合作社|基地|工厂)/u.test(text)
      || /(?:什么|哪些|哪家|有没有).+(?:公司|企业|农场|店铺|合作社|基地|工厂)/u.test(text);
  }

  private cleanupCompanyQueryName(
    transcript: string,
    value: string,
    mode: AiVoiceCompanyMode,
  ): string {
    const cleaned = this.cleanupStoreName(value)
      .replace(/^(?:现在|目前|最近|这里|这边|附近|周边|本地)/u, '')
      .replace(/^(?:有哪(?:些|家)|有哪些|什么|哪些|哪家|有没有|有没|找找|找一下|找一找|看看|看下|看一下|查查|查一下|搜搜|搜一下)+/u, '')
      .replace(/(?:页面|页|列表|商户|商家端|公司端)+$/u, '')
      .trim();

    if (!cleaned) return '';

    if (mode === 'list') {
      const locationHint = this.extractCompanyLocationHint(cleaned);
      if (locationHint === cleaned) return '';
      // "在武汉" → 去掉介词"在/到/去"后等于 locationHint → 清空（location 已单独提取）
      const withoutPreposition = cleaned.replace(/^(?:在|到|去)/u, '');
      if (locationHint && locationHint === withoutPreposition) return '';
      if (locationHint && cleaned.startsWith(locationHint) && /^(?:有哪(?:些|家)|有哪些|有什么|什么|哪些|哪家|有没有|有没)$/u.test(cleaned.slice(locationHint.length))) {
        return '';
      }
      // "在武汉的" → 去掉介词和"的"后等于 locationHint → 清空
      const withoutPrepositionAndDe = withoutPreposition.replace(/的$/u, '');
      if (locationHint && locationHint === withoutPrepositionAndDe) return '';
      if (/^(?:有哪(?:些|家)|有哪些|什么|哪些|哪家|有没有)$/u.test(cleaned)) return '';
      if (/^(?:农场|企业|公司|店铺|合作社|基地|工厂)$/u.test(cleaned)) return '';
    }

    if (/^(?:打开|进入|去|查看|看看|查|搜|找)$/u.test(cleaned)) {
      return '';
    }

    const transcriptCompact = transcript.replace(/\s+/g, '');
    if (
      mode === 'list'
      && cleaned
      && (
        transcriptCompact.includes(`${cleaned}有哪些`)
        || transcriptCompact.includes(`${cleaned}有什么`)
        || transcriptCompact.includes(`${cleaned}有没有`)
      )
    ) {
      return '';
    }

    return cleaned;
  }

  private normalizeCompanyCandidateName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[“”"'`]/g, '')
      .replace(/[，。！？,.!?\s]/g, '')
      .replace(/(?:官方|自营)/gu, '')
      .replace(/(?:店铺|农场|商家|公司|企业|旗舰店)$/u, '')
      .replace(/(?:生态|智慧|农业|基地|研究社|合作社|科技|食品|优选|直供|集团|有限责任|有限公司)+/gu, '')
      .trim();
  }

  private filterCompanyCandidatesByContext(
    companies: Array<{
      id: string; name: string; shortName?: string; mainBusiness?: string;
      location?: string; badges?: string[];
      companyType?: string; industryTags?: string[]; productKeywords?: string[];
      productFeatures?: string[]; certifications?: string[];
    }>,
    context: { industryHint?: string; location?: string; companyType?: string; featureTags?: string[] },
  ) {
    const normalize = (s: string) => this.normalizeCompanyCandidateName(s);
    const location = normalize(context.location || '');
    const industry = normalize(context.industryHint || '');
    const companyTypeLabel = normalize(this.getCompanyTypeLabel(context.companyType));
    const featureTags = (context.featureTags || []).map(normalize).filter(Boolean);

    const filtered = companies.filter((company) => {
      // 优先用结构化字段精确匹配，未命中再 fallback 到字符串 haystack
      const haystack = normalize([
        company.name, company.shortName || '', company.mainBusiness || '',
        company.location || '', ...(company.badges || []),
      ].join(' '));

      // 地区：用 location 字段匹配
      if (location) {
        if (!haystack.includes(location)) return false;
      }

      // 品类：先查 industryTags 精确命中，再 fallback haystack
      if (industry) {
        const tagMatch = (company.industryTags || []).some(
          (tag) => { const n = normalize(tag); return n && (n.includes(industry) || industry.includes(n)); },
        );
        if (!tagMatch && !haystack.includes(industry)) return false;
      }

      // 企业类型：先查 companyType 精确匹配，再 fallback haystack
      if (context.companyType) {
        const typeMatch = company.companyType === context.companyType;
        if (!typeMatch && companyTypeLabel && !haystack.includes(companyTypeLabel)) return false;
      }

      // 特征标签：先查 productFeatures + certifications 精确命中，再 fallback haystack
      if (featureTags.length) {
        const structuredTags = [
          ...(company.productFeatures || []),
          ...(company.certifications || []),
        ].map(normalize);
        const allMatched = featureTags.every(
          (tag) => structuredTags.some((st) => st.includes(tag) || tag.includes(st)) || haystack.includes(tag),
        );
        if (!allMatched) return false;
      }

      return true;
    });

    return filtered.length > 0 ? filtered : companies;
  }

  private rankCompanyMatchCandidates(
    transcript: string,
    extractedName: string,
    companies: Array<{ id: string; name: string; shortName?: string; mainBusiness?: string }>,
  ) {
    const normalizedTranscript = this.normalizeCompanyCandidateName(transcript);
    const normalizedExtracted = this.normalizeCompanyCandidateName(extractedName);

    return [...companies]
      .map((company) => {
        const aliases = [company.name, company.shortName].filter(Boolean) as string[];
        const score = aliases.reduce((best, alias) => {
          const normalizedAlias = this.normalizeCompanyCandidateName(alias);
          return Math.max(best, this.scoreCompanyCandidate(normalizedExtracted, normalizedTranscript, normalizedAlias));
        }, 0);
        return { company, score };
      })
      .sort((a, b) => b.score - a.score || a.company.name.localeCompare(b.company.name, 'zh-Hans-CN'))
      .map((entry) => entry.company);
  }

  private scoreCompanyCandidate(extractedName: string, transcript: string, candidate: string): number {
    if (!candidate) return 0;

    let score = 0;
    if (extractedName) {
      if (candidate === extractedName) return 1000;
      if (candidate.startsWith(extractedName) || extractedName.startsWith(candidate)) score = Math.max(score, 900);
      if (candidate.includes(extractedName) || extractedName.includes(candidate)) score = Math.max(score, 820);
      score = Math.max(score, 200 + this.sharedCharacterScore(extractedName, candidate));
    }

    if (transcript) {
      if (transcript.includes(candidate) || candidate.includes(transcript)) score = Math.max(score, 700);
      score = Math.max(score, 100 + this.sharedCharacterScore(transcript, candidate));
    }

    return score;
  }

  private sharedCharacterScore(left: string, right: string): number {
    if (!left || !right) return 0;
    const uniqueChars = new Set(left);
    let shared = 0;
    for (const ch of uniqueChars) {
      if (right.includes(ch)) shared += 1;
    }
    return shared * 20;
  }

  private chunkItems<T>(items: T[], size: number): T[][] {
    if (size <= 0) return [items];
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private async resolveCompanyTargetName(
    transcript: string,
    companyContext: {
      companyName?: string;
      industryHint?: string;
      location?: string;
      companyType?: string;
      featureTags?: string[];
    },
  ): Promise<{ companyId?: string; companyName: string }> {
    const cleaned = this.cleanupCompanyQueryName(transcript, companyContext.companyName || '', 'detail');
    if (!cleaned) return { companyName: '' };

    try {
      const companies = this.filterCompanyCandidatesByContext(await this.companyService.list(), companyContext);
      if (!companies.length) {
        return { companyName: cleaned };
      }

      const normalizedTarget = this.normalizeCompanyCandidateName(cleaned);
      const exactMatch = companies.find((company) => {
        const candidates = [company.name, company.shortName].filter(Boolean) as string[];
        return candidates.some((candidate) => this.normalizeCompanyCandidateName(candidate) === normalizedTarget);
      });

      if (exactMatch) {
        return {
          companyId: exactMatch.id,
          companyName: exactMatch.name,
        };
      }

      const rewritten = await this.rewriteVoiceCompanyName(transcript, cleaned, companies.map((company) => ({
        id: company.id,
        name: company.name,
        shortName: company.shortName,
        mainBusiness: company.mainBusiness,
        industryTags: company.industryTags,
      })));

      if (rewritten) {
        const matchedCompany = companies.find((company) => company.name === rewritten);
        return {
          companyId: matchedCompany?.id,
          companyName: rewritten,
        };
      }
    } catch (error) {
      this.logger.warn(`CompanyName resolve failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { companyName: cleaned };
  }

  private async rewriteVoiceCompanyName(
    transcript: string,
    extractedName: string,
    companies: Array<{ id: string; name: string; shortName?: string; mainBusiness?: string; industryTags?: string[] }>,
  ): Promise<string> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || companies.length === 0) {
      return '';
    }

    const rankedCompanies = this.rankCompanyMatchCandidates(transcript, extractedName, companies);
    const candidateBatches = this.chunkItems(rankedCompanies, this.COMPANY_MATCH_BATCH_SIZE);
    let bestMatch: { name: string; confidence: number } | null = null;

    if (candidateBatches.length > 1) {
      this.logger.log(`[VoiceCompany] candidate-batches total=${companies.length} batches=${candidateBatches.length} batchSize=${this.COMPANY_MATCH_BATCH_SIZE}`);
    }

    try {
      for (let index = 0; index < candidateBatches.length; index += 1) {
        const batch = candidateBatches[index];
        const batchMatch = await this.rewriteVoiceCompanyNameBatch(
          apiKey,
          transcript,
          extractedName,
          batch,
          index + 1,
          candidateBatches.length,
        );
        if (batchMatch && (!bestMatch || batchMatch.confidence > bestMatch.confidence)) {
          bestMatch = batchMatch;
        }
        if (bestMatch && bestMatch.confidence >= this.COMPANY_MATCH_EARLY_EXIT_CONFIDENCE) {
          break;
        }
      }
    } catch (error) {
      this.logger.warn(`[VoiceCompany] rewrite-fallback extracted="${extractedName}" error=${error instanceof Error ? error.message : String(error)}`);
      return '';
    }

    if (!bestMatch) {
      return '';
    }

    this.logger.log(`[VoiceCompany] rewritten "${extractedName}" -> "${bestMatch.name}" confidence=${bestMatch.confidence}`);
    return bestMatch.name;
  }

  private async rewriteVoiceCompanyNameBatch(
    apiKey: string,
    transcript: string,
    extractedName: string,
    companies: Array<{ id: string; name: string; shortName?: string; mainBusiness?: string; industryTags?: string[] }>,
    batchIndex: number,
    totalBatches: number,
  ): Promise<{ name: string; confidence: number } | null> {
    const candidateLines = companies
      .map((company, index) => {
        const parts = [`${index + 1}. ${company.name}`];
        if (company.shortName) parts.push(`（简称：${company.shortName}）`);
        const business = company.industryTags?.length
          ? `${company.industryTags.join('/')}${company.mainBusiness ? ` - ${company.mainBusiness}` : ''}`
          : company.mainBusiness || '';
        if (business) parts.push(`｜主营：${business}`);
        return parts.join('');
      })
      .join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.QWEN_COMPANY_MATCH_MODEL,
          messages: [
            {
              role: 'system',
              content:
                '你是农脉App的企业名纠偏器。任务：根据语音转写和当前企业候选列表，只从候选列表里选择最可能的企业官方名称。要能纠正常见 ASR 同音/近音错字，比如“清河”可能对应“青禾”。如果无法高置信匹配，返回空字符串。严格只返回 JSON：{"name":"","confidence":0}.',
            },
            {
              role: 'user',
              content: `transcript=${transcript}\nextracted_name=${extractedName}\nbatch=${batchIndex}/${totalBatches}\ncandidates:\n${candidateLines}`,
            },
          ],
          temperature: 0,
          max_tokens: 120,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(`[VoiceCompany] rewrite-batch-failed batch=${batchIndex}/${totalBatches} status=${response.status} body=${errText}`);
        return null;
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) return null;

      const jsonStr = content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      const matchedName = this.pickFirstString(parsed?.name);
      const confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 0;
      if (!matchedName || confidence < 0.6) {
        return null;
      }

      const official = companies.find((company) => company.name === matchedName);
      if (!official) {
        return null;
      }

      return { name: official.name, confidence };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 从加购语句中提取商品名 */
  private extractCartProduct(text: string): string {
    const fillerWords = /我想|我要|请|帮我|把|加入|加到|加|购物车|加购|的|吗|呢|啊|吧|了/g;
    return text.replace(fillerWords, '').trim();
  }

  private cleanupStoreName(value: string): string {
    return value
      .replace(/^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:打开|进入|去|逛逛|查看|看看|查(?:一下)?|搜(?:索)?|找)+/u, '')
      .replace(/^(?:现在|目前|最近|这边|这里|附近)?(?:都)?(?:有哪(?:些|家)|有什?么|哪些|什么)/u, '')
      .replace(/^(?:这个|那个|这家|那家)/u, '')
      .replace(/(?:的)?(?:店铺|农场|商家|公司|企业|旗舰店)/gu, '')
      .replace(/(?:列表|推荐|相关)+$/u, '')
      .replace(/^(?:全部|所有)/u, '')
      .replace(/(?:在哪|在哪里|怎么样|信息|介绍|详情|主页|地址|电话|吗|呢|啊|呀|吧|嘛|哦)+$/u, '')
      .trim();
  }

  // ========== Qwen 大模型意图识别 ==========

  /**
   * 调用 Qwen-Flash 做一级意图分类
   * 仅输出统一的 classify 结果，不直接做业务处理
   */
  private async qwenIntentClassify(transcript: string, semanticSlotsEnabled = false): Promise<VoiceIntentClassification | null> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      this.logger.warn('DASHSCOPE_API_KEY 未设置，跳过 Qwen 一级分类');
      return null;
    }

    // ===== 语义槽位双层管道：Flash → (可选) Plus =====
    if (semanticSlotsEnabled) {
      try {
        const flashResult = await this.callSemanticModel(apiKey, transcript, FLASH_SEMANTIC_PROMPT, this.QWEN_INTENT_MODEL, 5000);
        if (flashResult) {
          const validIntents = ['navigate', 'search', 'company', 'transaction', 'recommend', 'chat'] as const;
          const intent = validIntents.includes(flashResult.intent as any) ? flashResult.intent as VoiceIntentClassification['intent'] : 'chat';
          const confidence = typeof flashResult.confidence === 'number'
            ? Math.max(0, Math.min(flashResult.confidence, 1))
            : 0.5;
          const slots = flashResult.slots && typeof flashResult.slots === 'object' ? flashResult.slots : {};
          const fallbackReason = typeof flashResult.fallbackReason === 'string' && flashResult.fallbackReason !== 'null'
            ? flashResult.fallbackReason
            : undefined;

          if (isFlashResultGood(confidence, slots)) {
            this.logger.log(`[SemanticPipeline] Flash 结果足够好，直接使用 intent=${intent} confidence=${confidence.toFixed(2)}`);
            return {
              intent,
              confidence,
              source: 'model',
              params: { ...slots, reply: flashResult.reply, fallbackReason },
              pipeline: 'flash',
              wasUpgraded: false,
              fallbackReason,
            };
          }

          // Flash 结果不够好 → 升级到 Plus
          this.logger.log(`[SemanticPipeline] Flash 结果不充分（confidence=${confidence.toFixed(2)}），升级到 Plus`);
          const plusResult = await this.callSemanticModel(apiKey, transcript, PLUS_SEMANTIC_PROMPT, this.QWEN_CHAT_MODEL, 8000);
          if (plusResult) {
            const plusIntent = validIntents.includes(plusResult.intent as any) ? plusResult.intent as VoiceIntentClassification['intent'] : 'chat';
            const plusConfidence = typeof plusResult.confidence === 'number'
              ? Math.max(0, Math.min(plusResult.confidence, 1))
              : 0.5;
            const plusSlots = plusResult.slots && typeof plusResult.slots === 'object' ? plusResult.slots : {};
            const plusFallbackReason = typeof plusResult.fallbackReason === 'string' && plusResult.fallbackReason !== 'null'
              ? plusResult.fallbackReason
              : undefined;

            this.logger.log(`[SemanticPipeline] Plus 结果 intent=${plusIntent} confidence=${plusConfidence.toFixed(2)}`);
            return {
              intent: plusIntent,
              confidence: plusConfidence,
              source: 'model',
              params: { ...plusSlots, reply: plusResult.reply, fallbackReason: plusFallbackReason },
              pipeline: 'plus',
              wasUpgraded: true,
              fallbackReason: plusFallbackReason,
            };
          }
        }
      } catch (err) {
        this.logger.error(`[SemanticPipeline] 语义管道异常，回退到传统分类：${err.message}`);
      }
      // 语义管道失败 → 回退到下方传统逻辑
    }

    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Shanghai' });
    const systemPrompt = `你是农脉App的语音一级分类器。当前日期：${today}。用户通过语音下达指令，你只负责判断任务类型并输出结构化 JSON。

严格只返回以下 JSON 格式，不要输出其他内容：
{"intent":"navigate|search|company|transaction|recommend|chat","confidence":0.0,"params":{}}

分类规则：
- navigate：打开页面、去某个页面、回到某个页面。params.target 只能是：
  home / discover / me / settings / cart / checkout / orders / search / ai-chat
- search：查找/搜索/浏览某类商品。params 可包含：
  query / categoryHint / category / preferRecommended / constraints / recommendThemes / usage / audience
- company：企业/农场相关请求。params.mode 只能是 list / detail / search；params.name 仅在 detail/search 时填写；还可包含：
  industryHint / location / companyType / featureTags
- transaction：订单、物流、退款、退货、换货、付款等交易动作。params.action 填动作名；可附带 params.reply
- recommend：用户让系统做推荐、筛选、预算导购。params 可包含：
  query / categoryHint / category / budget / constraints / recommendThemes / usage / audience / reply
- chat：其他开放式问答、闲聊、日期时间问题。params.reply 直接填写给用户的中文回答

关键原则：
- “有没有海鲜” 和 “有没有推荐的海鲜” 都是 search，区别写在 params.preferRecommended
- 只有当用户明确在请求系统替他做选择时，才分类成 recommend
- 不要把页面跳转、商品搜索、交易动作、推荐导购混为一类

示例：
- "打开购物车" -> {"intent":"navigate","confidence":0.99,"params":{"target":"cart"}}
- "打开设置" -> {"intent":"navigate","confidence":0.99,"params":{"target":"settings"}}
- "帮我找鸡蛋" -> {"intent":"search","confidence":0.97,"params":{"query":"鸡蛋","preferRecommended":false,"constraints":[]}}
- "有没有推荐的海鲜" -> {"intent":"search","confidence":0.94,"params":{"query":"海鲜","preferRecommended":true}}
- "帮我找低糖水果" -> {"intent":"search","confidence":0.95,"params":{"query":"水果","preferRecommended":false,"constraints":["low-sugar"]}}
- "适合小孩吃的水果" -> {"intent":"recommend","confidence":0.90,"params":{"query":"水果","audience":"儿童","reply":"我来给你推荐适合小孩吃的水果。"}}
- "推荐点海鲜给我" -> {"intent":"recommend","confidence":0.93,"params":{"query":"海鲜","reply":"我来给你推荐一些海鲜。"}}
- "推荐今天的爆款" -> {"intent":"recommend","confidence":0.93,"params":{"recommendThemes":["hot"],"reply":"我来给你推荐今天的爆款。"}}
- "推荐今天的折扣商品" -> {"intent":"recommend","confidence":0.93,"params":{"recommendThemes":["discount"],"reply":"我来给你推荐今天的折扣商品。"}}
- "推荐最近好吃的食物" -> {"intent":"recommend","confidence":0.94,"params":{"recommendThemes":["recent","tasty"],"reply":"我来给你推荐最近好吃的商品。"}}
- "帮我查订单到哪了" -> {"intent":"transaction","confidence":0.96,"params":{"action":"track-order","reply":"正在为你查询订单物流信息..."}}
- "现在有哪些企业" -> {"intent":"company","confidence":0.95,"params":{"mode":"list"}}
- "打开农场" -> {"intent":"company","confidence":0.95,"params":{"mode":"list","companyType":"farm"}}
- "打开青禾农场" -> {"intent":"company","confidence":0.96,"params":{"mode":"detail","name":"青禾农场","companyType":"farm"}}
- "帮我找卖水果的公司" -> {"intent":"company","confidence":0.95,"params":{"mode":"list","industryHint":"水果"}}
- "武汉有哪些农场" -> {"intent":"company","confidence":0.95,"params":{"mode":"list","location":"武汉","companyType":"farm"}}
- "武昌区有没有有机蔬菜合作社" -> {"intent":"company","confidence":0.95,"params":{"mode":"list","location":"武昌区","industryHint":"蔬菜","companyType":"cooperative","featureTags":["有机"]}}
- "今天几号" -> {"intent":"chat","confidence":0.98,"params":{"reply":"今天是${today}。"}}
- "今天天气如何" -> {"intent":"chat","confidence":0.98,"params":{"reply":"我现在还不能查询实时天气，所以没法准确回答天气情况。"}}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.QWEN_INTENT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: transcript },
          ],
          temperature: 0.1,
          max_tokens: 150,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`Qwen 一级分类 API 请求失败：${response.status} ${errText}`);
        return null;
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content;

      if (!content) {
        this.logger.warn('Qwen 一级分类返回空内容');
        return null;
      }

      const jsonStr = content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      const validIntents = ['navigate', 'search', 'company', 'transaction', 'recommend', 'chat'] as const;
      const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'chat';
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(parsed.confidence, 1))
        : 0.5;
      const rawParams = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};
      const params: Record<string, unknown> = { ...rawParams };

      // 兼容模型偶发返回旧字段格式，避免分类器初期过于脆弱。
      if (!Object.keys(params).length && typeof parsed.param === 'string') {
        if (intent === 'navigate') {
          params.target = parsed.param;
        } else if (intent === 'company') {
          params.name = parsed.param;
        } else if (intent === 'search') {
          params.query = parsed.param;
        } else if (intent === 'transaction') {
          params.action = parsed.param;
        } else {
          params.message = parsed.param;
        }
      }
      if (!this.pickFirstString(params.reply, parsed.feedback) && typeof parsed.feedback === 'string') {
        params.reply = parsed.feedback;
      }

      const navigateTarget = this.parseNavigateTarget(params.target);
      if (intent === 'navigate') {
        params.target = navigateTarget ?? 'home';
      }
      if (intent === 'transaction') {
        const action = this.normalizeTransactionAction(params.action, transcript);
        params.action = action;
        params.status = this.pickFirstString(params.status) || this.inferTransactionStatus(action);
        params.reply = this.pickFirstString(params.reply) || this.getTransactionFeedback(action);
      }
      if (intent === 'company') {
        params.name = this.cleanupStoreName(this.pickFirstString(params.name, params.companyName, params.param));
        params.mode = this.normalizeCompanyMode(
          params.mode,
          transcript,
          this.pickFirstString(params.name),
          Boolean(
            this.pickFirstString(params.industryHint, params.categoryHint, params.category, params.location, params.region, params.city, params.district, params.area, params.companyType, params.type)
            || this.pickStringArray(params.featureTags ?? params.tags ?? params.features).length,
          ),
        );
        params.industryHint = this.cleanupStoreName(this.pickFirstString(params.industryHint, params.categoryHint, params.category, params.business, params.mainBusiness));
        params.location = this.cleanupStoreName(this.pickFirstString(params.location, params.region, params.city, params.district, params.area));
        params.companyType = this.normalizeCompanyType(this.pickFirstString(params.companyType, params.type), transcript);
        params.featureTags = this.pickStringArray(params.featureTags ?? params.tags ?? params.features);
      }
      if (intent === 'recommend') {
        params.query = this.pickFirstString(params.query, params.categoryHint, params.category, params.keyword);
        params.categoryHint = this.pickFirstString(params.categoryHint, params.category);
        params.usage = this.pickFirstString(params.usage, params.scene, params.scenario);
        params.usageScenario = params.usageScenario || params.usage;
        params.audience = this.pickFirstString(params.audience, params.persona, params.people, params.group);
        params.constraints = this.pickStringArray(params.constraints);
        params.budget = this.pickNumber(params.budget) ?? this.extractBudget(transcript);
        params.recommendThemes = this.pickRecommendThemes(
          params.recommendThemes ?? params.recommendTheme ?? params.theme,
        );
        params.preferRecommended = true;
      }
      if (intent === 'search') {
        params.query = this.pickFirstString(params.query, params.categoryHint, params.category, params.keyword, params.param);
        params.categoryHint = this.pickFirstString(params.categoryHint, params.category);
        params.usage = this.pickFirstString(params.usage, params.scene, params.scenario);
        params.usageScenario = params.usageScenario || params.usage;
        params.audience = this.pickFirstString(params.audience, params.persona, params.people, params.group);
        params.constraints = this.pickStringArray(params.constraints);
        params.recommendThemes = this.pickRecommendThemes(
          params.recommendThemes ?? params.recommendTheme ?? params.theme,
        );
      }

      this.logger.log(
        `Qwen 一级分类结果：model=${this.QWEN_INTENT_MODEL}, intent=${intent}, confidence=${confidence.toFixed(2)}`,
      );

      return {
        intent,
        confidence,
        source: 'model',
        params,
      };
    } catch (err) {
      this.logger.error(`Qwen 一级分类解析失败：${err.message}`);
      return null;
    }
  }

  /**
   * 通用语义模型调用：发送 systemPrompt + transcript，解析 JSON 返回
   * 用于 Flash/Plus 双层管道和 out-of-domain bridge
   */
  private async callSemanticModel(
    apiKey: string,
    transcript: string,
    systemPrompt: string,
    model: string,
    timeoutMs: number,
  ): Promise<Record<string, any> | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: transcript },
          ],
          temperature: 0.1,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`[SemanticModel] API 请求失败：model=${model} status=${response.status} body=${errText}`);
        return null;
      }

      const data = await response.json() as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        this.logger.warn(`[SemanticModel] 返回空内容 model=${model}`);
        return null;
      }

      const jsonStr = content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (err) {
      clearTimeout(timeout);
      this.logger.error(`[SemanticModel] 调用异常 model=${model}: ${err.message}`);
      return null;
    }
  }

  // ========== 完整 Session API ==========

  /** 创建 AI 会话 */
  async createSession(userId: string, page: string, context?: any) {
    const session = await this.prisma.aiSession.create({
      data: { userId, page, context },
    });

    return {
      id: session.id,
      page: session.page,
      context: session.context,
      createdAt: session.createdAt.toISOString(),
      utterances: [],
    };
  }

  /** 获取会话列表 */
  async listSessions(userId: string) {
    const sessions = await this.prisma.aiSession.findMany({
      where: { userId },
      take: 20,
      include: {
        utterances: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { transcript: true, createdAt: true },
        },
      },
    });

    return sessions
      .map((s) => ({
        id: s.id,
        page: s.page,
        createdAt: s.createdAt.toISOString(),
        lastMessage: s.utterances[0]?.transcript || '',
        lastMessageAt: s.utterances[0]?.createdAt?.toISOString() || null,
      }))
      .sort((a, b) => {
        const aTime = new Date(a.lastMessageAt || a.createdAt).getTime();
        const bTime = new Date(b.lastMessageAt || b.createdAt).getTime();
        return bTime - aTime;
      });
  }

  async listRecentConversations(userId: string, limit = 3) {
    const utterances = await this.prisma.aiUtterance.findMany({
      where: {
        session: {
          userId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        session: {
          select: {
            id: true,
            page: true,
          },
        },
        intentResults: {
          orderBy: { createdAt: 'asc' },
          include: {
            actionExecutions: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    return utterances.map((utterance) => {
      const assistantMessage = utterance.intentResults
        .flatMap((item) => item.actionExecutions || [])
        .map((action) => action.actionPayload as Record<string, any> | null)
        .map((payload) => payload?.message)
        .find((message): message is string => typeof message === 'string' && message.trim().length > 0);

      return {
        id: utterance.id,
        sessionId: utterance.sessionId,
        page: utterance.session?.page || 'assistant',
        question: utterance.transcript,
        answer: assistantMessage || '',
        createdAt: utterance.createdAt.toISOString(),
      };
    });
  }

  /** 获取会话详情（含完整对话历史） */
  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.aiSession.findUnique({
      where: { id: sessionId },
      include: {
        utterances: {
          orderBy: { createdAt: 'asc' },
          include: {
            intentResults: {
              include: {
                actionExecutions: true,
              },
            },
          },
        },
      },
    });

    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new NotFoundException('会话不存在');

    return {
      id: session.id,
      page: session.page,
      context: session.context,
      createdAt: session.createdAt.toISOString(),
      utterances: session.utterances.map((u) => this.mapUtterance(u)),
    };
  }

  /** 发送语音/文字消息（Phase 2：多轮对话） */
  async sendMessage(
    sessionId: string,
    userId: string,
    dto: { transcript: string; audioUrl?: string },
  ) {
    // 1. 验证会话归属，并读取已有历史（不含当前消息）
    const session = await this.prisma.aiSession.findUnique({
      where: { id: sessionId },
      include: {
        utterances: {
          orderBy: { createdAt: 'asc' },
          include: {
            intentResults: {
              include: { actionExecutions: true },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) throw new NotFoundException('会话不存在');

    // 2. 从已有 utterances 提取历史（不含当前消息）
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const u of session.utterances) {
      history.push({ role: 'user', content: u.transcript });
      const assistantContent = (u.intentResults || [])
        .flatMap((ir: any) => ir.actionExecutions || [])
        .map((ae: any) => {
          const payload = ae.actionPayload as any;
          return payload?.chatResponse?.reply || payload?.message;
        })
        .find((c: any) => typeof c === 'string' && c.trim().length > 0);
      if (assistantContent) {
        history.push({ role: 'assistant', content: assistantContent });
      }
    }

    // 3. 调用 Qwen-Plus 多轮对话（先调模型，再落库）
    const chatResponse = await this.chatWithContext(history, dto.transcript);

    // 4. 创建 utterance + 结构化落库
    const utterance = await this.prisma.aiUtterance.create({
      data: {
        sessionId,
        transcript: dto.transcript,
        audioUrl: dto.audioUrl,
      },
    });

    await this.prisma.aiIntentResult.create({
      data: {
        utteranceId: utterance.id,
        intent: 'chat',
        slots: this.toJsonValue({}),
        confidence: 1.0,
        modelInfo: this.toJsonValue({
          model: this.QWEN_CHAT_MODEL,
          phase: 'phase2-multi-turn',
          replySource: 'qwen-plus',
          hasSuggestedActions: chatResponse.suggestedActions.length > 0,
          hasFollowUpQuestions: chatResponse.followUpQuestions.length > 0,
        }),
        actionExecutions: {
          create: {
            actionType: 'SHOW_CHOICES',
            actionPayload: this.toJsonValue({
              // 结构化落库：reply / suggestedActions / followUpQuestions 各自独立
              chatResponse: {
                reply: chatResponse.reply,
                suggestedActions: chatResponse.suggestedActions,
                followUpQuestions: chatResponse.followUpQuestions,
              },
              // 保留 message 字段兼容旧前端读取逻辑
              message: chatResponse.reply,
            }),
            success: true,
          },
        },
      },
    });

    // 5. 返回完整 utterance
    const fullUtterance = await this.prisma.aiUtterance.findUnique({
      where: { id: utterance.id },
      include: {
        intentResults: {
          include: { actionExecutions: true },
        },
      },
    });

    return this.mapUtterance(fullUtterance!);
  }

  // ===== Phase 2: 多轮对话核心方法 =====

  /**
   * 构建多轮对话的 messages 数组（system + 历史 + 当前用户消息）
   * 双重控制：轮次上限 + token 预算
   */
  private buildChatMessages(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    currentMessage: string,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: this.CHAT_SYSTEM_PROMPT },
    ];

    // 粗估 token：中文 1 字 ≈ 1.5 token
    const estimateTokens = (text: string) => Math.ceil(text.length * 1.5);

    const systemTokens = estimateTokens(this.CHAT_SYSTEM_PROMPT);
    const currentTokens = estimateTokens(currentMessage);
    let budgetRemaining = this.CHAT_MAX_INPUT_TOKENS - systemTokens - currentTokens;

    // 从最新的历史开始向前取，直到超出预算或轮次上限
    // 一轮 = user + assistant，所以最多取 CHAT_MAX_ROUNDS * 2 条
    const maxMessages = this.CHAT_MAX_ROUNDS * 2;
    const recentHistory = history.slice(-maxMessages);

    const selectedHistory: typeof recentHistory = [];
    for (let i = recentHistory.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(recentHistory[i].content);
      if (budgetRemaining - tokens < 0) break;
      budgetRemaining -= tokens;
      selectedHistory.unshift(recentHistory[i]);
    }

    messages.push(...selectedHistory);
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  /**
   * 解析 Qwen-Plus 的聊天响应 JSON，带 fallback
   * 必须容忍非 JSON 返回，降级为纯文本 reply
   */
  private parseChatResponse(raw: string): AiChatResponse {
    try {
      // 去除可能的 markdown 代码块包裹（兼容 ```json / ``` / 大小写 / 尾部多余文字）
      let cleaned = raw.trim();
      const fenceMatch = cleaned.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
      }

      const parsed = JSON.parse(cleaned);

      return {
        reply: typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : raw.trim(),
        suggestedActions: Array.isArray(parsed.suggestedActions)
          ? parsed.suggestedActions
              .filter((a: any) =>
                a && typeof a.type === 'string' &&
                ['search', 'navigate', 'company', 'recommend'].includes(a.type) &&
                typeof a.label === 'string',
              )
              .slice(0, 2)
          : [],
        followUpQuestions: Array.isArray(parsed.followUpQuestions)
          ? parsed.followUpQuestions
              .filter((q: any) => typeof q === 'string' && q.trim())
              .slice(0, 3)
          : [],
      };
    } catch {
      // Qwen 返回非法 JSON，整个输出当作纯 reply
      return {
        reply: raw.trim(),
        suggestedActions: [],
        followUpQuestions: [],
      };
    }
  }

  /**
   * 对 suggestedActions 中的 resolved 字段进行补全
   * 复用已有的搜索实体解析链和企业同音纠偏链
   */
  private async resolveSuggestedActions(
    actions: AiSuggestedAction[],
  ): Promise<AiSuggestedAction[]> {
    const resolved: AiSuggestedAction[] = [];

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'search': {
            // 复用 productService.resolveSearchEntity()（分类候选映射 + qwen-flash）
            const query = action.resolved?.query || action.label;
            const searchEntity = await this.productService.resolveSearchEntity(query);
            resolved.push({
              ...action,
              resolved: {
                ...action.resolved,
                query: searchEntity.normalizedKeyword || query,
                ...(searchEntity.matchedCategoryId
                  ? { matchedCategoryId: searchEntity.matchedCategoryId, matchedCategoryName: searchEntity.matchedCategoryName }
                  : {}),
              },
            });
            break;
          }
          case 'company': {
            // 复用 resolveCompanyTargetName()（候选过滤 + 同音纠偏链）
            const name = action.resolved?.name || action.label;
            const companyResult = await this.resolveCompanyTargetName(name, {
              companyName: name,
            });
            resolved.push({
              ...action,
              resolved: {
                ...action.resolved,
                name,
                ...(companyResult.companyId
                  ? { companyId: companyResult.companyId, companyName: companyResult.companyName }
                  : {}),
              },
            });
            break;
          }
          default:
            resolved.push(action);
        }
      } catch (err) {
        this.logger.warn(`[AiChat] Failed to resolve suggestedAction type=${action.type} label=${action.label}: ${err?.message || err}`);
        resolved.push(action);
      }
    }

    return resolved;
  }

  /**
   * Phase 2 核心：多轮对话，Qwen-Plus 为主脑
   * 绕过 parseIntent()，直接走 Qwen-Plus 多轮对话
   *
   * 注意：history 参数只包含"已有历史"，不含当前用户消息
   * 当前用户消息通过 transcript 参数单独传入，避免重复注入
   */
  private async chatWithContext(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    transcript: string,
  ): Promise<AiChatResponse> {
    // 1. 构建滑动窗口 messages
    const messages = this.buildChatMessages(history, transcript);

    // 2. 调用 Qwen-Plus
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return { reply: 'AI 服务暂未配置，请联系管理员。', suggestedActions: [], followUpQuestions: [] };
    }

    let rawContent: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s 超时

      const response = await fetch(this.QWEN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.QWEN_CHAT_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 800,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.error(`[AiChat] Qwen API error: ${response.status}`);
        return { reply: '抱歉，AI 助手暂时繁忙，请稍后再试。', suggestedActions: [], followUpQuestions: [] };
      }

      const data = await response.json();
      rawContent = data.choices?.[0]?.message?.content || '';
    } catch (error) {
      this.logger.error(`[AiChat] Qwen API call failed: ${error instanceof Error ? error.message : String(error)}`);
      return { reply: '网络异常，请稍后再试。', suggestedActions: [], followUpQuestions: [] };
    }

    // 3. 解析响应
    const chatResponse = this.parseChatResponse(rawContent);

    // 4. 补全 suggestedActions 的 resolved 字段
    if (chatResponse.suggestedActions.length > 0) {
      chatResponse.suggestedActions = await this.resolveSuggestedActions(chatResponse.suggestedActions);
    }

    return chatResponse;
  }

  /** 映射消息数据 */
  private mapUtterance(u: any) {
    return {
      id: u.id,
      transcript: u.transcript,
      audioUrl: u.audioUrl || null,
      createdAt: u.createdAt.toISOString(),
        intentResults: (u.intentResults || []).map((ir: any) => ({
          id: ir.id,
          intent: ir.intent,
          slots: ir.slots,
          confidence: ir.confidence,
          candidates: ir.candidates,
          modelInfo: ir.modelInfo,
          actions: (ir.actionExecutions || []).map((ae: any) => ({
            id: ae.id,
            type: ae.actionType,
          payload: ae.actionPayload,
          success: ae.success,
          error: ae.error,
        })),
      })),
    };
  }

  /** 简单意图检测（保留兼容，内部已使用 parseIntent 替代） */
  private detectIntent(text: string): string {
    if (text.includes('搜') || text.includes('找') || text.includes('有没有')) return 'SearchProduct';
    if (text.includes('加') && text.includes('购物车')) return 'AddToCart';
    if (text.includes('下单') || text.includes('买')) return 'PlaceOrder';
    if (text.includes('订单') || text.includes('物流')) return 'QueryOrder';
    if (text.includes('溯源') || text.includes('产地')) return 'QueryTrace';
    if (text.includes('企业') || text.includes('公司')) return 'SearchCompany';
    return 'GeneralQuery';
  }

  /** 简单槽位提取（占位） */
  private extractSlots(text: string): any {
    return { rawText: text };
  }

  /** 简单回复生成（占位，保留兼容） */
  private generateReply(text: string): string {
    if (text.includes('搜') || text.includes('找')) return '正在为您搜索相关商品...';
    if (text.includes('订单')) return '正在查询您的订单信息...';
    if (text.includes('溯源')) return '正在获取溯源信息...';
    return '好的，我来帮您处理。';
  }

  // ========== N14修复：AI 功能入口 API ==========

  /** 对话历史列表 */
  async getChatHistory(userId: string) {
    const sessions = await this.prisma.aiSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        utterances: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { transcript: true, createdAt: true },
        },
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      title: s.utterances[0]?.transcript?.slice(0, 20) || 'AI 对话',
      lastMessage: s.utterances[0]?.transcript || '',
      updatedAt: s.utterances[0]?.createdAt?.toISOString() || s.createdAt.toISOString(),
    }));
  }

  /** AI 溯源概览（占位数据，接入真实溯源服务后替换） */
  async getTraceOverview(productId?: string) {
    // 如果传了 productId，查产品名称
    let productName = '有机蓝莓';
    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { title: true },
      });
      if (product) productName = product.title;
    }

    return {
      productId: productId || 'demo',
      productName,
      batchId: `BATCH-${Date.now().toString(36).toUpperCase()}`,
      farmName: '云南绿源有机农场',
      statusLabel: '已验证',
      tags: ['有机认证', 'GAP认证', '可溯源'],
      steps: [
        { id: 't-1', title: '种植', description: '云南大理有机基地种植', status: 'done', time: '2026-01-15', location: '云南大理' },
        { id: 't-2', title: '采摘', description: '人工采摘，当日分拣', status: 'done', time: '2026-02-10', location: '云南大理' },
        { id: 't-3', title: '质检', description: 'SGS 检测报告', status: 'done', time: '2026-02-11' },
        { id: 't-4', title: '冷链运输', description: '全程冷链配送', status: 'doing', time: '2026-02-12' },
        { id: 't-5', title: '签收', description: '等待买家签收', status: 'pending' },
      ],
    };
  }

  /** AI 推荐洞察（占位数据，接入推荐引擎后替换） */
  async getRecommendInsights(_userId: string) {
    return [
      { id: 'ri-1', title: '本周热销水果', description: '根据你的购买偏好，推荐当季草莓和蓝莓', weight: 0.95, tags: ['应季', '热销'] },
      { id: 'ri-2', title: '健康饮食搭配', description: '低糖高纤维组合：燕麦 + 奇异果 + 坚果', weight: 0.88, tags: ['健康', '低糖'] },
      { id: 'ri-3', title: '复购提醒', description: '上次购买的有机鸡蛋即将用完，建议补货', weight: 0.82, tags: ['复购', '提醒'] },
    ];
  }

  /** AI 推荐方案（第一阶段：后端编排组合方案） */
  async getRecommendPlan(input: {
    query?: string;
    categoryId?: string;
    categoryName?: string;
    preferRecommended?: boolean;
    constraints?: string[];
    maxPrice?: number;
    recommendThemes?: string[];
    // 语义槽参数（来自语音意图解析）
    usageScenario?: string;
    promotionIntent?: string;
    bundleIntent?: string;
    originPreference?: string;
    dietaryPreference?: string;
    flavorPreference?: string;
    categoryHint?: string;
  }) {
    const query = this.cleanupSearchKeyword(input.query || '');
    const categoryId = this.pickFirstString(input.categoryId);
    const categoryName = this.pickFirstString(input.categoryName);
    const constraints = Array.from(new Set((input.constraints || []).map((item) => item.trim()).filter(Boolean)));
    const recommendThemes = this.pickRecommendThemes(input.recommendThemes || []);
    const maxPrice = typeof input.maxPrice === 'number' && Number.isFinite(input.maxPrice) && input.maxPrice > 0
      ? Math.round(input.maxPrice * 100) / 100
      : undefined;
    const preferRecommended = !!input.preferRecommended || recommendThemes.length > 0 || (!query && !categoryId && !maxPrice && constraints.length === 0);

    // 构造语义槽位对象，传递给商品搜索以提升匹配精度
    const slots = {
      usageScenario: input.usageScenario,
      promotionIntent: input.promotionIntent,
      bundleIntent: input.bundleIntent,
      originPreference: input.originPreference,
      dietaryPreference: input.dietaryPreference,
      flavorPreference: input.flavorPreference,
      categoryHint: input.categoryHint,
    };
    // 若 categoryHint 存在但 query 为空，将 categoryHint 作为搜索词兜底
    const effectiveQuery = query || (input.categoryHint ? input.categoryHint : '') || '';

    const productResult = await this.productService.list(
      1,
      8,
      categoryId || undefined,
      effectiveQuery || undefined,
      preferRecommended,
      constraints,
      maxPrice,
      recommendThemes,
      slots,
    );

    const products = productResult.items;
    const summary = this.buildRecommendPlanSummary({
      query,
      categoryName,
      budget: maxPrice,
      constraints,
      recommendThemes,
      preferRecommended,
    });
    const aiReason = this.buildRecommendPlanReason({
      budget: maxPrice,
      constraints,
      recommendThemes,
      preferRecommended,
    });
    const tags = this.buildRecommendPlanTags({
      query,
      categoryName,
      budget: maxPrice,
      constraints,
      recommendThemes,
      preferRecommended,
    });
    const plans = this.buildRecommendPlans(products, {
      budget: maxPrice,
      constraints,
      recommendThemes,
      preferRecommended,
    });

    return {
      query: query || undefined,
      categoryId: categoryId || undefined,
      categoryName: categoryName || undefined,
      budget: maxPrice,
      constraints,
      recommendThemes,
      preferRecommended,
      // 语义槽位原样透传，供前端在"查看全部"时回传给搜索页
      usageScenario: input.usageScenario,
      promotionIntent: input.promotionIntent,
      bundleIntent: input.bundleIntent,
      originPreference: input.originPreference,
      dietaryPreference: input.dietaryPreference,
      flavorPreference: input.flavorPreference,
      categoryHint: input.categoryHint,
      summary,
      aiReason,
      tags,
      products,
      plans,
    };
  }

  private buildRecommendPlanSummary(input: {
    query?: string;
    categoryName?: string;
    budget?: number;
    constraints: string[];
    recommendThemes: AiRecommendTheme[];
    preferRecommended: boolean;
  }) {
    const target = input.query || input.categoryName || '推荐商品';
    const descriptors = [
      ...input.recommendThemes.map((item) => this.getRecommendThemeLabel(item)),
      ...input.constraints.map((item) => this.RECOMMEND_CONSTRAINT_LABELS[item] || item),
      ...(input.preferRecommended ? ['AI优选'] : []),
    ].filter(Boolean);

    if (input.budget && descriptors.length > 0) {
      return `按 ¥${input.budget} 预算，为你挑选${descriptors.join('、')}${target === '推荐商品' ? '' : ` ${target}`}`;
    }
    if (input.budget) {
      return `按 ¥${input.budget} 预算，为你挑选更合适的${target}`;
    }
    if (descriptors.length > 0) {
      return `围绕${descriptors.join('、')}偏好，为你推荐${target}`;
    }
    return `为你整理了一组更值得先看的${target}`;
  }

  private buildRecommendPlanReason(input: {
    budget?: number;
    constraints: string[];
    recommendThemes: AiRecommendTheme[];
    preferRecommended: boolean;
  }) {
    const reasons = [
      ...input.recommendThemes.map((item) => this.getRecommendThemeLabel(item)),
      ...input.constraints.map((item) => this.RECOMMEND_CONSTRAINT_LABELS[item] || item),
    ];

    if (input.budget) {
      reasons.push(`预算 ¥${input.budget}`);
    }
    if (input.preferRecommended) {
      reasons.push('AI优选');
    }

    return Array.from(new Set(reasons)).slice(0, 3).join(' · ');
  }

  private buildRecommendPlanTags(input: {
    query?: string;
    categoryName?: string;
    budget?: number;
    constraints: string[];
    recommendThemes: AiRecommendTheme[];
    preferRecommended: boolean;
  }) {
    return Array.from(new Set([
      ...(input.query ? [input.query] : []),
      ...(input.categoryName ? [input.categoryName] : []),
      ...(input.budget ? [`预算 ¥${input.budget}`] : []),
      ...input.recommendThemes.map((item) => this.getRecommendThemeLabel(item)),
      ...input.constraints.map((item) => this.RECOMMEND_CONSTRAINT_LABELS[item] || item),
      ...(input.preferRecommended ? ['AI优选'] : []),
    ].filter(Boolean))).slice(0, 6);
  }

  private buildRecommendPlans(
    products: Array<{
      id: string;
      title: string;
      price: number;
      origin: string;
      tags: string[];
    }>,
    input: {
      budget?: number;
      constraints: string[];
      recommendThemes: AiRecommendTheme[];
      preferRecommended: boolean;
    },
  ) {
    if (!products.length) return [];

    const dedupe = new Set<string>();
    const plans: Array<{
      id: string;
      title: string;
      description: string;
      tone: 'brand' | 'accent' | 'analysis';
      totalPrice: number;
      products: typeof products;
      highlights: string[];
    }> = [];

    const createPlan = (
      id: string,
      title: string,
      tone: 'brand' | 'accent' | 'analysis',
      items: typeof products,
    ) => {
      const filtered = items.slice(0, 3);
      if (!filtered.length) return;
      const signature = filtered.map((item) => item.id).sort().join('|');
      if (!signature || dedupe.has(signature)) return;
      dedupe.add(signature);

      const totalPrice = filtered.reduce((sum, item) => sum + item.price, 0);
      const highlights = Array.from(new Set([
        ...(input.budget ? [`合计 ¥${totalPrice.toFixed(1)}`] : []),
        ...input.recommendThemes.map((item) => this.getRecommendThemeLabel(item)),
        ...input.constraints.map((item) => this.RECOMMEND_CONSTRAINT_LABELS[item] || item),
        ...filtered.flatMap((item) => item.tags || []).slice(0, 2),
        ...(input.preferRecommended ? ['AI优选'] : []),
      ].filter(Boolean))).slice(0, 4);

      plans.push({
        id,
        title,
        tone,
        totalPrice,
        products: filtered,
        description: this.buildRecommendPlanDescription(title, filtered, input.budget),
        highlights,
      });
    };

    createPlan(
      'steady',
      input.budget ? '预算内稳妥组合' : '今日优选组合',
      'brand',
      products.slice(0, 3),
    );

    if (input.budget) {
      const budgetCombo: typeof products = [];
      let budgetUsed = 0;
      for (const product of products) {
        if (budgetCombo.length >= 3) break;
        if (budgetUsed + product.price <= input.budget || budgetCombo.length === 0) {
          budgetCombo.push(product);
          budgetUsed += product.price;
        }
      }
      createPlan('budget', '控预算组合', 'accent', budgetCombo);

      const valueCombo = [...products]
        .sort((a, b) => (a.price - b.price) || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, 3);
      createPlan('value', '性价比组合', 'analysis', valueCombo);
    } else {
      createPlan(
        'quality',
        '标签优先组合',
        'accent',
        [...products].sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0)).slice(0, 3),
      );
      createPlan(
        'value',
        '轻量尝鲜组合',
        'analysis',
        [...products].sort((a, b) => a.price - b.price || a.title.localeCompare(b.title, 'zh-Hans-CN')).slice(0, 3),
      );
    }

    return plans.slice(0, 3);
  }

  private buildRecommendPlanDescription(
    title: string,
    products: Array<{ title: string }>,
    budget?: number,
  ) {
    const names = products.map((item) => item.title).slice(0, 3).join('、');
    if (budget) {
      return `${title}优先控制预算，把 ${names} 组合在一起，避免超支。`;
    }
    return `${title}优先把 ${names} 放在同一组，方便你直接比较和下单。`;
  }

  private getRecommendThemeLabel(theme: AiRecommendTheme) {
    const labelMap: Record<AiRecommendTheme, string> = {
      hot: '爆款',
      discount: '折扣',
      tasty: '好吃',
      seasonal: '当季',
      recent: '最近热门',
    };
    return labelMap[theme] || theme;
  }

  /** AI 金融服务列表（占位数据，接入真实金融服务后替换） */
  async getFinanceServices(_userId: string) {
    return [
      { id: 'fs-1', title: '农产品供应链金融', description: '基于订单流水的小额信贷服务', status: 'available', badge: '热门' },
      { id: 'fs-2', title: '农业保险', description: '天气灾害保险、农产品价格保险', status: 'available' },
      { id: 'fs-3', title: '分期付款', description: '大宗采购分期支付', status: 'soon', badge: '即将上线' },
      { id: 'fs-4', title: '理财产品', description: '农业主题稳健型理财', status: 'locked' },
    ];
  }
}
