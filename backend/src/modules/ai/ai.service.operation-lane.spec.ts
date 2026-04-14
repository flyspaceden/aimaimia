jest.mock('./asr.service', () => ({
  AsrService: class AsrService {},
}));

import { AiService } from './ai.service';

function createAiService(options?: {
  productService?: Partial<Record<string, jest.Mock>>;
}) {
  const productService = {
    resolveSearchEntity: jest.fn().mockResolvedValue({
      normalizedKeyword: '',
      matchedCategoryIds: [],
      source: 'none',
    }),
    resolveAddToCartCandidate: jest.fn().mockResolvedValue({}),
    canFastClassifySearchKeyword: jest.fn().mockResolvedValue(false),
    ...(options?.productService ?? {}),
  };

  return {
    service: new AiService(
      {} as any,
      {} as any,
      productService as any,
      {} as any,
    ),
    productService,
  };
}

describe('AiService operation-lane regressions', () => {
  it('“你好吗”应命中寒暄快路，而不是回退到泛化 chat', async () => {
    const { service } = createAiService();
    const timing: Record<string, any> = {};

    const intent = await service.parseIntent('你好吗？', 'voice', timing as any);

    expect(intent).toMatchObject({
      type: 'chat',
      intent: 'chat',
      feedback: '我很好，谢谢！有什么我可以帮你的吗？',
      confidence: 0.99,
    });
    expect(timing.fast_route_hit).toBe(true);
    expect(timing.model_route).toBe('rule');
  });

  it('“你在干嘛”应命中在场确认快路，而不是落入模型分类', async () => {
    const { service } = createAiService();
    const timing: Record<string, any> = {};

    const intent = await service.parseIntent('你在干嘛？', 'voice', timing as any);

    expect(intent).toMatchObject({
      type: 'chat',
      intent: 'chat',
      feedback: '我在呢。你可以直接告诉我想找什么商品、想看哪个企业，或者让我帮你查订单。',
      confidence: 0.99,
    });
    expect(timing.fast_route_hit).toBe(true);
    expect(timing.model_route).toBe('rule');
  });

  it('“把土鸡蛋放入购物车”应识别为加购搜索，而不是落入通用 transaction', async () => {
    const { service, productService } = createAiService({
      productService: {
        resolveSearchEntity: jest.fn().mockResolvedValue({
          normalizedKeyword: '土鸡蛋',
          matchedCategoryIds: [],
          source: 'keyword',
        }),
        resolveAddToCartCandidate: jest.fn().mockResolvedValue({
          productId: 'p-egg-1',
          productName: '土鸡蛋',
        }),
      },
    });
    const timing: Record<string, any> = {};

    const intent = await service.parseIntent('把土鸡蛋放入购物车。', 'voice', timing as any);

    expect(intent.type).toBe('search');
    expect(intent.search).toMatchObject({
      query: '土鸡蛋',
      action: 'add-to-cart',
      matchedProductId: 'p-egg-1',
      matchedProductName: '土鸡蛋',
    });
    expect(timing.fast_route_hit).toBe(true);
    expect(timing.model_route).toBe('rule');
    expect(productService.resolveAddToCartCandidate).toHaveBeenCalled();
  });

  it('“我要加购百里香”应保留完整商品名，而不是把“里”错误剥掉', async () => {
    const { service, productService } = createAiService({
      productService: {
        resolveSearchEntity: jest.fn().mockResolvedValue({
          normalizedKeyword: '百里香',
          matchedCategoryIds: [],
          source: 'keyword',
        }),
        resolveAddToCartCandidate: jest.fn().mockResolvedValue({
          productId: 'p-herb-1',
          productName: '百里香',
        }),
      },
    });

    const intent = await service.parseIntent('我要加购百里香', 'voice', {} as any);

    expect(intent.type).toBe('search');
    expect(intent.search).toMatchObject({
      query: '百里香',
      action: 'add-to-cart',
      matchedProductId: 'p-herb-1',
    });
    expect(productService.resolveAddToCartCandidate).toHaveBeenCalledWith('百里香', undefined);
  });

  it('唯一商品命中的加购语音应返回“已加入购物车”反馈，而不是“正在搜索”', async () => {
    const { service } = createAiService({
      productService: {
        resolveSearchEntity: jest.fn().mockResolvedValue({
          normalizedKeyword: '信阳毛尖',
          matchedCategoryIds: [],
          source: 'keyword',
        }),
        resolveAddToCartCandidate: jest.fn().mockResolvedValue({
          productId: 'p-080',
          productName: '信阳毛尖',
        }),
      },
    });

    const intent = await service.parseIntent('把信阳毛尖加入购物车。', 'voice', {} as any);

    expect(intent.type).toBe('search');
    expect(intent.search).toMatchObject({
      action: 'add-to-cart',
      matchedProductId: 'p-080',
      matchedProductName: '信阳毛尖',
    });
    expect(intent.feedback).toBe('已将信阳毛尖加入购物车');
  });

  it('模糊加购表达不应直接跳购物车', async () => {
    const { service } = createAiService();
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;

    try {
      const intent = await service.parseIntent('帮我加到购物车', 'voice', {} as any);

      expect(intent.type).toBe('chat');
      expect(intent.feedback).not.toContain('购物车');
    } finally {
      process.env.DASHSCOPE_API_KEY = originalApiKey;
    }
  });

  it('“现在购物车里面有多少件商品”应直接回购物车快路，不再走通用 transaction', async () => {
    const { service } = createAiService();
    const timing: Record<string, any> = {};

    const intent = await service.parseIntent('现在购物车里面有多少件商品？', 'voice', timing as any);

    expect(intent).toMatchObject({
      type: 'navigate',
      intent: 'navigate',
      param: 'cart',
      resolved: {
        navigateTarget: 'cart',
      },
    });
    expect(timing.fast_route_hit).toBe(true);
    expect(timing.model_route).toBe('rule');
  });

  it('“现在有推荐的水果吗”应走轻推荐链路，避免重实体解析', async () => {
    const { service, productService } = createAiService({
      productService: {
        resolveSearchEntity: jest.fn(() => {
          throw new Error('recommend-lite should skip entity resolution');
        }),
      },
    });
    const timing: Record<string, any> = {};

    const intent = await service.parseIntent('现在有推荐的水果吗？', 'voice', timing as any);

    expect(intent.type).toBe('recommend');
    expect(intent.recommend).toMatchObject({
      query: '水果',
      preferRecommended: true,
    });
    expect(timing.fast_route_hit).toBe(true);
    expect(timing.model_route).toBe('rule');
    expect(timing.entity_resolve_ms ?? 0).toBe(0);
    expect(productService.resolveSearchEntity).not.toHaveBeenCalled();
  });

  it('企业类推荐话术不应被轻推荐快路误判成商品推荐', async () => {
    const { service } = createAiService();
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;

    try {
      const intent = await service.parseIntent('现在有推荐的企业吗？', 'voice', {} as any);

      expect(intent.type).not.toBe('recommend');
    } finally {
      process.env.DASHSCOPE_API_KEY = originalApiKey;
    }
  });

  it('模型分类失败时也应记录 flash_ms，避免失败样本缺少关键 timing', async () => {
    const { service } = createAiService();
    const timing: Record<string, any> = {};
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    const originalSemanticFlag = process.env.AI_SEMANTIC_SLOTS_ENABLED;
    const originalFetch = global.fetch;

    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.AI_SEMANTIC_SLOTS_ENABLED = 'false';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;

    try {
      const intent = await service.parseIntent('这是一句不会命中快路的复杂表达', 'voice', timing as any);

      expect(intent.type).toBe('chat');
      expect(timing.model_route).toBe('fallback');
      expect(timing.flash_ms).toBeDefined();
    } finally {
      process.env.DASHSCOPE_API_KEY = originalApiKey;
      process.env.AI_SEMANTIC_SLOTS_ENABLED = originalSemanticFlag;
      global.fetch = originalFetch;
    }
  });

  it('统一语义 flash 失败时也应记录 flash_ms', async () => {
    const { service } = createAiService();
    const timing: Record<string, any> = {};
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    const originalSemanticFlag = process.env.AI_SEMANTIC_SLOTS_ENABLED;
    const originalFetch = global.fetch;

    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.AI_SEMANTIC_SLOTS_ENABLED = 'true';
    global.fetch = jest.fn().mockRejectedValue(new Error('legacy flash down')) as any;
    (service as any).callSemanticModel = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('semantic flash down');
    });

    try {
      const intent = await service.parseIntent('这是一句不会命中快路的复杂表达', 'voice', timing as any);

      expect(intent.type).toBe('chat');
      expect(timing.model_route).toBe('fallback');
      expect(timing.flash_ms).toBeGreaterThan(0);
    } finally {
      process.env.DASHSCOPE_API_KEY = originalApiKey;
      process.env.AI_SEMANTIC_SLOTS_ENABLED = originalSemanticFlag;
      global.fetch = originalFetch;
    }
  });

  it('统一语义低置信 flash 不应升级到 plus', async () => {
    const { service } = createAiService();
    const timing: Record<string, any> = {};
    const originalApiKey = process.env.DASHSCOPE_API_KEY;
    const originalSemanticFlag = process.env.AI_SEMANTIC_SLOTS_ENABLED;
    const originalFetch = global.fetch;
    const callSemanticModel = jest
      .fn()
      .mockResolvedValueOnce({
        intent: 'chat',
        confidence: 0.4,
        params: { reply: '先这样吧' },
      });

    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.AI_SEMANTIC_SLOTS_ENABLED = 'true';
    global.fetch = jest.fn().mockRejectedValue(new Error('legacy flash down')) as any;
    (service as any).callSemanticModel = callSemanticModel;

    try {
      const intent = await service.parseIntent('这是一句不会命中快路的复杂表达', 'voice', timing as any);

      expect(intent.type).toBe('chat');
      expect(timing.model_route).toBe('flash');
      expect(timing.plus_ms).toBeUndefined();
      expect(callSemanticModel).toHaveBeenCalledTimes(1);
    } finally {
      process.env.DASHSCOPE_API_KEY = originalApiKey;
      process.env.AI_SEMANTIC_SLOTS_ENABLED = originalSemanticFlag;
      global.fetch = originalFetch;
    }
  });
});
