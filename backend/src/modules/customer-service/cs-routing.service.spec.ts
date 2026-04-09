import { CsRoutingService } from './cs-routing.service';
import { CsAiContext } from './types/cs.types';

function createMockFaqService(matchResult: any = null) {
  return { match: jest.fn().mockResolvedValue(matchResult) };
}

function createService(faqResult: any = null) {
  const faqService = createMockFaqService(faqResult);
  const service = new CsRoutingService({} as any, faqService as any);
  return { service, faqService };
}

const baseContext: CsAiContext = {
  source: 'MY_PAGE',
  conversationHistory: [],
};

describe('CsRoutingService', () => {
  // 确保测试环境没有 API key，AI 层会返回 null
  const originalEnv = process.env.DASHSCOPE_API_KEY;
  beforeEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
  });
  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.DASHSCOPE_API_KEY = originalEnv;
    }
  });

  it('"转人工" → layer 3, shouldTransferToAgent=true', async () => {
    const { service } = createService();

    const result = await service.route('我要转人工', baseContext, 0);

    expect(result.layer).toBe(3);
    expect(result.shouldTransferToAgent).toBe(true);
  });

  it('"找客服" → layer 3', async () => {
    const { service } = createService();

    const result = await service.route('帮我找客服', baseContext, 0);

    expect(result.layer).toBe(3);
    expect(result.shouldTransferToAgent).toBe(true);
  });

  it('"投诉" → layer 3 with reply message', async () => {
    const { service } = createService();

    const result = await service.route('我要投诉', baseContext, 0);

    expect(result.layer).toBe(3);
    expect(result.shouldTransferToAgent).toBe(true);
    expect(result.reply).toContain('转接人工客服');
  });

  it('"12315" → layer 3 (emotion keyword)', async () => {
    const { service } = createService();

    const result = await service.route('我要打12315举报你们', baseContext, 0);

    expect(result.layer).toBe(3);
    expect(result.shouldTransferToAgent).toBe(true);
  });

  it('FAQ match → layer 1, returns FAQ answer', async () => {
    const faqResult = {
      faqId: 'faq-1',
      answer: '退款一般3-5个工作日到账',
      answerType: 'TEXT',
      metadata: null,
      priority: 0,
    };
    const { service } = createService(faqResult);

    const result = await service.route('退款多久到账', baseContext, 0);

    expect(result.layer).toBe(1);
    expect(result.reply).toBe('退款一般3-5个工作日到账');
    expect(result.contentType).toBe('TEXT');
    expect(result.shouldTransferToAgent).toBe(false);
  });

  it('FAQ match with RICH_CARD type', async () => {
    const faqResult = {
      faqId: 'faq-2',
      answer: '<card>VIP权益说明</card>',
      answerType: 'RICH_CARD',
      metadata: { cardType: 'vip_benefits' },
      priority: 0,
    };
    const { service } = createService(faqResult);

    const result = await service.route('VIP有什么权益', baseContext, 0);

    expect(result.layer).toBe(1);
    expect(result.contentType).toBe('RICH_CARD');
    expect(result.metadata).toEqual({ cardType: 'vip_benefits' });
    expect(result.shouldTransferToAgent).toBe(false);
  });

  it('No FAQ match + no DASHSCOPE_API_KEY → fallback reply, layer 2', async () => {
    const { service } = createService(null);

    const result = await service.route('随便说点什么', baseContext, 0);

    expect(result.layer).toBe(2);
    expect(result.shouldTransferToAgent).toBe(false);
    expect(result.reply).toContain('转人工');
  });

  it('consecutiveFailures=1 (second failure) → layer 3, auto transfer', async () => {
    const { service } = createService(null);

    const result = await service.route('还是不明白', baseContext, 1);

    expect(result.layer).toBe(3);
    expect(result.shouldTransferToAgent).toBe(true);
    expect(result.reply).toContain('转接人工客服');
  });

  it('consecutiveFailures=0 (first failure) → layer 2, fallback message with "转人工" suggestion', async () => {
    const { service } = createService(null);

    const result = await service.route('这个问题好复杂', baseContext, 0);

    expect(result.layer).toBe(2);
    expect(result.shouldTransferToAgent).toBe(false);
    expect(result.reply).toContain('转人工');
  });

  it('Normal message, no FAQ, no API key → not transferred on first failure', async () => {
    const { service } = createService(null);

    const result = await service.route('你好啊', baseContext, 0);

    expect(result.layer).toBe(2);
    expect(result.shouldTransferToAgent).toBe(false);
    expect(result.contentType).toBe('TEXT');
  });
});
