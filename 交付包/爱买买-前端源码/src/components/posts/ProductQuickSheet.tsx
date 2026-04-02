import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { AppBottomSheet } from '../overlay';
import { ErrorState, Skeleton, useToast } from '../feedback';
import { ProductRepo } from '../../repos';
import { useCartStore } from '../../store';
import { useTheme } from '../../theme';
import { Price } from '../ui';

type ProductQuickSheetProps = {
  open: boolean;
  productId?: string;
  onClose: () => void;
};

// 商品快购抽屉：帖子挂商品的快捷购买入口（公共组件需中文注释）
export const ProductQuickSheet = ({ open, productId, onClose }: ProductQuickSheetProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const addItem = useCartStore((state) => state.addItem);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => ProductRepo.getById(String(productId)),
    enabled: Boolean(productId) && open,
  });

  return (
    <AppBottomSheet open={open} onClose={onClose} mode="auto" title="挂载商品">
      {isLoading ? (
        <View>
          <Skeleton height={120} radius={radius.lg} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.md }} />
        </View>
      ) : !data || !data.ok ? (
        <ErrorState
          title="商品加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后再试' : '请稍后再试'}
          onAction={refetch}
        />
      ) : (
        <View>
          <View style={styles.productRow}>
            <Image source={{ uri: data.data.image }} style={{ width: 84, height: 84, borderRadius: radius.md }} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
                {data.data.title}
              </Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {data.data.origin}
              </Text>
              <View style={{ marginTop: 8 }}>
                <Price value={data.data.price} unit={data.data.unit} strikeValue={data.data.strikePrice} />
              </View>
            </View>
          </View>
          <Pressable
            onPress={() => {
              addItem(data.data);
              show({ message: '已加入购物车', type: 'success' });
              onClose();
            }}
            style={[styles.primaryButton, { backgroundColor: colors.brand.primary, borderRadius: radius.md }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>一键加购</Text>
          </Pressable>
        </View>
      )}
    </AppBottomSheet>
  );
};

const styles = StyleSheet.create({
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
