import { IsIn } from 'class-validator';

export class PayOrderDto {
  // 只接受前端小写格式，后端通过 CHANNEL_MAP 转换为 Prisma 枚举值
  @IsIn(['wechat', 'alipay', 'bankcard'])
  paymentMethod: string;
}
