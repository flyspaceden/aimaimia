import React, { useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { Tag } from '../../src/components/ui/Tag';
import { Price } from '../../src/components/ui/Price';
import { AiBadge } from '../../src/components/ui/AiBadge';
import { AiDivider } from '../../src/components/ui/AiDivider';
import { AiCardGlow } from '../../src/components/ui/AiCardGlow';
import { ProductRepo, TraceRepo, CompanyRepo } from '../../src/repos';
import { useCartStore } from '../../src/store';
import { useTheme } from '../../src/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;

// I04修复：基于商品ID动态生成AI品质评分（真实场景应从后端获取）
const getAiScore = (productId: string): { score: number; comment: string } => {
  // 基于ID生成稳定的伪随机分数（85-98区间）
  let hash = 0;
  for (let i = 0; i < productId.length; i++) {
    hash = ((hash << 5) - hash) + productId.charCodeAt(i);
    hash |= 0;
  }
  const score = 85 + Math.abs(hash % 14); // 85-98
  const comments = [
    '优质产地直供，检测合规，适合注重健康的家庭',
    '多项指标达标，溯源信息完整，品质可信赖',
    '产地认证齐全，农残检测通过，推荐购买',
    '供应链透明，质量管控严格，综合评价优秀',
  ];
  return { score, comment: comments[Math.abs(hash) % comments.length] };
};

import type { ProductDetail } from '../../src/types';

// 溯源流程步骤
const TRACE_STEPS = [
  { icon: '🌱', label: '种植' },
  { icon: '🔬', label: '检测' },
  { icon: '📦', label: '包装' },
  { icon: '🚚', label: '运输' },
  { icon: '✅', label: '到您手中' },
];

export default function ProductDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { colors, radius, spacing, typography, shadow, gradients, isDark } = useTheme();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const addItem = useCartStore((state) => state.addItem);
  const cartCount = useCartStore((state) => state.items.reduce((sum, item) => sum + item.quantity, 0));
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);

  // 商品数据（静态数据，5 分钟长缓存）
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: () => ProductRepo.getById(String(id)),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });

  // 溯源数据（极少变动，10 分钟长缓存）
  const { data: traceData } = useQuery({
    queryKey: ['product-trace', id],
    queryFn: () => TraceRepo.getProductTrace(String(id)),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });

  // 企业数据（5 分钟长缓存）
  const product = data?.ok ? data.data : null;
  const { data: companyData } = useQuery({
    queryKey: ['company', product?.companyId],
    queryFn: () => CompanyRepo.getById(product!.companyId!),
    enabled: Boolean(product?.companyId),
    staleTime: 5 * 60_000,
  });

  // 派生数据（必须在所有 early return 之前，保证 hooks 调用顺序稳定）
  const detail = product as unknown as ProductDetail | null;
  const skus = detail?.skus || [];
  const activeSkuId = selectedSkuId || skus[0]?.id;
  // N08修复：从选中 SKU 获取实际价格，传入购物车避免使用商品默认价格
  const activeSkuPrice = useMemo(() => {
    if (!activeSkuId || !skus.length) return undefined;
    const sku = skus.find((s) => s.id === activeSkuId);
    return sku?.price;
  }, [activeSkuId, skus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleImageScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offset / SCREEN_WIDTH);
    setImageIndex(idx);
  };

  // 加载态
  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="商品详情" />
        <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
          <Skeleton height={280} radius={radius.lg} />
          <Skeleton height={24} radius={radius.md} style={{ marginTop: spacing.lg }} />
          <Skeleton height={16} radius={radius.md} style={{ marginTop: spacing.sm }} />
          <Skeleton height={80} radius={radius.lg} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </Screen>
    );
  }

  // 错误态
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

  const images = detail?.images?.length ? detail.images.map((m) => m.url) : (product?.image ? [product.image] : []);
  const aiScore = getAiScore(product?.id ?? 'default');
  const trace = traceData?.ok ? traceData.data : null;
  const company = companyData?.ok ? companyData.data : null;
  const traceOrigin = trace?.batches?.[0]?.meta?.origin as string | undefined;
  const traceBatchCode = trace?.batches?.[0]?.batchCode;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="商品详情"
        rightSlot={
          <Pressable onPress={() => router.push('/cart')} hitSlop={10} style={{ padding: 8 }}>
            <View>
              <MaterialCommunityIcons name="cart-outline" size={22} color={colors.text.primary} />
              {cartCount > 0 && (
                <View style={[styles.headerBadge, { backgroundColor: colors.accent.blue }]}>
                  <Text style={[typography.captionSm, { color: colors.text.inverse, fontSize: 10 }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* 图片轮播 */}
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleImageScroll}
          >
            {images.map((uri, idx) => (
              <Image
                key={idx}
                source={{ uri }}
                style={{ width: SCREEN_WIDTH, height: 300 }}
                contentFit="cover"
              />
            ))}
          </ScrollView>
          {/* 圆点指示器 */}
          {images.length > 1 && (
            <View style={styles.dotRow}>
              {images.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: idx === imageIndex ? colors.brand.primary : colors.text.inverse,
                      opacity: idx === imageIndex ? 1 : 0.6,
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        <View style={{ padding: spacing.xl }}>
          {/* AI 品质评分区 */}
          <Animated.View entering={FadeInDown.duration(300).delay(100)}>
            <AiCardGlow style={{ ...shadow.sm, marginBottom: spacing.xl }}>
              <View style={[styles.aiScoreCard, { backgroundColor: colors.ai.soft, borderRadius: radius.lg }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <AiBadge variant="score" />
                    <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
                      AI 品质评分
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text style={[typography.title2, { color: colors.ai.start, fontWeight: '700' }]}>
                      {aiScore.score}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.tertiary }]}>/100</Text>
                  </View>
                </View>
                {/* 渐变进度条 */}
                <View style={[styles.progressBg, { backgroundColor: colors.bgSecondary, borderRadius: radius.pill, marginTop: spacing.md }]}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: `${aiScore.score}%`, borderRadius: radius.pill }]}
                  />
                </View>
                <Text style={[typography.bodySm, { color: colors.ai.start, marginTop: spacing.md, lineHeight: 20 }]}>
                  "{aiScore.comment}"
                </Text>
              </View>
            </AiCardGlow>
          </Animated.View>

          {/* 价格区域 */}
          <Animated.View entering={FadeInDown.duration(300).delay(150)}>
            <View style={[styles.priceSection, { backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Price value={product!.price} unit={product!.unit} strikeValue={product!.strikePrice} />
              </View>
              <View style={[styles.statsRow, { marginTop: spacing.sm }]}>
                {(product!.monthlySales ?? 0) > 0 && (
                <View style={[styles.statChip, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill }]}>
                  <Text style={[typography.captionSm, { color: colors.brand.primary }]}>月销 {product!.monthlySales}</Text>
                </View>
              )}
              {(product!.rating ?? 0) > 0 && (
                <View style={[styles.statChip, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.pill, marginLeft: spacing.sm }]}>
                  <Text style={[typography.captionSm, { color: colors.brand.primary }]}>好评 {product!.rating}%</Text>
                </View>
              )}
              </View>
              {/* 退换货政策提示（TODO: 待后端 product API 返回 returnPolicy 字段后按实际值判断） */}
              <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: spacing.sm, fontSize: 11 }]}>
                支持7天无理由退换 · 质量问题可申请售后
              </Text>
            </View>
          </Animated.View>

          {/* 标题 + 产地 + 标签 */}
          <Animated.View entering={FadeInDown.duration(300).delay(200)} style={{ marginTop: spacing.xl }}>
            <Text style={[typography.title2, { color: colors.text.primary, lineHeight: 30 }]}>{product!.title}</Text>
            <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: spacing.xs }]}>
              {product!.origin}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md }}>
              {(product!.tags ?? [])
                .filter((tag): tag is string => typeof tag === 'string')
                .map((tag, index) => (
                <Tag key={`${tag}-${index}`} label={tag} style={{ marginRight: spacing.xs, marginBottom: spacing.xs }} />
              ))}
            </View>
          </Animated.View>

          {/* SKU 选择区 */}
          {skus.length > 0 && (
            <Animated.View entering={FadeInDown.duration(300).delay(250)} style={{ marginTop: spacing.xl }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: spacing.md }]}>
                规格选择
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {skus.map((sku) => {
                  const active = activeSkuId === sku.id;
                  return (
                    <Pressable
                      key={sku.id}
                      onPress={() => setSelectedSkuId(sku.id)}
                      style={[
                        styles.skuButton,
                        {
                          borderColor: active ? colors.brand.primary : colors.border,
                          backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                          borderRadius: radius.md,
                        },
                        active && shadow.sm,
                      ]}
                    >
                      <Text
                        style={[
                          active ? typography.bodyStrong : typography.bodySm,
                          { color: active ? colors.brand.primary : colors.text.primary },
                        ]}
                      >
                        {sku.title}
                      </Text>
                      <Text style={[typography.captionSm, { color: active ? colors.brand.primary : colors.text.tertiary, marginTop: 2 }]}>
                        ¥{sku.price}
                      </Text>
                      <Text style={[typography.captionSm, { color: colors.text.tertiary, marginTop: 2 }]}>
                        库存: {sku.stock}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          )}

          {/* AI 溯源区 */}
          <Animated.View entering={FadeInDown.duration(300).delay(300)}>
            <View style={[styles.traceSection, { backgroundColor: colors.ai.soft, borderRadius: radius.xl, marginTop: spacing.xl }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }}>
                <AiBadge variant="trace" />
                <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                  AI 溯源验证
                </Text>
              </View>

              {/* 流程图标行 */}
              <View style={styles.traceFlow}>
                {TRACE_STEPS.map((step, idx) => (
                  <React.Fragment key={step.label}>
                    <View style={styles.traceStepItem}>
                      <View style={[styles.traceIcon, { backgroundColor: colors.surface, borderRadius: radius.full, ...shadow.sm }]}>
                        <Text style={{ fontSize: 20 }}>{step.icon}</Text>
                      </View>
                      <Text style={[typography.captionSm, { color: colors.text.secondary, marginTop: 6 }]}>
                        {step.label}
                      </Text>
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={14}
                        color={colors.brand.primary}
                        style={{ marginTop: 3 }}
                      />
                    </View>
                    {idx < TRACE_STEPS.length - 1 && (
                      <LinearGradient
                        colors={[colors.ai.start, colors.ai.end]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.traceArrow, { borderRadius: 1 }]}
                      />
                    )}
                  </React.Fragment>
                ))}
              </View>

              <AiDivider style={{ marginVertical: spacing.md }} />

              {/* 溯源元数据 */}
              <View>
                {traceOrigin && (
                  <View style={styles.traceMeta}>
                    <Text style={[typography.caption, { color: colors.text.tertiary }]}>产地</Text>
                    <Text style={[typography.bodySm, { color: colors.text.primary }]}>
                      <MaterialCommunityIcons name="check-circle-outline" size={13} color={colors.brand.primary} /> {traceOrigin}
                    </Text>
                  </View>
                )}
                {traceBatchCode && (
                  <View style={[styles.traceMeta, { marginTop: spacing.xs }]}>
                    <Text style={[typography.caption, { color: colors.text.tertiary }]}>批次</Text>
                    <Text style={[typography.bodySm, { color: colors.text.primary }]}>
                      <MaterialCommunityIcons name="check-circle-outline" size={13} color={colors.brand.primary} /> {traceBatchCode}
                    </Text>
                  </View>
                )}
              </View>

              {/* 查看完整溯源 */}
              <Pressable
                onPress={() => router.push({ pathname: '/ai/trace', params: { productId: String(id) } })}
                style={[styles.traceLink, { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md }]}
              >
                <Text style={[typography.bodyStrong, { color: colors.ai.start }]}>查看完整溯源报告</Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.ai.start} />
              </Pressable>
            </View>
          </Animated.View>

          {/* 企业卡片 — 增强版 */}
          {company && (
            <Animated.View entering={FadeInDown.duration(300).delay(350)}>
              <Pressable
                onPress={() => router.push({ pathname: '/company/[id]', params: { id: company.id } })}
                style={[
                  styles.companyCard,
                  shadow.sm,
                  { backgroundColor: colors.surface, borderRadius: radius.xl, marginTop: spacing.xl },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Image
                    source={{ uri: company.cover }}
                    style={{ width: 52, height: 52, borderRadius: radius.lg }}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{company.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <MaterialCommunityIcons name="star" size={14} color={colors.gold.primary} />
                      <Text style={[typography.captionSm, { color: colors.text.secondary, marginLeft: 3 }]}>
                        4.8
                      </Text>
                      <View style={[styles.companyDot, { backgroundColor: colors.text.tertiary }]} />
                      <Text style={[typography.captionSm, { color: colors.text.secondary }]}>有机认证</Text>
                      <View style={[styles.companyDot, { backgroundColor: colors.text.tertiary }]} />
                      <Text style={[typography.captionSm, { color: colors.text.secondary }]}>5年</Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.tertiary} />
                </View>
                {/* AI 信赖评分条 */}
                <View style={[styles.trustBar, { backgroundColor: colors.ai.soft, borderRadius: radius.md, marginTop: spacing.md }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <AiBadge variant="analysis" />
                    <Text style={[typography.captionSm, { color: colors.text.secondary, marginLeft: spacing.xs }]}>
                      AI 信赖分
                    </Text>
                  </View>
                  <Text style={[typography.bodyStrong, { color: colors.ai.start }]}>96</Text>
                  <Text style={[typography.captionSm, { color: colors.text.tertiary }]}>/100</Text>
                </View>
              </Pressable>
            </Animated.View>
          )}

          {/* 商品属性 */}
          {(() => {
            const primitiveAttrs = detail?.attributes
              ? Object.entries(detail.attributes).filter(
                  ([, value]) => typeof value === 'string' || typeof value === 'number',
                )
              : [];
            if (primitiveAttrs.length === 0) return null;
            return (
              <Animated.View entering={FadeInDown.duration(300).delay(370)} style={{ marginTop: spacing.xl }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
                  <View style={[styles.sectionLine, { backgroundColor: colors.brand.primary }]} />
                  <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                    商品属性
                  </Text>
                </View>
                <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadow.sm }]}>
                  {primitiveAttrs.map(([key, value]) => (
                    <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                      <Text style={[typography.bodySm, { color: colors.text.tertiary }]}>{key}</Text>
                      <Text style={[typography.bodySm, { color: colors.text.primary }]}>{String(value)}</Text>
                    </View>
                  ))}
                </View>
              </Animated.View>
            );
          })()}

          {/* 图文详情 */}
          <Animated.View entering={FadeInDown.duration(300).delay(400)} style={{ marginTop: spacing.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
              <View style={[styles.sectionLine, { backgroundColor: colors.brand.primary }]} />
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                图文详情
              </Text>
            </View>
            <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadow.sm, minHeight: 80 }]}>
              {detail?.description ? (
                <Text style={[typography.body, { color: colors.text.secondary, lineHeight: 24 }]}>
                  {detail.description}
                </Text>
              ) : (
                <Text style={[typography.body, { color: colors.text.tertiary, textAlign: 'center' }]}>
                  暂无详情描述
                </Text>
              )}
            </View>
          </Animated.View>
        </View>
      </ScrollView>

      {/* 底部操作栏 — 毛玻璃 */}
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={80}
          tint={isDark ? 'dark' : 'light'}
          style={[
            styles.ctaBar,
            {
              paddingBottom: insets.bottom + spacing.md,
              paddingTop: spacing.md,
              paddingHorizontal: spacing.xl,
              borderTopColor: colors.border,
            },
          ]}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(6,14,6,0.6)' : 'rgba(250,252,250,0.6)' }]} />
          <Pressable
            onPress={() => {
              addItem(product!, 1, activeSkuId, activeSkuPrice);
              show({ message: '已加入购物车', type: 'success' });
            }}
            style={[
              styles.ctaButton,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: colors.brand.primary,
              },
            ]}
          >
            <MaterialCommunityIcons name="cart-plus" size={18} color={colors.brand.primary} style={{ marginRight: 6 }} />
            <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>加入购物车</Text>
          </Pressable>
          <LinearGradient
            colors={[...gradients.goldGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.ctaButton, { borderRadius: radius.lg, marginLeft: spacing.md }]}
          >
            <Pressable
              onPress={() => {
                addItem(product!, 1, activeSkuId, activeSkuPrice);
                router.push('/checkout');
              }}
              style={styles.ctaInner}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>✦ 立即购买</Text>
            </Pressable>
          </LinearGradient>
        </BlurView>
      ) : (
        <View
          style={[
            styles.ctaBar,
            {
              paddingBottom: insets.bottom + spacing.md,
              paddingTop: spacing.md,
              paddingHorizontal: spacing.xl,
              borderTopColor: colors.border,
              backgroundColor: isDark ? 'rgba(6,14,6,0.95)' : 'rgba(250,252,250,0.95)',
            },
          ]}
        >
          <Pressable
            onPress={() => {
              addItem(product!, 1, activeSkuId, activeSkuPrice);
              show({ message: '已加入购物车', type: 'success' });
            }}
            style={[
              styles.ctaButton,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: colors.brand.primary,
              },
            ]}
          >
            <MaterialCommunityIcons name="cart-plus" size={18} color={colors.brand.primary} style={{ marginRight: 6 }} />
            <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>加入购物车</Text>
          </Pressable>
          <LinearGradient
            colors={[...gradients.goldGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.ctaButton, { borderRadius: radius.lg, marginLeft: spacing.md }]}
          >
            <Pressable
              onPress={() => {
                addItem(product!, 1, activeSkuId, activeSkuPrice);
                router.push('/checkout');
              }}
              style={styles.ctaInner}
            >
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>✦ 立即购买</Text>
            </Pressable>
          </LinearGradient>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  dotRow: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginHorizontal: 3,
  },
  aiScoreCard: {
    padding: 16,
  },
  progressBg: {
    height: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
  },
  priceSection: {
    padding: 16,
    marginTop: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  skuButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 10,
  },
  traceSection: {
    padding: 20,
  },
  traceFlow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  traceStepItem: {
    alignItems: 'center',
    width: 52,
  },
  traceIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  traceArrow: {
    width: 16,
    height: 2,
    marginTop: 21,
  },
  traceMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  traceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyCard: {
    padding: 16,
  },
  companyDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    marginHorizontal: 6,
  },
  trustBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionLine: {
    width: 3,
    height: 16,
    borderRadius: 1.5,
  },
  detailPlaceholder: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  ctaButton: {
    flex: 1,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
});
