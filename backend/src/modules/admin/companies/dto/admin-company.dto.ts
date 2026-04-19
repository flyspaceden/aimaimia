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

// ============ C40c9 管理员员工 CRUD + 换 OWNER ============
export class AdminAddStaffDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsIn(['MANAGER', 'OPERATOR'], { message: '只能添加 MANAGER 或 OPERATOR 员工，OWNER 走 transfer-owner' })
  role: 'MANAGER' | 'OPERATOR';

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;
}

export class AdminUpdateStaffDto {
  @IsOptional()
  @IsIn(['MANAGER', 'OPERATOR'], { message: '管理员不能设为 OWNER，走 transfer-owner' })
  role?: 'MANAGER' | 'OPERATOR';

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class AdminTransferOwnerDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '新 OWNER 手机号格式不正确' })
  newOwnerPhone: string;

  @IsIn(['DEMOTE_TO_MANAGER', 'REMOVE'], { message: '老 OWNER 处理方式只支持 DEMOTE_TO_MANAGER 或 REMOVE' })
  oldOwnerAction: 'DEMOTE_TO_MANAGER' | 'REMOVE';
}
