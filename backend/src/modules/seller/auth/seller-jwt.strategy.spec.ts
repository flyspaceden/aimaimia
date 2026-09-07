import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SellerJwtStrategy, SellerJwtPayload } from './seller-jwt.strategy';
import { SellerRoleGuard } from '../common/guards/seller-role.guard';
import { PickupSellerPointController } from '../../pickup/pickup-seller.controller';

describe('seller JWT live staff authority', () => {
  const payload: SellerJwtPayload = { sub: 'staff', userId: 'buyer', companyId: 'company', role: 'MANAGER', type: 'seller', sessionId: 'session' };
  const make = (staff: any = { status: 'ACTIVE', companyId: 'company', role: 'MANAGER' }, session: any = { id: 'session' }) => {
    const prisma = { sellerSession: { findFirst: jest.fn().mockResolvedValue(session) }, companyStaff: { findUnique: jest.fn().mockResolvedValue(staff) } };
    return { prisma, strategy: new SellerJwtStrategy({ getOrThrow: () => 'test-only-secret' } as any, prisma as any) };
  };
  it('uses database OPERATOR after MANAGER downgrade and denies actual pickup point write endpoints', async () => {
    const { strategy, prisma } = make({ status: 'ACTIVE', companyId: 'company', role: 'OPERATOR' });
    const user = await strategy.validate(payload);
    expect(user.role).toBe('OPERATOR');
    expect(prisma.companyStaff.findUnique).toHaveBeenCalledWith({ where: { id: 'staff' }, select: { status: true, companyId: true, role: true } });
    const guard = new SellerRoleGuard(new Reflector());
    for (const handler of [PickupSellerPointController.prototype.create, PickupSellerPointController.prototype.update]) {
      const context = { getHandler: () => handler, getClass: () => PickupSellerPointController, switchToHttp: () => ({ getRequest: () => ({ user }) }) };
      expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
    }
  });
  it('preserves active manager identity and exact session scope', async () => {
    const { strategy, prisma } = make();
    expect(await strategy.validate(payload)).toEqual(payload);
    expect(prisma.sellerSession.findFirst).toHaveBeenCalledWith({ where: { id: 'session', staffId: 'staff', expiresAt: { gt: expect.any(Date) } } });
  });
  it('retains legacy token session verification', async () => {
    const { strategy, prisma } = make();
    await strategy.validate({ ...payload, sessionId: undefined });
    expect(prisma.sellerSession.findFirst).toHaveBeenCalledWith({ where: { staffId: 'staff', expiresAt: { gt: expect.any(Date) } } });
  });
  it('rejects disabled staff', async () => {
    await expect(make({ status: 'DISABLED', companyId: 'company', role: 'MANAGER' }).strategy.validate(payload)).rejects.toThrow(ForbiddenException);
  });
  it('rejects transferred staff', async () => {
    await expect(make({ status: 'ACTIVE', companyId: 'other', role: 'MANAGER' }).strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
  it('rejects expired sessions before reading staff', async () => {
    const { strategy, prisma } = make(undefined, null);
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    expect(prisma.companyStaff.findUnique).not.toHaveBeenCalled();
  });
});
