import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { CsFaqAnswerType, CsQuickEntryType, CsTicketPriority, CsTicketStatus } from '@prisma/client';

// --- FAQ ---
export class CreateCsFaqDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @MaxLength(50, { each: true })
  keywords: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^[^(]*$/, { message: '正则表达式不允许包含嵌套量词（防 ReDoS）' })
  pattern?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  answer: string;

  @IsOptional()
  @IsEnum(CsFaqAnswerType)
  answerType?: CsFaqAnswerType;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdateCsFaqDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @MaxLength(50, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answer?: string;

  @IsOptional()
  @IsEnum(CsFaqAnswerType)
  answerType?: CsFaqAnswerType;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class TestCsFaqDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message: string;
}

// --- Quick Entry ---
export class CreateCsQuickEntryDto {
  @IsEnum(CsQuickEntryType)
  type: CsQuickEntryType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;
}

export class UpdateCsQuickEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class BatchSortDto {
  @IsArray()
  @ArrayMaxSize(100)
  items: { id: string; sortOrder: number }[];
}

// --- Quick Reply ---
export class CreateCsQuickReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCsQuickReplyDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// --- Ticket ---
export class UpdateCsTicketDto {
  @IsOptional()
  @IsEnum(CsTicketStatus)
  status?: CsTicketStatus;

  @IsOptional()
  @IsEnum(CsTicketPriority)
  priority?: CsTicketPriority;
}
