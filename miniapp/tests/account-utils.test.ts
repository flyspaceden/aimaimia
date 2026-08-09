import { describe, expect, it } from 'vitest';
import {
  addressDraftToInput,
  addressToDraft,
  formatAddressLine,
  formatInterests,
  isMainlandPhone,
  isSmsCode,
  maskPhone,
  parseInterests,
  validateAddressDraft,
  validateProfileDraft,
} from '@/components/account-utils';
import type { Address } from '@/types';

const address: Address = {
  id: 'address-1', receiverName: '张三', phone: '13800138000',
  regionCode: '330106', regionText: '浙江省/杭州市/西湖区',
  province: '浙江省', city: '杭州市', district: '西湖区', detail: '文三路 138 号',
  isDefault: true, createdAt: '2026-08-02T00:00:00.000Z',
};

describe('account presentation contracts', () => {
  it('uses the same mainland phone and six-digit SMS boundaries as backend DTOs', () => {
    expect(isMainlandPhone('13800138000')).toBe(true);
    expect(isMainlandPhone('12800138000')).toBe(false);
    expect(isSmsCode('123456')).toBe(true);
    expect(isSmsCode('12345a')).toBe(false);
  });

  it('masks a trusted phone without changing missing-profile copy', () => {
    expect(maskPhone('13800138000')).toBe('138****8000');
    expect(maskPhone()).toBe('未绑定手机号');
  });

  it('deduplicates and caps App-compatible interest tags', () => {
    const interests = parseInterests('蓝莓、有机蔬菜，蓝莓 当季水果 大米 茶叶 蜂蜜 坚果');
    expect(interests).toEqual(['蓝莓', '有机蔬菜', '当季水果', '大米', '茶叶', '蜂蜜']);
    expect(formatInterests(interests)).toBe('蓝莓、有机蔬菜、当季水果、大米、茶叶、蜂蜜');
  });

  it('keeps the App profile validation limits before mini-program PUT /me', () => {
    expect(validateProfileDraft({ name: '爱', location: '上海', interestsText: '' })).toBe('昵称至少 2 个字');
    expect(validateProfileDraft({ name: '爱买买', location: '上海', interestsText: '' })).toBeUndefined();
  });

  it('round-trips the server region code and human-readable region text', () => {
    const draft = addressToDraft(address);
    expect(draft.regionValues).toEqual(['浙江省', '杭州市', '西湖区']);
    expect(validateAddressDraft(draft)).toBeUndefined();
    expect(addressDraftToInput(draft)).toEqual({
      receiverName: '张三', phone: '13800138000', regionCode: '330106',
      regionText: '浙江省/杭州市/西湖区', detail: '文三路 138 号',
    });
  });

  it('requires legacy addresses without a region code to be reselected before saving', () => {
    const draft = addressToDraft({ ...address, regionCode: undefined, regionText: undefined });
    expect(draft.regionValues).toEqual(['浙江省', '杭州市', '西湖区']);
    expect(validateAddressDraft(draft)).toBe('请选择省/市/区');
  });

  it('falls back to legacy region labels when an old record stores an empty regionText', () => {
    expect(addressToDraft({ ...address, regionText: '' }).regionValues).toEqual(['浙江省', '杭州市', '西湖区']);
  });

  it('renders new and legacy address lines without exposing internal codes', () => {
    expect(formatAddressLine(address)).toBe('浙江省 杭州市 西湖区 文三路 138 号');
    expect(formatAddressLine({ ...address, regionText: undefined })).toBe('浙江省杭州市西湖区 文三路 138 号');
  });
});
