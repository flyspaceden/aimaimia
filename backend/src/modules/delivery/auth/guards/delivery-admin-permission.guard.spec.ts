import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeliveryAdminPermissionGuard } from './delivery-admin-permission.guard';

describe('DeliveryAdminPermissionGuard', () => {
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
    return {
      guard: new DeliveryAdminPermissionGuard(reflector as unknown as Reflector),
      reflector,
    };
  };

  it('allows delivery admins when no endpoint permission is required', () => {
    const { guard } = buildGuard(undefined);

    expect(
      guard.canActivate(
        buildContext({
          type: 'delivery-admin',
          permissions: [],
        }),
      ),
    ).toBe(true);
  });

  it('allows exact, module wildcard, and delivery wildcard permissions', () => {
    expect(
      buildGuard('delivery:orders:read').guard.canActivate(
        buildContext({
          type: 'delivery-admin',
          permissions: ['delivery:orders:read'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('delivery:orders:write').guard.canActivate(
        buildContext({
          type: 'delivery-admin',
          permissions: ['delivery:orders:*'],
        }),
      ),
    ).toBe(true);

    expect(
      buildGuard('delivery:pricing:write').guard.canActivate(
        buildContext({
          type: 'delivery-admin',
          permissions: ['delivery:*'],
        }),
      ),
    ).toBe(true);
  });

  it('rejects delivery admins without the required permission', () => {
    const { guard } = buildGuard('delivery:pricing:write');

    expect(() =>
      guard.canActivate(
        buildContext({
          type: 'delivery-admin',
          permissions: ['delivery:orders:read'],
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
