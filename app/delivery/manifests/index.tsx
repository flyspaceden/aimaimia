import React from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { DeliveryManifestRepo } from '../../../src/repos/delivery';
import {
  DeliveryLoading,
  DeliveryMessageState,
  DeliveryPanel,
  useDeliveryTheme,
} from '../_components';

export default function DeliveryManifestsScreen() {
  const { spacing, typography, palette } = useDeliveryTheme();
  const query = useQuery({
    queryKey: ['delivery-manifests'],
    queryFn: () => DeliveryManifestRepo.list(),
  });

  if (query.isLoading && !query.data) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="配送清单" />
        <DeliveryLoading />
      </Screen>
    );
  }

  if (!query.data || !query.data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="配送清单" />
        <DeliveryMessageState
          title="清单加载失败"
          description={query.data?.ok === false ? query.data.error.displayMessage ?? '请稍后重试' : '请稍后重试'}
          actionLabel="重新加载"
          onAction={() => query.refetch()}
          icon="file-document-alert-outline"
        />
      </Screen>
    );
  }

  const manifests = query.data.data;

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="配送清单" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
        {manifests.length === 0 ? (
          <DeliveryMessageState
            title="还没有生成配送清单"
            description="订单清单生成后会出现在这里"
            icon="file-document-outline"
          />
        ) : (
          manifests.map((manifest) => (
            <Pressable key={manifest.id} onPress={() => Linking.openURL(manifest.fileUrl)} style={{ marginBottom: spacing.md }}>
              <DeliveryPanel>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: palette.brand.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons
                      name={manifest.format === 'PDF' ? 'file-pdf-box' : 'file-excel-box'}
                      size={22}
                      color={palette.brand.primaryDark}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: palette.text.primary }]} numberOfLines={1}>
                      {manifest.title}
                    </Text>
                    <Text style={[typography.caption, { color: palette.text.secondary, marginTop: 2 }]}>
                      {manifest.type} · {manifest.status}
                    </Text>
                    <Text style={[typography.caption, { color: palette.text.tertiary, marginTop: 2 }]}>
                      {new Date(manifest.generatedAt).toLocaleString()}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={palette.text.tertiary} />
                </View>
              </DeliveryPanel>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
