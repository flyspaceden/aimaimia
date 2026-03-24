import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RejectMerchantApplicationDto {
  @IsString()
  @IsNotEmpty({ message: '拒绝原因不能为空' })
  @MaxLength(1000)
  reason: string;
}
