import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Company } from '../../types';
import { useTheme } from '../../theme';
import { Tag } from '../ui/Tag';
import { formatPrice } from '../../utils/formatPrice';

type CompanyCardProps = {
  company: Company;
  onPress?: (company: Company) => void;
  onProductPress?: (productId: string) => void;
  onAddToCart?: (product: { id: string; title: string; price: number; image: string; defaultSkuId?: string }) => void;
};

// 企业卡片：全宽布局，含横滑商品缩略图行
export const CompanyCard = React.memo(({ company, onPress, onProductPress, onAddToCart }: CompanyCardProps) => {
  const { colors, radius, spacing, typography } = useTheme();

  // 认证标签：优先使用 certifications，回退到 badges
  const badges = company.certifications && company.certifications.length > 0
    ? company.certifications
    : company.badges;

  const topProducts = company.topProducts ?? [];
  const hasProducts = topProducts.length > 0;

  return (
    <Pressable
      onPress={() => onPress?.(company)}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.md,
          marginBottom: spacing.sm,
        },
      ]}
    >
      {/* 顶部：Logo + 企业名 + 认证标签 */}
      <View style={styles.headerRow}>
        {company.cover ? (
          <Image
            source={{ uri: company.cover }}
            style={[styles.logo, { borderRadius: radius.sm }]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.logo,
              styles.logoFallback,
              { borderRadius: radius.sm, backgroundColor: colors.brand.primarySoft },
            ]}
          >
            <Text style={[typography.title3, { color: colors.brand.primary }]}>
              {company.name.charAt(0)}
            </Text>
          </View>
        )}

        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            <Text
              style={[typography.title3, { color: colors.text.primary, flexShrink: 1 }]}
              numberOfLines={1}
            >
              {company.name}
            </Text>
            {badges.slice(0, 2).map((badge, index) => (
              <Tag
                key={`${company.id}-badge-${index}`}
                label={badge}
                tone="accent"
                style={{ marginLeft: spacing.xs }}
              />
            ))}
          </View>

          <Text
            style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}
            numberOfLines={1}
          >
            {company.location}
            {company.distanceKm != null && company.distanceKm > 0 ? ` · ${company.distanceKm.toFixed(1)} km` : ''}
            {company.mainBusiness ? ` · ${company.mainBusiness}` : ''}
          </Text>
        </View>
      </View>

      {/* 商品区：≤3 个等分排列，>3 个横向滑动 */}
      {hasProducts && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border, marginVertical: spacing.sm }]} />
          {topProducts.length <= 3 ? (
            // 等分布局：每个商品 flex:1
            <View style={styles.productsFlexRow}>
              {topProducts.map((product, index) => (
                <Pressable
                  key={product.id}
                  onPress={() => onProductPress?.(product.id)}
                  style={[
                    styles.productFlexItem,
                    {
                      marginRight: index < topProducts.length - 1 ? spacing.sm : 0,
                      borderRadius: radius.md,
                      backgroundColor: colors.bgSecondary,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: product.image || undefined }}
                    style={[styles.productFlexImage, { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md }]}
                    contentFit="cover"
                    placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                  />
                  <View style={{ padding: spacing.xs }}>
                    <Text style={[typography.captionSm, { color: colors.text.primary }]} numberOfLines={1}>
                      {product.title}
                    </Text>
                    <View style={styles.priceRow}>
                      <Text style={[typography.captionSm, { color: colors.brand.primary, fontWeight: '700' }]}>
                        ¥{formatPrice(product.price)}
                      </Text>
                      {onAddToCart && (
                        <Pressable
                          onPress={() => onAddToCart(product)}
                          hitSlop={6}
                          style={[styles.addBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.sm }]}
                        >
                          <MaterialCommunityIcons name="cart-plus" size={14} color="#FFFFFF" />
                        </Pressable>
                      )}
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            // 横滑布局：固定宽度，可左右滑动
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -spacing.md }}
              contentContainerStyle={{ paddingHorizontal: spacing.md }}
            >
              {topProducts.map((product, index) => (
                <Pressable
                  key={product.id}
                  onPress={() => onProductPress?.(product.id)}
                  style={[
                    styles.productScrollItem,
                    {
                      marginRight: index < topProducts.length - 1 ? spacing.sm : 0,
                      borderRadius: radius.md,
                      backgroundColor: colors.bgSecondary,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: product.image || undefined }}
                    style={[styles.productScrollImage, { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md }]}
                    contentFit="cover"
                    placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                  />
                  <View style={{ padding: spacing.xs }}>
                    <Text style={[typography.captionSm, { color: colors.text.primary }]} numberOfLines={1}>
                      {product.title}
                    </Text>
                    <View style={styles.priceRow}>
                      <Text style={[typography.captionSm, { color: colors.brand.primary, fontWeight: '700' }]}>
                        ¥{formatPrice(product.price)}
                      </Text>
                      {onAddToCart && (
                        <Pressable
                          onPress={() => onAddToCart(product)}
                          hitSlop={6}
                          style={[styles.addBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.sm }]}
                        >
                          <MaterialCommunityIcons name="cart-plus" size={14} color="#FFFFFF" />
                        </Pressable>
                      )}
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </Pressable>
  );
});

CompanyCard.displayName = 'CompanyCard';

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  logo: {
    width: 48,
    height: 48,
    marginRight: 10,
    flexShrink: 0,
  },
  logoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  divider: {
    height: 1,
  },
  productsFlexRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  productFlexItem: {
    flex: 1,
    overflow: 'hidden',
  },
  productFlexImage: {
    width: '100%',
    height: 64,
  },
  productScrollItem: {
    width: 100,
    overflow: 'hidden',
  },
  productScrollImage: {
    width: 100,
    height: 72,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  addBtn: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
