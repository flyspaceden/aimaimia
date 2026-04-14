jest.mock('./asr.service', () => ({
  AsrService: class AsrService {},
}));

import { AiService } from './ai.service';

function createAiService() {
  return new AiService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('AiService 企业语音解析回归', () => {
  it('“帮我找一找在武汉的公司”应在规则层直接识别为企业列表请求', () => {
    const service = createAiService();

    const classification = (service as any).classifyIntentByRules('帮我找一找在武汉的公司。');

    expect(classification).toMatchObject({
      intent: 'company',
      confidence: 0.95,
      source: 'rule',
      params: {
        mode: 'list',
        location: '武汉',
      },
    });
    expect(classification.params.name).toBeUndefined();
  });

  it('企业列表请求中的脏名称残片不应进入 companyName', () => {
    const service = createAiService();

    const context = (service as any).buildCompanyContext(
      '帮我找一找在武汉的公司。',
      {
        mode: 'list',
        name: '一找在武汉',
        location: '武汉',
      },
      '一找在武汉',
      'list',
    );

    expect(context).toMatchObject({
      companyName: '',
      location: '武汉',
    });
  });
});
