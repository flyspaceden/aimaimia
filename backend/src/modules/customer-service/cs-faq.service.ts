import { Injectable, Logger } from '@nestjs/common';
import { CsFaq, CsFaqAnswerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface FaqMatchResult {
  faqId: string;
  answer: string;
  answerType: CsFaqAnswerType;
  metadata: Record<string, unknown> | null;
  priority: number;
}

/** 检测常见 ReDoS 模式：嵌套量词如 (a+)+、(a*)*、(a?){10,} 等 */
function isSafeRegex(pattern: string): boolean {
  // 拒绝嵌套量词：(?:...)+ 内含 +*? 量词
  if (/([+*?]|\{[^}]+\})\s*[+*?]/.test(pattern)) return false;
  // 拒绝超长模式
  if (pattern.length > 200) return false;
  return true;
}

@Injectable()
export class CsFaqService {
  private readonly logger = new Logger(CsFaqService.name);

  /** FAQ 规则内存缓存，避免每条消息查数据库 */
  private faqCache: CsFaq[] | null = null;
  private faqCacheExpiry = 0;
  private readonly FAQ_CACHE_TTL = 60_000; // 1 分钟

  constructor(private prisma: PrismaService) {}

  /** 使缓存失效（CRUD 操作后调用） */
  invalidateCache() {
    this.faqCache = null;
    this.faqCacheExpiry = 0;
  }

  private async getEnabledFaqs(): Promise<CsFaq[]> {
    if (this.faqCache && Date.now() < this.faqCacheExpiry) {
      return this.faqCache;
    }
    this.faqCache = await this.prisma.csFaq.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    });
    this.faqCacheExpiry = Date.now() + this.FAQ_CACHE_TTL;
    return this.faqCache;
  }

  /**
   * 匹配 FAQ 规则：先关键词匹配，再正则匹配，返回最高优先级结果
   */
  async match(message: string): Promise<FaqMatchResult | null> {
    if (!message) return null;

    const faqs = await this.getEnabledFaqs();
    const normalized = message.toLowerCase().trim();

    for (const faq of faqs) {
      // 关键词匹配：任一关键词命中即算匹配
      const keywordMatch = faq.keywords.some((kw) =>
        normalized.includes(kw.toLowerCase()),
      );
      if (keywordMatch) {
        return {
          faqId: faq.id,
          answer: faq.answer,
          answerType: faq.answerType,
          metadata: faq.metadata as Record<string, unknown> | null,
          priority: faq.priority,
        };
      }

      // 正则匹配（带安全检查和超时保护）
      if (faq.pattern) {
        if (!isSafeRegex(faq.pattern)) {
          this.logger.warn(`FAQ ${faq.id} 正则不安全，跳过: ${faq.pattern}`);
          continue;
        }
        try {
          const regex = new RegExp(faq.pattern, 'i');
          // 只在截断后的文本上执行正则，防止超长输入
          if (regex.test(normalized.substring(0, 500))) {
            return {
              faqId: faq.id,
              answer: faq.answer,
              answerType: faq.answerType,
              metadata: faq.metadata as Record<string, unknown> | null,
              priority: faq.priority,
            };
          }
        } catch {
          this.logger.warn(`FAQ ${faq.id} 正则无效: ${faq.pattern}`);
        }
      }
    }

    return null;
  }

  // --- Admin CRUD ---

  async findAll() {
    return this.prisma.csFaq.findMany({ orderBy: [{ priority: 'desc' }, { sortOrder: 'asc' }] });
  }

  async create(data: { keywords: string[]; pattern?: string; answer: string; answerType?: CsFaqAnswerType; metadata?: any; priority?: number }) {
    // 验证正则安全性
    if (data.pattern && !isSafeRegex(data.pattern)) {
      throw new Error('正则表达式不安全：包含嵌套量词或过长');
    }
    const result = await this.prisma.csFaq.create({ data: { ...data, answerType: data.answerType ?? 'TEXT' } });
    this.invalidateCache();
    return result;
  }

  async update(id: string, data: Record<string, unknown>) {
    if (typeof data.pattern === 'string' && !isSafeRegex(data.pattern)) {
      throw new Error('正则表达式不安全：包含嵌套量词或过长');
    }
    const result = await this.prisma.csFaq.update({ where: { id }, data });
    this.invalidateCache();
    return result;
  }

  async delete(id: string) {
    const result = await this.prisma.csFaq.delete({ where: { id } });
    this.invalidateCache();
    return result;
  }
}
