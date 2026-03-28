import { IsString, IsNotEmpty, IsOptional, IsEnum, IsMobilePhone, IsObject, IsDateString, IsIn } from 'class-validator';
import { CompanyStaffRole, DocumentType } from '@prisma/client';

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

/** AI 搜索字段键名（用于 highlights merge 保护，包含历史字段以防旧数据覆盖） */
export const AI_SEARCH_KEYS = [
  'companyType', 'mainBusiness',
  'industryTags', 'productKeywords', 'productFeatures', 'certifications',
  'serviceAreas', 'supplyModes',
] as const;

/** 更新 AI 搜索资料 DTO（仅 companyType，其他字段已迁移到 CompanyTag） */
export class UpdateAiSearchProfileDto {
  @IsIn(COMPANY_TYPES)
  companyType: string;
}
