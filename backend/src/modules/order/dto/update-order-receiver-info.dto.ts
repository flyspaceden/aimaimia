import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdateOrderReceiverInfoDto {
  @IsString({ message: 'recipientName 必须为字符串' })
  @MaxLength(50, { message: 'recipientName 不能超过 50 个字符' })
  recipientName!: string;

  @IsString({ message: 'phone 必须为字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的手机号' })
  phone!: string;

  @IsString({ message: 'regionCode 必须为字符串' })
  @MaxLength(32, { message: 'regionCode 不能超过 32 个字符' })
  regionCode!: string;

  @IsString({ message: 'regionText 必须为字符串' })
  @MaxLength(120, { message: 'regionText 不能超过 120 个字符' })
  regionText!: string;

  @IsString({ message: 'detail 必须为字符串' })
  @MaxLength(200, { message: 'detail 不能超过 200 个字符' })
  detail!: string;
}
