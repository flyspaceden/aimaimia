import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PERMISSION_KEY } from '../admin/common/decorators/require-permission';
import {
  AdminPickupPointQueryDto,
  AdminPickupPointReasonDto,
} from './dto/pickup-point.dto';
import {
  PickupAdminOrderController,
  PickupAdminPointController,
  PickupAdminVerificationController,
} from './pickup-admin.controller';

describe('PickupAdminPointController contract', () => {
  it('uses dedicated least-privilege permissions for every point operation', () => {
    const prototype = PickupAdminPointController.prototype;
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.companyOptions)).toBe('pickup_points:read');
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.list)).toBe('pickup_points:read');
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.create)).toBe('pickup_points:create');
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.update)).toBe('pickup_points:update');
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.remove)).toBe('pickup_points:delete');
    expect(Reflect.getMetadata(PERMISSION_KEY, prototype.restore)).toBe('pickup_points:delete');
  });

  it('requires the separate platform-fulfillment permission for platform ready and verify actions', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, PickupAdminOrderController.prototype.ready))
      .toBe('pickup_fulfillment:operate');
    expect(Reflect.getMetadata(PERMISSION_KEY, PickupAdminOrderController.prototype.verify))
      .toBe('pickup_fulfillment:operate');
    expect(Reflect.getMetadata(PERMISSION_KEY, PickupAdminVerificationController.prototype.resolve))
      .toBe('pickup_fulfillment:operate');
    expect(Reflect.getMetadata(PERMISSION_KEY, PickupAdminVerificationController.prototype.verify))
      .toBe('pickup_fulfillment:operate');
  });

  it('parses false query flags as false instead of JavaScript truthiness', () => {
    const query = plainToInstance(AdminPickupPointQueryDto, {
      page: '2',
      pageSize: '10',
      isActive: 'false',
      isDeleted: 'false',
    }, { enableImplicitConversion: true });
    expect(validateSync(query)).toHaveLength(0);
    expect(query).toMatchObject({ page: 2, pageSize: 10, isActive: false, isDeleted: false });
  });

  it('requires a non-empty reason for delete and restore', () => {
    const empty = plainToInstance(AdminPickupPointReasonDto, { reason: '' });
    const valid = plainToInstance(AdminPickupPointReasonDto, { reason: '门店停止合作' });
    expect(validateSync(empty).length).toBeGreaterThan(0);
    expect(validateSync(valid)).toHaveLength(0);
  });

  it('does not expand existing non-super-admin privileges during migration', () => {
    const migration = readFileSync(join(
      process.cwd(),
      'prisma/migrations/20260814220000_admin_pickup_point_management/migration.sql',
    ), 'utf8');
    const roleGrant = migration.slice(migration.indexOf('INSERT INTO "AdminRolePermission"'));
    expect(roleGrant).toContain(`r."name" = '超级管理员'`);
    expect(roleGrant).not.toContain(`r."name" = '经理'`);
    expect(roleGrant).not.toContain(`r."name" = '员工'`);
  });

  it('grants center-warehouse operation only to the super-admin role during migration', () => {
    const migration = readFileSync(join(
      process.cwd(),
      'prisma/migrations/20260816010000_add_platform_hub_pickup_points/migration.sql',
    ), 'utf8');
    const roleGrant = migration.slice(migration.indexOf('INSERT INTO "AdminRolePermission"'));
    expect(migration).toContain(`'pickup_fulfillment:operate'`);
    expect(roleGrant).toContain('"id", "roleId", "permissionId", "createdAt"');
    expect(roleGrant).toContain(`'rpf_' || md5(r."id" || ':' || p."id")`);
    expect(roleGrant).toContain(`r."name" = '超级管理员'`);
    expect(roleGrant).not.toContain(`r."name" = '经理'`);
    expect(roleGrant).not.toContain(`r."name" = '员工'`);
  });
});
