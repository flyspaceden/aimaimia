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
import { showPermissionRationale } from '../../src/components/overlay/PermissionRationaleModal';
import { BonusRepo, GrowthRepo } from '../../src/repos';
import { useBottomInset, useTheme } from '../../src/theme';
import { getReferralInviterLabel } from '../../src/utils/referralRelation';

const SCAN_BOX_SIZE = 250;
const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;
type ScannedInviteCode = { type: 'vip' | 'normal' | 'auto'; code: string };
type ResolvedInviteCodeType = 'vip' | 'normal';
type BindInviteCodeResult = {
  ok: boolean;
  data?: unknown;
  error?: { displayMessage?: string; message?: string; retryable?: boolean };
  resolvedType: ResolvedInviteCodeType;
};

const withResolvedType = (result: any, resolvedType: ResolvedInviteCodeType): BindInviteCodeResult => ({
  ...result,
  resolvedType,
});

const shouldTryNormalShareFallback = (result: any) => {
  if (result?.ok || result?.error?.retryable) return false;
  const message = `${result?.error?.displayMessage ?? ''}${result?.error?.message ?? ''}`;
  return message.includes('推荐码无效');
};

const shouldTryVipReferralFallback = (result: any) => {
  if (result?.ok || result?.error?.retryable) return false;
  const message = `${result?.error?.displayMessage ?? ''}${result?.error?.message ?? ''}`;
  return message.includes('普通分享码无效');
};

// 二维码扫描页
export default function ScannerScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const bottomAreaPadding = useBottomInset(32);
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const [permission, requestPermission] = useCameraPermissions();

  // 华为合规：申请相机权限前先以弹窗形式同步告知权限用途
  const handleRequestCameraPermission = useCallback(async () => {
    const userAgreed = await showPermissionRationale({
      permission: 'camera',
      featureName: '扫描推荐码二维码',
      purpose: '使用相机扫描他人分享的推荐码二维码，以快速绑定推荐关系',
    });
    if (!userAgreed) return;
    await requestPermission();
  }, [requestPermission]);
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

  // 绑定推荐码/普通分享码
  const bindInviteCode = async (payload: ScannedInviteCode): Promise<BindInviteCodeResult> => {
    if (payload.type === 'normal') {
      const result = await GrowthRepo.bindNormalShareCode(payload.code);
      return withResolvedType(result, 'normal');
    }
    if (payload.type === 'auto' && payload.code.startsWith('S')) {
      const normalResult = await GrowthRepo.bindNormalShareCode(payload.code);
      if (normalResult.ok || !shouldTryVipReferralFallback(normalResult)) {
        return withResolvedType(normalResult, 'normal');
      }
      const vipResult = await BonusRepo.useReferralCode(payload.code);
      return withResolvedType(vipResult, 'vip');
    }
    const vipResult = await BonusRepo.useReferralCode(payload.code);
    if (payload.type === 'auto' && shouldTryNormalShareFallback(vipResult)) {
      const normalResult = await GrowthRepo.bindNormalShareCode(payload.code);
      return withResolvedType(normalResult, 'normal');
    }
    return withResolvedType(vipResult, 'vip');
  };

  const bindMutation = useMutation<BindInviteCodeResult, Error, ScannedInviteCode>({
    mutationFn: bindInviteCode,
    onSuccess: (result, payload) => {
      if (result.ok) {
        const resolvedType = result.resolvedType ?? (payload.type === 'normal' ? 'normal' : 'vip');
        const inviterName = resolvedType === 'vip'
          ? getReferralInviterLabel(result.data as any)
          : null;
        show({
          message: inviterName
            ? `已绑定推荐人：${inviterName}`
            : resolvedType === 'normal'
              ? '普通分享码绑定成功'
              : '推荐码绑定成功！',
          type: 'success',
        });
        queryClient.invalidateQueries({ queryKey: ['bonus-member'] });
        queryClient.invalidateQueries({ queryKey: ['growth-me'] });
        queryClient.invalidateQueries({ queryKey: ['normal-share-records'] });
        queryClient.invalidateQueries({ queryKey: ['normal-share-stats'] });
        router.back();
      } else {
        show({ message: result.error?.displayMessage ?? '绑定失败，请稍后重试', type: 'error' });
        setScanned(false);
      }
    },
    onError: () => {
      show({ message: '网络异常，请重试', type: 'error' });
      setScanned(false);
    },
  });

  // 从扫描结果中解析推荐码
  const parseInviteCode = (data: string): ScannedInviteCode | null => {
    // 新 H5 邀请页不区分普通码/VIP 码，交给 auto fallback 判断。
    const unifiedUrlMatch = data.match(/app\.(ai-maimai|xn--ckqa175y)\.com\/invite\/([A-Za-z0-9]{8})/);
    if (unifiedUrlMatch) return { type: 'auto', code: unifiedUrlMatch[2].toUpperCase() };
    // 兼容旧 URL 格式: https://app.ai-maimai.com/r/CODE（兼容旧域名 app.xn--ckqa175y.com）
    const vipUrlMatch = data.match(/app\.(ai-maimai|xn--ckqa175y)\.com\/r\/([A-Za-z0-9]{8})/);
    if (vipUrlMatch) return { type: 'vip', code: vipUrlMatch[2].toUpperCase() };
    const normalUrlMatch = data.match(/app\.(ai-maimai|xn--ckqa175y)\.com\/s\/([A-Za-z0-9]{8})/);
    if (normalUrlMatch) return { type: 'normal', code: normalUrlMatch[2].toUpperCase() };
    // 纯文本 8 位码无法从格式判断类型，S 开头优先普通分享码，否则优先 VIP 推荐码。
    const codeMatch = data.match(/^[A-Za-z0-9]{8}$/);
    if (codeMatch) return { type: 'auto', code: data.toUpperCase() };
    return null;
  };

  const parseGroupBuyCode = (data: string): string | null => {
    const urlMatch = data.match(/app\.ai-maimai\.com\/gb\/([A-Z2-9]{10})/i);
    if (urlMatch) return urlMatch[1].toUpperCase();
    return null;
  };

  // 扫描回调
  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanned || bindMutation.isPending) return;
      const groupBuyCode = parseGroupBuyCode(data);
      if (groupBuyCode) {
        setScanned(true);
        router.push({ pathname: '/gb/[code]' as any, params: { code: groupBuyCode } });
        return;
      }
      const inviteCode = parseInviteCode(data);
      if (!inviteCode) {
        show({ message: '未识别到有效推荐码或普通分享码', type: 'info' });
        return;
      }
      setScanned(true);
      bindMutation.mutate(inviteCode);
    },
    [scanned, bindMutation, show],
  );

  // 手动输入提交
  const handleManualSubmit = () => {
    const trimmed = manualCode.trim().toUpperCase();
    if (trimmed.length !== 8) {
      show({ message: '请输入 8 位推荐码或普通分享码', type: 'info' });
      return;
    }
    setSheetOpen(false);
    setScanned(true);
    bindMutation.mutate({ type: 'auto', code: trimmed });
  };

  const renderManualInputSheet = () => (
    <AppBottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="手动输入推荐码或普通分享码">
      <TextInput
        ref={inputRef}
        value={manualCode}
        onChangeText={(text) => setManualCode(text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
        placeholder="请输入 8 位推荐码或普通分享码"
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
  );

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
            扫描推荐码或普通分享码二维码需要使用相机，请授权相机访问权限
          </Text>
          <Pressable
            onPress={handleRequestCameraPermission}
            style={[styles.permissionBtn, { backgroundColor: colors.brand.primary, borderRadius: radius.pill, marginTop: spacing.xl }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>授权相机</Text>
          </Pressable>
          <Pressable
            onPress={() => setSheetOpen(true)}
            style={[styles.permissionBtn, { borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, marginTop: spacing.md }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.brand.primary }]}>
              没有相机权限也可以手动输入
            </Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }}>
            <Text style={[typography.bodySm, { color: colors.muted }]}>返回</Text>
          </Pressable>
        </View>
        {renderManualInputSheet()}
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
          <Text style={[typography.bodyStrong, { color: '#FFFFFF' }]}>扫码绑定</Text>
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
        <View style={[styles.bottomArea, { paddingBottom: bottomAreaPadding }]}>
          <Text style={[typography.bodySm, { color: 'rgba(255,255,255,0.8)', textAlign: 'center' }]}>
            将推荐码或普通分享码二维码放入框内
          </Text>
          <Pressable onPress={() => setSheetOpen(true)} style={{ marginTop: spacing.md }}>
            <Text style={[typography.bodySm, { color: colors.ai.end, textAlign: 'center' }]}>
              手动输入推荐码或普通分享码
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 手动输入抽屉 */}
      {renderManualInputSheet()}
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
    paddingTop: 32,
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
