import { GroupService } from './group.service';
import { validate } from 'class-validator';
import { GroupStatus } from '@prisma/client';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupStatusDto } from './dto/update-group-status.dto';

describe('GroupService buyer company visibility', () => {
  it('filters public group lists by active non-platform company', async () => {
    const prisma = {
      group: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new GroupService(prisma as any);

    await service.list();
    expect(prisma.group.findMany).toHaveBeenCalledWith({
      where: { company: { status: 'ACTIVE', isPlatform: false } },
      orderBy: { createdAt: 'desc' },
    });

    await service.listByCompany('company-1');
    expect(prisma.group.findMany).toHaveBeenLastCalledWith({
      where: {
        companyId: 'company-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('uses the same company filter for public detail', async () => {
    const prisma = {
      group: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new GroupService(prisma as any);

    await expect(service.getById('group-1')).rejects.toThrow('考察团不存在');
    expect(prisma.group.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
    });
  });
});

describe('Group DTO contracts', () => {
  it('accepts ISO deadlines and rejects non-date strings', async () => {
    const valid = Object.assign(new CreateGroupDto(), {
      companyId: 'company-1',
      title: '考察团',
      destination: '云南',
      targetSize: 2,
      deadline: '2099-08-31',
    });
    await expect(validate(valid)).resolves.toHaveLength(0);

    valid.deadline = 'tomorrow';
    expect(await validate(valid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'deadline' }),
    ]));
  });

  it('accepts only the Prisma GroupStatus enum', async () => {
    const dto = Object.assign(new UpdateGroupStatusDto(), { status: GroupStatus.FULL });
    await expect(validate(dto)).resolves.toHaveLength(0);

    (dto as any).status = 'completed';
    expect(await validate(dto)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'status' }),
    ]));
  });
});
