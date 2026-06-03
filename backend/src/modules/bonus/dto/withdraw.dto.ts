import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** 申请提现 DTO */
export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsIn(['alipay'])
  channel?: 'alipay';

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  alipayAccount: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  alipayName: string;
}
