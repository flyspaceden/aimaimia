import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { useTheme } from '../../src/theme';

const mockTimeline = [
  { id: 't1', time: '今天 09:20', status: '包裹已揽收', location: '上海转运中心' },
  { id: 't2', time: '昨天 18:40', status: '已发货', location: '青禾农场仓库' },
  { id: 't3', time: '昨天 10:10', status: '订单已出库', location: '青禾农场' },
];

export default function OrderTrackScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="物流追踪" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={[styles.heroCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>订单#20250112</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            当前状态：运输中（占位）
          </Text>
          <View style={[styles.mapPlaceholder, { backgroundColor: colors.border }]}>
            <MaterialCommunityIcons name="map-outline" size={22} color={colors.text.secondary} />
            <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 6 }]}>物流轨迹地图占位</Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>物流节点</Text>
          {mockTimeline.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.timelineRow,
                shadow.sm,
                { backgroundColor: colors.surface, borderRadius: radius.lg },
              ]}
            >
              <View style={styles.timelineLeft}>
                <View style={[styles.dot, { backgroundColor: index === 0 ? colors.brand.primary : colors.border }]} />
                {index !== mockTimeline.length - 1 ? (
                  <View style={[styles.line, { backgroundColor: colors.border }]} />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{item.status}</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{item.location}</Text>
                <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>{item.time}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.title3, { color: colors.text.primary }]}>产地实景联动</Text>
          <View style={[styles.heroCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text style={[typography.body, { color: colors.text.secondary }]}>
              未来将展示企业展览馆的产地实景与检验报告（占位）。
            </Text>
            <Pressable style={[styles.cta, { borderColor: colors.brand.primary, borderRadius: radius.pill }]}>
              <Text style={[typography.caption, { color: colors.brand.primary }]}>查看企业展览馆</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  mapPlaceholder: {
    marginTop: 12,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  timelineRow: {
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 12,
    flexDirection: 'row',
  },
  timelineLeft: {
    width: 24,
    alignItems: 'center',
    marginRight: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  line: {
    width: 2,
    flex: 1,
    marginTop: 4,
  },
  cta: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
});

