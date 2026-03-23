import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Company } from '../../types';
import { useTheme } from '../../theme';
import { Tag } from '../ui/Tag';

type CompanyCardProps = {
  company: Company;
  onPress?: (company: Company) => void;
  onProductPress?: (productId: string) => void;
};

// 企业卡片：全宽布局，含顶部商品缩略图行
export const CompanyCard = React.memo(({ company, onPress, onProductPress }: CompanyCardProps) => {
  const { colors, radius, spacing, typography } = useTheme();

  // 认证标签：优先使用 certifications，回退到 badges
  const badges = company.certifications && company.certifications.length > 0
    ? company.certifications
    : company.badges;

  // 前 3 个商品缩略图
  const topProducts = company.topProducts ?? [];
  const visibleProducts = topProducts.slice(0, 3);
  const extraCount = topProducts.length > 3 ? topProducts.length - 3 : 0;
  const hasProducts = visibleProducts.length > 0;

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
        {/* 企业 Logo */}
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

        {/* 企业信息 */}
        <View style={styles.headerInfo}>
          {/* 第一行：企业名 + 认证标签 */}
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

          {/* 第二行：地区 · 距离 · 好评率 */}
          <Text
            style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}
            numberOfLines={1}
          >
            {company.location}
            {company.distanceKm != null ? ` · ${company.distanceKm.toFixed(1)} km` : ''}
            {company.mainBusiness ? ` · ${company.mainBusiness}` : ''}
          </Text>
        </View>
      </View>

      {/* 分隔线 */}
      {hasProducts && (
        <View style={[styles.divider, { backgroundColor: colors.border, marginVertical: spacing.sm }]} />
      )}

      {/* 底部：商品缩略图行 */}
      {hasProducts && (
        <View style={styles.productsRow}>
          {visibleProducts.map((product, index) => {
            const isLast = index === visibleProducts.length - 1;
            return (
              <Pressable
                key={product.id}
                onPress={() => onProductPress?.(product.id)}
                style={[
                  styles.productItem,
                  { marginRight: isLast ? 0 : spacing.sm },
                ]}
              >
                {/* 商品图片 */}
                <View style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: product.image }}
                    style={[styles.productImage, { borderRadius: radius.sm }]}
                    contentFit="cover"
                  />
                  {/* +N 覆盖层：仅显示在第 3 张图上 */}
                  {isLast && extraCount > 0 && (
                    <View
                      style={[
                        styles.extraOverlay,
                        { borderRadius: radius.sm, backgroundColor: colors.overlay },
                      ]}
                    >
                      <Text style={[typography.caption, { color: colors.text.inverse }]}>
                        +{extraCount}
                      </Text>
                    </View>
                  )}
                </View>
                {/* 商品名称 */}
                <Text
                  style={[
                    typography.caption,
                    { color: colors.text.secondary, marginTop: spacing.xs },
                  ]}
                  numberOfLines={1}
                >
                  {product.title}
                </Text>
                {/* 商品价格 */}
                <Text
                  style={[typography.caption, { color: colors.brand.primary }]}
                  numberOfLines={1}
                >
                  ¥{product.price.toFixed(2)}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
  productsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  productItem: {
    flex: 1,
  },
  productImage: {
    width: '100%',
    height: 52,
  },
  extraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
