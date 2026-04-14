import { parseChineseAddress } from './parse-region';

describe('parseChineseAddress', () => {
  it('普通省市区直接拼接', () => {
    expect(parseChineseAddress('广东省广州市天河区')).toEqual({
      province: '广东省',
      city: '广州市',
      district: '天河区',
    });
  });

  it('直辖市 上海市浦东新区', () => {
    expect(parseChineseAddress('上海市浦东新区')).toEqual({
      province: '上海市',
      city: '上海市',
      district: '浦东新区',
    });
  });

  it('直辖市 北京市朝阳区', () => {
    expect(parseChineseAddress('北京市朝阳区')).toEqual({
      province: '北京市',
      city: '北京市',
      district: '朝阳区',
    });
  });

  it('自治区 内蒙古自治区呼和浩特市回民区', () => {
    expect(parseChineseAddress('内蒙古自治区呼和浩特市回民区')).toEqual({
      province: '内蒙古自治区',
      city: '呼和浩特市',
      district: '回民区',
    });
  });

  it('空格分隔 三段', () => {
    expect(parseChineseAddress('广东省 广州市 天河区')).toEqual({
      province: '广东省',
      city: '广州市',
      district: '天河区',
    });
  });

  it('空格分隔：直辖市两段形式', () => {
    expect(parseChineseAddress('上海市 浦东新区')).toEqual({
      province: '上海市',
      city: '浦东新区',
      district: '',
    });
  });

  it('空字符串/undefined 安全处理', () => {
    expect(parseChineseAddress('')).toEqual({ province: '', city: '', district: '' });
    expect(parseChineseAddress(null)).toEqual({ province: '', city: '', district: '' });
    expect(parseChineseAddress(undefined)).toEqual({ province: '', city: '', district: '' });
  });

  it('解析失败时整串作为 province', () => {
    expect(parseChineseAddress('乱码xyz')).toEqual({
      province: '乱码xyz',
      city: '',
      district: '',
    });
  });

  it('逗号分隔也支持', () => {
    expect(parseChineseAddress('广东省,广州市,天河区')).toEqual({
      province: '广东省',
      city: '广州市',
      district: '天河区',
    });
  });

  it('自治州：四川省凉山彝族自治州西昌市', () => {
    expect(parseChineseAddress('四川省凉山彝族自治州西昌市')).toEqual({
      province: '四川省',
      city: '凉山彝族自治州',
      district: '西昌市',
    });
  });
});
