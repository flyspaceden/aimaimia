import { CsAdminController } from './cs-admin.controller';

function createMocks() {
  const csService = {
    getAdminSessionList: jest.fn().mockResolvedValue([]),
    getAdminSessionDetail: jest.fn(),
    getStats: jest.fn().mockResolvedValue({
      totalSessions: 10, aiResolveRate: 80, agentHandled: 2, avgRating: 4.5, queueCount: 1,
    }),
    getQuickEntries: jest.fn(),
  };
  const faqService = {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'faq-1', ...data })),
    update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
    delete: jest.fn().mockResolvedValue({}),
    match: jest.fn(),
  };
  const ticketService = {
    findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    update: jest.fn(),
  };
  const agentService = {
    getAllAgentStatus: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    csQuickEntry: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'qe1', type: 'QUICK_ACTION', label: '查物流', enabled: true },
        { id: 'qe2', type: 'HOT_QUESTION', label: '退款多久', enabled: false },
      ]),
      create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'new', ...args.data })),
      update: jest.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id })),
      delete: jest.fn().mockResolvedValue({}),
    },
    csQuickReply: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'qr1', category: '通用', title: '问候', enabled: true },
        { id: 'qr2', category: '退款', title: '已受理', enabled: false },
      ]),
      create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'new', ...args.data })),
      update: jest.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id })),
      delete: jest.fn().mockResolvedValue({}),
    },
  };

  const controller = new CsAdminController(
    csService as any, faqService as any, ticketService as any, agentService as any, prisma as any,
  );
  return { controller, csService, faqService, ticketService, agentService, prisma };
}

describe('CsAdminController', () => {
  // ====================================================================
  // FAQ CRUD
  // ====================================================================

  describe('FAQ CRUD', () => {
    it('getFaqs — 调用 faqService.findAll', async () => {
      const { controller, faqService } = createMocks();

      const result = await controller.getFaqs();

      expect(faqService.findAll).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('createFaq — 调用 faqService.create 并传入正确数据', async () => {
      const { controller, faqService } = createMocks();
      const dto = { keywords: ['退款'], answer: '3-5天到账' } as any;

      const result = await controller.createFaq(dto);

      expect(faqService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expect.objectContaining({ id: 'faq-1', keywords: ['退款'], answer: '3-5天到账' }));
    });

    it('testFaq — 调用 faqService.match 并返回结果', async () => {
      const { controller, faqService } = createMocks();
      const matchResult = { faqId: 'faq-1', answer: '退款3天到账', answerType: 'TEXT' };
      faqService.match.mockResolvedValue(matchResult);

      const result = await controller.testFaq({ message: '退款多久到账' } as any);

      expect(faqService.match).toHaveBeenCalledWith('退款多久到账');
      expect(result).toEqual(matchResult);
    });

    it('deleteFaq — 调用 faqService.delete', async () => {
      const { controller, faqService } = createMocks();

      await controller.deleteFaq('faq-1');

      expect(faqService.delete).toHaveBeenCalledWith('faq-1');
    });
  });

  // ====================================================================
  // Quick Entry CRUD
  // ====================================================================

  describe('Quick Entry CRUD', () => {
    it('getQuickEntries — 返回所有条目（含 disabled，Bug 5 验证）', async () => {
      const { controller, prisma } = createMocks();

      const result = await controller.getQuickEntries();

      expect(prisma.csQuickEntry.findMany).toHaveBeenCalledWith({ orderBy: { sortOrder: 'asc' } });
      // 验证返回包含 enabled=false 的条目（管理端应返回所有条目）
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'qe1', enabled: true }),
        expect.objectContaining({ id: 'qe2', enabled: false }),
      ]));
    });

    it('createQuickEntry — prisma.csQuickEntry.create 被调用', async () => {
      const { controller, prisma } = createMocks();
      const dto = { type: 'QUICK_ACTION', label: '查订单' } as any;

      const result = await controller.createQuickEntry(dto);

      expect(prisma.csQuickEntry.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual(expect.objectContaining({ label: '查订单' }));
    });

    it('sortQuickEntries — 所有条目按新 sortOrder 更新', async () => {
      const { controller, prisma } = createMocks();
      const dto = {
        items: [
          { id: 'qe1', sortOrder: 2 },
          { id: 'qe2', sortOrder: 1 },
        ],
      } as any;

      await controller.sortQuickEntries(dto);

      expect(prisma.csQuickEntry.update).toHaveBeenCalledTimes(2);
      expect(prisma.csQuickEntry.update).toHaveBeenCalledWith({
        where: { id: 'qe1' }, data: { sortOrder: 2 },
      });
      expect(prisma.csQuickEntry.update).toHaveBeenCalledWith({
        where: { id: 'qe2' }, data: { sortOrder: 1 },
      });
    });

    it('deleteQuickEntry — prisma.csQuickEntry.delete 被调用', async () => {
      const { controller, prisma } = createMocks();

      await controller.deleteQuickEntry('qe1');

      expect(prisma.csQuickEntry.delete).toHaveBeenCalledWith({ where: { id: 'qe1' } });
    });
  });

  // ====================================================================
  // Quick Reply CRUD
  // ====================================================================

  describe('Quick Reply CRUD', () => {
    it('getQuickReplies — 返回所有回复（含 disabled，Bug 5 验证）', async () => {
      const { controller, prisma } = createMocks();

      const result = await controller.getQuickReplies();

      expect(prisma.csQuickReply.findMany).toHaveBeenCalledWith({
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      });
      // 验证返回包含 enabled=false 的条目
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'qr1', enabled: true }),
        expect.objectContaining({ id: 'qr2', enabled: false }),
      ]));
    });

    it('createQuickReply — prisma.csQuickReply.create 被调用', async () => {
      const { controller, prisma } = createMocks();
      const dto = { category: '通用', title: '感谢', content: '感谢您的耐心等候' } as any;

      const result = await controller.createQuickReply(dto);

      expect(prisma.csQuickReply.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual(expect.objectContaining({ category: '通用', title: '感谢' }));
    });

    it('deleteQuickReply — prisma.csQuickReply.delete 被调用', async () => {
      const { controller, prisma } = createMocks();

      await controller.deleteQuickReply('qr1');

      expect(prisma.csQuickReply.delete).toHaveBeenCalledWith({ where: { id: 'qr1' } });
    });
  });

  // ====================================================================
  // Tickets
  // ====================================================================

  describe('Tickets', () => {
    it('getTickets — 调用 ticketService.findAll 并解析查询参数', async () => {
      const { controller, ticketService } = createMocks();

      await controller.getTickets('OPEN', 'PAYMENT', 'HIGH', '2', '10');

      expect(ticketService.findAll).toHaveBeenCalledWith({
        status: 'OPEN',
        category: 'PAYMENT',
        priority: 'HIGH',
        page: 2,
        pageSize: 10,
      });
    });

    it('updateTicket — 调用 ticketService.update 并传入 adminId', async () => {
      const { controller, ticketService } = createMocks();
      const dto = { status: 'RESOLVED' } as any;
      ticketService.update.mockResolvedValue({ id: 'ticket-1', status: 'RESOLVED' });

      const result = await controller.updateTicket('ticket-1', dto, 'admin-1');

      expect(ticketService.update).toHaveBeenCalledWith('ticket-1', dto, 'admin-1');
      expect(result).toEqual(expect.objectContaining({ status: 'RESOLVED' }));
    });
  });

  // ====================================================================
  // Stats
  // ====================================================================

  describe('Stats', () => {
    it('getStats — 返回正确形状（5 个字段）', async () => {
      const { controller } = createMocks();

      const result = await controller.getStats();

      expect(result).toEqual({
        totalSessions: 10,
        aiResolveRate: 80,
        agentHandled: 2,
        avgRating: 4.5,
        queueCount: 1,
      });
    });
  });
});
