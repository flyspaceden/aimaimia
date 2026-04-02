import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class SellerAuthGuard extends AuthGuard('seller-jwt') {
  constructor(private prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 先执行 JWT 校验（Passport 策略）
    const result = await super.canActivate(context);
    if (!result) return false;

    // M05修复：JWT 校验通过后，再检查企业状态
    // 防止企业被停用后，已颁发的 JWT 仍然可以访问
    const request = context.switchToHttp().getRequest();
    const seller = request.user;

    if (seller?.companyId) {
      const company = await this.prisma.company.findUnique({
        where: { id: seller.companyId },
        select: { status: true, suspendedUntil: true, creditScore: true },
      });

      let status = company?.status;
      if (
        company &&
        company.status === 'SUSPENDED' &&
        company.suspendedUntil &&
        company.suspendedUntil <= new Date() &&
        company.creditScore >= 40
      ) {
        const restored = await this.prisma.company.update({
          where: { id: seller.companyId },
          data: { status: 'ACTIVE', suspendedUntil: null },
          select: { status: true },
        });
        status = restored.status;
      }

      if (!company || status !== 'ACTIVE') {
        throw new ForbiddenException('企业已停用，请联系管理员');
      }
    }

    return true;
  }
}
