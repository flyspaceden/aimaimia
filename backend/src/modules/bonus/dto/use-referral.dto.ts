import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** 使用推荐码 DTO */
export class UseReferralDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code: string;
}
