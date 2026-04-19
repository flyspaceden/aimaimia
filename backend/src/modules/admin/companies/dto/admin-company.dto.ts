import { IsString, IsOptional, IsEnum, IsObject, IsIn, IsNotEmpty, Matches, MinLength, MaxLength } from 'class-validator';
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

export class AdminUpdateAiSearchProfileDto {
  @IsIn([...COMPANY_TYPES])
  companyType: string;
}

export class AdminCreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsString()
  @Matches(/^1\d{10}$/, { message: '请输入正确的手机号' })
  phone: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsOptional()
  @IsString()
  description?: string;
}

// ============ C40c8 管理员兜底重置员工密码 ============
export class AdminResetStaffPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}
