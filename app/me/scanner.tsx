import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback';
import { AppBottomSheet } from '../../src/components/overlay';
import { BonusRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';

const SCAN_BOX_SIZE = 250;
const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

// 二维码扫描页
export default function ScannerScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const inputRef = useRef<TextInput>(null);

  // 扫描线动画
  const scanLineY = useSharedValue(0);
  useEffect(() => {
    scanLineY.value = withRepeat(
      withTiming(SCAN_BOX_SIZE - 4, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [scanLineY]);

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanLineY.value }],
  }));

  // 绑定推荐码
  const bindMutation = useMutation({
    mutationFn: (code: string) => BonusRepo.useReferralCode(code),
    onSuccess: (result) => {
      if (result.ok) {
        show({ message: '推荐码绑定成功！', type: 'success' });
        queryClient.invalidateQueries({ queryKey: ['bonus-member'] });
        router.back();
      } else {
        show({ message: result.error.displayMessage ?? '绑定失败，请稍后重试', type: 'error' });
        setScanned(false);
      }
    },
    onError: () => {
      show({ message: '网络异常，请重试', type: 'error' });
      setScanned(false);
    },
  });

  // 从扫描结果中解析推荐码
  const parseReferralCode = (data: string): string | null => {
    // 支持 URL 格式: https://app.xn--ckqa175y.com/r/CODE
    const urlMatch = data.match(/app\.xn--ckqa175y\.com\/r\/([A-Za-z0-9]{8})/);
    if (urlMatch) return urlMatch[1].toUpperCase();
    // 纯文本 8 位码
    const codeMatch = data.match(/^[A-Za-z0-9]{8}$/);
    if (codeMatch) return data.toUpperCase();
    return null;
  };

  // 扫描回调
  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanned || bindMutation.isPending) return;
      const code = parseReferralCode(data);
      if (!code) {
        show({ message: '未识别到有效推荐码', type: 'info' });
        return;
      }
      setScanned(true);
      bindMutation.mutate(code);
    },
    [scanned, bindMutation, show],
  );

  // 手动输入提交
  const handleManualSubmit = () => {
    const trimmed = manualCode.trim().toUpperCase();
    if (trimmed.length !== 8) {
      show({ message: '请输入 8 位推荐码', type: 'info' });
      return;
    }
    setSheetOpen(false);
    setScanned(true);
    bindMutation.mutate(trimmed);
  };

  // 权限未授予 — 显示说明页
  if (!permission?.granted) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <View style={styles.permissionContainer}>
          <MaterialCommunityIcons name="camera-off-outline" size={64} color={colors.muted} />
          <Text style={[typography.headingSm, { color: colors.text.primary, marginTop: spacing.lg, textAlign: 'center' }]}>
            需要相机权限
          </Text>
          <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: spacing.sm, textAlign: 'center' }]}>
            扫描推荐码二维码需要使用相机，请授权相机访问权限
          </Text>
          <Pressable
            onPress={requestPermission}
            style={[styles.permissionBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.pill, marginTop: spacing.xl }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>授权相机</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
            <Text style={[typography.bodySm, { color: colors.muted }]}>返回</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }} safeAreaTop={false} safeAreaBottom={false}>
      {/* 全屏相机 */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchOn}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* 暗色遮罩 + 扫描框 */}
      <View style={styles.overlay}>
        {/* 顶部导航栏 */}
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.navBtn}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="#FFFFFF" />
          </Pressable>
          <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>扫描推荐码</Text>
          <Pressable onPress={() => setTorchOn(!torchOn)} hitSlop={10} style={styles.navBtn}>
            <MaterialCommunityIcons
              name={torchOn ? 'flashlight' : 'flashlight-off'}
              size={22}
              color="#FFFFFF"
            />
          </Pressable>
        </View>

        {/* 中部扫描区 */}
        <View style={styles.scanArea}>
          {/* 上方遮罩 */}
          <View style={styles.maskFill} />

          <View style={styles.scanRow}>
            {/* 左遮罩 */}
            <View style={styles.maskFill} />

            {/* 扫描框 */}
            <View style={styles.scanBox}>
              {/* 4 角标 */}
              <View style={[styles.corner, styles.cornerTL, { borderColor: colors.ai.end }]} />
              <View style={[styles.corner, styles.cornerTR, { borderColor: colors.ai.end }]} />
              <View style={[styles.corner, styles.cornerBL, { borderColor: colors.ai.end }]} />
              <View style={[styles.corner, styles.cornerBR, { borderColor: colors.ai.end }]} />

              {/* 扫描线 */}
              <Animated.View style={[styles.scanLine, { backgroundColor: colors.ai.end }, scanLineStyle]} />
            </View>

            {/* 右遮罩 */}
            <View style={styles.maskFill} />
          </View>

          {/* 下方遮罩 */}
          <View style={styles.maskFill} />
        </View>

        {/* 底部提示 */}
        <View style={styles.bottomArea}>
          <Text style={[typography.bodySm, { color: 'rgba(255,255,255,0.8)', textAlign: 'center' }]}>
            将推荐码二维码放入框内
          </Text>
          <Pressable onPress={() => setSheetOpen(true)} style={{ marginTop: spacing.md }}>
            <Text style={[typography.bodySm, { color: colors.ai.end, textAlign: 'center' }]}>
              手动输入推荐码
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 手动输入抽屉 */}
      <AppBottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="手动输入推荐码">
        <TextInput
          ref={inputRef}
          value={manualCode}
          onChangeText={(text) => setManualCode(text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
          placeholder="请输入 8 位推荐码"
          placeholderTextColor={colors.muted}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[
            styles.manualInput,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: radius.lg,
              color: colors.text.primary,
              fontSize: 18,
              letterSpacing: 4,
            },
          ]}
        />
        <Pressable
          onPress={handleManualSubmit}
          disabled={bindMutation.isPending}
        >
          <View
            style={[
              styles.submitBtn,
              {
                backgroundColor: colors.brand.primary,
                borderRadius: radius.pill,
                opacity: bindMutation.isPending ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>
              {bindMutation.isPending ? '绑定中...' : '确认绑定'}
            </Text>
          </View>
        </Pressable>
      </AppBottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 权限页
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  // 遮罩层
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  navBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 扫描区域布局
  scanArea: {
    flex: 1,
  },
  scanRow: {
    flexDirection: 'row',
    height: SCAN_BOX_SIZE,
  },
  maskFill: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  scanBox: {
    width: SCAN_BOX_SIZE,
    height: SCAN_BOX_SIZE,
    position: 'relative',
  },
  // 角标
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
  },
  // 扫描线
  scanLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 2,
    borderRadius: 1,
    opacity: 0.8,
  },
  // 底部区域
  bottomArea: {
    paddingVertical: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  // 手动输入
  manualInput: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  submitBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 16,
  },
});
