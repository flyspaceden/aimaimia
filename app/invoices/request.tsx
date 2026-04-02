import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { InvoiceRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, InvoiceProfile } from '../../src/types';

export default function InvoiceRequestScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ orderId: string }>();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 加载用户的发票抬头列表
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['invoice-profiles'],
    queryFn: () => InvoiceRepo.getProfiles(),
    enabled: isLoggedIn,
  });

  const listError = data && !data.ok ? data.error : null;
  const profiles = data?.ok ? data.data : [];

  // 提交开票申请
  const handleSubmit = useCallback(async () => {
    if (!selectedId) {
      show({ message: '请选择发票抬头', type: 'error' });
      return;
    }
    if (!params.orderId) {
      show({ message: '缺少订单信息', type: 'error' });
      return;
    }

    setSubmitting(true);
    const result = await InvoiceRepo.requestInvoice({
      orderId: params.orderId,
      profileId: selectedId,
    });
    setSubmitting(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '申请失败', type: 'error' });
      return;
    }

    show({ message: '开票申请已提交', type: 'success' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
    ]);
    router.back();
  }, [selectedId, params.orderId, show, queryClient, router]);

  // 渲染抬头选择卡片
  const renderProfile = (profile: InvoiceProfile, index: number) => {
    const isSelected = selectedId === profile.id;
    const isCompany = profile.type === 'COMPANY';
    return (
      <Animated.View key={profile.id} entering={FadeInDown.duration(300).delay(50 + index * 30)}>
        <Pressable
          onPress={() => setSelectedId(profile.id)}
          style={[
            styles.profileCard,
            shadow.sm,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: isSelected ? 2 : 1,
              borderColor: isSelected ? colors.brand.primary : colors.border,
            },
          ]}
        >
          <View style={styles.profileHeader}>
            {/* 类型标签 */}
            <View style={[
              styles.typeBadge,
              {
                backgroundColor: isCompany ? colors.accent.blueSoft : colors.brand.primarySoft,
                borderRadius: radius.pill,
              },
            ]}>
              <Text style={[typography.captionSm, { color: isCompany ? colors.accent.blue : colors.brand.primary }]}>
                {isCompany ? '企业' : '个人'}
              </Text>
            </View>
            {/* 选中指示 */}
            <View style={[
              styles.radio,
              {
                borderColor: isSelected ? colors.brand.primary : colors.border,
                backgroundColor: isSelected ? colors.brand.primary : 'transparent',
              },
            ]}>
              {isSelected ? (
                <View style={[styles.radioInner, { backgroundColor: colors.text.inverse }]} />
              ) : null}
            </View>
          </View>

          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 8 }]} numberOfLines={1}>
            {profile.title}
          </Text>

          {isCompany && profile.taxNo ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              税号：{profile.taxNo}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="申请发票" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={80} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={80} radius={radius.lg} />
        </View>
      ) : (listError as AppError | null) ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="抬头加载失败"
            description={listError?.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
            {/* 提示 */}
            <Text style={[typography.bodySm, { color: colors.text.secondary, marginBottom: spacing.lg }]}>
              请选择发票抬头，确认后将为订单 {params.orderId?.slice(0, 10)}... 申请开票
            </Text>

            {profiles.length === 0 ? (
              <EmptyState title="暂无发票抬头" description="请先新建一个发票抬头" />
            ) : (
              profiles.map((profile, index) => renderProfile(profile, index))
            )}

            {/* 新建抬头入口 */}
            <Pressable
              onPress={() => router.push('/invoices/profiles/edit')}
              style={[
                styles.addBtn,
                { borderColor: colors.border, borderRadius: radius.lg, marginTop: spacing.md },
              ]}
            >
              <Text style={[typography.bodySm, { color: colors.accent.blue }]}>+ 新建抬头</Text>
            </Pressable>
          </ScrollView>

          {/* 底部确认按钮 */}
          <View style={[styles.bottomBar, { borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface }]}>
            <Pressable
              onPress={handleSubmit}
              disabled={!selectedId || submitting}
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={!selectedId || submitting ? [colors.border, colors.border] : [colors.brand.primary, colors.ai.start]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.confirmBtn, { borderRadius: radius.pill }]}
              >
                <Text style={[
                  typography.bodyStrong,
                  { color: !selectedId || submitting ? colors.text.secondary : colors.text.inverse },
                ]}>
                  {submitting ? '提交中...' : '确认申请'}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    padding: 14,
    marginBottom: 12,
  },
  profileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  addBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    paddingVertical: 14,
  },
  bottomBar: {
    padding: 16,
  },
  confirmBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
});
