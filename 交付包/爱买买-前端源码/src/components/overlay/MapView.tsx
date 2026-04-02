import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapProviders, mapSdkReady, MapProvider } from '../../constants';
import { Company } from '../../types';
import { useTheme } from '../../theme';

type MapViewProps = {
  provider?: MapProvider;
  markers: Company[];
  onSelect?: (company: Company) => void;
  sdkReady?: boolean;
};

type Percent = `${number}%`;

const MARKER_POSITIONS: Array<{ left: Percent; top: Percent }> = [
  { left: '16%', top: '32%' },
  { left: '42%', top: '28%' },
  { left: '68%', top: '40%' },
  { left: '28%', top: '62%' },
  { left: '58%', top: '66%' },
];

// 地图容器：高德/腾讯占位展示企业点位（后续接真实地图 SDK）
export const MapView = ({ provider = 'amap', markers, onSelect, sdkReady = mapSdkReady }: MapViewProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const providerLabel = mapProviders.find((item) => item.value === provider)?.label ?? '地图';
  const providerStatus = sdkReady ? '已接入' : '占位';

  return (
    <View style={[styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
      <View style={[styles.canvas, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.lg }]}>
        <View style={[styles.gridLine, { backgroundColor: colors.border }]} />
        <View style={[styles.gridLineVertical, { backgroundColor: colors.border }]} />
        <View style={[styles.providerTag, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>
            {providerLabel} · {providerStatus}
          </Text>
        </View>
        {markers.slice(0, MARKER_POSITIONS.length).map((company, index) => {
          const position = MARKER_POSITIONS[index];
          return (
            <Pressable
              key={company.id}
              onPress={() => onSelect?.(company)}
              style={[
                styles.marker,
                {
                  backgroundColor: colors.accent.blue,
                  borderColor: colors.surface,
                  left: position.left,
                  top: position.top,
                },
              ]}
            >
              <View style={[styles.markerPulse, { backgroundColor: colors.accent.blueSoft }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={{ padding: spacing.md }}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
          企业点位（{markers.length}）
        </Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
          点击地图点位可查看企业详情
        </Text>
        {!sdkReady ? (
          <Text style={[typography.caption, { color: colors.muted, marginTop: 4 }]}>
            接入真实地图需构建 Dev Client 并配置 SDK Key
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    marginBottom: 16,
  },
  canvas: {
    height: 220,
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    height: 1,
    width: '100%',
    top: '50%',
    opacity: 0.5,
  },
  gridLineVertical: {
    position: 'absolute',
    width: 1,
    height: '100%',
    left: '50%',
    opacity: 0.5,
  },
  providerTag: {
    position: 'absolute',
    top: 12,
    left: 12,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  marker: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerPulse: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 999,
    opacity: 0.35,
  },
});
