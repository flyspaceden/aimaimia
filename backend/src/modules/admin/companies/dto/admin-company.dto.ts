import { IsString, IsOptional, IsEnum, IsObject, IsArray, ArrayMinSize, IsIn, IsNotEmpty, IsMobilePhone } from 'class-validator';
import { CompanyStatus, VerifyStatus } from '@prisma/client';

export class AdminUpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  shortName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  servicePhone?: string;

  @IsOptional()
  @IsString()
  serviceWeChat?: string;

  @IsOptional()
  @IsObject()
  address?: Record<string, any>;

  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;
}

export class AdminAuditCompanyDto {
  @IsEnum(CompanyStatus)
  status: CompanyStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

export class AdminUpdateHighlightsDto {
  @IsObject()
  highlights: Record<string, string>;
}

export class AdminVerifyDocumentDto {
  @IsEnum(VerifyStatus)
  verifyStatus: VerifyStatus;

  @IsOptional()
  @IsString()
  verifyNote?: string;
}

export class BindOwnerDto {
  @IsString()
  phone: string;
}

// ============ AI 搜索资料（管理端） ============

const COMPANY_TYPES = ['farm', 'company', 'cooperative', 'base', 'factory', 'store'] as const;
const INDUSTRY_TAGS = ['水果', '蔬菜', '粮油', '肉禽', '水产', '茶叶', '蜂蜜', '乳制品', '其他'] as const;
const PRODUCT_FEATURES = ['有机', '可溯源', '冷链', '认证'] as const;
const CERTIFICATIONS_LIST = ['有机认证', '绿色食品', '地理标志'] as const;

export class AdminUpdateAiSearchProfileDto {
  @IsIn([...COMPANY_TYPES])
  companyType: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn([...INDUSTRY_TAGS], { each: true })
  industryTags: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productKeywords?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn([...PRODUCT_FEATURES], { each: true })
  productFeatures: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn([...CERTIFICATIONS_LIST], { each: true })
  certifications?: string[];
}

export class AdminCreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsOptional()
  @IsString()
  description?: string;
}
