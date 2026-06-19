import { IsMobilePhone } from 'class-validator';

export class DeliverySmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone!: string;
}
