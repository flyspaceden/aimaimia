// src/components/overlay/VoiceOverlay.tsx
import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  SlideInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import type { AiVoiceIntent } from '../../types/domain/Ai';

// 波形动画条
const WAVE_BARS = [
  { base: 8, peak: 20, delay: 0 },
  { base: 14, peak: 24, delay: 80 },
  { base: 20, peak: 10, delay: 160 },
  { base: 12, peak: 22, delay: 240 },
  { base: 16, peak: 8, delay: 120 },
  { base: 10, peak: 18, delay: 200 },
  { base: 18, peak: 14, delay: 40 },
];

function AnimatedWaveBar({ base, peak, delay, color }: { base: number; peak: number; delay: number; color: string }) {
  const height = useSharedValue(base);
  useEffect(() => {
    height.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(peak, { duration: 300 }),
          withTiming(base, { duration: 300 }),
        ),
        -1, // 无限循环
        true,
      ),
    );
  }, [base, peak, delay, height]);

  const animStyle = useAnimatedStyle(() => ({ height: height.value }));

  return (
    <Animated.View style={[styles.waveBar, { backgroundColor: color }, animStyle]} />
  );
}

type VoiceOverlayProps = {
  isRecording: boolean;
  isProcessing: boolean;
  feedbackVisible: boolean;
  feedbackText: string;
  userTranscript?: string;
  actionLabel?: string | null;
  onActionPress?: () => void;
  onContinueChat?: () => void;
  onDismiss?: () => void;
  clarifyIntent?: AiVoiceIntent | null;
  onClarifySelect?: (candidateId: string) => void;
  anchorBottom: number;
};

export function VoiceOverlay({
  isRecording,
  isProcessing,
  feedbackVisible,
  feedbackText,
  userTranscript,
  actionLabel,
  onActionPress,
  onContinueChat,
  onDismiss,
  clarifyIntent,
  onClarifySelect,
  anchorBottom,
}: VoiceOverlayProps) {
  const { colors, radius, typography, shadow } = useTheme();

  // ── 状态 1：录音中 ──
  if (isRecording) {
    return (
      <Animated.View
        entering={FadeInUp.duration(200)}
        exiting={FadeOutDown.duration(150)}
        style={[
          styles.recordingCard,
          shadow.md,
          {
            bottom: anchorBottom + 8,
            backgroundColor: colors.surface,
            borderColor: colors.ai.start,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.recordingHeader}>
          <View style={[styles.micIcon, { backgroundColor: colors.ai.start }]}>
            <Text style={{ fontSize: 14 }}>🎤</Text>
          </View>
          <Text style={[typography.bodySm, { color: colors.ai.start, fontWeight: '600' }]}>
            正在听...
          </Text>
        </View>
        {/* 波形动画条 */}
        <View style={styles.waveformRow}>
          {WAVE_BARS.map((bar, i) => (
            <AnimatedWaveBar key={i} base={bar.base} peak={bar.peak} delay={bar.delay} color={colors.ai.start} />
          ))}
        </View>
        <Text style={[typography.caption, { color: colors.text.tertiary, textAlign: 'center', marginTop: 4 }]}>
          松开结束
        </Text>
      </Animated.View>
    );
  }

  // ── 状态 1.5：处理中 ──
  if (isProcessing && !feedbackVisible) {
    return (
      <Animated.View
        entering={FadeIn.duration(150)}
        exiting={FadeOut.duration(150)}
        style={[
          styles.recordingCard,
          shadow.md,
          {
            bottom: anchorBottom + 8,
            backgroundColor: colors.surface,
            borderColor: colors.ai.start,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.recordingHeader}>
          <View style={[styles.micIcon, { backgroundColor: colors.ai.start }]}>
            <Text style={{ fontSize: 14 }}>🎤</Text>
          </View>
          <Text style={[typography.bodySm, { color: colors.ai.start, fontWeight: '600' }]}>
            识别中...
          </Text>
        </View>
        {/* 三点跳动 */}
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: colors.ai.start }]}
            />
          ))}
        </View>
      </Animated.View>
    );
  }

  // ── 状态 2：反馈浮层 ──
  if (!feedbackVisible) return null;

  const hasClarify = clarifyIntent?.clarify?.candidates && clarifyIntent.clarify.candidates.length > 0;
  const hasContinueChat = !!onContinueChat;

  // 使用 Modal 让反馈浮层渲染到原生层级，逃出 AiFloatingCompanion wrapper 的坐标系
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <Animated.View
        entering={SlideInUp.duration(300)}
        exiting={FadeOut.duration(200)}
        style={styles.feedbackContainer}
      >
        {/* 半透明遮罩 */}
        <Pressable style={styles.feedbackBackdrop} onPress={onDismiss} />

      <View style={[styles.feedbackContent, { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }]}>
        {/* 用户原话 */}
        {userTranscript ? (
          <View style={styles.transcriptRow}>
            <View style={[styles.transcriptDot, { backgroundColor: colors.ai.start }]} />
            <Text style={[typography.caption, { color: colors.text.tertiary, flex: 1 }]}>
              "{userTranscript}"
            </Text>
          </View>
        ) : null}

        {/* AI 回复卡片 */}
        <View style={[styles.aiReplyCard, { borderColor: `${colors.ai.start}40`, backgroundColor: `${colors.ai.start}08` }]}>
          <View style={styles.aiReplyHeader}>
            <View style={[styles.aiAvatar, { backgroundColor: colors.ai.start }]}>
              <Text style={{ fontSize: 10 }}>🌿</Text>
            </View>
            <Text style={[typography.caption, { color: colors.ai.start, fontWeight: '600' }]}>
              AI 农管家
            </Text>
          </View>
          <Text style={[typography.bodySm, { color: colors.text.primary, lineHeight: 20 }]}>
            {feedbackText}
          </Text>
        </View>

        {/* 按钮区域 */}
        <View style={styles.buttonRow}>
          {hasClarify ? (
            // 消歧候选芯片
            <View style={styles.clarifyChips}>
              {clarifyIntent!.clarify!.candidates.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => onClarifySelect?.(candidate.id)}
                  style={[styles.clarifyChip, { borderColor: colors.ai.start, borderRadius: radius.full }]}
                >
                  <Text style={[typography.caption, { color: colors.ai.start }]}>
                    {candidate.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              {actionLabel && onActionPress ? (
                <Pressable
                  onPress={onActionPress}
                  style={[styles.primaryButton, { backgroundColor: colors.ai.start, borderRadius: radius.full }]}
                >
                  <Text style={[typography.bodySm, { color: '#fff', fontWeight: '500' }]}>
                    {actionLabel}
                  </Text>
                </Pressable>
              ) : null}
              {hasContinueChat ? (
                <Pressable
                  onPress={onContinueChat}
                  style={[styles.secondaryButton, { borderColor: `${colors.ai.start}40`, borderRadius: radius.full }]}
                >
                  <Text style={[typography.caption, { color: colors.ai.start }]}>
                    继续对话
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {/* 关闭 */}
        <Pressable onPress={onDismiss} style={styles.dismissArea}>
          <Text style={[typography.caption, { color: colors.text.tertiary }]}>点击关闭</Text>
        </Pressable>
      </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── 录音卡片 ──
  recordingCard: {
    position: 'absolute',
    right: 16,
    minWidth: 160,
    padding: 14,
    borderWidth: 1,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  micIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 22,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // ── 反馈浮层 ──
  feedbackContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    justifyContent: 'flex-end',
  },
  feedbackBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  feedbackContent: {
    padding: 20,
    paddingBottom: 32,
  },
  transcriptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  transcriptDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  aiReplyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  aiReplyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  aiAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  clarifyChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  clarifyChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  dismissArea: {
    alignItems: 'center',
    paddingTop: 12,
  },
});
