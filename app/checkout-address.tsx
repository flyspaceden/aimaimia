import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../src/components/layout';
import { AuthModal } from '../src/components/overlay';
import { EmptyState, Skeleton } from '../src/components/feedback';
import { AddressRepo } from '../src/repos';
import { useAuthStore, useCheckoutStore } from '../src/store';
import { useTheme } from '../src/theme';

export default function CheckoutAddressScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);
  const [authOpen, setAuthOpen] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => AddressRepo.list(),
    enabled: isLoggedIn,
  });

  const addresses = data?.ok ? data.data : [];

  const setSelectedAddress = useCheckoutStore((s) => s.setSelectedAddress);

  const handleSelect = (id: string) => {
    setSelectedAddress(id);
    router.back();
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="选择收货地址" />
      {!isLoggedIn ? (
        <EmptyState
          title="请先登录"
          description="登录后才能选择或新增收货地址"
          actionLabel="登录 / 注册"
          onAction={() => setAuthOpen(true)}
        />
      ) : isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={80} radius={radius.lg} style={{ marginBottom: spacing.md }} />
          <Skeleton height={80} radius={radius.lg} />
        </View>
      ) : addresses.length === 0 ? (
        <EmptyState
          title="暂无收货地址"
          description="请先添加收货地址"
          actionLabel="添加地址"
          // 直接进新增表单（带 openNew=1 参数让 /me/addresses 跳过列表态）
          onAction={() => router.push({ pathname: '/me/addresses', params: { openNew: '1' } })}
        />
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          initialNumToRender={6}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          ListFooterComponent={
            <Pressable
              // 同上：直接进新增表单
              onPress={() => router.push({ pathname: '/me/addresses', params: { openNew: '1' } })}
              style={[styles.addButton, { borderColor: colors.border, borderRadius: radius.lg }]}
            >
              <MaterialCommunityIcons name="plus" size={20} color={colors.brand.primary} />
              <Text style={[typography.bodyStrong, { color: colors.brand.primary, marginLeft: 8 }]}>
                新增地址
              </Text>
            </Pressable>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(300).delay(50 + index * 30)}>
              <Pressable
                onPress={() => handleSelect(item.id)}
                style={[
                  styles.card,
                  shadow.md,
                  { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
                ]}
              >
                {item.isDefault ? (
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    style={{ width: 2 }}
                  />
                ) : null}
                <View style={{ flex: 1, paddingLeft: item.isDefault ? 12 : 14 }}>
                  <View style={styles.nameRow}>
                    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                      {item.receiverName}
                    </Text>
                    <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 12 }]}>
                      {item.phone}
                    </Text>
                    {item.isDefault ? (
                      <View style={[styles.defaultBadge, { backgroundColor: colors.brand.primarySoft }]}>
                        <Text style={[typography.caption, { color: colors.brand.primary }]}>默认</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}
                    numberOfLines={2}
                  >
                    {item.province}{item.city}{item.district} {item.detail}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
              </Pressable>
            </Animated.View>
          )}
        />
      )}

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={async (session) => {
          setLoggedIn({
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            userId: session.userId,
            loginMethod: session.loginMethod,
          });
          await queryClient.invalidateQueries({ queryKey: ['addresses'] });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  defaultBadge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 14,
    marginTop: 8,
  },
});
