import React, { useCallback } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { InvoiceRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, InvoiceProfile } from '../../src/types';

export default function InvoiceProfilesScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['invoice-profiles'],
    queryFn: () => InvoiceRepo.getProfiles(),
    enabled: isLoggedIn,
  });

  const listError = data && !data.ok ? data.error : null;
  const profiles = data?.ok ? data.data : [];

  // 删除抬头
  const handleDelete = useCallback(async (profile: InvoiceProfile) => {
    Alert.alert('删除抬头', `确认删除「${profile.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const result = await InvoiceRepo.deleteProfile(profile.id);
          if (!result.ok) {
            show({ message: result.error.displayMessage ?? '删除失败', type: 'error' });
            return;
          }
          show({ message: '已删除', type: 'success' });
          queryClient.invalidateQueries({ queryKey: ['invoice-profiles'] });
        },
      },
    ]);
  }, [show, queryClient]);

  // 渲染抬头卡片
  const renderItem = useCallback(({ item, index }: { item: InvoiceProfile; index: number }) => {
    const isCompany = item.type === 'COMPANY';
    return (
      <Animated.View entering={FadeInDown.duration(300).delay(50 + index * 30)}>
        <Pressable
          onPress={() => router.push({ pathname: '/invoices/profiles/edit', params: { id: item.id } })}
          style={[
            styles.card,
            shadow.md,
            { backgroundColor: colors.surface, borderRadius: radius.lg },
          ]}
        >
          <View style={styles.cardHeader}>
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
            {/* 操作 */}
            <Pressable onPress={() => handleDelete(item)} hitSlop={8}>
              <Text style={[typography.caption, { color: colors.danger }]}>删除</Text>
            </Pressable>
          </View>

          {/* 抬头名称 */}
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginTop: 8 }]} numberOfLines={1}>
            {item.title}
          </Text>

          {/* 税号（企业） */}
          {isCompany && item.taxNo ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              税号：{item.taxNo}
            </Text>
          ) : null}

          {/* 联系方式 */}
          {item.email || item.phone ? (
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
              {[item.email, item.phone].filter(Boolean).join(' | ')}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
    );
  }, [colors, radius, shadow, typography, handleDelete, router]);

  const keyExtractor = useCallback((item: InvoiceProfile) => item.id, []);

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="发票抬头管理" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={100} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={100} radius={radius.lg} />
        </View>
      ) : (listError as AppError | null) ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="抬头加载失败"
            description={listError?.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : profiles.length === 0 ? (
        <View style={{ padding: spacing.xl }}>
          <EmptyState title="暂无发票抬头" description="添加抬头后可快速申请开票" />
        </View>
      ) : (
        <FlatList
          data={profiles}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        />
      )}

      {/* 底部新建按钮 */}
      <Pressable onPress={() => router.push('/invoices/profiles/edit')}>
        <LinearGradient
          colors={[colors.brand.primary, colors.ai.start]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.bottomBtn, { borderTopColor: colors.border, borderTopWidth: 1 }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>新建抬头</Text>
        </LinearGradient>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bottomBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
});
