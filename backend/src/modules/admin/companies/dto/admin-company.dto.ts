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

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname?: string;
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

  @IsIn(['MANAGER', 'OPERATOR'], { message: '只能添加经理或运营员工，创始人请使用「转让创始人」功能' })
  role: 'MANAGER' | 'OPERATOR';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;
}

export class AdminUpdateStaffDto {
  @IsOptional()
  @IsIn(['MANAGER', 'OPERATOR'], { message: '编辑员工仅支持经理或运营，创始人请使用「转让创始人」功能' })
  role?: 'MANAGER' | 'OPERATOR';

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class AdminTransferOwnerDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '新创始人手机号格式不正确' })
  newOwnerPhone: string;

  @IsIn(['DEMOTE_TO_MANAGER', 'REMOVE'], { message: '原创始人处理方式只支持「降级为经理」或「移除出企业」' })
  oldOwnerAction: 'DEMOTE_TO_MANAGER' | 'REMOVE';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname?: string;
}

// 管理员直接修改员工昵称（对应员工列表「用户」列后的 ✏️）
export class AdminUpdateStaffNicknameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname: string;
}

// 管理员直接修改员工手机号（对应员工列表「操作」列的「修改手机号」按钮）
export class AdminUpdateStaffPhoneDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  newPhone: string;
}
