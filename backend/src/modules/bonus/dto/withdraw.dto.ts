import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** 申请提现 DTO */
export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsIn(['alipay', 'wechat'])
  channel?: 'alipay' | 'wechat';

  @ValidateIf((dto: WithdrawDto) => !dto.channel || dto.channel === 'alipay')
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  alipayAccount?: string;

  @ValidateIf((dto: WithdrawDto) => !dto.channel || dto.channel === 'alipay')
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  alipayName?: string;
}
