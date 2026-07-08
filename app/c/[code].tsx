import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AuthModal } from '../../src/components/overlay';
import { CaptainRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useTheme } from '../../src/theme';

export default function CaptainLandingPage() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [authOpen, setAuthOpen] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const normalizedCode = useMemo(() => String(code || '').trim().toUpperCase(), [code]);

  const landingQuery = useQuery({
    queryKey: ['captain-landing', normalizedCode],
    queryFn: () => CaptainRepo.getLanding(normalizedCode),
    enabled: normalizedCode.length > 0,
  });

  const landing = landingQuery.data?.ok ? landingQuery.data.data : null;
  const captain = landing?.captain ?? null;
  const captainName = captain?.displayName || captain?.nickname || '团长';

  const bindMutation = useMutation({
    mutationFn: () => CaptainRepo.bindByCode(normalizedCode),
    onSuccess: async (result) => {
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '绑定失败', type: 'error' });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['captain-me'] });
      show({ message: '团长关系已绑定', type: 'success' });
      router.replace('/me/captain' as any);
    },
  });

  const handleBind = () => {
    if (!landing?.valid) {
      show({ message: landing?.reason ?? '团长码不可用', type: 'warning' });
      return;
    }
    if (!landing.enabled) {
      show({ message: '团长经营暂未开放', type: 'warning' });
      return;
    }
    if (!isLoggedIn) {
      setAuthOpen(true);
      return;
    }
    bindMutation.mutate();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="团长经营" />
      {landingQuery.isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={220} radius={radius.xl} />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={120} radius={radius.lg} />
        </View>
      ) : landingQuery.data && !landingQuery.data.ok ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="团长码加载失败"
            description={landingQuery.data.error.displayMessage ?? '请稍后重试'}
            onAction={() => landingQuery.refetch()}
          />
        </View>
      ) : !landing?.valid ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="团长码不可用"
            description={landing?.reason ?? '该团长码已失效或团长状态不可用'}
            onAction={() => router.replace('/' as any)}
            actionLabel="返回首页"
          />
        </View>
      ) : !landing.enabled ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="团长经营暂未开放"
            description="该团长码已识别，平台开启团长经营后可继续绑定"
            onAction={() => landingQuery.refetch()}
            actionLabel="刷新"
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
          <LinearGradient
            colors={['#0F766E', '#164E63']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderRadius: radius.xl }, shadow.lg]}
          >
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons name="snowflake-variant" size={30} color="#FFFFFF" />
            </View>
            <Text style={[typography.title2, styles.heroTitle]}>
              {captainName}
            </Text>
            <Text style={[typography.bodySm, styles.heroDesc]}>
              邀请你加入{landing.programName}
            </Text>
            <View style={styles.codePill}>
              <Text style={styles.codeText}>{landing.code}</Text>
            </View>
          </LinearGradient>

          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="package-variant-closed-check" size={22} color={colors.brand.primary} />
              <View style={styles.infoText}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>真实订单</Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  经营奖励以商品实付、物流和售后结果为准
                </Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={22} color={colors.brand.primary} />
              <View style={styles.infoText}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>独立台账</Text>
                <Text style={[typography.caption, { color: colors.text.secondary }]}>
                  团长经营奖励与 VIP 推荐、消费积分、红包分开记录
                </Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleBind}
            disabled={bindMutation.isPending}
            style={[styles.primaryButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
          >
            <MaterialCommunityIcons name={isLoggedIn ? 'account-check-outline' : 'login'} size={18} color="#FFFFFF" />
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: '#FFFFFF', marginLeft: 8 }]}>
              {isLoggedIn ? (bindMutation.isPending ? '绑定中' : '绑定团长') : '登录后绑定'}
            </Text>
          </Pressable>
        </ScrollView>
      )}

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['captain-landing', normalizedCode] });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    minHeight: 230,
    padding: 24,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  heroTitle: {
    color: '#FFFFFF',
  },
  heroDesc: {
    color: 'rgba(255,255,255,0.78)',
    marginTop: 8,
  },
  codePill: {
    alignSelf: 'flex-start',
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  codeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
  infoCard: {
    marginTop: 18,
    padding: 18,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
  },
  primaryButton: {
    marginTop: 22,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
