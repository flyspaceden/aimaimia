/**
 * 中文行政区划地址解析。
 *
 * 兼容两类输入：
 *   1. 分隔符拼接：`"广东省 广州市 天河区"`（空格/逗号/斜杠分隔）
 *   2. 直接拼接：`"广东省广州市天河区"` 或 `"上海市浦东新区"`
 *
 * 特殊处理：
 *   - 直辖市（北京/上海/天津/重庆）：province=city=直辖市名，district=余下
 *   - 自治区（内蒙古/广西/西藏/宁夏/新疆）：整体作为 province
 */

const MUNICIPALITIES = ['北京市', '上海市', '天津市', '重庆市'];
const AUTONOMOUS_REGIONS = [
  '内蒙古自治区',
  '广西壮族自治区',
  '西藏自治区',
  '宁夏回族自治区',
  '新疆维吾尔自治区',
];

export function parseChineseAddress(regionText: string | null | undefined): {
  province: string;
  city: string;
  district: string;
} {
  if (!regionText) return { province: '', city: '', district: '' };

  const text = regionText.trim();
  if (!text) return { province: '', city: '', district: '' };

  // 1. 有分隔符直接拆分
  if (/[\s,/、]/.test(text)) {
    const parts = text
      .split(/[\s,/、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      province: parts[0] || '',
      city: parts[1] || '',
      district: parts[2] || '',
    };
  }

  // 2. 直辖市
  for (const m of MUNICIPALITIES) {
    if (text.startsWith(m)) {
      return { province: m, city: m, district: text.slice(m.length) };
    }
  }

  // 3. 自治区
  for (const ar of AUTONOMOUS_REGIONS) {
    if (text.startsWith(ar)) {
      const rest = text.slice(ar.length);
      const m = rest.match(/^(.+?(?:市|自治州|地区|盟))(.*)$/);
      if (m) return { province: ar, city: m[1] || '', district: m[2] || '' };
      return { province: ar, city: rest, district: '' };
    }
  }

  // 4. 普通省（"XX省XX市XX区/县"）
  const m = text.match(/^(.+?省)(.+?(?:市|自治州|地区|盟))(.*)$/);
  if (m) return { province: m[1], city: m[2], district: m[3] || '' };

  // 5. 解析失败：整串塞入 province
  return { province: text, city: '', district: '' };
}
