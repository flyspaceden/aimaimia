import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import type { ProductType } from '../../types/domain/Product';
import type { BundleSnapshotItem } from '../../types/domain/BundleSnapshot';
import { BundleSummary } from '../orders/BundleSummary';

interface Props {
  image: string;
  title: string;
  skuTitle?: string;
  productType?: ProductType;
  bundleItems?: BundleSnapshotItem[];
  unitPrice: number;
  quantity: number;
  priceLabel?: string;
  /** 是否显示"申请售后"按钮 */
  showAfterSaleAction?: boolean;
  onAfterSale?: () => void;
}

export function OrderItemRow({
  image,
  title,
  skuTitle,
  productType,
  bundleItems,
  unitPrice,
  quantity,
  priceLabel,
  showAfterSaleAction,
  onAfterSale,
}: Props) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={styles.row}>
      {image ? (
        <Image source={{ uri: image }} style={[styles.image, { borderRadius: radius.md, backgroundColor: colors.muted }]} />
      ) : (
        <View style={[styles.image, { borderRadius: radius.md, backgroundColor: colors.muted }]} />
      )}
      <View style={styles.body}>
        <Text style={[typography.body, { color: colors.text.primary }]} numberOfLines={2}>{title}</Text>
        {skuTitle ? (
          <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: 2 }]} numberOfLines={1}>
            规格：{skuTitle}
          </Text>
        ) : null}
        <BundleSummary productType={productType} bundleItems={bundleItems} />
        <View style={styles.metaRow}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>x{quantity}</Text>
          {showAfterSaleAction ? (
            <Pressable onPress={onAfterSale}>
              <Text style={[typography.caption, { color: colors.text.secondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }]}>
                申请售后
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={[typography.bodyStrong, { color: priceLabel ? colors.gold.primary : colors.text.primary }]}>
        {priceLabel ?? `¥${unitPrice.toFixed(2)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  image: { width: 56, height: 56, marginRight: 10 },
  body: { flex: 1, marginRight: 8, minWidth: 0 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
});
