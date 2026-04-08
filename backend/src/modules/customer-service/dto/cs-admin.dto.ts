import { IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { CsFaqAnswerType, CsQuickEntryType, CsTicketPriority, CsTicketStatus } from '@prisma/client';

// --- FAQ ---
export class CreateCsFaqDto {
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsString()
  @IsNotEmpty()
  answer: string;

  @IsOptional()
  @IsEnum(CsFaqAnswerType)
  answerType?: CsFaqAnswerType;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdateCsFaqDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsString()
  answer?: string;

  @IsOptional()
  @IsEnum(CsFaqAnswerType)
  answerType?: CsFaqAnswerType;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
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
  message: string;
}

// --- Quick Entry ---
export class CreateCsQuickEntryDto {
  @IsEnum(CsQuickEntryType)
  type: CsQuickEntryType;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateCsQuickEntryDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
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
  items: { id: string; sortOrder: number }[];
}

// --- Quick Reply ---
export class CreateCsQuickReplyDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCsQuickReplyDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
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
