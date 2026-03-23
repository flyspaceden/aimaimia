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

type ProductCardProps = {
  product: Product;
  width: number;
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
  const coverHeight = imageHeight ?? width;

  const handleAdd = () => {
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
      style={[styles.card, shadow.sm, { width, borderRadius: radius.lg, backgroundColor: colors.surface }]}
    >
      <Image
        source={{ uri: product.image }}
        style={{ height: coverHeight, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
        contentFit="cover"
        cachePolicy="memory-disk"
        placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
        transition={200}
        accessibilityLabel={`${product.title}商品图片`}
      />
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
          {product.tags.slice(0, 2).map((tag, index) => (
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
              accessibilityLabel="加入购物车"
              accessibilityRole="button"
              style={{
                backgroundColor: colors.brand.primary,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
              }}
            >
              <MaterialCommunityIcons name="cart" size={18} color={colors.text.inverse} />
            </Pressable>
          </Animated.View>
        </View>

        {/* 月销量 */}
        {monthlySales != null && monthlySales > 0 && (
          <Text
            style={[
              typography.caption,
              { color: colors.muted, marginTop: spacing.xs },
            ]}
          >
            月销 {monthlySales}
          </Text>
        )}

        {/* 商家来源标签 */}
        {product.companyName && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
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
});
