declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;
declare const require: any;
declare const process: { cwd: () => string };

const fs = require('fs');

const readProjectFile = (path: string) =>
  fs.readFileSync(`${process.cwd()}/${path}`, 'utf8');

describe('VIP membership copy', () => {
  it('keeps the membership center copy aligned with implemented VIP benefits', () => {
    const source = readProjectFile('app/me/vip.tsx');

    [
      '消费奖励翻倍',
      '高额返利',
      '入会专属礼包',
      '全场商品享受 VIP 专属价',
      '奖励余额可随时申请提现至微信或支付宝',
    ].forEach((phrase) => {
      expect(source).not.toContain(phrase);
    });

    [
      '普通商品会员价',
      '更低包邮门槛',
      '消费积分抵扣更多',
      'VIP 身份标识',
      '普通商品确认收货后，按平台规则计算奖励',
      '可用余额满足规则后，可申请提现至支付宝',
    ].forEach((phrase) => {
      expect(source).toContain(phrase);
    });
  });

  it('keeps the me page VIP modal free of unsupported benefit promises', () => {
    const source = readProjectFile('app/(tabs)/me.tsx');

    [
      '全场商品享 95 折',
      '多买多补贴',
      '惊喜礼包一份',
      '优先客服通道',
    ].forEach((phrase) => {
      expect(source).not.toContain(phrase);
    });

    [
      '普通商品会员价',
      '更低包邮门槛',
      '消费积分抵扣更多',
      '推荐 VIP 奖励',
    ].forEach((phrase) => {
      expect(source).toContain(phrase);
    });
  });
});
