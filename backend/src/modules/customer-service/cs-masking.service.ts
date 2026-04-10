import { Injectable, Logger } from '@nestjs/common';

/**
 * 消息脱敏服务
 *
 * 用途：在消息写入数据库前，自动遮盖用户输入中的敏感信息（身份证/银行卡/手机号/邮箱）
 * 设计原则：
 * - 写入前脱敏（不可逆）：保护数据库泄漏风险
 * - 模式识别 + 替换：用占位符替换敏感片段，保留消息结构
 * - 误伤可接受：宁可多脱敏，不可漏脱敏
 *
 * 脱敏规则：
 * - 身份证：18 位（含校验码 X）→ ****
 * - 银行卡：13-19 位连续数字 → ****
 * - 手机号：11 位（1开头）→ 138****1234
 * - 邮箱：保留首字符和域名 → t***@example.com
 */
@Injectable()
export class CsMaskingService {
  private readonly logger = new Logger(CsMaskingService.name);

  /** 身份证：18 位数字 + 末位可能为 X，前后非数字 */
  private readonly ID_CARD_REGEX = /(?<![0-9])([1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[012])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?![0-9Xx])/g;

  /** 银行卡：13-19 位连续数字（前后非数字） */
  private readonly BANK_CARD_REGEX = /(?<![0-9])(\d{13,19})(?![0-9])/g;

  /** 手机号：11 位 1 开头（前后非数字） */
  private readonly PHONE_REGEX = /(?<![0-9])(1[3-9]\d{9})(?![0-9])/g;

  /** 邮箱 */
  private readonly EMAIL_REGEX = /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  /**
   * 脱敏文本中的敏感信息
   * 脱敏顺序：身份证 → 手机号 → 邮箱 → 银行卡（避免银行卡正则吃掉身份证/手机号的数字）
   */
  mask(text: string): string {
    if (!text) return text;

    let result = text;
    let maskedCount = 0;

    // 1. 身份证（最长，最先匹配）
    result = result.replace(this.ID_CARD_REGEX, () => {
      maskedCount++;
      return '[身份证已隐藏]';
    });

    // 2. 手机号
    result = result.replace(this.PHONE_REGEX, (_match, num: string) => {
      maskedCount++;
      // 保留前 3 后 4：138****1234
      return `${num.slice(0, 3)}****${num.slice(7)}`;
    });

    // 3. 邮箱
    result = result.replace(this.EMAIL_REGEX, (_match, first: string, domain: string) => {
      maskedCount++;
      return `${first}***${domain}`;
    });

    // 4. 银行卡（最后，避免误吃身份证/手机号）
    result = result.replace(this.BANK_CARD_REGEX, () => {
      maskedCount++;
      return '[银行卡号已隐藏]';
    });

    if (maskedCount > 0) {
      this.logger.debug(`消息脱敏完成，遮盖 ${maskedCount} 处敏感信息`);
    }

    return result;
  }

  /**
   * 检测文本中是否包含敏感信息（不脱敏，仅判断）
   * 用于审计日志或拦截策略
   */
  containsSensitive(text: string): boolean {
    if (!text) return false;
    return (
      this.ID_CARD_REGEX.test(text) ||
      this.PHONE_REGEX.test(text) ||
      this.EMAIL_REGEX.test(text) ||
      this.BANK_CARD_REGEX.test(text)
    );
  }
}
