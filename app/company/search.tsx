import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../src/components/layout';
import { CompanyCard } from '../../src/components/cards';
import { EmptyState, ErrorState, Skeleton } from '../../src/components/feedback';
import { AiCardGlow } from '../../src/components/ui/AiCardGlow';
import { CompanyRepo } from '../../src/repos';
import { useRecentSearches } from '../../src/hooks/useRecentSearches';
import { AppError } from '../../src/types';
import { useTheme } from '../../src/theme';

const normalizeCompanySearchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cleanupCompanyVoiceQuery = (value: string): string => {
  const compact = normalizeCompanySearchText(value).replace(/\s+/g, '');
  if (!compact) return '';

  return compact
    .replace(/^(?:请|麻烦你)?(?:帮我|给我|替我)?(?:打开|进入|去|逛逛|查看|看看|查(?:一下)?|搜(?:索)?|找)+/u, '')
    .replace(/^(?:现在|目前|最近|这边|这里|附近)?(?:都)?(?:有哪(?:些|家)|有什?么|哪些|什么)/u, '')
    .replace(/(?:的)?(?:店铺|农场|商家|公司|企业|旗舰店)/gu, '')
    .replace(/(?:相关|列表|推荐)+$/u, '')
    .replace(/(?:吗|呢|啊|呀|吧|嘛|哦)+$/u, '')
    .trim();
};

const buildCompanyTokens = (value: string, fromVoice: boolean): string[] => {
  const normalized = normalizeCompanySearchText(value);
  if (!normalized) return [];

  const tokenSet = new Set<string>();
  const rawTokens = normalized.split(/[\s,，、/]+/).map((token) => token.trim()).filter(Boolean);
  rawTokens.forEach((token) => tokenSet.add(token));

  if (fromVoice) {
    const cleaned = cleanupCompanyVoiceQuery(value);
    if (cleaned) tokenSet.add(cleaned);
  }

  return Array.from(tokenSet).filter(Boolean);
};

const buildCompanySearchIndex = (company: any) => {
  const name = normalizeCompanySearchText(company.name || '');
  const shortName = normalizeCompanySearchText(company.shortName || '');
  const mainBusiness = normalizeCompanySearchText(company.mainBusiness || '');
  const location = normalizeCompanySearchText(company.location || '');
  const structuredLocation = normalizeCompanySearchText(
    [
      company.address?.province,
      company.address?.city,
      company.address?.district,
      company.address?.postalCode,
      company.address?.detail,
      company.address?.text,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const description = normalizeCompanySearchText(company.description || '');
  const badges = normalizeCompanySearchText((company.badges || []).join(' '));
  const industryTags = (company.industryTags || []).map(normalizeCompanySearchText).join(' ');
  const productFeatures = (company.productFeatures || []).map(normalizeCompanySearchText).join(' ');
  const certifications = (company.certifications || []).map(normalizeCompanySearchText).join(' ');
  const companyType = normalizeCompanySearchText(company.companyType || '');
  const productKeywords = (company.productKeywords || []).map(normalizeCompanySearchText).join(' ');
  const combined = [name, shortName, mainBusiness, location, structuredLocation, description, badges, industryTags, productFeatures, certifications, companyType, productKeywords].filter(Boolean).join(' ');

  return {
    name,
    shortName,
    mainBusiness,
    location,
    structuredLocation,
    description,
    badges,
    industryTags,
    productFeatures,
    certifications,
    companyType,
    productKeywords,
    combined,
  };
};

const scoreCompanyMatch = (
  company: any,
  queryTokens: string[],
  filters: {
    submitted: boolean;
    industryHint?: string;
    location?: string;
    companyType?: string;
    featureTags: string[];
  },
) => {
  const index = buildCompanySearchIndex(company);
  let score = 0;

  if (filters.submitted && queryTokens.length > 0) {
    let queryMatched = false;
    for (const token of queryTokens) {
      const normalizedToken = normalizeCompanySearchText(token);
      if (!normalizedToken) continue;

      if (index.name === normalizedToken || index.shortName === normalizedToken) {
        score += 180;
        queryMatched = true;
        continue;
      }
      if (index.name.includes(normalizedToken) || index.shortName.includes(normalizedToken)) {
        score += 130;
        queryMatched = true;
        continue;
      }
      if (index.mainBusiness.includes(normalizedToken)) {
        score += 95;
        queryMatched = true;
        continue;
      }
      if (index.location.includes(normalizedToken)) {
        score += 80;
        queryMatched = true;
        continue;
      }
      if (index.structuredLocation.includes(normalizedToken)) {
        score += 90;
        queryMatched = true;
        continue;
      }
      if (index.combined.includes(normalizedToken)) {
        score += 55;
        queryMatched = true;
      }
    }

    if (!queryMatched) {
      return null;
    }
  }

  if (filters.industryHint) {
    const industryHint = normalizeCompanySearchText(filters.industryHint);
    // 结构化品类精确命中（优先级更高）
    const structuredIndustryMatch = (company.industryTags || []).some(
      (tag: string) => normalizeCompanySearchText(tag).includes(industryHint) || industryHint.includes(normalizeCompanySearchText(tag)),
    );
    if (structuredIndustryMatch) {
      score += 160; // Higher than mainBusiness text match (140)
    } else if (index.mainBusiness.includes(industryHint)) {
      score += 140;
    } else if (index.combined.includes(industryHint)) {
      score += 90;
    } else {
      return null;
    }
  }

  if (filters.location) {
    const locationFilter = normalizeCompanySearchText(filters.location);
    if (index.structuredLocation.includes(locationFilter)) {
      score += 140;
    } else if (index.location.includes(locationFilter)) {
      score += 120;
    } else if (index.combined.includes(locationFilter)) {
      score += 70;
    } else {
      return null;
    }
  }

  if (filters.companyType) {
    const companyType = filters.companyType;
    // 结构化企业类型精确命中
    if (company.companyType === companyType) {
      score += 100; // Higher than keyword match (85)
    } else {
      // Fallback to keyword matching in name/description
      const typeKeywords: Record<string, string[]> = {
        farm: ['农场'], company: ['公司', '企业', '商家'], cooperative: ['合作社'],
        base: ['基地'], factory: ['工厂', '加工厂'], store: ['店铺', '门店'],
      };
      const keywords = typeKeywords[companyType] || [];
      const matched = keywords.some((kw) => index.combined.includes(normalizeCompanySearchText(kw)));
      if (matched) {
        score += 85;
      } else {
        return null;
      }
    }
  }

  if (filters.featureTags.length > 0) {
    const structuredFeatures = [
      ...(company.productFeatures || []),
      ...(company.certifications || []),
    ].map(normalizeCompanySearchText);

    let allMatched = true;
    let structuredMatchCount = 0;
    for (const tag of filters.featureTags) {
      const normalizedTag = normalizeCompanySearchText(tag);
      const structuredHit = structuredFeatures.some(
        (f) => f.includes(normalizedTag) || normalizedTag.includes(f),
      );
      if (structuredHit) {
        structuredMatchCount++;
      } else {
        // Fallback to text search
        const textHit = index.badges.includes(normalizedTag) || index.mainBusiness.includes(normalizedTag) || index.description.includes(normalizedTag) || index.combined.includes(normalizedTag);
        if (!textHit) {
          allMatched = false;
          break;
        }
      }
    }
    if (!allMatched) return null;
    // Structured matches get higher score
    score += structuredMatchCount * 60 + (filters.featureTags.length - structuredMatchCount) * 50;
  }

  score += Math.max(0, 20 - Math.min(company.distanceKm || 0, 20));

  return score;
};

export default function CompanySearchScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { q, source, industryHint, location, companyType, featureTags } = useLocalSearchParams<{
    q?: string;
    source?: string;
    industryHint?: string;
    location?: string;
    companyType?: string;
    featureTags?: string;
  }>();
  const rawQuery = Array.isArray(q) ? q[0] : q;
  const isVoiceSource = (Array.isArray(source) ? source[0] : source) === 'voice';
  const resolvedIndustryHint = Array.isArray(industryHint) ? industryHint[0] : industryHint;
  const rawLocation = Array.isArray(location) ? location[0] : location;
  // "附近/周边/本地/这里/这边"是相对位置概念，非真实地名，不做 location 过滤（Phase D 接入定位后再支持）
  const resolvedLocation = rawLocation && /^(?:附近|周边|本地|这里|这边|身边)$/.test(rawLocation) ? undefined : rawLocation;
  const resolvedCompanyType = Array.isArray(companyType) ? companyType[0] : companyType;
  const resolvedFeatureTags = (Array.isArray(featureTags) ? featureTags[0] : featureTags)
    ?.split(',')
    .map((item: string) => item.trim())
    .filter(Boolean) || [];
  const initialQuery = useMemo(
    () => (rawQuery ? (isVoiceSource ? cleanupCompanyVoiceQuery(rawQuery) || rawQuery : rawQuery) : ''),
    [isVoiceSource, rawQuery],
  );
  const [query, setQuery] = useState(initialQuery);
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(!!initialQuery);
  const { add: addRecent } = useRecentSearches();

  useEffect(() => {
    setQuery(initialQuery);
    setSearchTerm(initialQuery);
    setSubmitted(!!initialQuery);
    if (initialQuery) {
      addRecent(initialQuery);
    }
  }, [addRecent, initialQuery]);

  const companiesQuery = useQuery({
    queryKey: ['company-search-page'],
    queryFn: () => CompanyRepo.list(),
    staleTime: 3 * 60_000,
  });

  const companies = companiesQuery.data?.ok ? companiesQuery.data.data : [];
  const queryTokens = useMemo(
    () => buildCompanyTokens(searchTerm, isVoiceSource),
    [isVoiceSource, searchTerm],
  );

  const filteredCompanies = useMemo(() => {
    return companies
      .map((company) => ({
        company,
        score: scoreCompanyMatch(company, queryTokens, {
          submitted,
          industryHint: resolvedIndustryHint,
          location: resolvedLocation,
          companyType: resolvedCompanyType,
          featureTags: resolvedFeatureTags,
        }),
      }))
      .filter((entry): entry is { company: (typeof companies)[number]; score: number } => entry.score !== null)
      .sort((left, right) => right.score - left.score || (left.company.distanceKm || 0) - (right.company.distanceKm || 0))
      .map((entry) => entry.company);
  }, [companies, queryTokens, resolvedCompanyType, resolvedFeatureTags, resolvedIndustryHint, resolvedLocation, submitted]);

  const handleSearch = (keyword?: string) => {
    const term = keyword ?? query.trim();
    setQuery(term);
    setSearchTerm(term);
    setSubmitted(true);
    if (term) {
      addRecent(term);
    }
  };

  const aiSummary = useMemo(() => {
    const filters = [resolvedLocation, resolvedIndustryHint, resolvedCompanyType, resolvedFeatureTags.join(' ')].filter(Boolean).join(' ');
    if ((!submitted || !searchTerm.trim()) && !filters) {
      return `为你找到 ${filteredCompanies.length} 家可浏览企业，支持按企业名、主营业务、产地位置搜索。`;
    }
    if (filteredCompanies.length === 0) {
      const hint = searchTerm.trim() || filters;
      return `未找到与“${hint}”相关的企业，试试换个企业名、主营业务或地区关键词。`;
    }
    const hint = searchTerm.trim() || filters;
    return `为你找到 ${filteredCompanies.length} 家与“${hint}”相关的企业，已按名称、主营品类、地区、企业类型和特征标签综合排序。`;
  }, [filteredCompanies.length, resolvedCompanyType, resolvedFeatureTags, resolvedIndustryHint, resolvedLocation, searchTerm, submitted]);

  const renderBody = () => {
    if (companiesQuery.isLoading) {
      return (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={18} radius={radius.sm} style={{ width: 140 }} />
          <Skeleton height={240} radius={radius.lg} style={{ marginTop: spacing.lg }} />
          <Skeleton height={240} radius={radius.lg} style={{ marginTop: spacing.lg }} />
        </View>
      );
    }

    if (companiesQuery.data && !companiesQuery.data.ok) {
      return (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="企业加载失败"
            description={(companiesQuery.data.error as AppError)?.displayMessage ?? '请稍后重试'}
          />
        </View>
      );
    }

    return (
      <View style={{ flex: 1 }}>
        <Animated.View entering={FadeInDown.duration(300)} style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
          <AiCardGlow style={{ ...shadow.sm, marginBottom: spacing.md }}>
            <View style={{ padding: spacing.lg, backgroundColor: colors.ai.soft, borderRadius: radius.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.ai.start, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>AI</Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.ai.start }]}>企业搜索摘要</Text>
              </View>
              <Text style={[typography.bodySm, { color: colors.text.secondary, lineHeight: 20 }]}>{aiSummary}</Text>
            </View>
          </AiCardGlow>
        </Animated.View>

        {filteredCompanies.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
            <EmptyState title="暂无企业结果" description="换个企业名、主营业务或位置试试" />
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.md }]}>试试这些搜索</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {['农场', '蜂蜜', '有机种植', '蓝莓', '茶叶', '直供基地'].map((term) => (
                  <Pressable
                    key={term}
                    onPress={() => handleSearch(term)}
                    style={{
                      backgroundColor: colors.bgSecondary,
                      borderRadius: radius.pill,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      marginRight: spacing.sm,
                      marginBottom: spacing.sm,
                    }}
                  >
                    <Text style={[typography.bodySm, { color: colors.text.secondary }]}>{term}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <FlatList
            data={filteredCompanies}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing['3xl'] }}
            renderItem={({ item: company }) => (
              <View style={{ marginBottom: spacing.md }}>
                <CompanyCard
                  company={company}
                  onPress={(item) => router.push({ pathname: '/company/[id]', params: { id: item.id } })}
                />
              </View>
            )}
          />
        )}
      </View>
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <View style={[styles.searchBar, { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderBottomColor: colors.divider }]}>
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: colors.bgSecondary,
              borderRadius: radius.lg,
            },
          ]}
        >
          <MaterialCommunityIcons name="store-search-outline" size={20} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              if (!text.trim()) {
                setSearchTerm('');
                setSubmitted(false);
              }
            }}
            onSubmitEditing={() => handleSearch()}
            placeholder="搜索企业、农场、主营业务..."
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={[styles.input, typography.bodySm, { color: colors.text.primary }]}
          />
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginLeft: spacing.md }}>
          <Text style={[typography.bodyStrong, { color: colors.text.secondary }]}>取消</Text>
        </Pressable>
      </View>
      {renderBody()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    marginHorizontal: 8,
    paddingVertical: 0,
  },
});
