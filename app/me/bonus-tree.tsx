import React, { useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { BonusRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { VipTreeNode } from '../../src/types';

// 当前用户节点脉动动画
function PulsingNode({ children }: { children: React.ReactNode }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.08, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={pulseStyle}>{children}</Animated.View>;
}

// 三叉树节点组件
const TreeNode = ({
  node,
  isMe,
  colors,
  radius,
  shadow,
  typography,
}: {
  node: VipTreeNode;
  isMe?: boolean;
  colors: any;
  radius: any;
  shadow: any;
  typography: any;
}) => {
  const inner = (
    <View
      style={[
        styles.treeNode,
        isMe ? shadow.md : undefined,
        {
          backgroundColor: isMe ? colors.brand.primary : colors.surface,
          borderRadius: radius.lg,
          borderColor: isMe ? colors.brand.primary : colors.border,
        },
      ]}
    >
      <MaterialCommunityIcons
        name="account-circle"
        size={28}
        color={isMe ? colors.text.inverse : colors.brand.primary}
      />
      <Text
        style={[
          typography.caption,
          { color: isMe ? colors.text.inverse : colors.text.primary, marginTop: 2 },
        ]}
      >
        {isMe ? '我' : `L${node.level}`}
      </Text>
      <Text
        style={[
          { fontSize: 10, color: isMe ? 'rgba(255,255,255,0.7)' : colors.text.secondary, marginTop: 1 },
        ]}
      >
        {node.childrenCount}/3
      </Text>
    </View>
  );

  return isMe ? <PulsingNode>{inner}</PulsingNode> : inner;
};

export default function BonusTreeScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data: memberData } = useQuery({
    queryKey: ['bonus-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });
  const { data: treeData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['bonus-vip-tree'],
    queryFn: () => BonusRepo.getVipTree(),
    enabled: isLoggedIn,
  });

  const member = memberData?.ok ? memberData.data : null;
  const tree = treeData?.ok ? treeData.data : null;
  const error = treeData && !treeData.ok ? treeData.error : null;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="VIP 三叉树" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      >
        {isLoading ? (
          <View>
            <Skeleton height={120} radius={radius.lg} style={{ marginBottom: spacing.md }} />
            <Skeleton height={300} radius={radius.lg} />
          </View>
        ) : error ? (
          <ErrorState title="加载失败" description="请稍后重试" onAction={() => refetch()} />
        ) : member?.tier !== 'VIP' ? (
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={[styles.upgradeCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.xl }]}>
              <View style={[styles.upgradeIcon, { backgroundColor: colors.accent.blueSoft }]}>
                <MaterialCommunityIcons name="crown-outline" size={32} color={colors.accent.blue} />
              </View>
              <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.lg }]}>
                升级 VIP 解锁三叉树
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginTop: spacing.sm, textAlign: 'center' }]}>
                购买 VIP 礼包后，您将获得专属三叉树节点，享受团队分润收益
              </Text>
              <Pressable onPress={() => show({ message: 'VIP 购买功能即将上线', type: 'info' })}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.upgradeButton, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                    ¥399 开通 VIP
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          </Animated.View>
        ) : !tree?.node ? (
          <EmptyState title="暂无树节点" description="您的三叉树节点正在分配中" />
        ) : (
          <View>
            {/* 节点统计 — 装饰条 + 动画入场 */}
            <Animated.View entering={FadeInDown.duration(300)}>
              <View style={[styles.statsCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden' }]}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.ai.start]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ height: 3 }}
                />
                <View style={{ padding: 20 }}>
                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <Text style={[typography.title2, { color: colors.brand.primary }]}>
                        L{tree.node.level}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        我的层级
                      </Text>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.statItem}>
                      <Text style={[typography.title2, { color: colors.accent.blue }]}>
                        {tree.children.length}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        直接下级
                      </Text>
                    </View>
                    <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.statItem}>
                      <Text style={[typography.title2, { color: colors.success }]}>
                        {tree.children.reduce((sum, c) => sum + (c.children?.length ?? 0), 0)}
                      </Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                        间接下级
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </Animated.View>

            {/* 树形可视化 */}
            <Animated.View entering={FadeInDown.duration(300).delay(100)}>
              <View style={[styles.treeContainer, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.xl }]}>
                <Text style={[typography.title3, { color: colors.text.primary, marginBottom: spacing.lg }]}>
                  我的三叉树
                </Text>

                {/* 第一层：我 */}
                <View style={styles.treeLevel}>
                  <TreeNode node={tree.node} isMe colors={colors} radius={radius} shadow={shadow} typography={typography} />
                </View>

                {/* 渐变连接线 */}
                {tree.children.length > 0 ? (
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    style={styles.gradientConnector}
                  />
                ) : null}

                {/* 第二层：直接下级 */}
                {tree.children.length > 0 ? (
                  <View style={styles.treeLevel}>
                    {tree.children.map((child) => (
                      <TreeNode key={child.id} node={child} colors={colors} radius={radius} shadow={shadow} typography={typography} />
                    ))}
                    {/* 空位占位 — ai.start 色文字 */}
                    {Array.from({ length: 3 - tree.children.length }).map((_, i) => (
                      <View
                        key={`empty-${i}`}
                        style={[
                          styles.treeNode,
                          styles.emptyNode,
                          { borderColor: colors.border, borderRadius: radius.lg },
                        ]}
                      >
                        <MaterialCommunityIcons name="plus" size={20} color={colors.ai.start} />
                        <Text style={[{ fontSize: 10, color: colors.ai.start, marginTop: 2 }]}>邀请</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* 第三层：间接下级 */}
                {tree.children.some((c) => c.children && c.children.length > 0) ? (
                  <>
                    <LinearGradient
                      colors={[colors.brand.primary, colors.ai.start]}
                      style={styles.gradientConnector}
                    />
                    <View style={styles.treeLevel}>
                      {tree.children.flatMap((child) =>
                        (child.children ?? []).map((gc) => (
                          <TreeNode key={gc.id} node={gc} colors={colors} radius={radius} shadow={shadow} typography={typography} />
                        ))
                      )}
                    </View>
                  </>
                ) : null}
              </View>
            </Animated.View>

            {/* 分润说明 */}
            <Animated.View entering={FadeInDown.duration(300).delay(200)}>
              <View style={[styles.infoCard, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.lg }]}>
                <MaterialCommunityIcons name="information-outline" size={16} color={colors.brand.primary} />
                <Text style={[typography.caption, { color: colors.brand.primary, flex: 1, marginLeft: 8 }]}>
                  每消费一次解锁一层，最多解锁 15 层。下级消费时您将获得对应层级的分润红包。
                </Text>
              </View>
            </Animated.View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  upgradeCard: {
    padding: 32,
    alignItems: 'center',
  },
  upgradeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 24,
  },
  statsCard: {
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 32,
  },
  treeContainer: {
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  treeLevel: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  gradientConnector: {
    width: 2,
    height: 24,
    alignSelf: 'center',
    borderRadius: 1,
  },
  treeNode: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  emptyNode: {
    borderStyle: 'dashed',
  },
  infoCard: {
    flexDirection: 'row',
    padding: 14,
    alignItems: 'flex-start',
  },
});
