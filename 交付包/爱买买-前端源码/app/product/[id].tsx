import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { ProductRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { Tag } from '../../src/components/ui/Tag';
import { Price } from '../../src/components/ui/Price';
import { useTheme } from '../../src/theme';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) => state.items.reduce((sum, item) => sum + item.quantity, 0));
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: () => ProductRepo.getById(String(id)),
    enabled: Boolean(id),
  });
  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="商品详情" />
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <Skeleton height={240} radius={radius.lg} />
          <Skeleton height={24} radius={radius.md} style={{ marginTop: spacing.lg }} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.sm }} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.sm }} />
        </ScrollView>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="商品详情" />
        <ErrorState
          title="商品加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const product = data.data;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="商品详情"
        rightSlot={
          <Pressable onPress={() => router.push('/cart')} hitSlop={10} style={{ padding: 8 }}>
            <View>
              <MaterialCommunityIcons name="cart-outline" size={22} color={colors.text.primary} />
              {cartCount > 0 ? (
                <View style={[styles.headerBadge, { backgroundColor: colors.accent.blue }]}>
                  <Text style={[typography.caption, { color: colors.text.inverse }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Image source={{ uri: product.image }} style={{ height: 280, borderRadius: radius.lg }} />
        <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.lg }]}>
          {product.title}
        </Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
          {product.origin}
        </Text>

        <View style={{ marginTop: spacing.md }}>
          <Price value={product.price} unit={product.unit} strikeValue={product.strikePrice} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md }}>
          <Tag label="AI推荐" tone="accent" style={{ marginRight: spacing.xs, marginBottom: spacing.xs }} />
          {product.tags.map((tag, index) => (
            <Tag
              key={`${tag}-${index}`}
              label={tag}
              style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}
            />
          ))}
        </View>

        <View
          style={[
            styles.aiCard,
            shadow.sm,
            { backgroundColor: colors.accent.blueSoft, borderRadius: radius.lg, marginTop: spacing.lg },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.accent.blue }]}>AI 推荐理由</Text>
          <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
            这款商品来自可信产地，检测报告齐全，适合追求高品质与低碳饮食的家庭。
          </Text>
        </View>

        <Pressable
          onPress={() => show({ message: 'AI 溯源图谱即将上线', type: 'info' })}
          style={[
            styles.traceCard,
            shadow.sm,
            { borderRadius: radius.lg, borderColor: colors.border, marginTop: spacing.lg },
          ]}
        >
          <View>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>AI 溯源图谱</Text>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
              育种 - 种养 - 流通全链路可视化
            </Text>
          </View>
          <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>查看</Text>
        </Pressable>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>图文详情</Text>
          <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm }]}>
            这里展示商品产地、检测报告与图文详情内容（占位）。
          </Text>
        </View>
      </ScrollView>

      <View
        style={[
          styles.ctaBar,
          {
            paddingBottom: insets.bottom + spacing.md,
            paddingTop: spacing.sm,
            paddingHorizontal: spacing.xl,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            addItem(product);
            show({ message: '已加入购物车', type: 'success' });
          }}
          style={[styles.ctaButton, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>加入购物车</Text>
        </Pressable>
        <Pressable
          onPress={() => show({ message: '购买功能即将上线', type: 'info' })}
          style={[
            styles.ctaButton,
            { backgroundColor: colors.brand.primary, borderRadius: radius.md, marginLeft: spacing.md },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>立即购买</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  aiCard: {
    padding: 16,
  },
  traceCard: {
    padding: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  ctaButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
