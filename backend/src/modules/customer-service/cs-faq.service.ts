import { Injectable, Logger } from '@nestjs/common';
import { CsFaqAnswerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface FaqMatchResult {
  faqId: string;
  answer: string;
  answerType: CsFaqAnswerType;
  metadata: Record<string, unknown> | null;
  priority: number;
}

@Injectable()
export class CsFaqService {
  private readonly logger = new Logger(CsFaqService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 匹配 FAQ 规则：先关键词匹配，再正则匹配，返回最高优先级结果
   */
  async match(message: string): Promise<FaqMatchResult | null> {
    const faqs = await this.prisma.csFaq.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    });

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

      // 正则匹配
      if (faq.pattern) {
        try {
          const regex = new RegExp(faq.pattern, 'i');
          if (regex.test(normalized)) {
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
    return this.prisma.csFaq.create({ data: { ...data, answerType: data.answerType ?? 'TEXT' } });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.csFaq.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.csFaq.delete({ where: { id } });
  }
}
