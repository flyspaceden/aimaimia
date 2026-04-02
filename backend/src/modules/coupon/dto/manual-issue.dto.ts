import {
  IsArray,
  IsString,
  ArrayMinSize,
} from 'class-validator';

/** 管理员手动发放红包 DTO */
export class ManualIssueDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  userIds: string[]; // 目标用户 ID 列表
}
