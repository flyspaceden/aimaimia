import { CsMaskingService } from './cs-masking.service';

describe('CsMaskingService', () => {
  const service = new CsMaskingService();

  describe('身份证脱敏', () => {
    it('18 位身份证（数字结尾）→ 替换为占位符', () => {
      const result = service.mask('我的身份证号是 110101199003078812');
      expect(result).toContain('[身份证已隐藏]');
      expect(result).not.toContain('110101199003078812');
    });

    it('18 位身份证（X 结尾）→ 替换为占位符', () => {
      const result = service.mask('身份证 11010119900307881X');
      expect(result).toContain('[身份证已隐藏]');
      expect(result).not.toContain('11010119900307881X');
    });

    it('文本中嵌入身份证 → 替换不影响其他文字', () => {
      const result = service.mask('请帮我用身份证110101199003078812查一下订单');
      expect(result).toContain('请帮我用身份证');
      expect(result).toContain('查一下订单');
      expect(result).toContain('[身份证已隐藏]');
    });
  });

  describe('手机号脱敏', () => {
    it('11 位手机号（13 开头）→ 中间 4 位用 * 替换', () => {
      const result = service.mask('我的手机是 13812341234');
      expect(result).toContain('138****1234');
      expect(result).not.toContain('13812341234');
    });

    it('19 开头手机号也匹配', () => {
      const result = service.mask('19012345678');
      expect(result).toContain('190****5678');
    });

    it('10 位号码不匹配（非手机号）', () => {
      const result = service.mask('订单号 1234567890');
      expect(result).toContain('1234567890');
    });
  });

  describe('邮箱脱敏', () => {
    it('保留首字符和域名', () => {
      const result = service.mask('我的邮箱 test@example.com');
      expect(result).toContain('t***@example.com');
      expect(result).not.toContain('test@example.com');
    });

    it('多个邮箱都被脱敏', () => {
      const result = service.mask('a@x.com 和 b@y.com');
      expect(result).toContain('a***@x.com');
      expect(result).toContain('b***@y.com');
    });
  });

  describe('银行卡脱敏', () => {
    it('16 位银行卡号 → 替换为占位符', () => {
      const result = service.mask('卡号 6228480000000000');
      expect(result).toContain('[银行卡号已隐藏]');
      expect(result).not.toContain('6228480000000000');
    });

    it('19 位银行卡号 → 替换', () => {
      const result = service.mask('我的卡是 6228480000000000123');
      expect(result).toContain('[银行卡号已隐藏]');
    });
  });

  describe('混合脱敏', () => {
    it('一条消息包含多种敏感信息 → 全部脱敏', () => {
      const result = service.mask(
        '身份证 110101199003078812 手机 13812341234 邮箱 test@x.com',
      );
      expect(result).toContain('[身份证已隐藏]');
      expect(result).toContain('138****1234');
      expect(result).toContain('t***@x.com');
    });

    it('无敏感信息 → 原样返回', () => {
      const result = service.mask('我想退款');
      expect(result).toBe('我想退款');
    });

    it('空字符串 → 返回空', () => {
      expect(service.mask('')).toBe('');
    });
  });

  describe('containsSensitive', () => {
    it('含手机号 → true', () => {
      expect(service.containsSensitive('打 13812341234')).toBe(true);
    });

    it('普通文字 → false', () => {
      expect(service.containsSensitive('退款')).toBe(false);
    });

    it('空字符串 → false', () => {
      expect(service.containsSensitive('')).toBe(false);
    });
  });
});
