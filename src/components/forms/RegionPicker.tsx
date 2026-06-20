import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import type { ColorScheme } from '../../theme/colors';
import regions from '../../data/china-regions.json';
import { resolveRegionPickerColors } from './regionPickerTheme';

/** 行政区划节点（省/市/区共用） */
type RegionNode = {
  code: string;
  name: string;
  children?: RegionNode[];
};

const PROVINCES = regions as RegionNode[];

export type RegionValue = {
  /** 行政区划标准编码（6 位区县码，如 "110101"） */
  regionCode: string;
  /** 文本，"/" 分隔，如 "北京市/北京市/东城区" */
  regionText: string;
};

type Props = {
  value?: RegionValue | null;
  onChange: (value: RegionValue) => void;
  placeholder?: string;
  colors?: ColorScheme;
};

type Level = 'province' | 'city' | 'district';

/**
 * 省/市/区三级联动选择器（淘宝风底部弹起 Tab 切换）。
 * - 数据来源：src/data/china-regions.json（pca-code 行政区划标准）
 * - 选完 3 级自动 onChange + 关闭
 * - regionText 用 "/" 分隔，与后端 parseChineseAddress 兼容
 */
export const RegionPicker: React.FC<Props> = ({
  value,
  onChange,
  placeholder = '请选择省/市/区',
  colors: colorOverride,
}) => {
  const theme = useTheme();
  const colors = resolveRegionPickerColors(theme.colors, colorOverride);
  const { radius, spacing, typography } = theme;
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>('province');
  const [provinceCode, setProvinceCode] = useState<string | null>(null);
  const [cityCode, setCityCode] = useState<string | null>(null);
  // 区县由用户最终点击确定，不需要单独 state（点击即提交）

  // 打开 Modal 时根据传入 value 还原选择路径（编辑场景）
  useEffect(() => {
    if (!open) return;
    if (!value?.regionCode) {
      setLevel('province');
      setProvinceCode(null);
      setCityCode(null);
      return;
    }
    // 通过 6 位 code 反查省/市
    const provinceP = value.regionCode.slice(0, 2);
    const cityP = value.regionCode.slice(0, 4);
    const matchedProvince = PROVINCES.find((p) => p.code === provinceP);
    const matchedCity = matchedProvince?.children?.find((c) => c.code === cityP);
    setProvinceCode(matchedProvince ? matchedProvince.code : null);
    setCityCode(matchedCity ? matchedCity.code : null);
    setLevel(matchedCity ? 'district' : matchedProvince ? 'city' : 'province');
  }, [open, value?.regionCode]);

  const province = useMemo(
    () => PROVINCES.find((p) => p.code === provinceCode) || null,
    [provinceCode],
  );
  const city = useMemo(
    () => province?.children?.find((c) => c.code === cityCode) || null,
    [province, cityCode],
  );

  const list: RegionNode[] = useMemo(() => {
    if (level === 'province') return PROVINCES;
    if (level === 'city') return province?.children || [];
    return city?.children || [];
  }, [level, province, city]);

  const handleSelect = (node: RegionNode) => {
    if (level === 'province') {
      setProvinceCode(node.code);
      setCityCode(null);
      setLevel('city');
      return;
    }
    if (level === 'city') {
      setCityCode(node.code);
      setLevel('district');
      return;
    }
    // level === 'district'：完成
    if (!province || !city) return;
    onChange({
      regionCode: node.code,
      regionText: `${province.name}/${city.name}/${node.name}`,
    });
    setOpen(false);
  };

  const triggerLabel = value?.regionText
    ? value.regionText.replace(/\//g, ' ')
    : placeholder;

  const tabLabel = (l: Level): string => {
    if (l === 'province') return province?.name || '请选择';
    if (l === 'city') return city?.name || '请选择';
    return '请选择';
  };

  const tabActive = (l: Level): boolean => l === level;
  const tabEnabled = (l: Level): boolean => {
    if (l === 'province') return true;
    if (l === 'city') return !!province;
    return !!city;
  };

  const selectedCodeAtLevel = (): string | null => {
    if (level === 'province') return provinceCode;
    if (level === 'city') return cityCode;
    return null;
  };

  return (
    <>
      {/* Trigger */}
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <Text
          style={[
            typography.body,
            {
              color: value?.regionText ? colors.text.primary : colors.muted,
              flex: 1,
            },
          ]}
          numberOfLines={1}
        >
          {triggerLabel}
        </Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
      </Pressable>

      {/* Modal */}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            // 阻止背景点击穿透
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>选择地区</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* Tabs */}
            <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
              {(['province', 'city', 'district'] as Level[]).map((l) => {
                const active = tabActive(l);
                const enabled = tabEnabled(l);
                return (
                  <Pressable
                    key={l}
                    disabled={!enabled}
                    onPress={() => enabled && setLevel(l)}
                    style={styles.tab}
                  >
                    <Text
                      style={[
                        typography.body,
                        {
                          color: !enabled
                            ? colors.muted
                            : active
                              ? colors.brand.primary
                              : colors.text.primary,
                          fontWeight: active ? '600' : '400',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {tabLabel(l)}
                    </Text>
                    {active && (
                      <View
                        style={[styles.tabIndicator, { backgroundColor: colors.brand.primary }]}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* List */}
            <FlatList
              data={list}
              keyExtractor={(item) => item.code}
              initialNumToRender={20}
              renderItem={({ item }) => {
                const selected = selectedCodeAtLevel() === item.code;
                return (
                  <Pressable
                    onPress={() => handleSelect(item)}
                    style={[
                      styles.row,
                      { borderBottomColor: colors.border, paddingHorizontal: spacing.xl },
                    ]}
                  >
                    <Text
                      style={[
                        typography.body,
                        { color: selected ? colors.brand.primary : colors.text.primary, flex: 1 },
                      ]}
                    >
                      {item.name}
                    </Text>
                    {selected && (
                      <MaterialCommunityIcons name="check" size={18} color={colors.brand.primary} />
                    )}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '70%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    position: 'relative',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    width: 24,
    borderRadius: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
