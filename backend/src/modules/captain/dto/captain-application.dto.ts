import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const CAPTAIN_APPLICATION_COMMUNITY_SCALES = [
  'NONE',
  'UNDER_50',
  'BETWEEN_50_200',
  'BETWEEN_200_500',
  'OVER_500',
] as const;

export const CAPTAIN_APPLICATION_EXPECTED_GMV = [
  'UNDER_3000',
  'BETWEEN_3000_10000',
  'BETWEEN_10000_30000',
  'OVER_30000',
] as const;

export const CAPTAIN_APPLICATION_SEAFOOD_EXPERIENCE = [
  'NONE',
  'BUYER',
  'SOLD_BEFORE',
  'SUPPLY_CHAIN_OR_GROUP_BUY',
] as const;

export const CAPTAIN_APPLICATION_RESOURCE_TYPES = [
  'MOMENTS',
  'WECHAT_GROUP',
  'VIDEO_ACCOUNT',
  'COMMUNITY',
  'RESTAURANT',
  'COMPANY_GROUP_BUY',
  'FRIENDS_FAMILY',
  'OTHER',
] as const;

export const CAPTAIN_APPLICATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type CaptainApplicationStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export class SubmitCaptainApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  realName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  contact: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city: string;

  @IsIn(CAPTAIN_APPLICATION_COMMUNITY_SCALES)
  communityScale: string;

  @IsIn(CAPTAIN_APPLICATION_EXPECTED_GMV)
  expectedMonthlyGmv: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(CAPTAIN_APPLICATION_RESOURCE_TYPES, { each: true })
  resourceTypes: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  promotionPlan: string;

  @IsIn(CAPTAIN_APPLICATION_SEAFOOD_EXPERIENCE)
  seafoodExperience: string;

  @Type(() => Boolean)
  @IsBoolean()
  complianceAccepted: boolean;
}

export class ApproveCaptainApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  captainCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string | null;
}

export class RejectCaptainApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}
