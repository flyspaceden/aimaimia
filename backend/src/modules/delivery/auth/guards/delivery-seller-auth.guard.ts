import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DeliveryPrismaService } from '../../../../delivery-prisma/delivery-prisma.service';

@Injectable()
export class DeliverySellerAuthGuard extends AuthGuard('delivery-seller-jwt') {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = await super.canActivate(context);
    if (!result) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    const seller = request.user;

    if (seller?.merchantId) {
      const merchant = await this.deliveryPrisma.deliveryMerchant.findUnique({
        where: { id: seller.merchantId },
        select: { status: true },
      });

      if (!merchant || merchant.status !== 'ACTIVE') {
        throw new ForbiddenException('配送中心商家已停用，请联系平台管理员');
      }
    }

    return true;
  }
}
