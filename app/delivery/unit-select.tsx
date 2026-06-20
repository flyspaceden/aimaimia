import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { DeliveryUnitRepo } from '../../src/repos/delivery';
import { useDeliveryAuthStore, useDeliveryCartStore } from '../../src/store';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  useDeliveryTheme,
} from './_components';

export default function DeliveryUnitSelectScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const currentUnitId = useDeliveryAuthStore((state) => state.currentUnitId);
  const setCurrentUnit = useDeliveryAuthStore((state) => state.setCurrentUnit);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['delivery-units'],
    queryFn: () => DeliveryUnitRepo.list(),
  });

  const units = data?.ok ? data.data.items : [];

  const handleSelect = async (id: string) => {
    const result = await DeliveryUnitRepo.select(id);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '切换单位失败', type: 'error' });
      return;
    }

    const nextUnit = units.find((unit) => unit.id === id) ?? null;
    useDeliveryCartStore.getState().clearLocal();
    setCurrentUnit(nextUnit);
    await queryClient.invalidateQueries({ queryKey: ['delivery-cart'] });
    router.replace('/delivery/(tabs)/products');
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="选择配送单位" />
        <DeliveryLoading />
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="选择配送单位" />
        <DeliveryMessageState
          title="配送单位加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          actionLabel="重新加载"
          onAction={refetch}
          icon="warehouse"
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="选择配送单位" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
        {units.length === 0 ? (
          <DeliveryMessageState
            title="还没有配送单位"
            description="先补一条单位信息，再进入配送商品页"
            actionLabel="新增单位"
            onAction={() => router.push('/delivery/unit-edit')}
            icon="map-marker-plus-outline"
          />
        ) : (
          <>
            {units.map((unit) => {
              const active = unit.id === (currentUnitId || data.data.currentUnitId);
              return (
                <DeliveryPanel key={unit.id} style={{ marginBottom: spacing.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Text style={[typography.headingSm, { color: palette.text.primary, flex: 1 }]}>
                          {unit.name}
                        </Text>
                        {active ? (
                          <View
                            style={{
                              paddingHorizontal: spacing.sm,
                              paddingVertical: spacing.xs,
                              borderRadius: 999,
                              backgroundColor: palette.brand.primarySoft,
                            }}
                          >
                            <Text style={[typography.captionSm, { color: palette.brand.primaryDark }]}>
                              当前单位
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.sm }]}>
                        {unit.contactName} · {unit.contactPhone}
                      </Text>
                      <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                        {unit.provinceName} {unit.cityName} {unit.districtName} {unit.detailAddress}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => router.push({ pathname: '/delivery/unit-edit', params: { id: unit.id } })}
                      style={{ alignSelf: 'flex-start', padding: 4 }}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={18} color={palette.text.secondary} />
                    </Pressable>
                  </View>
                  <DeliveryButton
                    label={active ? '进入商品页' : '切换到该单位'}
                    variant={active ? 'secondary' : 'primary'}
                    onPress={() => handleSelect(unit.id)}
                    style={{ marginTop: spacing.lg }}
                  />
                </DeliveryPanel>
              );
            })}
            <DeliveryButton
              label="新增单位"
              variant="ghost"
              icon="plus"
              onPress={() => router.push('/delivery/unit-edit')}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
