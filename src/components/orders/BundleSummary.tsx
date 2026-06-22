import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme';
import type { ProductType } from '../../types/domain/Product';
import type { BundleSnapshotItem } from '../../types/domain/BundleSnapshot';
import { formatBundleQuantityLabel, isBundleProductType } from '../../utils/bundleSnapshot';

type Props = {
  productType?: ProductType;
  bundleItems?: BundleSnapshotItem[];
  showLabel?: boolean;
};

export function BundleSummary({ productType, bundleItems, showLabel = true }: Props) {
  const { colors, radius, spacing, typography } = useTheme();

  if (!isBundleProductType(productType) || !bundleItems?.length) {
    return null;
  }

  return (
    <View
      style={[
        styles.wrapper,
        {
          marginTop: spacing.sm,
          padding: spacing.sm,
          borderRadius: radius.md,
          backgroundColor: colors.bgSecondary,
        },
      ]}
    >
      {showLabel ? (
        <Text style={[typography.captionSm, { color: colors.text.secondary, marginBottom: spacing.xs }]}>
          组合内容
        </Text>
      ) : null}
      {bundleItems.map((item) => (
        <View key={`${item.skuId}-${item.productTitle}`} style={styles.row}>
          {item.image ? (
            <Image
              source={{ uri: item.image }}
              style={[styles.image, { borderRadius: radius.sm, backgroundColor: colors.surface }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.image, { borderRadius: radius.sm, backgroundColor: colors.surface }]} />
          )}
          <View style={[styles.textWrap, { marginLeft: spacing.sm }]}>
            <Text style={[typography.caption, { color: colors.text.primary }]} numberOfLines={1}>
              {item.productTitle}
            </Text>
            <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 2 }]} numberOfLines={1}>
              {item.skuTitle || '默认规格'}
            </Text>
          </View>
          <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
            {formatBundleQuantityLabel(item)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  image: {
    width: 28,
    height: 28,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
});
