import { CsTicketService } from './cs-ticket.service';

function createMocks() {
  const prisma = {
    csSession: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    csTicket: {
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'ticket-1', ...args.data }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
  };
  const service = new CsTicketService(prisma as any);
  return { service, prisma };
}

// 保存/恢复全局 fetch，用于 AI 摘要的 mock
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});

// 保存/恢复环境变量
const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('CsTicketService', () => {
  // ===== createTicket =====

  describe('createTicket()', () => {
    it('1. 正常创建工单：获取会话消息，创建工单，关联会话', async () => {
      const { service, prisma } = createMocks();

      prisma.csSession.findUniqueOrThrow.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        source: 'MY_PAGE',
        sourceId: null,
        messages: [
          { senderType: 'USER', content: '你好', createdAt: new Date() },
          { senderType: 'AI', content: '您好，有什么可以帮您？', createdAt: new Date() },
        ],
      });

      // DASHSCOPE_API_KEY 未设置 → generateSummary 会抛错被 catch，summary 为 undefined
      delete process.env.DASHSCOPE_API_KEY;

      const ticketId = await service.createTicket('session-1');

      expect(ticketId).toBe('ticket-1');
      expect(prisma.csSession.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(prisma.csTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          priority: 'MEDIUM',
        }),
      });
      expect(prisma.csSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { ticketId: 'ticket-1' },
      });
    });

    it('2. PAYMENT 类别 → 优先级设为 HIGH', async () => {
      const { service, prisma } = createMocks();

      prisma.csSession.findUniqueOrThrow.mockResolvedValue({
        id: 'session-2',
        userId: 'user-2',
        source: 'MY_PAGE',
        sourceId: null,
        messages: [],
      });

      delete process.env.DASHSCOPE_API_KEY;

      await service.createTicket('session-2', 'PAYMENT');

      expect(prisma.csTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          priority: 'HIGH',
          category: 'PAYMENT',
        }),
      });
    });

    it('3. AI 摘要失败 → 工单仍然创建（summary 为 undefined）', async () => {
      const { service, prisma } = createMocks();

      prisma.csSession.findUniqueOrThrow.mockResolvedValue({
        id: 'session-3',
        userId: 'user-3',
        source: 'MY_PAGE',
        sourceId: null,
        messages: [
          { senderType: 'USER', content: '付款失败', createdAt: new Date() },
        ],
      });

      // 设置 API key 使其走 fetch 分支，然后让 fetch 抛错
      process.env.DASHSCOPE_API_KEY = 'test-key';
      (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));

      const ticketId = await service.createTicket('session-3');

      // 工单仍然创建成功
      expect(ticketId).toBe('ticket-1');
      expect(prisma.csTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-3',
          summary: undefined,
        }),
      });
    });

    it('4. 来源 ORDER_DETAIL → relatedOrderId 被设置', async () => {
      const { service, prisma } = createMocks();

      prisma.csSession.findUniqueOrThrow.mockResolvedValue({
        id: 'session-4',
        userId: 'user-4',
        source: 'ORDER_DETAIL',
        sourceId: 'order-123',
        messages: [],
      });

      delete process.env.DASHSCOPE_API_KEY;

      await service.createTicket('session-4');

      expect(prisma.csTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          relatedOrderId: 'order-123',
        }),
      });
    });
  });

  // ===== findAll =====

  describe('findAll()', () => {
    it('5. 带筛选参数：status + category + pagination', async () => {
      const { service, prisma } = createMocks();

      await service.findAll({
        page: 2,
        pageSize: 10,
        status: 'OPEN',
        category: 'PAYMENT',
      });

      expect(prisma.csTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'OPEN', category: 'PAYMENT' },
          skip: 10, // (page-1) * pageSize = (2-1) * 10
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(prisma.csTicket.count).toHaveBeenCalledWith({
        where: { status: 'OPEN', category: 'PAYMENT' },
      });
    });
  });

  // ===== update =====

  describe('update()', () => {
    it('6. 状态改为 RESOLVED → resolvedBy 和 resolvedAt 被设置', async () => {
      const { service, prisma } = createMocks();

      prisma.csTicket.update.mockResolvedValue({ id: 'ticket-1', status: 'RESOLVED' });

      await service.update('ticket-1', { status: 'RESOLVED' }, 'admin-1');

      expect(prisma.csTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedBy: 'admin-1',
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });
});
