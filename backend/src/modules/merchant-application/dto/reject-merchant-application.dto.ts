import { IsString, IsNotEmpty } from 'class-validator';

export class RejectMerchantApplicationDto {
  @IsString()
  @IsNotEmpty({ message: '拒绝原因不能为空' })
  reason: string;
}
