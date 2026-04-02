import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Product } from '../../types';
import { useTheme } from '../../theme';
import { Price } from '../ui/Price';
import { Tag } from '../ui/Tag';

type ProductCardProps = {
  product: Product;
  width: number;
  imageHeight?: number;
  onPress?: (product: Product) => void;
  onAdd?: (product: Product) => void;
};

// 商品卡片：用于双列商品流展示
export const ProductCard = ({ product, width, imageHeight, onPress, onAdd }: ProductCardProps) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();
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
      style={[styles.card, shadow.sm, { width, borderRadius: radius.lg, backgroundColor: colors.surface }]}
    >
      <Image
        source={{ uri: product.image }}
        style={{ height: coverHeight, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
        contentFit="cover"
      />
      <View style={{ padding: spacing.md }}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={2}>
          {product.title}
        </Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
          {product.origin}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
          {product.tags.slice(0, 2).map((tag, index) => (
            <Tag
              key={`${tag}-${index}`}
              label={tag}
              style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}
            />
          ))}
        </View>
        <View style={styles.footer}>
          <Price value={product.price} unit={product.unit} strikeValue={product.strikePrice} />
          <Animated.View style={{ transform: [{ scale }] }}>
            <Pressable
              onPress={handleAdd}
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
      </View>
    </Pressable>
  );
};

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
