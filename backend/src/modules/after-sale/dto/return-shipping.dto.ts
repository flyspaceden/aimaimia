import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReturnShippingDto {
  /** 退货快递公司名称 */
  @IsNotEmpty({ message: '请填写快递公司名称' })
  @IsString({ message: 'returnCarrierName 必须为字符串' })
  @MaxLength(50, { message: '快递公司名称不能超过 50 个字符' })
  returnCarrierName: string;

  /** 退货快递单号 */
  @IsNotEmpty({ message: '请填写快递单号' })
  @IsString({ message: 'returnWaybillNo 必须为字符串' })
  @MaxLength(50, { message: '快递单号不能超过 50 个字符' })
  returnWaybillNo: string;
}
