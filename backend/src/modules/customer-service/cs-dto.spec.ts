import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { SendCsMessageDto } from './dto/cs-send-message.dto';
import { SubmitCsRatingDto } from './dto/cs-submit-rating.dto';
import { CreateCsSessionDto } from './dto/cs-create-session.dto';
import {
  CreateCsFaqDto,
  CreateCsQuickEntryDto,
  CreateCsQuickReplyDto,
  UpdateCsTicketDto,
} from './dto/cs-admin.dto';

// ==================== SendCsMessageDto ====================

describe('SendCsMessageDto', () => {
  it('1. 合法内容 → 无校验错误', async () => {
    const dto = plainToInstance(SendCsMessageDto, { content: 'hello' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('2. 空内容 → 校验错误', async () => {
    const dto = plainToInstance(SendCsMessageDto, { content: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('3. 内容超过5000字符 → 校验错误', async () => {
    const dto = plainToInstance(SendCsMessageDto, { content: 'x'.repeat(5001) });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ==================== SubmitCsRatingDto ====================

describe('SubmitCsRatingDto', () => {
  it('4. 合法评分 score=4 + tags + comment → 无校验错误', async () => {
    const dto = plainToInstance(SubmitCsRatingDto, {
      score: 4,
      tags: ['好'],
      comment: '不错',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('5. score=0 → 校验错误（最小值为1）', async () => {
    const dto = plainToInstance(SubmitCsRatingDto, { score: 0 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('6. score=6 → 校验错误（最大值为5）', async () => {
    const dto = plainToInstance(SubmitCsRatingDto, { score: 6 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('7. comment 超过1000字符 → 校验错误', async () => {
    const dto = plainToInstance(SubmitCsRatingDto, {
      score: 3,
      comment: 'x'.repeat(1001),
    });
    const errors = await validate(dto);
    const commentErrors = errors.filter((e) => e.property === 'comment');
    expect(commentErrors.length).toBeGreaterThan(0);
  });

  it('8. tags 超过10项 → 校验错误', async () => {
    const dto = plainToInstance(SubmitCsRatingDto, {
      score: 3,
      tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    });
    const errors = await validate(dto);
    const tagsErrors = errors.filter((e) => e.property === 'tags');
    expect(tagsErrors.length).toBeGreaterThan(0);
  });
});

// ==================== CreateCsFaqDto ====================

describe('CreateCsFaqDto', () => {
  it('9. 合法 FAQ → 无校验错误', async () => {
    const dto = plainToInstance(CreateCsFaqDto, {
      keywords: ['退款'],
      answer: '1-3天',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('10. 空 keywords 数组 → 仍通过（数组校验不要求非空）', async () => {
    const dto = plainToInstance(CreateCsFaqDto, {
      keywords: [],
      answer: '回答内容',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('11. answer 超过5000字符 → 校验错误', async () => {
    const dto = plainToInstance(CreateCsFaqDto, {
      keywords: ['退款'],
      answer: 'x'.repeat(5001),
    });
    const errors = await validate(dto);
    const answerErrors = errors.filter((e) => e.property === 'answer');
    expect(answerErrors.length).toBeGreaterThan(0);
  });

  it('12. keywords 超过20项 → 校验错误', async () => {
    const dto = plainToInstance(CreateCsFaqDto, {
      keywords: Array.from({ length: 21 }, (_, i) => `kw${i}`),
      answer: '回答',
    });
    const errors = await validate(dto);
    const kwErrors = errors.filter((e) => e.property === 'keywords');
    expect(kwErrors.length).toBeGreaterThan(0);
  });

  it('13. 单个 keyword 超过50字符 → 校验错误', async () => {
    const dto = plainToInstance(CreateCsFaqDto, {
      keywords: ['x'.repeat(51)],
      answer: '回答',
    });
    const errors = await validate(dto);
    const kwErrors = errors.filter((e) => e.property === 'keywords');
    expect(kwErrors.length).toBeGreaterThan(0);
  });
});

// ==================== CreateCsSessionDto ====================

describe('CreateCsSessionDto', () => {
  it('14. 合法来源 MY_PAGE → 无校验错误', async () => {
    const dto = plainToInstance(CreateCsSessionDto, { source: 'MY_PAGE' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('15. 无效来源 INVALID → 校验错误', async () => {
    const dto = plainToInstance(CreateCsSessionDto, { source: 'INVALID' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ==================== CreateCsQuickEntryDto ====================

describe('CreateCsQuickEntryDto', () => {
  it('16. 合法快捷入口 → 无校验错误', async () => {
    const dto = plainToInstance(CreateCsQuickEntryDto, {
      type: 'QUICK_ACTION',
      label: '查物流',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('17. 缺少 type → 校验错误', async () => {
    const dto = plainToInstance(CreateCsQuickEntryDto, { label: '查物流' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ==================== CreateCsQuickReplyDto ====================

describe('CreateCsQuickReplyDto', () => {
  it('18. 合法快捷回复 → 无校验错误', async () => {
    const dto = plainToInstance(CreateCsQuickReplyDto, {
      category: '通用',
      title: '问候',
      content: '您好',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('19. content 超过5000字符 → 校验错误', async () => {
    const dto = plainToInstance(CreateCsQuickReplyDto, {
      category: '通用',
      title: '问候',
      content: 'x'.repeat(5001),
    });
    const errors = await validate(dto);
    const contentErrors = errors.filter((e) => e.property === 'content');
    expect(contentErrors.length).toBeGreaterThan(0);
  });
});

// ==================== UpdateCsTicketDto ====================

describe('UpdateCsTicketDto', () => {
  it('20. 合法状态 RESOLVED → 无校验错误', async () => {
    const dto = plainToInstance(UpdateCsTicketDto, { status: 'RESOLVED' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
