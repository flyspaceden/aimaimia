import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../../src/components/feedback';
import { OrderRepo } from '../../../src/repos';
import { useTheme } from '../../../src/theme';
import { AppError } from '../../../src/types';

const reasons = ['商品破损', '质量问题', '少件/错发', '不想要了', '其他'];

export default function AfterSaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedReason, setSelectedReason] = useState(reasons[0]);
  const [note, setNote] = useState('');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: Boolean(orderId),
  });
  const refreshing = isFetching;

  const handleSubmit = async () => {
    const result = await OrderRepo.applyAfterSale({ orderId, reason: selectedReason, note });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '售后申请失败', type: 'error' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    await queryClient.invalidateQueries({ queryKey: ['me-order-issue'] });
    show({ message: '售后申请已提交', type: 'success' });
    router.replace({ pathname: '/orders/[id]', params: { id: orderId } });
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="申请售后" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={120} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1, paddingHorizontal: spacing.xl }}>
        <AppHeader title="申请售后" />
        <ErrorState
          title="订单加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  const order = data.data;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="申请售后" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}
      >
        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>订单信息</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>{order.id}</Text>
          {order.items.length === 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              <EmptyState title="暂无商品" description="订单中没有商品记录" />
            </View>
          ) : (
            order.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <Image source={{ uri: item.image }} style={styles.cover} contentFit="cover" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    数量 x{item.quantity}
                  </Text>
                </View>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                  ¥{item.price.toFixed(2)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>售后原因</Text>
          <View style={styles.reasonRow}>
            {reasons.map((reason) => {
              const active = reason === selectedReason;
              return (
                <Pressable
                  key={reason}
                  onPress={() => setSelectedReason(reason)}
                  style={[
                    styles.reasonChip,
                    {
                      backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      borderColor: active ? colors.brand.primary : colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary }]}>
                    {reason}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.sm }]}>
            详情说明（可选）
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="补充说明有助于更快处理"
            placeholderTextColor={colors.muted}
            style={[styles.textarea, { borderColor: colors.border, color: colors.text.primary }]}
            multiline
          />
        </View>

        <Pressable
          onPress={handleSubmit}
          style={[styles.submitButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
        >
          <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>提交售后申请</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  cover: {
    width: 64,
    height: 64,
    borderRadius: 12,
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  reasonChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 90,
    marginTop: 8,
    textAlignVertical: 'top',
  },
  submitButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
});
