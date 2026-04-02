import { IsNumber, IsPositive, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** 申请提现 DTO */
export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  channel: string;
}
