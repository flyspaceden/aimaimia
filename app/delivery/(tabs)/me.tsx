import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppHeader, Screen } from '../../../src/components/layout';
import { useDeliveryAuthStore, useDeliveryCartStore } from '../../../src/store';
import {
  DeliveryButton,
  DeliveryPanel,
  useDeliveryTheme,
} from '../_components';

const tools = [
  { label: '配送订单', icon: 'clipboard-text-outline', route: '/delivery/orders' },
  { label: '配送清单', icon: 'file-document-outline', route: '/delivery/manifests' },
  { label: '配送单位', icon: 'warehouse', route: '/delivery/unit-select' },
  { label: '返回爱买买平台', icon: 'arrow-u-left-top', route: '/(tabs)/me' },
] as const;

export default function DeliveryMeScreen() {
  const router = useRouter();
  const { palette, spacing, typography } = useDeliveryTheme();
  const user = useDeliveryAuthStore((state) => state.user);
  const currentUnit = useDeliveryAuthStore((state) => state.currentUnit);
  const clearSession = useDeliveryAuthStore((state) => state.clearSession);

  const handleLogout = () => {
    useDeliveryCartStore.getState().clearLocal();
    clearSession();
    router.replace('/delivery/login');
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送我的" showBack={false} />
      <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: palette.brand.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="truck-delivery-outline" size={24} color={palette.brand.primaryDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.headingSm, { color: palette.text.primary }]}>
                {user?.nickname || user?.phone || '配送账号'}
              </Text>
              <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                {user?.phone || '未绑定手机号'}
              </Text>
            </View>
          </View>
          <View
            style={{
              marginTop: spacing.lg,
              borderTopWidth: 1,
              borderTopColor: palette.divider,
              paddingTop: spacing.lg,
            }}
          >
            <Text style={[typography.caption, { color: palette.text.secondary }]}>当前配送单位</Text>
            <Text style={[typography.bodyStrong, { color: palette.text.primary, marginTop: spacing.xs }]}>
              {currentUnit?.name || '未选择'}
            </Text>
            {currentUnit ? (
              <Text style={[typography.bodySm, { color: palette.text.secondary, marginTop: spacing.xs }]}>
                {currentUnit.contactName} · {currentUnit.contactPhone}
              </Text>
            ) : null}
          </View>
        </DeliveryPanel>

        <DeliveryPanel style={{ marginBottom: spacing.md }}>
          <Text style={[typography.headingSm, { color: palette.text.primary, marginBottom: spacing.md }]}>
            常用工具
          </Text>
          <View style={{ gap: spacing.sm }}>
            {tools.map((tool) => (
              <Pressable
                key={tool.label}
                onPress={() => router.push(tool.route)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: spacing.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: palette.brand.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name={tool.icon} size={18} color={palette.brand.primaryDark} />
                  </View>
                  <Text style={[typography.bodyStrong, { color: palette.text.primary }]}>
                    {tool.label}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={palette.text.tertiary} />
              </Pressable>
            ))}
          </View>
        </DeliveryPanel>

        <DeliveryButton label="退出配送账号" variant="ghost" icon="logout" onPress={handleLogout} />
      </ScrollView>
    </Screen>
  );
}
