import { FundProofService } from './fund-proof.service';

describe('私有基金付款凭证', () => {
  const prisma = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };
  const service = new FundProofService(prisma as never);
  beforeEach(() => jest.clearAllMocks());
  it('拒绝伪造 MIME 与超限文件，不写数据库', async () => {
    await expect(service.upload({ buffer: Buffer.from('<script>'), mimetype: 'application/pdf' } as Express.Multer.File, 'a')).rejects.toThrow('类型');
    await expect(service.upload({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'image/png' } as Express.Multer.File, 'a')).rejects.toThrow('5MB');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('上传仅返回不可猜测 ID，无公开下载地址', async () => {
    prisma.$executeRaw.mockResolvedValue(1);
    const result = await service.upload({ buffer: Buffer.from('%PDF-test'), mimetype: 'application/pdf' } as Express.Multer.File, 'admin');
    expect(result).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('拒绝把任意路径或外部 URL 当作已上传凭证', async () => {
    await expect(service.requireProof('https://public.example/receipt')).rejects.toThrow('编号');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.requireProof('11111111-1111-4111-8111-111111111111')).rejects.toThrow('先上传');
  });
});
