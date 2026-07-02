import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';

export enum ManualIssueTargetMode {
  SPECIFIC_USERS = 'SPECIFIC_USERS',
  ALL_USERS = 'ALL_USERS',
}

/** 管理员手动发放红包 DTO */
export class ManualIssueDto {
  @IsOptional()
  @IsEnum(ManualIssueTargetMode)
  targetMode?: ManualIssueTargetMode;

  @ValidateIf((dto) => dto.targetMode !== ManualIssueTargetMode.ALL_USERS)
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  userIds?: string[]; // 目标买家编号或用户 ID 列表
}
