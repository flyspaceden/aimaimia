import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapSdkReady, MapProvider } from '../../constants';
import { Company } from '../../types';
import { useTheme } from '../../theme';

type MapViewProps = {
  provider?: MapProvider;
  markers: Company[];
  onSelect?: (company: Company) => void;
  sdkReady?: boolean;
  /** 全屏模式：地图撑满 flex:1，不渲染底部说明文字 */
  fullScreen?: boolean;
  /** 当前选中的企业（高亮点位） */
  selectedMarker?: Company | null;
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
export const MapView = ({
  provider = 'amap',
  markers,
  onSelect,
  sdkReady = mapSdkReady,
  fullScreen = false,
  selectedMarker,
}: MapViewProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();

  const canvasStyle = fullScreen
    ? [styles.canvasFull, { backgroundColor: colors.brand.primarySoft }]
    : [styles.canvas, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.lg }];

  const containerStyle = fullScreen
    ? [styles.containerFull]
    : [styles.card, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }];

  return (
    <View style={containerStyle}>
      <View style={canvasStyle}>
        <View style={[styles.gridLine, { backgroundColor: colors.border }]} />
        <View style={[styles.gridLineVertical, { backgroundColor: colors.border }]} />

        {/* 占位提示横幅 */}
        {!sdkReady && (
          <View style={[styles.previewBanner, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>
              地图功能开发中，当前为预览模式
            </Text>
          </View>
        )}

        {markers.slice(0, MARKER_POSITIONS.length).map((company, index) => {
          const position = MARKER_POSITIONS[index];
          const isSelected = selectedMarker?.id === company.id;
          return (
            <Pressable
              key={company.id}
              onPress={() => onSelect?.(company)}
              style={[
                styles.marker,
                {
                  backgroundColor: isSelected ? colors.brand.primary : colors.accent.blue,
                  borderColor: colors.surface,
                  left: position.left,
                  top: position.top,
                  width: isSelected ? 18 : 14,
                  height: isSelected ? 18 : 14,
                },
              ]}
            >
              <View
                style={[
                  styles.markerPulse,
                  {
                    backgroundColor: isSelected ? colors.brand.primarySoft : colors.accent.blueSoft,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* 非全屏时展示底部说明文字 */}
      {!fullScreen && (
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
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    marginBottom: 16,
  },
  containerFull: {
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    height: 220,
    overflow: 'hidden',
  },
  canvasFull: {
    flex: 1,
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
  previewBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 6,
    zIndex: 10,
  },
  marker: {
    position: 'absolute',
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
