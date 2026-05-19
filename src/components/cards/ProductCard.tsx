import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Product } from '../../types';
import { useTheme } from '../../theme';
import { Price } from '../ui/Price';
import { Tag } from '../ui/Tag';
import { AiBadge } from '../ui/AiBadge';
import { useAppConfig } from '../../hooks/useAppConfig';
import { getStockStatus } from '../../utils/stockDisplay';

type ProductCardProps = {
  product: Product;
  width?: number;
  imageHeight?: number;
  onPress?: (product: Product) => void;
  onAdd?: (product: Product) => void;
  /** 显示 AI 推荐标签 */
  aiRecommend?: boolean;
  /** AI 推荐理由文案 */
  aiReason?: string;
  /** 月销量 */
  monthlySales?: number;
};

// 商品卡片：用于双列商品流展示
export const ProductCard = React.memo(({
  product,
  width,
  imageHeight,
  onPress,
  onAdd,
  aiRecommend,
  aiReason,
  monthlySales,
}: ProductCardProps) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const router = useRouter();
  const scale = useRef(new Animated.Value(1)).current;
  const coverHeight = imageHeight ?? width ?? 150;
  const { lowStockDisplayThreshold } = useAppConfig();

  // 库存状态：NORMAL / LOW_STOCK / OUT_OF_STOCK；product.stock 未返回时降级为 NORMAL（不展示提示）
  const stockStatus = getStockStatus(product.stock, lowStockDisplayThreshold);
  const isOutOfStock = stockStatus === 'OUT_OF_STOCK';
  const isLowStock = stockStatus === 'LOW_STOCK';
  const showLimit = product.maxPerOrder != null && product.maxPerOrder > 0;
  const showSales = monthlySales != null && monthlySales > 0;

  const handleAdd = () => {
    if (isOutOfStock) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    onAdd?.(product);
  };

  return (
    <Pressable
      onPress={() => onPress?.(product)}
      accessibilityLabel={`${product.title}，${product.origin}，价格${product.price}元`}
      accessibilityRole="button"
      style={[styles.card, shadow.sm, { width: width || '100%', borderRadius: radius.lg, backgroundColor: colors.surface }]}
    >
      <View style={{ position: 'relative' }}>
        <Image
          source={{ uri: product.image || undefined }}
          style={{ height: coverHeight, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
          transition={200}
          accessibilityLabel={`${product.title}商品图片`}
        />
        {/* 库存徽章：低库存红色「仅剩 x 件」/ 售罄黑灰「已售罄」 */}
        {isLowStock && (
          <View style={[styles.stockBadge, { backgroundColor: colors.danger }]}>
            <Text style={styles.stockBadgeText}>仅剩 {product.stock} 件</Text>
          </View>
        )}
        {isOutOfStock && (
          <View style={[styles.stockBadge, styles.stockBadgeSoldOut]}>
            <Text style={styles.stockBadgeText}>已售罄</Text>
          </View>
        )}
      </View>
      <View style={{ padding: spacing.md }}>
        {/* AI 推荐标签 */}
        {aiRecommend && (
          <AiBadge variant="recommend" style={{ marginBottom: spacing.xs }} />
        )}

        <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
          {product.title}
        </Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
          {product.origin}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, minHeight: 28 }}>
          {(product.tags ?? [])
            .filter((tag): tag is string => typeof tag === 'string')
            .slice(0, 2)
            .map((tag, index) => (
            <Tag
              key={`${tag}-${index}`}
              label={tag}
              style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}
            />
          ))}
        </View>

        {/* AI 推荐理由 */}
        {aiReason ? (
          <Text
            style={[
              typography.captionSm,
              { color: colors.ai.start, marginTop: spacing.xs },
            ]}
            numberOfLines={2}
          >
            {aiReason}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Price value={product.price} unit={product.unit} strikeValue={product.strikePrice} />
          <Animated.View style={{ transform: [{ scale }] }}>
            <Pressable
              onPress={handleAdd}
              disabled={isOutOfStock}
              accessibilityLabel={isOutOfStock ? '已售罄，无法加入购物车' : '加入购物车'}
              accessibilityRole="button"
              accessibilityState={{ disabled: isOutOfStock }}
              style={{
                backgroundColor: isOutOfStock ? colors.muted : colors.brand.primary,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
                opacity: isOutOfStock ? 0.6 : 1,
              }}
            >
              <MaterialCommunityIcons name="cart" size={18} color={colors.text.inverse} />
            </Pressable>
          </Animated.View>
        </View>

        {/* 月销量 · 限购：任一存在即渲染整行 */}
        {(showSales || showLimit) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
            {showSales && (
              <Text style={[typography.caption, { color: colors.muted }]}>
                月销 {monthlySales}
              </Text>
            )}
            {showSales && showLimit && (
              <Text style={[typography.caption, { color: colors.border, marginHorizontal: 4 }]}>·</Text>
            )}
            {showLimit && (
              <Text style={[typography.caption, { color: colors.info }]}>
                限购 {product.maxPerOrder} 件
              </Text>
            )}
          </View>
        )}

        {/* 商家来源标签 */}
        {product.companyName && (
          <Pressable
            onPress={() => {
              if (product.companyId) {
                router.push({ pathname: '/company/[id]', params: { id: product.companyId } });
              }
            }}
            style={{
              marginTop: spacing.xs,
              paddingTop: spacing.xs,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <Text style={[typography.captionSm, { color: colors.brand.primary }]}>
              {product.companyName}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={12} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  footer: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  stockBadgeSoldOut: {
    backgroundColor: 'rgba(33, 33, 33, 0.85)',
  },
  stockBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
