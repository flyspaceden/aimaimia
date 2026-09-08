import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { PrismaModule } from '../../../prisma/prisma.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminFundLedgerModule } from './admin-fund-ledger.module';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { ResultWrapperInterceptor } from '../../../common/interceptors/result-wrapper.interceptor';

const suite = process.env.FUND_LEDGER_INTEGRATION === '1' ? describe : describe.skip;
suite('基金 API 数据库与实时权限集成（本机测试身份）', () => {
  let app: INestApplication; let db: PrismaService; let superId: string; let readerId: string;
  const prefix = `fund-http-${Date.now()}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fund_test')) throw new Error('仅允许隔离本机测试库');
    const module = await Test.createTestingModule({ imports: [PrismaModule, AdminFundLedgerModule] })
      .overrideGuard(AdminAuthGuard).useValue({ canActivate(context: { switchToHttp(): { getRequest(): { headers: Record<string,string>; user: unknown } } }) {
        const req = context.switchToHttp().getRequest();
        if (!req.headers['x-local-test-admin']) throw new UnauthorizedException();
        req.user = { sub: req.headers['x-local-test-admin'], type: 'admin', roles: [], permissions: [] }; return true;
      } }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResultWrapperInterceptor()); await app.init(); db = module.get(PrismaService);
    const role = await db.adminRole.upsert({ where: { name: '超级管理员' }, create: { name: '超级管理员' }, update: {} });
    const admin = await db.adminUser.create({ data: { username: `${prefix}-super`, passwordHash: 'TEST_ONLY_NOT_LOGIN', userRoles: { create: { roleId: role.id } } } }); superId = admin.id;
    const readerRole = await db.adminRole.create({ data: { name: `${prefix}-reader`, rolePermissions: { create: [{ permission: { connect: { code: 'industry_funds:read' } } }, { permission: { connect: { code: 'fund_ledgers:read' } } }] } } });
    readerId = (await db.adminUser.create({ data: { username: `${prefix}-reader`, passwordHash: 'TEST_ONLY_NOT_LOGIN', userRoles: { create: { roleId: readerRole.id } } } })).id;
  });
  afterAll(async () => { await app?.close(); });
  const get = (path: string, admin = superId) => request(app.getHttpServer()).get(path).set('x-local-test-admin', admin);
  it('无测试身份被拒绝；只读管理员不能登记付款', async () => {
    await request(app.getHttpServer()).get('/admin/fund-ledgers/summary').expect(401);
    await request(app.getHttpServer()).post('/admin/industry-funds/payments').set('x-local-test-admin', readerId).send({}).expect(403);
  });
  it('总账、公司分页与筛选是有效 JSON 信封，无效参数返回400', async () => {
    const response = await get('/admin/fund-ledgers/summary').expect(200);
    expect(response.body).toMatchObject({ ok: true, data: { funds: expect.any(Array) } });
    await get('/admin/industry-funds/companies?page=1&pageSize=20').expect(200);
    await get('/admin/industry-funds/unassigned').expect(200);
    await get('/admin/fund-ledgers/CHARITY_FUND/entries').expect(200);
    await get('/admin/fund-ledgers/INVALID/entries').expect(400);
    await get('/admin/industry-funds/companies?pageSize=1000').expect(400);
    await get('/admin/fund-ledgers/summary?from=2026-09-10&to=2026-09-01').expect(400);
  });
  it('银行凭证只经权限接口下载，普通只读用户不可获取', async () => {
    const upload = await request(app.getHttpServer()).post('/admin/industry-funds/proofs').set('x-local-test-admin', superId).attach('file', Buffer.from('%PDF-test-receipt'), { filename: 'receipt.pdf', contentType: 'application/pdf' }).expect(201);
    const id = upload.body.data.id;
    expect(upload.body.data).toEqual({ id: expect.any(String) });
    await get(`/admin/industry-funds/proofs/${id}`, readerId).expect(403);
    const downloaded = await get(`/admin/industry-funds/proofs/${id}`).expect(200);
    expect(downloaded.headers['cache-control']).toBe('no-store');
    expect(downloaded.headers['content-disposition']).toContain('attachment');
    expect(downloaded.body.toString()).toBe('%PDF-test-receipt');
  });
  it('权限撤销实时生效，不相信测试身份中的过期权限', async () => {
    await get('/admin/fund-ledgers/summary', readerId).expect(200);
    await db.adminUser.update({ where: { id: readerId }, data: { status: 'DISABLED' } });
    await get('/admin/fund-ledgers/summary', readerId).expect(403);
  });
});
