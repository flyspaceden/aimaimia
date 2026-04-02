import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../src/components/layout';
import { EmptyState, ErrorState, Skeleton } from '../src/components/feedback';
import { SearchInput } from '../src/components/inputs';
import { Tag } from '../src/components/ui';
import { CompanyRepo, ProductRepo } from '../src/repos';
import { useTheme } from '../src/theme';
import { AppError, Company, Product } from '../src/types';

export default function SearchScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const { data: productResult, isLoading: productsLoading, isFetching: productsFetching, refetch: refetchProducts } =
    useQuery({
      queryKey: ['search-products'],
      queryFn: () => ProductRepo.list({ page: 1, pageSize: 32 }),
    });
  const {
    data: companyResult,
    isLoading: companiesLoading,
    isFetching: companiesFetching,
    refetch: refetchCompanies,
  } = useQuery({
    queryKey: ['search-companies'],
    queryFn: () => CompanyRepo.list(),
  });

  const products = productResult?.ok ? productResult.data.items : [];
  const companies = companyResult?.ok ? companyResult.data : [];
  const productError = productResult && !productResult.ok ? productResult.error : null;
  const companyError = companyResult && !companyResult.ok ? companyResult.error : null;
  const hasQuery = query.trim().length > 0;
  const isLoading = productsLoading || companiesLoading;
  const refreshing = productsFetching || companiesFetching;

  const filteredProducts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return products;
    }

    const tokens = keyword
      .split(/[\s,，、/]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    return products.filter((product) => {
      const haystack = [product.title, product.origin, product.tags.join(' ')].join(' ').toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [products, query]);

  // 搜索企业：支持关键词与“附近/距离/认证”混合匹配（复杂逻辑需中文注释）
  const filteredCompanies = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return companies;
    }

    const distanceMatch = keyword.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const distanceLimit = distanceMatch ? Number(distanceMatch[1]) : keyword.includes('附近') ? 20 : null;
    const tokens = keyword
      .split(/[\s,，、/]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && !item.includes('km') && !item.includes('公里') && item !== '附近');

    const badgeKeywordMap: Record<string, string> = {
      有机: '品质认证',
      绿色: '品质认证',
      gap: '品质认证',
      认证: '品质认证',
      证书: '品质认证',
      直供: '产地直供',
      产地: '产地直供',
      低碳: '低碳种植',
      基地: '优选基地',
    };
    const badgeHints = new Set<string>();
    tokens.forEach((token) => {
      Object.keys(badgeKeywordMap).forEach((key) => {
        if (token.includes(key)) {
          badgeHints.add(badgeKeywordMap[key]);
        }
      });
    });

    const scored = companies
      .map((company) => {
        if (distanceLimit !== null && company.distanceKm > distanceLimit) {
          return null;
        }

        const fields = [company.name, company.mainBusiness, company.location, company.badges.join(' ')].map((item) =>
          item.toLowerCase()
        );
        let score = 0;

        tokens.forEach((token) => {
          if (fields[0].includes(token)) {
            score += 5;
            return;
          }
          if (fields[1].includes(token)) {
            score += 3;
            return;
          }
          if (fields[2].includes(token)) {
            score += 3;
            return;
          }
          if (fields[3].includes(token)) {
            score += 4;
            return;
          }
        });

        badgeHints.forEach((badge) => {
          if (company.badges.includes(badge)) {
            score += 4;
          }
        });

        if (distanceLimit !== null) {
          score += Math.max(0, (distanceLimit - company.distanceKm) / Math.max(distanceLimit, 1));
        }

        if (tokens.length === 0 && badgeHints.size === 0) {
          score = 1;
        }

        return score > 0 ? { company, score } : null;
      })
      .filter((item): item is { company: Company; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.company);

    return scored;
  }, [companies, query]);

  const shownProducts = hasQuery ? filteredProducts : products.slice(0, 6);
  const shownCompanies = hasQuery ? filteredCompanies : companies.slice(0, 4);
  const hasResults = shownProducts.length > 0 || shownCompanies.length > 0;

  const handleRefresh = async () => {
    await Promise.all([refetchProducts(), refetchCompanies()]);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="搜索" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <SearchInput value={query} onChangeText={setQuery} />
        {isLoading ? (
          <View style={{ marginTop: spacing.lg }}>
            <View style={styles.sectionHeader}>
              <Skeleton height={18} radius={radius.sm} style={{ width: 120 }} />
            </View>
            <Skeleton height={88} radius={radius.lg} style={{ marginBottom: spacing.md }} />
            <Skeleton height={88} radius={radius.lg} style={{ marginBottom: spacing.md }} />
            <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
              <Skeleton height={18} radius={radius.sm} style={{ width: 120 }} />
            </View>
            <Skeleton height={140} radius={radius.lg} style={{ marginBottom: spacing.md }} />
          </View>
        ) : productError && companyError ? (
          <View style={{ marginTop: spacing.lg }}>
            <ErrorState
              title="搜索加载失败"
              description={(productError as AppError)?.displayMessage ?? '请稍后重试'}
              onAction={handleRefresh}
            />
          </View>
        ) : !hasResults ? (
          <View style={{ marginTop: spacing.lg }}>
            <EmptyState
              title={hasQuery ? '未找到匹配结果' : '输入关键词开始搜索'}
              description={hasQuery ? '换个关键词试试' : '支持商品/企业/城市/认证等关键词'}
            />
          </View>
        ) : (
          <View style={{ marginTop: spacing.lg }}>
            {hasQuery ? (
              <View style={styles.summaryRow}>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  商品 {shownProducts.length} · 企业 {shownCompanies.length}
                </Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  关键词：{query.trim()}
                </Text>
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>
                {hasQuery ? '商品结果' : '热门商品'}
              </Text>
            </View>
            {productError ? (
              <ErrorState
                title="商品加载失败"
                description={productError.displayMessage ?? '请稍后重试'}
                onAction={handleRefresh}
              />
            ) : shownProducts.length === 0 ? (
              <EmptyState title="暂无商品" description="换个关键词试试" />
            ) : (
              shownProducts.map((product) => (
                <Pressable
                  key={product.id}
                  onPress={() => router.push(`/product/${product.id}`)}
                  style={[
                    styles.productRow,
                    shadow.sm,
                    { backgroundColor: colors.surface, borderRadius: radius.lg },
                  ]}
                >
                  <Image
                    source={{ uri: product.image }}
                    style={{ width: 72, height: 72, borderRadius: radius.md }}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {product.title}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      {product.origin}
                    </Text>
                    <View style={styles.tagRow}>
                      {product.tags.slice(0, 2).map((tag) => (
                        <Tag key={`${product.id}-${tag}`} label={tag} tone="accent" style={{ marginRight: 6 }} />
                      ))}
                    </View>
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>
                    ￥{product.price}
                  </Text>
                </Pressable>
              ))
            )}

            <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>
                {hasQuery ? '企业结果' : '热门企业'}
              </Text>
            </View>
            {companyError ? (
              <ErrorState
                title="企业加载失败"
                description={companyError.displayMessage ?? '请稍后重试'}
                onAction={handleRefresh}
              />
            ) : shownCompanies.length === 0 ? (
              <EmptyState title="暂无企业" description="换个关键词试试" />
            ) : (
              shownCompanies.map((company) => (
                <Pressable
                  key={company.id}
                  onPress={() => router.push(`/company/${company.id}`)}
                  style={[
                    styles.companyRow,
                    shadow.sm,
                    { backgroundColor: colors.surface, borderRadius: radius.lg },
                  ]}
                >
                  <Image
                    source={{ uri: company.cover }}
                    style={{ width: 86, height: 86, borderRadius: radius.md }}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                      {company.name}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                      {company.mainBusiness}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>
                        {company.location}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>
                        {company.distanceKm.toFixed(1)} km
                      </Text>
                    </View>
                    <View style={styles.tagRow}>
                      {company.badges.slice(0, 3).map((badge) => (
                        <Tag key={`${company.id}-${badge}`} label={badge} tone="brand" style={{ marginRight: 6 }} />
                      ))}
                    </View>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 12,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 12,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
});
