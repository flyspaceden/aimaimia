import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 上报分享事件 DTO（用于触发 SHARE 红包） */
export class TriggerShareDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  scene?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;
}
