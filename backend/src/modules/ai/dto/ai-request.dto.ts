import { IsNotEmpty, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class AiAssistantChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}

export class AiCreateSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  page: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, any>;
}

export class AiSendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  transcript: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(1000)
  audioUrl?: string;
}

export class AiSeedMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  transcript: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  reply: string;
}

export class AiTraceOverviewQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;
}

export class AiRecommendPlanQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  preferRecommended?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  constraints?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  maxPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  recommendThemes?: string;

  // 语义槽参数（来自语音意图解析）
  @IsOptional()
  @IsString()
  @MaxLength(128)
  usageScenario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  promotionIntent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bundleIntent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  originPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  dietaryPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  flavorPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  categoryHint?: string;
}
