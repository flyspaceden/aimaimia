import type { Address, AddressInput, UserProfile } from '@/types';

export const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;
export const SMS_CODE_PATTERN = /^\d{6}$/;

export type AddressDraft = {
  receiverName: string;
  phone: string;
  regionCode: string;
  regionText: string;
  regionValues: string[];
  detail: string;
};

export function isMainlandPhone(value: string): boolean {
  return MAINLAND_PHONE_PATTERN.test(value.trim());
}

export function isSmsCode(value: string): boolean {
  return SMS_CODE_PATTERN.test(value.trim());
}

export function maskPhone(phone?: string): string {
  if (!phone) return '未绑定手机号';
  const normalized = phone.trim();
  if (normalized.length !== 11) return normalized;
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

export function parseInterests(value: string): string[] {
  return Array.from(new Set(value
    .split(/[,，、/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)))
    .slice(0, 6);
}

export function formatInterests(interests?: string[]): string {
  return interests?.length ? interests.join('、') : '';
}

export function validateProfileDraft(input: Pick<UserProfile, 'name' | 'location'> & { interestsText: string }): string | undefined {
  const name = input.name.trim();
  const location = input.location.trim();
  if (name.length < 2) return '昵称至少 2 个字';
  if (name.length > 12) return '昵称不超过 12 个字';
  if (location.length < 2) return '请填写所在地';
  if (location.length > 20) return '所在地不超过 20 个字';
  return undefined;
}

export function addressToDraft(address?: Address): AddressDraft {
  if (!address) return { receiverName: '', phone: '', regionCode: '', regionText: '', regionValues: [], detail: '' };
  const fallbackValues = [address.province, address.city, address.district].filter(Boolean);
  const regionValues = address.regionText
    ? address.regionText.split('/').filter(Boolean)
    : fallbackValues;
  return {
    receiverName: address.receiverName,
    phone: address.phone,
    regionCode: address.regionCode ?? '',
    regionText: address.regionText || fallbackValues.join('/'),
    regionValues,
    detail: address.detail,
  };
}

export function validateAddressDraft(draft: AddressDraft): string | undefined {
  if (!draft.receiverName.trim()) return '请输入收货人姓名';
  if (draft.receiverName.trim().length > 50) return '收货人姓名不超过 50 个字';
  if (!isMainlandPhone(draft.phone)) return '请输入正确的手机号';
  if (!draft.regionCode || !draft.regionText) return '请选择省/市/区';
  if (!draft.detail.trim()) return '请输入详细地址';
  if (draft.detail.trim().length > 200) return '详细地址不超过 200 个字';
  return undefined;
}

export function addressDraftToInput(draft: AddressDraft): AddressInput {
  return {
    receiverName: draft.receiverName.trim(),
    phone: draft.phone.trim(),
    regionCode: draft.regionCode,
    regionText: draft.regionText,
    detail: draft.detail.trim(),
  };
}

export function formatAddressLine(address: Address): string {
  const region = address.regionText
    ? address.regionText.replace(/\//g, ' ')
    : [address.province, address.city, address.district].filter(Boolean).join('');
  return `${region} ${address.detail}`.trim();
}
