import type { CheckoutSession, MiniProgramPaymentParams } from './checkout';
import type { PageResult } from './pagination';

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isPageResult(value: unknown): value is Omit<PageResult<unknown>, 'nextPage'> {
  if (!isObject(value)) return false;
  return Array.isArray(value.items)
    && Number.isInteger(value.total)
    && Number(value.total) >= 0
    && Number.isInteger(value.page)
    && Number(value.page) >= 1
    && Number.isInteger(value.pageSize)
    && Number(value.pageSize) >= 1;
}

export function isMiniProgramPaymentParams(value: unknown): value is MiniProgramPaymentParams {
  if (!isObject(value)) return false;
  return value.channel === 'wechat'
    && value.scene === 'mini_program'
    && typeof value.appId === 'string'
    && value.appId.length > 0
    && typeof value.timeStamp === 'string'
    && typeof value.nonceStr === 'string'
    && typeof value.package === 'string'
    && value.package.startsWith('prepay_id=')
    && value.package.length > 'prepay_id='.length
    && value.signType === 'RSA'
    && typeof value.paySign === 'string'
    && value.paySign.length > 0
    && typeof value.prepayId === 'string'
    && value.prepayId.length > 0;
}

export function isCheckoutSession(value: unknown): value is CheckoutSession {
  if (!isObject(value)) return false;
  return typeof value.sessionId === 'string'
    && typeof value.merchantOrderNo === 'string'
    && typeof value.expectedTotal === 'number'
    && value.paymentScene === 'MINI_PROGRAM'
    && isMiniProgramPaymentParams(value.paymentParams);
}
