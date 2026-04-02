import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CompanyCard } from '../../src/components/cards';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { SearchInput } from '../../src/components/inputs';
import { Screen } from '../../src/components/layout';
import { MapView } from '../../src/components/overlay/MapView';
import { mapProviders, MapProvider } from '../../src/constants';
import { CompanyRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AppError } from '../../src/types';

export default function MuseumScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [mapProvider, setMapProvider] = useState<MapProvider>('amap');
  const [searchQuery, setSearchQuery] = useState('');
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['companies'],
    queryFn: () => CompanyRepo.list(),
  });

  const listError = data && !data.ok ? data.error : null;
  const companies = data?.ok ? data.data : [];
  const filters = [
    { id: 'all', label: '全部' },
    { id: 'nearby', label: '附近 20km' },
    { id: 'certified', label: '品质认证' },
    { id: 'direct', label: '产地直供' },
    { id: 'lowcarbon', label: '低碳种植' },
  ];
  const viewModes = [
    { id: 'list', label: '列表', icon: 'format-list-bulleted' },
    { id: 'map', label: '地图', icon: 'map' },
  ];

  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'nearby':
        return companies.filter((item) => item.distanceKm <= 20);
      case 'certified':
        return companies.filter((item) => item.badges.includes('品质认证'));
      case 'direct':
        return companies.filter((item) => item.badges.includes('产地直供'));
      case 'lowcarbon':
        return companies.filter((item) => item.badges.includes('低碳种植'));
      default:
        return companies;
    }
  }, [activeFilter, companies]);

  // 语义搜索：支持距离/认证/关键词综合匹配（复杂逻辑需中文注释）
  const searchedCompanies = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) {
      return filtered;
    }

    const normalized = query.toLowerCase();
    const distanceMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
    const distanceLimit = distanceMatch ? Number(distanceMatch[1]) : normalized.includes('附近') ? 20 : null;

    const keywords = normalized
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
    keywords.forEach((keyword) => {
      Object.keys(badgeKeywordMap).forEach((key) => {
        if (keyword.includes(key)) {
          badgeHints.add(badgeKeywordMap[key]);
        }
      });
    });

    const scored = filtered
      .map((company) => {
        if (distanceLimit !== null && company.distanceKm > distanceLimit) {
          return null;
        }

        const name = company.name.toLowerCase();
        const business = company.mainBusiness.toLowerCase();
        const location = company.location.toLowerCase();
        const badges = company.badges.join(' ').toLowerCase();

        let score = 0;

        keywords.forEach((keyword) => {
          if (name.includes(keyword)) {
            score += 5;
            return;
          }
          if (business.includes(keyword)) {
            score += 3;
            return;
          }
          if (location.includes(keyword)) {
            score += 3;
            return;
          }
          if (badges.includes(keyword)) {
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

        if (keywords.length === 0 && badgeHints.size === 0) {
          score = 1;
        }

        return score > 0 ? { company, score } : null;
      })
      .filter((item): item is { company: typeof filtered[number]; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.company);

    return scored;
  }, [filtered, searchQuery]);

  const stats = useMemo(() => {
    const nearby = companies.filter((item) => item.distanceKm <= 20).length;
    const certified = companies.filter((item) => item.badges.includes('品质认证')).length;
    return [
      { label: '合作企业', value: companies.length },
      { label: '附近 20km', value: nearby },
      { label: '品质认证', value: certified },
    ];
  }, [companies]);
  const refreshing = isFetching;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <FlatList
        data={searchedCompanies}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.lg }}>
            <View style={[styles.hero, { backgroundColor: colors.brand.primary }]}>
              <View style={styles.heroRow}>
                <View>
                  <Text style={[typography.title2, { color: colors.text.inverse }]}>企业展览馆</Text>
                  <Text style={[typography.caption, { color: colors.text.inverse, marginTop: 6 }]}>
                    AI驱动的产地信任与合作入口
                  </Text>
                </View>
                <View style={[styles.heroBadge, { backgroundColor: colors.accent.blueSoft }]}>
                  <Text style={[typography.caption, { color: colors.accent.blue }]}>AI</Text>
                </View>
              </View>
              <View style={styles.heroStats}>
                {stats.map((item, index) => (
                  <View
                    key={item.label}
                    style={[
                      styles.statCard,
                      {
                        backgroundColor: colors.brand.primaryDark,
                        marginRight: index === stats.length - 1 ? 0 : 10,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: colors.text.inverse }]}>{item.label}</Text>
                    <Text style={[typography.title3, { color: colors.text.inverse, marginTop: 4 }]}>
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.switchRow}>
              {viewModes.map((mode) => {
                const active = viewMode === mode.id;
                return (
                  <Pressable
                    key={mode.id}
                    onPress={() => setViewMode(mode.id as 'list' | 'map')}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? colors.brand.primary : colors.surface,
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                        marginRight: spacing.sm,
                      },
                    ]}
                  >
                    <View style={styles.toggleContent}>
                      <MaterialCommunityIcons
                        name={mode.icon as any}
                        size={14}
                        color={active ? colors.text.inverse : colors.text.secondary}
                      />
                      <Text
                        style={[
                          typography.caption,
                          { color: active ? colors.text.inverse : colors.text.secondary, marginLeft: 4 },
                        ]}
                      >
                        {mode.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {viewMode === 'map' ? (
              <View style={styles.switchRow}>
                {mapProviders.map((provider) => {
                  const active = mapProvider === provider.value;
                  return (
                    <Pressable
                      key={provider.value}
                      onPress={() => setMapProvider(provider.value)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: active ? colors.brand.primary : colors.surface,
                          borderColor: active ? colors.brand.primary : colors.border,
                          borderRadius: radius.pill,
                          marginRight: spacing.sm,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.caption,
                          { color: active ? colors.text.inverse : colors.text.secondary },
                        ]}
                      >
                        {provider.label} · {provider.note}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: spacing.md }}
            >
              {filters.map((filter) => {
                const isActive = filter.id === activeFilter;
                return (
                  <Pressable
                    key={filter.id}
                    onPress={() => setActiveFilter(filter.id)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: isActive ? colors.brand.primary : colors.surface,
                        borderColor: isActive ? colors.brand.primary : colors.border,
                        borderRadius: radius.pill,
                        marginRight: spacing.sm,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        { color: isActive ? colors.text.inverse : colors.text.secondary },
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {viewMode === 'map' ? (
            <MapView
              provider={mapProvider}
              markers={searchedCompanies}
              onSelect={(company) => router.push({ pathname: '/company/[id]', params: { id: company.id } })}
            />
            ) : null}
            <View style={{ marginTop: spacing.md }}>
              <SearchInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜索企业/城市/距离/认证（如：苏州 GAP 20km）"
              />
              {searchQuery ? (
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
                  搜索到 {searchedCompanies.length} 家企业
                </Text>
              ) : null}
            </View>
            <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.lg }]}>
              企业列表
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: spacing.lg }}>
            <CompanyCard
              company={item}
              onPress={(company) => router.push({ pathname: '/company/[id]', params: { id: company.id } })}
            />
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>
              <Skeleton height={220} radius={radius.lg} />
              <View style={{ height: spacing.md }} />
              <Skeleton height={220} radius={radius.lg} />
            </View>
          ) : (listError as AppError | null) ? (
            <ErrorState
              title="加载失败"
              description={listError?.displayMessage ?? '请稍后再试'}
              onAction={refetch}
            />
          ) : (
            <EmptyState
              title={searchQuery ? '未找到匹配企业' : '暂无企业'}
              description={searchQuery ? '请尝试更换关键词或缩小条件' : '稍后再来看看'}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    marginRight: 10,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  switchRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  toggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
