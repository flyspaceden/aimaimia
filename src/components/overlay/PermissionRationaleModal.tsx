import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

// 华为合规：申请敏感权限前先以弹窗形式同步告知用户「权限名 + 功能 + 用途」
// 弹窗不会自动消失，必须用户主动点"允许"或"取消"
//
// 用法（imperative）：
//   const granted = await showPermissionRationale({
//     permission: 'camera',
//     featureName: '拍摄头像',
//     purpose: '采集您的头像图片用于个人资料展示',
//   });
//   if (!granted) return;
//   // ...再调 ImagePicker.requestCameraPermissionsAsync()

export type PermissionType = 'camera' | 'photoLibrary' | 'microphone' | 'location' | 'storage' | 'notification';

const PERMISSION_META: Record<PermissionType, { label: string; icon: string }> = {
  camera: { label: '相机', icon: 'camera-outline' },
  photoLibrary: { label: '相册', icon: 'image-multiple-outline' },
  microphone: { label: '麦克风', icon: 'microphone-outline' },
  location: { label: '位置', icon: 'map-marker-outline' },
  storage: { label: '存储空间', icon: 'folder-outline' },
  notification: { label: '通知', icon: 'bell-outline' },
};

export interface PermissionRationaleOptions {
  permission: PermissionType;
  featureName: string;  // 例如「拍摄头像」
  purpose: string;      // 例如「采集您的头像图片用于个人资料展示」
}

export interface PermissionRationaleRef {
  show: (opts: PermissionRationaleOptions) => Promise<boolean>;
}

// 全局 ref，供 showPermissionRationale 调用
let globalRef: PermissionRationaleRef | null = null;

export async function showPermissionRationale(opts: PermissionRationaleOptions): Promise<boolean> {
  if (!globalRef) {
    // 容错：组件未挂载时直接放行（开发环境提示）
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[PermissionRationale] 组件未挂载，跳过 rationale 直接申请权限');
    }
    return true;
  }
  return globalRef.show(opts);
}

export const PermissionRationaleModal = forwardRef<PermissionRationaleRef, {}>((_props, ref) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();

  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<PermissionRationaleOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const show = useCallback((options: PermissionRationaleOptions) => {
    return new Promise<boolean>((resolve) => {
      // 防竞态：若上一个 rationale 还未解决就被新调用覆盖，先把旧 Promise resolve(false) 释放，
      // 否则旧的 await showPermissionRationale() 会永远悬挂
      if (resolverRef.current) {
        resolverRef.current(false);
      }
      resolverRef.current = resolve;
      setOpts(options);
      setOpen(true);
    });
  }, []);

  useImperativeHandle(ref, () => ({ show }), [show]);

  useEffect(() => {
    globalRef = { show };
    return () => {
      globalRef = null;
      // 卸载兜底：若 Modal 卸载时仍有未解决的 resolver，释放为 false，避免业务 await 悬挂
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, [show]);

  const handleAllow = useCallback(() => {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  }, []);

  const handleDeny = useCallback(() => {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  }, []);

  if (!opts) return null;

  const meta = PERMISSION_META[opts.permission];

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={handleDeny} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[
            styles.card,
            shadow.lg,
            { backgroundColor: colors.surface, borderRadius: radius['2xl'] ?? 20 },
          ]}
        >
          <LinearGradient
            colors={[colors.brand.primary, colors.ai.start, colors.ai.end]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[
              styles.topStripe,
              {
                borderTopLeftRadius: radius['2xl'] ?? 20,
                borderTopRightRadius: radius['2xl'] ?? 20,
              },
            ]}
          />

          <View style={styles.content}>
            {/* 顶部图标 */}
            <View style={[styles.iconBox, { backgroundColor: `${colors.brand.primary}15` }]}>
              <MaterialCommunityIcons name={meta.icon as any} size={28} color={colors.brand.primary} />
            </View>

            {/* 主标题：申请「相机」权限 */}
            <Text style={[typography.title3, { color: colors.text.primary, marginTop: spacing.md, textAlign: 'center' }]}>
              申请「{meta.label}」权限
            </Text>

            {/* 服务功能 */}
            <View style={[styles.row, { backgroundColor: colors.bgSecondary, borderRadius: radius.md, marginTop: spacing.md }]}>
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginBottom: 4 }]}>
                所属功能
              </Text>
              <Text style={[typography.body, { color: colors.text.primary, fontWeight: '600' }]}>
                {opts.featureName}
              </Text>
            </View>

            {/* 使用目的 */}
            <View style={[styles.row, { backgroundColor: colors.bgSecondary, borderRadius: radius.md, marginTop: spacing.sm }]}>
              <Text style={[typography.captionSm, { color: colors.text.secondary, marginBottom: 4 }]}>
                使用目的
              </Text>
              <Text style={[typography.body, { color: colors.text.primary, lineHeight: 20 }]}>
                {opts.purpose}
              </Text>
            </View>

            {/* 提示语：仅在使用时调用，可随时在系统设置中关闭 */}
            <Text style={[typography.captionSm, { color: colors.muted, marginTop: spacing.md, textAlign: 'center' }]}>
              本权限仅在使用相关功能时申请，您可随时在系统设置中关闭。
            </Text>

            {/* 按钮 */}
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Pressable onPress={handleAllow}>
                <LinearGradient
                  colors={[colors.brand.primary, colors.brand.primaryLight]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.primaryBtn, { borderRadius: radius.pill }]}
                >
                  <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                    允许
                  </Text>
                </LinearGradient>
              </Pressable>

              <Pressable
                onPress={handleDeny}
                style={[styles.secondaryBtn, { borderColor: colors.border, borderRadius: radius.pill }]}
              >
                <Text style={[typography.body, { color: colors.text.secondary }]}>取消</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
});

PermissionRationaleModal.displayName = 'PermissionRationaleModal';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  topStripe: {
    height: 4,
  },
  content: {
    padding: 20,
    paddingTop: 24,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  row: {
    padding: 12,
  },
  primaryBtn: {
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1,
  },
});
