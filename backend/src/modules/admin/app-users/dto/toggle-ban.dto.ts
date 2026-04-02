import { IsIn, IsOptional, IsString } from 'class-validator';

/** H16: 用户封禁/解封 DTO（替换 @Body('status')） */
export class ToggleBanDto {
  @IsIn(['ACTIVE', 'BANNED'])
  status: 'ACTIVE' | 'BANNED';

  @IsOptional()
  @IsString()
  reason?: string;
}
