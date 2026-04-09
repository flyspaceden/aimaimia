import { CsFaqService } from './cs-faq.service';

function makeFaq(overrides: Partial<any> = {}) {
  return {
    id: 'faq-1',
    keywords: ['退款'],
    pattern: null,
    answer: '退款一般3-5个工作日到账',
    answerType: 'TEXT',
    metadata: null,
    priority: 0,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

function createMockPrisma(faqs: any[] = []) {
  return {
    csFaq: {
      findMany: jest.fn().mockResolvedValue(faqs),
      create: jest
        .fn()
        .mockImplementation((args) =>
          Promise.resolve({ id: 'new-id', ...args.data }),
        ),
      update: jest
        .fn()
        .mockImplementation((args) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

function createService(faqs: any[] = []) {
  const prisma = createMockPrisma(faqs);
  const service = new CsFaqService(prisma as any);
  return { service, prisma };
}

describe('CsFaqService', () => {
  // ---- match() ----

  it('关键词完全匹配："退款多久到账" 匹配关键词 "退款"', async () => {
    const faq = makeFaq({ keywords: ['退款'] });
    const { service } = createService([faq]);

    const result = await service.match('退款多久到账');

    expect(result).not.toBeNull();
    expect(result!.faqId).toBe('faq-1');
    expect(result!.answer).toBe('退款一般3-5个工作日到账');
    expect(result!.answerType).toBe('TEXT');
  });

  it('关键词部分匹配（子串）："我想问一下退款的事" 匹配关键词 "退款"', async () => {
    const faq = makeFaq({ keywords: ['退款'] });
    const { service } = createService([faq]);

    const result = await service.match('我想问一下退款的事');

    expect(result).not.toBeNull();
    expect(result!.faqId).toBe('faq-1');
  });

  it('关键词大小写不敏感：消息含 "VIP" 匹配关键词 "vip"', async () => {
    const faq = makeFaq({
      id: 'faq-vip',
      keywords: ['vip'],
      answer: 'VIP会员享受专属权益',
    });
    const { service } = createService([faq]);

    const result = await service.match('请问VIP有什么权益');

    expect(result).not.toBeNull();
    expect(result!.faqId).toBe('faq-vip');
  });

  it('正则匹配：消息 "退款什么时候到账" 匹配 pattern 退款.*到账', async () => {
    const faq = makeFaq({
      id: 'faq-regex',
      keywords: [], // 无关键词，仅靠正则
      pattern: '退款.*到账',
      answer: '退款将在3-5天内到账',
    });
    const { service } = createService([faq]);

    const result = await service.match('退款什么时候到账');

    expect(result).not.toBeNull();
    expect(result!.faqId).toBe('faq-regex');
  });

  it('优先级排序：同时匹配两条规则，返回 priority 高的', async () => {
    const lowPriority = makeFaq({
      id: 'faq-low',
      keywords: ['退款'],
      answer: '低优先级回答',
      priority: 1,
    });
    const highPriority = makeFaq({
      id: 'faq-high',
      keywords: ['退款'],
      answer: '高优先级回答',
      priority: 10,
    });
    // getEnabledFaqs 按 priority desc 排序，所以 highPriority 在前
    const { service } = createService([highPriority, lowPriority]);

    const result = await service.match('退款问题');

    expect(result).not.toBeNull();
    expect(result!.faqId).toBe('faq-high');
    expect(result!.priority).toBe(10);
  });

  it('无匹配返回 null', async () => {
    const faq = makeFaq({ keywords: ['退款'] });
    const { service } = createService([faq]);

    const result = await service.match('今天天气怎么样');

    expect(result).toBeNull();
  });

  it('空消息返回 null', async () => {
    const faq = makeFaq({ keywords: ['退款'] });
    const { service } = createService([faq]);

    const result = await service.match('');

    expect(result).toBeNull();
  });

  it('无效正则不崩溃（graceful skip）', async () => {
    const faq = makeFaq({
      id: 'faq-bad-regex',
      keywords: [],
      pattern: '[invalid', // 无效正则
    });
    const { service } = createService([faq]);

    const result = await service.match('some message');

    // 不崩溃，返回 null（无匹配）
    expect(result).toBeNull();
  });

  it('ReDoS 防护：不安全正则 a++b 被跳过', async () => {
    const faq = makeFaq({
      id: 'faq-redos',
      keywords: [],
      pattern: 'a++b', // 嵌套量词，isSafeRegex 会拒绝
    });
    const { service } = createService([faq]);

    const result = await service.match('aaaaaaaaaa');

    expect(result).toBeNull();
  });

  it('正则只在前 500 字符执行', async () => {
    const faq = makeFaq({
      id: 'faq-tail',
      keywords: [],
      pattern: '秘密关键词',
    });
    const { service } = createService([faq]);

    // "秘密关键词" 出现在第 501 个字符之后
    const padding = 'x'.repeat(500);
    const message = padding + '秘密关键词';

    const result = await service.match(message);

    expect(result).toBeNull();
  });

  // ---- invalidateCache() ----

  it('CRUD 后缓存失效，下次查询重新从 DB 获取', async () => {
    const faq = makeFaq({ keywords: ['退款'] });
    const { service, prisma } = createService([faq]);

    // 第一次查询 — 填充缓存
    await service.match('退款');
    expect(prisma.csFaq.findMany).toHaveBeenCalledTimes(1);

    // 第二次查询 — 从缓存返回
    await service.match('退款');
    expect(prisma.csFaq.findMany).toHaveBeenCalledTimes(1);

    // invalidateCache 后第三次查询 — 重新查询 DB
    service.invalidateCache();
    await service.match('退款');
    expect(prisma.csFaq.findMany).toHaveBeenCalledTimes(2);
  });

  // ---- create() ----

  it('不安全正则在创建时被拒绝', async () => {
    const { service } = createService([]);

    await expect(
      service.create({
        keywords: ['测试'],
        pattern: 'a++b',
        answer: '测试回答',
      }),
    ).rejects.toThrow('正则表达式不安全');
  });
});
