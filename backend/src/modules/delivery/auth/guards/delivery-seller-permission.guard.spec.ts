import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeliverySellerPermissionGuard } from './delivery-seller-permission.guard';

describe('DeliverySellerPermissionGuard', () => {
  const buildContext = (user: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  const buildGuard = (requiredPermission?: string) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredPermission),
    };
    return new DeliverySellerPermissionGuard(reflector as unknown as Reflector);
  };

  it('allows endpoints without explicit seller permissions', () => {
    expect(
      buildGuard().canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: [],
        }),
      ),
    ).toBe(true);
  });

  it('allows owners even when the endpoint requires a permission code', () => {
    expect(
      buildGuard('finance:read').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OWNER',
          permissionCodes: [],
        }),
      ),
    ).toBe(true);
  });

  it('allows exact, delivery-prefixed, module wildcard, and global wildcard permissions', () => {
    expect(
      buildGuard('finance:read').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['finance:read'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('finance:read').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['delivery:finance:read'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('orders:write').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['orders:*'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('orders:write').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['delivery:*'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('orders:write').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['delivery:orders:manage'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('orders:read').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['orders:write'],
        }),
      ),
    ).toBe(true);
  });

  it('rejects seller staff without the required permission', () => {
    expect(() =>
      buildGuard('finance:read').canActivate(
        buildContext({
          type: 'delivery-seller',
          role: 'OPERATOR',
          permissionCodes: ['orders:write'],
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
