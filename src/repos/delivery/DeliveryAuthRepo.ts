import { AppError, Result } from '../../types';
import { API_BASE_URL } from '../http/config';

const DELIVERY_TIMEOUT_MS = 12000;

export type DeliveryLoginMethod = 'phone' | 'wechat';

export type DeliveryUnit = {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  detailAddress: string;
  extraFields?: Record<string, unknown> | null;
  status: string;
};

export type DeliveryAuthUser = {
  id: string;
  phone: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
};

export type DeliveryAuthSession = {
  accessToken: string;
  requiresUnit: boolean;
  currentUnitId: string | null;
  currentUnit: DeliveryUnit | null;
  user: DeliveryAuthUser;
};

type DeliveryUnitResponse = {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  detailAddress: string;
  extraFields?: Record<string, unknown> | null;
  status: string;
};

type DeliveryAuthSessionResponse = {
  accessToken: string;
  requiresUnit: boolean;
  currentUnitId: string | null;
  currentUnit: DeliveryUnitResponse | null;
  user: DeliveryAuthUser;
};

type DeliveryRequestOptions = {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};

const networkError: AppError = {
  code: 'NETWORK',
  message: '网络请求失败',
  displayMessage: '网络开小差了',
  retryable: true,
};

export const buildDeliveryPath = (path: string): string => {
  if (path === '/delivery' || path === 'delivery') {
    return '/delivery';
  }
  if (path.startsWith('/delivery/')) {
    return path;
  }
  return `/delivery/${path.replace(/^\/+/, '')}`;
};

const mapErrorResult = <T, U>(result: Result<T>): Result<U> => result as unknown as Result<U>;

export const mapDeliveryResult = <T, U>(result: Result<T>, mapper: (data: T) => U): Result<U> =>
  result.ok ? { ok: true, data: mapper(result.data) } : mapErrorResult<T, U>(result);

export const centsToYuan = (value: number): number => Number((value / 100).toFixed(2));

export const nullableCentsToYuan = (value?: number | null): number | null =>
  typeof value === 'number' ? centsToYuan(value) : null;

const getDeliveryAccessToken = (): string | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useDeliveryAuthStore } = require('../../store/useDeliveryAuthStore');
    return useDeliveryAuthStore.getState().accessToken;
  } catch {
    return undefined;
  }
};

const clearDeliveryClientState = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useDeliveryAuthStore } = require('../../store/useDeliveryAuthStore');
    useDeliveryAuthStore.getState().clearSession();
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useDeliveryCartStore } = require('../../store/useDeliveryCartStore');
    useDeliveryCartStore.getState().clearLocal();
  } catch {
    // ignore
  }
};

const buildQueryString = (params?: DeliveryRequestOptions['params']) => {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

const buildHeaders = (headers?: Record<string, string>, hasBody = false): Record<string, string> => {
  const nextHeaders: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  };
  const accessToken = getDeliveryAccessToken();
  if (accessToken) {
    nextHeaders.Authorization = `Bearer ${accessToken}`;
  }
  return nextHeaders;
};

async function deliveryRequest<T>(
  method: string,
  path: string,
  options: DeliveryRequestOptions = {},
): Promise<Result<T>> {
  const normalizedPath = buildDeliveryPath(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${normalizedPath}${buildQueryString(options.params)}`, {
      method,
      headers: buildHeaders(options.headers, options.body !== undefined),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const json = text ? (JSON.parse(text) as Result<T>) : ({ ok: response.ok, data: undefined } as Result<T>);

    if (response.status === 401 && !normalizedPath.startsWith('/delivery/auth/')) {
      clearDeliveryClientState();
    }

    return json;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        error: {
          ...networkError,
          message: '请求超时',
          displayMessage: '请求超时，请稍后重试',
        },
      };
    }
    return { ok: false, error: networkError };
  } finally {
    clearTimeout(timer);
  }
}

export const deliveryApiClient = {
  get: <T>(path: string, params?: DeliveryRequestOptions['params']) =>
    deliveryRequest<T>('GET', path, { params }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    deliveryRequest<T>('POST', path, { body, headers }),
  patch: <T>(path: string, body?: unknown) =>
    deliveryRequest<T>('PATCH', path, { body }),
  delete: <T>(path: string) =>
    deliveryRequest<T>('DELETE', path),
};

export const mapDeliveryUnit = (unit: DeliveryUnitResponse): DeliveryUnit => ({
  id: unit.id,
  name: unit.name,
  contactName: unit.contactName,
  contactPhone: unit.contactPhone,
  provinceCode: unit.provinceCode,
  provinceName: unit.provinceName,
  cityCode: unit.cityCode,
  cityName: unit.cityName,
  districtCode: unit.districtCode,
  districtName: unit.districtName,
  detailAddress: unit.detailAddress,
  extraFields: unit.extraFields ?? null,
  status: unit.status,
});

export const mapDeliveryAuthSession = (
  session: DeliveryAuthSessionResponse,
): DeliveryAuthSession => ({
  accessToken: session.accessToken,
  requiresUnit: session.requiresUnit,
  currentUnitId: session.currentUnitId,
  currentUnit: session.currentUnit ? mapDeliveryUnit(session.currentUnit) : null,
  user: {
    id: session.user.id,
    phone: session.user.phone,
    nickname: session.user.nickname,
    avatarUrl: session.user.avatarUrl,
    status: session.user.status,
  },
});

export const deliveryAuthPaths = {
  smsCode: () => buildDeliveryPath('auth/sms/code'),
  phoneLogin: () => buildDeliveryPath('auth/phone-login'),
  wechatLogin: () => buildDeliveryPath('auth/wechat-login'),
  me: () => buildDeliveryPath('me'),
};

export const DeliveryAuthRepo = {
  sendSmsCode: (payload: { phone: string }): Promise<Result<{ ok: boolean; message?: string }>> =>
    deliveryApiClient.post<{ ok: boolean; message?: string }>(deliveryAuthPaths.smsCode(), payload),

  loginWithPhone: (payload: {
    phone: string;
    code: string;
    nickname?: string;
    avatarUrl?: string;
  }): Promise<Result<DeliveryAuthSession>> =>
    deliveryApiClient
      .post<DeliveryAuthSessionResponse>(deliveryAuthPaths.phoneLogin(), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryAuthSession)),

  loginWithWechat: (payload: {
    code: string;
    nickname?: string;
    avatarUrl?: string;
  }): Promise<Result<DeliveryAuthSession>> =>
    deliveryApiClient
      .post<DeliveryAuthSessionResponse>(deliveryAuthPaths.wechatLogin(), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryAuthSession)),

  getMe: (): Promise<Result<DeliveryAuthSession>> =>
    deliveryApiClient
      .get<DeliveryAuthSessionResponse>(deliveryAuthPaths.me())
      .then((result) => mapDeliveryResult(result, mapDeliveryAuthSession)),
};
