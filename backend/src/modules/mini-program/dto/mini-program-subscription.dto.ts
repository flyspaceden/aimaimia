import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const MINI_PROGRAM_SUBSCRIPTION_KEYS = [
  'ORDER_SHIPPED',
  'AFTER_SALE_RESULT',
  'WITHDRAW_RESULT',
] as const;

export class MiniProgramSubscriptionConsentItemDto {
  @IsIn(MINI_PROGRAM_SUBSCRIPTION_KEYS)
  key: typeof MINI_PROGRAM_SUBSCRIPTION_KEYS[number];

  @IsString()
  @MaxLength(128)
  templateId: string;

  @IsIn(['accept', 'reject', 'ban', 'filter'])
  status: 'accept' | 'reject' | 'ban' | 'filter';
}

export class RecordMiniProgramSubscriptionConsentsDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  clientRequestId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => MiniProgramSubscriptionConsentItemDto)
  results: MiniProgramSubscriptionConsentItemDto[];
}
