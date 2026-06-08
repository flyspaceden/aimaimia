import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { useToast } from '../feedback';

interface Props {
  /** 完整订单号 */
  orderNo: string;
  /** 收起态展示的后几位，默认 6 */
  tailCount?: number;
  /** 订单号文字样式（适配 caption / captionSm 等不同上下文） */
  textStyle?: StyleProp<TextStyle>;
  /** 图标尺寸，默认 16 */
  iconSize?: number;
  /** 容器样式（如窄空间 maxWidth 限制） */
  style?: StyleProp<ViewStyle>;
}

/**
 * 订单号脱敏展示组件。
 * - 默认只显示后 N 位（前缀 …），点眼睛在「收起 ↔ 展开完整订单号」切换；
 * - 复制按钮无论展开与否都复制完整订单号，复制后 toast「已复制」；
 * - 订单号本身不超过 N 位时不显示眼睛（无需脱敏）。
 * 用于订单详情页 / 支付成功页 / 物流追踪页。
 */
export function OrderNoReveal({ orderNo, tailCount = 6, textStyle, iconSize = 16, style }: Props) {
  const { colors, typography } = useTheme();
  const { show } = useToast();
  const [revealed, setRevealed] = useState(false);

  if (!orderNo) {
    return (
      <Text
        style={[typography.caption, { color: colors.text.primary }, textStyle]}
        accessibilityLabel="订单号未提供"
      >
        —
      </Text>
    );
  }

  const maskable = orderNo.length > tailCount;
  const display = revealed || !maskable ? orderNo : `…${orderNo.slice(-tailCount)}`;
  // 竖向给足、横向适中：横向 8 + 图标间 gap 16，避免相邻眼睛/复制热区重叠
  const hit = { top: 12, bottom: 12, left: 8, right: 8 };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(orderNo);
    show({ message: '已复制', type: 'success' });
  };

  return (
    <View style={[styles.row, style]}>
      <Text
        style={[
          typography.caption,
          { color: colors.text.primary, fontFamily: 'monospace', flexShrink: 1 },
          textStyle,
        ]}
        selectable
        numberOfLines={revealed ? undefined : 1}
      >
        {display}
      </Text>
      {maskable ? (
        <Pressable
          onPress={() => setRevealed((v) => !v)}
          hitSlop={hit}
          accessibilityRole="button"
          accessibilityLabel={revealed ? '收起订单号' : '展开完整订单号'}
        >
          <MaterialCommunityIcons
            name={revealed ? 'eye-off-outline' : 'eye-outline'}
            size={iconSize}
            color={colors.text.secondary}
          />
        </Pressable>
      ) : null}
      <Pressable
        onPress={handleCopy}
        hitSlop={hit}
        accessibilityRole="button"
        accessibilityLabel="复制订单号"
      >
        <MaterialCommunityIcons name="content-copy" size={iconSize} color={colors.text.secondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 1 },
});
