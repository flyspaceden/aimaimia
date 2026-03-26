const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

interface ApiResponse<T = any> {
  ok: boolean;
  data: T;
  error?: string;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(res.status === 429 ? '请求过于频繁，请稍后再试' : '服务器错误，请稍后重试');
  }
  const body: ApiResponse<T> = await res.json();
  if (!body.ok) throw new Error(body.error || '请求失败');
  return body.data;
}

export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    throw new Error(res.status === 429 ? '请求过于频繁，请稍后再试' : '服务器错误，请稍后重试');
  }
  const body: ApiResponse<T> = await res.json();
  if (!body.ok) throw new Error(body.error || '请求失败');
  return body.data;
}

export async function getCaptcha(): Promise<{ captchaId: string; svg: string }> {
  return apiGet('/captcha');
}

export async function submitMerchantApplication(formData: FormData): Promise<{ message: string }> {
  return apiPostForm('/merchant-applications', formData);
}
