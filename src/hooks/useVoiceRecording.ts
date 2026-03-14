// src/hooks/useVoiceRecording.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';
import { useQueryClient } from '@tanstack/react-query';
import { useAiChatStore } from '../store/useAiChatStore';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { useToast } from '../components/feedback/Toast';
import { AiAssistantRepo } from '../repos/AiAssistantRepo';
import { resolveIntent, IntentResult } from '../utils/navigateByIntent';
import type { AiVoiceIntent } from '../types/domain/Ai';
import { USE_MOCK } from '../repos/http/config';

export type UseVoiceRecordingOptions = {
  /** 当前页面标识，传给 parseVoiceIntent（首页传 'home'，全局浮窗传实际路径） */
  page: string;
};

export type UseVoiceRecordingReturn = {
  // 状态
  isRecording: boolean;
  isProcessing: boolean;
  userTranscript: string;
  feedbackText: string;
  feedbackVisible: boolean;
  actionLabel: string | null;
  actionRoute: string | null;
  actionParams: Record<string, string> | null;
  clarifyIntent: AiVoiceIntent | null;
  continueChatContext: { initialTranscript: string; initialReply: string } | null;
  needsAuth: boolean;
  pendingIntent: AiVoiceIntent | null;
  // 操作
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  dismissFeedback: () => void;
  selectClarify: (candidateId: string) => Promise<void>;
  retryAfterAuth: () => void;
};

export function useVoiceRecording(
  options: UseVoiceRecordingOptions,
): UseVoiceRecordingReturn {
  const { page } = options;
  const { show: showToast } = useToast();
  const queryClient = useQueryClient();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const cartCount = useCartStore((s) => s.items.length);
  const selectedCartCount = useCartStore((s) => s.selectedCount());

  // ── 状态 ──
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [actionRoute, setActionRoute] = useState<string | null>(null);
  const [actionParams, setActionParams] = useState<Record<string, string> | null>(null);
  const [clarifyIntent, setClarifyIntent] = useState<AiVoiceIntent | null>(null);
  const [continueChatContext, setContinueChatContext] = useState<{
    initialTranscript: string; initialReply: string;
  } | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<AiVoiceIntent | null>(null);

  // ── Refs ──
  const mountedRef = useRef(true);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartedAtRef = useRef(0);
  const preparePromiseRef = useRef<Promise<string | null> | null>(null);
  const preparedIdRef = useRef<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 协调快速松手：如果 startRecording 尚未完成就调用了 stopRecording，
  // 设置此标记让 startRecording 完成后立即停止。
  const pendingStopRef = useRef(false);

  // ── 生命周期清理 ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      preparePromiseRef.current = null;
      preparedIdRef.current = null;
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // ── dismissFeedback（内部版本，非 useCallback 以避免循环依赖）──
  const dismissFeedbackInternal = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedbackText('');
    setFeedbackVisible(false);
    setActionLabel(null);
    setActionRoute(null);
    setActionParams(null);
    setClarifyIntent(null);
    setContinueChatContext(null);
    setUserTranscript('');
    setIsProcessing(false);
    setNeedsAuth(false);
    setPendingIntent(null);
  };

  // ── 语音历史持久化 ──
  const saveVoiceToStore = useCallback((transcript: string, feedback: string) => {
    const store = useAiChatStore.getState();
    store.createSession();
    const now = new Date().toISOString();
    store.addMessage({
      id: `voice-user-${Date.now()}`,
      role: 'user',
      content: transcript,
      createdAt: now,
    });
    if (feedback) {
      store.addMessage({
        id: `voice-ai-${Date.now()}`,
        role: 'assistant',
        content: feedback,
        createdAt: now,
      });
    }
  }, []);

  // ── 将 IntentResult 分解到各状态字段 ──
  const applyIntentResult = useCallback((
    result: IntentResult,
    intent: AiVoiceIntent,
  ) => {
    if (!mountedRef.current) return;

    // ── 统一清理上一轮残留状态 ──
    setIsProcessing(false);
    setFeedbackVisible(false);
    setClarifyIntent(null);
    setContinueChatContext(null);
    setActionLabel(null);
    setActionRoute(null);
    setActionParams(null);
    setFeedbackText('');

    if (result.needsAuth) {
      // needsAuth 时不持久化语音历史——登录后 retryAfterAuth 会重新 resolve 并持久化
      setNeedsAuth(true);
      setPendingIntent(intent);
      setFeedbackText(result.feedbackText || '请先登录...');
      setFeedbackVisible(true);
      return;
    }

    // 持久化语音历史（仅非 auth 场景，避免 retry 时双写）
    saveVoiceToStore(intent.transcript, result.feedbackText || intent.feedback || '');

    switch (result.action) {
      case 'navigate':
        if (result.toastText) {
          showToast({ message: result.toastText, type: 'success', duration: 2000 });
          setFeedbackText(result.toastText);
        }
        setActionRoute(result.route || null);
        setActionParams(result.params || null);
        break;

      case 'feedback':
        setFeedbackText(result.feedbackText || '');
        setFeedbackVisible(true);
        setActionLabel(result.actionLabel || null);
        setActionRoute(result.actionRoute || null);
        setActionParams(result.actionParams || null);
        if (result.continueChatContext) {
          setContinueChatContext(result.continueChatContext);
        }
        break;

      case 'clarify':
        setFeedbackText(result.feedbackText || '');
        setFeedbackVisible(true);
        setClarifyIntent(result.clarifyIntent || null);
        break;
    }
  }, [saveVoiceToStore, showToast]);

  // ── 开始录音 ──
  const startRecording = useCallback(async () => {
    dismissFeedbackInternal();
    pendingStopRef.current = false;

    try {
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (_) {}
        recordingRef.current = null;
      }

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麦克风权限', '请在设置中允许麦克风访问');
        return;
      }

      // 权限获取后检查：用户可能在等待权限弹窗时已松手
      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        isMeteringEnabled: false,
        android: {
          extension: '.wav',
          outputFormat: 0,
          audioEncoder: 0,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: { mimeType: 'audio/wav', bitsPerSecond: 256000 },
      });
      await recording.startAsync();

      recordingRef.current = recording;
      recordingStartedAtRef.current = Date.now();

      // 录音启动后检查：用户可能在 prepare+start 期间已松手
      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        // 录音已启动但用户已松手，立即走 stopRecording 逻辑
        // 不设 isRecording=true，直接清理
        try { await recording.stopAndUnloadAsync(); } catch (_) {}
        recordingRef.current = null;
        recordingStartedAtRef.current = 0;
        try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch (_) {}
        if (mountedRef.current) setIsRecording(false);
        return;
      }

      preparePromiseRef.current = AiAssistantRepo.prepareVoiceIntent()
        .then((result) => {
          if (!result.ok) {
            console.warn('ASR 预建连失败:', result.error?.message || 'unknown');
            return null;
          }
          preparedIdRef.current = result.data.prepareId;
          if (__DEV__) console.log(`[VoicePerf] prepared_asr_ready=${result.data.prepareId}`);
          return result.data.prepareId;
        })
        .catch((error: any) => {
          console.warn('ASR 预建连异常:', error?.message || error);
          return null;
        });

      if (mountedRef.current) setIsRecording(true);
    } catch (error: any) {
      console.error('录音启动失败:', error?.message || error);
      pendingStopRef.current = false;
      if (mountedRef.current) {
        setIsRecording(false);
      }
      recordingStartedAtRef.current = 0;
      preparePromiseRef.current = null;
      preparedIdRef.current = null;
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch (_) {}
    }
  }, []);

  // ── 停止录音 ──
  // 使用 recordingRef 而非 isRecording 作为 guard：
  // 手势 onEnd 回调通过 runOnJS 调用时，捕获的是手势创建时的闭包。
  // 由于 startRecording 在手势 onStart 中设置 isRecording=true 后触发重渲染，
  // 但活跃手势的 onEnd 仍引用旧闭包中的 isRecording=false，导致 guard 误判。
  // recordingRef 是 ref，始终反映最新值，不受闭包影响。
  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) {
      // 录音尚未启动完成（startRecording 仍在 await），标记待停止
      pendingStopRef.current = true;
      return;
    }

    setIsRecording(false);
    setIsProcessing(true);
    setFeedbackText('正在识别语音...');

    try {
      const recording = recordingRef.current;
      if (!recording) {
        if (mountedRef.current) {
          setIsProcessing(false);
          setFeedbackText('录音失败，请重试');
          setFeedbackVisible(true);
          feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 1500);
        }
        return;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      if (!uri) {
        preparePromiseRef.current = null;
        preparedIdRef.current = null;
        if (mountedRef.current) {
          setIsProcessing(false);
          setFeedbackText('录音失败，请重试');
          setFeedbackVisible(true);
          feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 1500);
        }
        return;
      }

      // 等待 ASR prepare（自适应超时）
      const recordingDurationMs = recordingStartedAtRef.current
        ? Math.max(0, Date.now() - recordingStartedAtRef.current)
        : 0;
      const prepareId = preparedIdRef.current
        || await Promise.race<string | null>([
          preparePromiseRef.current ?? Promise.resolve(null),
          new Promise<string | null>((resolve) => setTimeout(
            () => resolve(null),
            recordingDurationMs >= 2500 ? 2600 : recordingDurationMs >= 1200 ? 1800 : 800,
          )),
        ]);

      recordingStartedAtRef.current = 0;
      preparePromiseRef.current = null;
      preparedIdRef.current = null;

      // 解析语音意图
      const result = await AiAssistantRepo.parseVoiceIntent(uri, prepareId || undefined, { page });
      if (!mountedRef.current) return;

      if (result.ok) {
        if (!USE_MOCK && isLoggedIn) {
          void Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: ['ai-recent-conversations-home'] }),
            queryClient.invalidateQueries({ queryKey: ['ai-sessions'] }),
          ]);
        }

        const intent = result.data;
        setUserTranscript(intent.transcript);

        const intentResult = await resolveIntent(intent, {
          isLoggedIn,
          cartCount,
          selectedCartCount,
        });
        if (!mountedRef.current) return;

        applyIntentResult(intentResult, intent);
      } else {
        console.error('语音识别失败:', JSON.stringify(result.error));
        setIsProcessing(false);
        setFeedbackText(`识别失败: ${result.error?.message || '未知错误'}`);
        setFeedbackVisible(true);
        feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 3000);
      }
    } catch (error: any) {
      console.error('语音识别异常:', error?.message || error);
      if (mountedRef.current) {
        setIsProcessing(false);
        setFeedbackText(`识别异常: ${error?.message || '请重试'}`);
        setFeedbackVisible(true);
        feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 1500);
      }
    }
  }, [page, isLoggedIn, cartCount, selectedCartCount, queryClient, applyIntentResult]);

  // ── dismissFeedback（公开版） ──
  const dismissFeedback = useCallback(() => {
    dismissFeedbackInternal();
  }, []);

  // ── selectClarify ──
  const selectClarify = useCallback(async (candidateId: string) => {
    const candidate = clarifyIntent?.clarify?.candidates.find((item) => item.id === candidateId);
    if (!candidate || !clarifyIntent) return;

    setClarifyIntent(null);
    setIsProcessing(true);

    const nextIntent: AiVoiceIntent = {
      type: candidate.type,
      intent: candidate.intent ?? candidate.type,
      confidence: candidate.confidence,
      transcript: clarifyIntent.transcript,
      param: candidate.param,
      feedback: candidate.feedback,
      slots: candidate.slots,
      resolved: candidate.resolved,
      fallbackReason: candidate.fallbackReason,
      search: candidate.search,
      company: candidate.company,
      transaction: candidate.transaction,
      recommend: candidate.recommend,
    };

    try {
      const result = await resolveIntent(nextIntent, {
        isLoggedIn,
        cartCount,
        selectedCartCount,
      });
      if (mountedRef.current) {
        applyIntentResult(result, nextIntent);
      }
    } catch (error: any) {
      console.error('selectClarify 失败:', error?.message || error);
      if (mountedRef.current) {
        setIsProcessing(false);
        setFeedbackText('处理失败，请重试');
        setFeedbackVisible(true);
        feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 2000);
      }
    }
  }, [clarifyIntent, isLoggedIn, cartCount, selectedCartCount, applyIntentResult]);

  // ── retryAfterAuth ──
  const retryAfterAuth = useCallback(() => {
    const intent = pendingIntent;
    setNeedsAuth(false);
    setPendingIntent(null);
    if (!intent) return;

    setIsProcessing(true);
    resolveIntent(intent, {
      isLoggedIn: true,
      cartCount,
      selectedCartCount,
    })
      .then((result) => {
        if (mountedRef.current) {
          applyIntentResult(result, intent);
        }
      })
      .catch((error: any) => {
        console.error('retryAfterAuth 失败:', error?.message || error);
        if (mountedRef.current) {
          setIsProcessing(false);
          setFeedbackText('重试失败，请再试一次');
          setFeedbackVisible(true);
          feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 2000);
        }
      });
  }, [pendingIntent, cartCount, selectedCartCount, applyIntentResult]);

  return {
    isRecording,
    isProcessing,
    userTranscript,
    feedbackText,
    feedbackVisible,
    actionLabel,
    actionRoute,
    actionParams,
    clarifyIntent,
    continueChatContext,
    needsAuth,
    pendingIntent,
    startRecording,
    stopRecording,
    dismissFeedback,
    selectClarify,
    retryAfterAuth,
  };
}
