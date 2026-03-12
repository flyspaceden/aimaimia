import { IsString, IsNotEmpty, IsOptional, IsEnum, IsMobilePhone, IsUrl, IsObject, ValidateNested, IsDateString, IsArray, ArrayMinSize, IsIn } from 'class-validator';
import { CompanyStaffRole, DocumentType } from '@prisma/client';
import { Type } from 'class-transformer';

/** 更新企业信息 */
export class UpdateCompanyDto {
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
  contact?: any; // JSON

  @IsOptional()
  address?: any; // JSON { text, lat, lng }
}

/** 邀请员工 */
export class InviteStaffDto {
  @IsMobilePhone('zh-CN')
  phone: string; // 被邀请人手机号

  @IsEnum(CompanyStaffRole)
  role: CompanyStaffRole;
}

/** 修改员工角色/状态 */
export class UpdateStaffDto {
  @IsOptional()
  @IsEnum(CompanyStaffRole)
  role?: CompanyStaffRole;

  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'DISABLED';
}

/** 更新企业亮点 DTO（H15: 替换内联 { highlights: any }） */
export class UpdateHighlightsDto {
  @IsObject()
  highlights: Record<string, any>;
}

/** 上传资质文件 DTO（H15: 替换内联 { type, title, fileUrl, ... }） */
export class AddDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsOptional()
  @IsString()
  issuer?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// ============ AI 搜索资料枚举常量 ============

export const COMPANY_TYPES = ['farm', 'company', 'cooperative', 'base', 'factory', 'store'] as const;
export const INDUSTRY_TAGS = ['水果', '蔬菜', '粮油', '肉禽', '水产', '茶叶', '蜂蜜', '乳制品', '其他'] as const;
export const PRODUCT_FEATURES = ['有机', '可溯源', '冷链', '认证'] as const;
export const SUPPLY_MODES = ['批发', '零售', '直供', '同城配送', '可预约考察'] as const;
export const CERTIFICATIONS = ['有机认证', '绿色食品', '地理标志'] as const;

/** AI 搜索字段键名（用于 highlights merge 保护） */
export const AI_SEARCH_KEYS = [
  'companyType', 'industryTags', 'productKeywords', 'serviceAreas',
  'productFeatures', 'supplyModes', 'certifications', 'mainBusiness', 'badges',
] as const;

/** 更新 AI 搜索资料 DTO */
export class UpdateAiSearchProfileDto {
  @IsIn(COMPANY_TYPES)
  companyType: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(INDUSTRY_TAGS, { each: true })
  industryTags: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productKeywords?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  serviceAreas: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(PRODUCT_FEATURES, { each: true })
  productFeatures: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(SUPPLY_MODES, { each: true })
  supplyModes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(CERTIFICATIONS, { each: true })
  certifications?: string[];
}
