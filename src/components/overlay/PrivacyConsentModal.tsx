import React, { useCallback, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTheme } from '../../theme';
import { acceptPrivacyConsent } from '../../services/privacyConsent';

type Props = {
  open: boolean;
  onAgree: () => void;
};

// 首启隐私合规弹窗
// 根据工信部《App 个人信息保护管理规定》要求：
// - 首次启动时显著方式弹出
// - 必须能让用户查阅完整文本
// - 必须提供"同意"和"不同意"两个选项
// - 未同意前不得进入主功能
export const PrivacyConsentModal = ({ open, onAgree }: Props) => {
  const { colors, radius, spacing, typography, shadow } = useTheme();
  const router = useRouter();
  const [declined, setDeclined] = useState(false);

  const handleAgree = useCallback(async () => {
    await acceptPrivacyConsent();
    onAgree();
  }, [onAgree]);

  // 不同意：二次确认，退出 App（Android 可以，iOS 无法主动退出）
  const handleDecline = useCallback(() => {
    setDeclined(true);
  }, []);

  const handleReconsider = useCallback(() => {
    setDeclined(false);
  }, []);

  const handleExit = useCallback(() => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    }
    // iOS 无法编程退出，保持遮罩阻断
  }, []);

  const openPrivacy = useCallback(() => {
    router.push('/privacy');
  }, [router]);

  const openTerms = useCallback(() => {
    router.push('/terms');
  }, [router]);

  if (!open) return null;

  // Web 端 React Native <Modal> 渲染异常（遮罩可见但卡片不可交互），改用绝对定位 View
  const isWeb = Platform.OS === 'web';

  const content = (
    <View style={[styles.backdrop, isWeb && styles.backdropWeb]}>
      <Animated.View
        entering={FadeIn.duration(250)}
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

          {declined ? (
            // 二次确认：再次阅读 或 退出
            <View style={styles.content}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>温馨提示</Text>
              <Text
                style={[
                  typography.body,
                  { color: colors.text.secondary, marginTop: spacing.md, lineHeight: 22 },
                ]}
              >
                若您不同意《用户协议》和《隐私政策》，爱买买将无法为您提供服务。您可以再次阅读后决定，或退出 App。
              </Text>

              <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                <Pressable onPress={handleReconsider}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.brand.primaryLight]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryBtn, { borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                      再次查看
                    </Text>
                  </LinearGradient>
                </Pressable>

                <Pressable
                  onPress={handleExit}
                  style={[
                    styles.secondaryBtn,
                    { borderColor: colors.border, borderRadius: radius.pill },
                  ]}
                >
                  <Text style={[typography.body, { color: colors.text.secondary }]}>
                    {Platform.OS === 'android' ? '仍不同意并退出' : '仍不同意'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            // 主弹窗：摘要 + 完整文本入口 + 同意/不同意
            <View style={styles.content}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>欢迎使用爱买买</Text>
              <Text
                style={[
                  typography.captionSm,
                  { color: colors.text.secondary, marginTop: 4 },
                ]}
              >
                请先阅读并同意以下条款
              </Text>

              <ScrollView
                style={[
                  styles.summaryBox,
                  { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, marginTop: spacing.md },
                ]}
                contentContainerStyle={{ padding: 12 }}
                showsVerticalScrollIndicator
              >
                <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 20 }]}>
                  我们非常重视您的个人信息保护，在您使用爱买买前，请认真阅读
                  <Text style={{ color: colors.brand.primary, fontWeight: '600' }} onPress={openTerms}>
                    《用户协议》
                  </Text>
                  和
                  <Text style={{ color: colors.brand.primary, fontWeight: '600' }} onPress={openPrivacy}>
                    《隐私政策》
                  </Text>
                  。您需要重点了解：
                </Text>
                <Text
                  style={[
                    typography.bodySm,
                    { color: colors.text.secondary, marginTop: 8, lineHeight: 20 },
                  ]}
                >
                  1. 我们会在您使用注册登录、下单支付、物流配送、客服咨询、AI 助手等功能时，在征得您同意的前提下收集必要的个人信息。
                  {'\n'}
                  2. 敏感个人信息（如手机号、身份证号、人脸图像、精确位置、支付信息）会单独告知并获取您的同意，仅用于身份核验、交易履约和法定义务。
                  {'\n'}
                  3. 我们会将订单信息共享给商家和物流公司以完成交易，支付交由持牌支付机构处理，AI 内容会脱敏后提交给合作服务商。
                  {'\n'}
                  4. 您可以随时在 App 设置中查阅、更正、删除您的信息，撤回同意，或注销账号。
                  {'\n'}
                  5. 我们不会将您的个人信息用于与上述目的无关的用途，也不会在未经您同意的情况下向第三方提供。
                </Text>
                <Text
                  style={[
                    typography.captionSm,
                    { color: colors.text.secondary, marginTop: 8, fontStyle: 'italic' },
                  ]}
                >
                  点击上方蓝色文字可查看完整条款。
                </Text>
              </ScrollView>

              <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                <Pressable onPress={handleAgree}>
                  <LinearGradient
                    colors={[colors.brand.primary, colors.brand.primaryLight]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primaryBtn, { borderRadius: radius.pill }]}
                  >
                    <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>
                      同意并继续
                    </Text>
                  </LinearGradient>
                </Pressable>

                <Pressable
                  onPress={handleDecline}
                  style={[
                    styles.secondaryBtn,
                    { borderColor: colors.border, borderRadius: radius.pill },
                  ]}
                >
                  <Text style={[typography.body, { color: colors.text.secondary }]}>不同意</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
  );

  if (isWeb) return content;

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => {}}>
      {content}
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  backdropWeb: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  } as any,
  card: {
    width: '100%',
    maxWidth: 360,
    overflow: 'hidden',
  },
  topStripe: {
    height: 4,
  },
  content: {
    padding: 20,
  },
  summaryBox: {
    maxHeight: 260,
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
