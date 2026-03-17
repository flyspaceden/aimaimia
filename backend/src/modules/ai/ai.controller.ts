import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AiService } from './ai.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AiAssistantChatDto,
  AiCreateSessionDto,
  AiRecommendPlanQueryDto,
  AiSeedMessageDto,
  AiSendMessageDto,
  AiTraceOverviewQueryDto,
} from './dto/ai-request.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('ai')
export class AiController {
  private static readonly AI_CONTEXT_MAX_DEPTH = 6;
  private static readonly AI_CONTEXT_MAX_KEYS = 200;
  private static readonly AI_CONTEXT_MAX_ARRAY_ITEMS = 100;
  private static readonly AI_CONTEXT_MAX_STRING = 2000;

  constructor(private aiService: AiService) {}

  // ========== 前端简化 API（ai-assistant 风格） ==========

  /** 快捷入口列表 — 无需登录 */
  @Public()
  @Get('assistant/shortcuts')
  getShortcuts() {
    return this.aiService.getShortcuts();
  }

  /** 问候语 — 无需登录 */
  @Public()
  @Get('assistant/greeting')
  getGreeting() {
    return this.aiService.getGreeting();
  }

  /** 对话历史列表（N14修复） */
  @Get('assistant/history')
  getHistory(@CurrentUser('sub') userId: string) {
    return this.aiService.getChatHistory(userId);
  }

  /** 简单聊天（自动管理 session） */
  @Post('assistant/chat')
  async chat(
    @CurrentUser('sub') userId: string,
    @Body() dto: AiAssistantChatDto,
  ) {
    return this.aiService.simpleChat(userId, dto.message);
  }

  /** 语音意图解析：上传音频文件，返回识别结果和意图（限制 10MB）— 无需登录 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('voice-intent/prepare')
  async prepareVoiceIntent() {
    return this.aiService.prepareVoiceIntent();
  }

  /** 语音意图解析：上传音频文件，返回识别结果和意图（限制 10MB）— 无需登录 */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('voice-intent')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async parseVoiceIntent(
    @CurrentUser('sub') userId: string | undefined,
    @UploadedFile() audioFile: Express.Multer.File,
    @Query('prepareId') queryPrepareId?: string,
    @Query('sessionId') querySessionId?: string,
    @Query('page') queryPage?: string,
    @Body('prepareId') prepareId?: string,
    @Body('sessionId') sessionId?: string,
    @Body('page') page?: string,
  ) {
    if (!audioFile) {
      throw new BadRequestException('请上传音频文件');
    }

    // 根据 MIME 类型确定音频格式
    const format = this.getAudioFormat(audioFile.mimetype);
    const resolvedPrepareId = prepareId || queryPrepareId;
    const result = await this.aiService.parseVoiceIntent(
      audioFile.buffer,
      format,
      resolvedPrepareId,
      userId,
      sessionId || querySessionId,
      page || queryPage,
    );
    return result;
  }

  // ========== AI 功能入口 API（N14修复） ==========

  /** AI 溯源概览 */
  @Get('trace/overview')
  getTraceOverview(@Query() query: AiTraceOverviewQueryDto) {
    return this.aiService.getTraceOverview(query.productId);
  }

  /** AI 推荐洞察 */
  @Get('recommend/insights')
  getRecommendInsights(@CurrentUser('sub') userId: string) {
    return this.aiService.getRecommendInsights(userId);
  }

  /** AI 推荐方案 — 无需登录 */
  @Public()
  @Get('recommend/plan')
  getRecommendPlan(@Query() query: AiRecommendPlanQueryDto) {
    return this.aiService.getRecommendPlan({
      query: query.q,
      categoryId: query.categoryId,
      categoryName: query.categoryName,
      preferRecommended: query.preferRecommended === '1' || query.preferRecommended === 'true',
      constraints: query.constraints
        ? query.constraints.split(',').map((item) => item.trim()).filter(Boolean)
        : [],
      maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
      recommendThemes: query.recommendThemes
        ? query.recommendThemes.split(',').map((item) => item.trim()).filter(Boolean)
        : [],
      usageScenario: query.usageScenario,
      promotionIntent: query.promotionIntent,
      bundleIntent: query.bundleIntent,
      originPreference: query.originPreference,
      dietaryPreference: query.dietaryPreference,
      flavorPreference: query.flavorPreference,
      categoryHint: query.categoryHint,
    });
  }

  /** AI 金融服务列表 */
  @Get('finance/services')
  getFinanceServices(@CurrentUser('sub') userId: string) {
    return this.aiService.getFinanceServices(userId);
  }

  // ========== 完整 Session API ==========

  /** 创建会话 */
  @Post('sessions')
  createSession(
    @CurrentUser('sub') userId: string,
    @Body() dto: AiCreateSessionDto,
  ) {
    this.assertBoundedContext(dto.context);
    return this.aiService.createSession(userId, dto.page, dto.context);
  }

  /** 会话列表 */
  @Get('sessions')
  listSessions(@CurrentUser('sub') userId: string) {
    return this.aiService.listSessions(userId);
  }

  /** 最近对话预览（按 utterance，而不是按 session） */
  @Get('sessions/recent-conversations')
  listRecentConversations(
    @CurrentUser('sub') userId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Math.max(1, Math.min(10, Number(limit) || 3));
    return this.aiService.listRecentConversations(userId, parsedLimit);
  }

  /** 会话详情 */
  @Get('sessions/:id')
  getSession(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.aiService.getSession(id, userId);
  }

  /** 写入初始上下文（首页 → 聊天页，不调 Qwen） */
  @Post('sessions/:id/seed')
  seedMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: AiSeedMessageDto,
  ) {
    return this.aiService.seedMessage(id, userId, dto);
  }

  /** 发送消息 */
  @Post('sessions/:id/messages')
  sendMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: AiSendMessageDto,
  ) {
    return this.aiService.sendMessage(id, userId, dto);
  }

  // ========== 私有方法 ==========

  /**
   * 根据 MIME 类型映射为 ASR 支持的音频格式
   * 支持：pcm, wav, mp3, opus, speex, aac, amr
   */
  private getAudioFormat(mimetype: string): string {
    const formatMap: Record<string, string> = {
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'aac',
      'audio/m4a': 'aac',
      'audio/x-m4a': 'aac',
      'audio/aac': 'aac',
      'audio/ogg': 'opus',
      'audio/opus': 'opus',
      'audio/webm': 'opus',
      'audio/amr': 'amr',
      'audio/pcm': 'pcm',
      'audio/x-pcm': 'pcm',
      'audio/speex': 'speex',
      // iOS 录音常用格式
      'audio/x-caf': 'wav',
      'audio/caf': 'wav',
    };

    const format = formatMap[mimetype.toLowerCase()];
    if (format) return format;

    // 尝试从 mimetype 提取格式名
    const match = mimetype.match(/audio\/(\w+)/);
    if (match) return match[1];

    // 默认 wav
    return 'wav';
  }

  /**
   * M10修复（基础版）：限制 AI session context 的深度/键数量/数组大小，避免异常 JSON 造成内存开销。
   * 说明：全局 body limit 已限制总体大小，这里补结构复杂度限制。
   */
  private assertBoundedContext(value: unknown) {
    if (value === null || value === undefined) return;

    const state = { keyCount: 0 };
    const walk = (node: unknown, depth: number) => {
      if (depth > AiController.AI_CONTEXT_MAX_DEPTH) {
        throw new BadRequestException(`AI context 嵌套层级过深（最大 ${AiController.AI_CONTEXT_MAX_DEPTH} 层）`);
      }
      if (node === null || node === undefined) return;
      if (typeof node === 'string') {
        if (node.length > AiController.AI_CONTEXT_MAX_STRING) {
          throw new BadRequestException(`AI context 字符串过长（最大 ${AiController.AI_CONTEXT_MAX_STRING} 字符）`);
        }
        return;
      }
      if (typeof node !== 'object') return;

      if (Array.isArray(node)) {
        if (node.length > AiController.AI_CONTEXT_MAX_ARRAY_ITEMS) {
          throw new BadRequestException(`AI context 数组元素过多（最大 ${AiController.AI_CONTEXT_MAX_ARRAY_ITEMS} 个）`);
        }
        for (const item of node) walk(item, depth + 1);
        return;
      }

      const entries = Object.entries(node as Record<string, unknown>);
      state.keyCount += entries.length;
      if (state.keyCount > AiController.AI_CONTEXT_MAX_KEYS) {
        throw new BadRequestException(`AI context 键数量过多（最大 ${AiController.AI_CONTEXT_MAX_KEYS} 个）`);
      }
      for (const [, child] of entries) walk(child, depth + 1);
    };

    walk(value, 0);
  }
}
