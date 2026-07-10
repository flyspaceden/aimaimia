import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CsSocketAuthService } from './cs-socket-auth.service';

function createMocks() {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    session: { findFirst: jest.fn() },
    adminSession: { findFirst: jest.fn() },
    adminUser: { findUnique: jest.fn() },
  };
  const jwtService: any = { verify: jest.fn() };
  const configService: any = {
    getOrThrow: jest.fn((key: string) => (
      key === 'JWT_SECRET' ? 'buyer-secret' : 'admin-secret'
    )),
  };
  const service = new CsSocketAuthService(prisma, jwtService, configService);
  return { service, prisma, jwtService };
}

describe('CsSocketAuthService', () => {
  it('并行查询买家账号和登录会话，避免串行数据库往返', async () => {
    const { service, prisma, jwtService } = createMocks();
    jwtService.verify.mockReturnValue({ sub: 'user-1', sessionId: 'buyer-session-1' });

    let resolveUser!: (value: { status: string }) => void;
    let resolveSession!: (value: { id: string }) => void;
    prisma.user.findUnique.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    prisma.session.findFirst.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));

    const pendingAuth = service.authenticate('token');
    await Promise.resolve();
    const bothQueriesStarted = prisma.user.findUnique.mock.calls.length === 1
      && prisma.session.findFirst.mock.calls.length === 1;

    resolveUser({ status: 'ACTIVE' });
    resolveSession({ id: 'buyer-session-1' });
    await expect(pendingAuth).resolves.toEqual({ userId: 'user-1' });
    expect(bothQueriesStarted).toBe(true);
  });

  it('拒绝已注销的买家登录会话', async () => {
    const { service, prisma, jwtService } = createMocks();
    jwtService.verify.mockReturnValue({ sub: 'user-1', sessionId: 'buyer-session-1' });
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.session.findFirst.mockResolvedValue(null);

    await expect(service.authenticate('token')).rejects.toThrow(UnauthorizedException);
  });

  it('拒绝已禁用的管理员账号', async () => {
    const { service, prisma, jwtService } = createMocks();
    jwtService.verify
      .mockImplementationOnce(() => { throw new Error('not buyer'); })
      .mockReturnValueOnce({ sub: 'admin-1', sessionId: 'admin-session-1' });
    prisma.adminSession.findFirst.mockResolvedValue({ id: 'admin-session-1' });
    prisma.adminUser.findUnique.mockResolvedValue({ status: 'DISABLED', userRoles: [] });

    await expect(service.authenticate('token')).rejects.toThrow(ForbiddenException);
  });

  it('拒绝没有客服读取权限的管理员', async () => {
    const { service, prisma, jwtService } = createMocks();
    jwtService.verify
      .mockImplementationOnce(() => { throw new Error('not buyer'); })
      .mockReturnValueOnce({ sub: 'admin-1', sessionId: 'admin-session-1' });
    prisma.adminSession.findFirst.mockResolvedValue({ id: 'admin-session-1' });
    prisma.adminUser.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      userRoles: [{ role: { name: '员工', rolePermissions: [] } }],
    });

    await expect(service.authenticate('token')).rejects.toThrow(ForbiddenException);
  });

  it('按数据库实时权限返回管理员能力，不信任 JWT 中缓存权限', async () => {
    const { service, prisma, jwtService } = createMocks();
    jwtService.verify
      .mockImplementationOnce(() => { throw new Error('not buyer'); })
      .mockReturnValueOnce({
        sub: 'admin-1',
        sessionId: 'admin-session-1',
        permissions: ['cs:manage'],
      });
    prisma.adminSession.findFirst.mockResolvedValue({ id: 'admin-session-1' });
    prisma.adminUser.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      userRoles: [{
        role: {
          name: '客服只读',
          rolePermissions: [{ permission: { code: 'cs:read' } }],
        },
      }],
    });

    await expect(service.authenticate('token')).resolves.toEqual({
      adminId: 'admin-1',
      canRead: true,
      canManage: false,
    });
  });
});
