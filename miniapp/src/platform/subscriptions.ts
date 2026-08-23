import Taro from '@tarojs/taro';
import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';

export const MINI_SUBSCRIPTION_KEYS = [
  'ORDER_SHIPPED',
  'AFTER_SALE_RESULT',
  'WITHDRAW_RESULT',
] as const;

export type MiniSubscriptionKey = typeof MINI_SUBSCRIPTION_KEYS[number];
export type MiniSubscriptionStatus = 'accept' | 'reject' | 'ban' | 'filter';

export type MiniSubscriptionTemplate = {
  key: MiniSubscriptionKey;
  templateId: string;
  label: string;
  description: string;
  configured: boolean;
};

export type MiniSubscriptionRequestResult = {
  accepted: MiniSubscriptionKey[];
  rejected: MiniSubscriptionKey[];
  unavailable: MiniSubscriptionKey[];
};

function requestId(): string {
  const bytes = new Uint8Array(12);
  const cryptoApi = (globalThis as typeof globalThis & {
    crypto?: { getRandomValues?: (value: Uint8Array) => Uint8Array };
  }).crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `mini-sub-${Date.now().toString(36)}-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function failure<T>(code: string, displayMessage: string, retryable = false): Result<T> {
  return { ok: false, error: { code, message: displayMessage, displayMessage, retryable } };
}

export const MiniSubscriptionRepo = {
  templates: (): Promise<Result<MiniSubscriptionTemplate[]>> =>
    ApiClient.get<MiniSubscriptionTemplate[]>('/mini-program/subscriptions/templates'),
  record: (
    clientRequestId: string,
    results: Array<{ key: MiniSubscriptionKey; templateId: string; status: MiniSubscriptionStatus }>,
  ) => ApiClient.post<{ recorded: number }>('/mini-program/subscriptions/consents', {
    clientRequestId,
    results,
  }, { idempotencyKey: clientRequestId }),
};

/**
 * 必须由用户的点击行为调用；不在页面加载时自动索取授权。
 */
export async function requestMiniProgramSubscriptions(
  keys: MiniSubscriptionKey[],
  preloadedTemplates?: MiniSubscriptionTemplate[],
): Promise<Result<MiniSubscriptionRequestResult>> {
  const uniqueKeys = [...new Set(keys)].filter((key) => MINI_SUBSCRIPTION_KEYS.includes(key));
  if (!uniqueKeys.length) return failure('NO_SUBSCRIPTION_PURPOSE', '没有可订阅的服务提醒');
  let templates = preloadedTemplates;
  if (!templates) {
    const templatesResult = await MiniSubscriptionRepo.templates();
    if (!templatesResult.ok) return templatesResult;
    templates = templatesResult.data;
  }
  const requested = templates.filter((item) => uniqueKeys.includes(item.key) && item.configured && item.templateId);
  const unavailable = uniqueKeys.filter((key) => !requested.some((item) => item.key === key));
  if (!requested.length) {
    return failure('SUBSCRIPTION_TEMPLATES_NOT_CONFIGURED', '微信订阅消息模板尚未配置');
  }

  let platformResult: Awaited<ReturnType<typeof Taro.requestSubscribeMessage>>;
  try {
    // Taro 4.2.1 的 AtLeastOne 类型在这里错误地同时要求微信 tmplIds
    // 和另一平台的 entityIds；运行时按微信官方合同只传 tmplIds。
    platformResult = await (Taro.requestSubscribeMessage as unknown as (
      option: { tmplIds: string[] },
    ) => ReturnType<typeof Taro.requestSubscribeMessage>)({
      tmplIds: requested.slice(0, 3).map((item) => item.templateId),
    });
  } catch (error) {
    const message = error && typeof error === 'object' && 'errMsg' in error
      ? String((error as { errMsg?: unknown }).errMsg || '')
      : '';
    return failure('SUBSCRIPTION_PANEL_FAILED', message || '无法打开微信订阅面板', true);
  }

  const results = requested.slice(0, 3).map((template) => {
    const rawStatus = String((platformResult as Record<string, unknown>)[template.templateId] || 'reject');
    const status: MiniSubscriptionStatus = ['accept', 'reject', 'ban', 'filter'].includes(rawStatus)
      ? rawStatus as MiniSubscriptionStatus
      : 'reject';
    return { key: template.key, templateId: template.templateId, status };
  });
  const clientRequestId = requestId();
  const recorded = await MiniSubscriptionRepo.record(clientRequestId, results);
  if (!recorded.ok) return recorded;
  return {
    ok: true,
    data: {
      accepted: results.filter((item) => item.status === 'accept').map((item) => item.key),
      rejected: results.filter((item) => item.status !== 'accept').map((item) => item.key),
      unavailable,
    },
  };
}

/**
 * 业务动作附近的可选订阅：授权面板、模板配置或记录失败都不得改变主业务结果。
 * 调用方仍必须位于用户明确点击产生的处理链上。
 */
export async function requestOptionalMiniProgramSubscriptions(
  keys: MiniSubscriptionKey[],
  preloadedTemplates?: MiniSubscriptionTemplate[],
): Promise<void> {
  try {
    await requestMiniProgramSubscriptions(keys, preloadedTemplates);
  } catch {
    // 订阅是附加能力，不向申请售后、提现等主业务抛错。
  }
}
