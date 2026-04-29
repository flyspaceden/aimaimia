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
import { ProductRepo } from '../repos/ProductRepo';
import { resolveIntent, IntentResult } from '../utils/navigateByIntent';
import { buildVoiceCartConfirmation } from '../utils/voiceCartConfirmation';
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
  /** 直接处理预构建的意图（菜单快捷入口，跳过语音/ASR） */
  processIntent: (intent: AiVoiceIntent) => Promise<void>;
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
  const addCartItem = useCartStore((s) => s.addItem);

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
  // 处理阶段文案计时器（识别中 → 思考中 → 快好了）
  const stageTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
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
      stageTimerRefs.current.forEach(clearTimeout);
    };
  }, []);

  // ── dismissFeedback（内部版本，非 useCallback 以避免循环依赖）──
  const dismissFeedbackInternal = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    // 清理处理阶段计时器，防止录音 stage timer 覆盖 processIntent 结果
    stageTimerRefs.current.forEach(clearTimeout);
    stageTimerRefs.current = [];
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
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    stageTimerRefs.current.forEach(clearTimeout);
    stageTimerRefs.current = [];
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

    // chatResponse：后端返回富文本回复 → 跳转聊天页展示（含建议操作按钮）
    if (intent.chatResponse) {
      saveVoiceToStore(intent.transcript, intent.chatResponse.reply);
      setActionRoute('/ai/chat');
      setActionParams({
        initialMessage: intent.chatResponse.reply,
        suggestedActions: JSON.stringify(intent.chatResponse.suggestedActions),
      });
      return;
    }

    // 持久化语音历史（仅非 auth 场景，避免 retry 时双写）
    saveVoiceToStore(intent.transcript, result.feedbackText || intent.feedback || '');

    // 已唯一命中商品的加购语音：直接执行加购，不再跳搜索页。
    if (result.cartExecution?.productId) {
      const productId = result.cartExecution.productId;
      const preferredName = result.cartExecution.productName;
      void ProductRepo.getById(productId).then((productResult) => {
        if (!mountedRef.current) return;
        if (!productResult.ok) {
          showToast({
            message: preferredName
              ? `已识别到${preferredName}，但加入购物车失败，请重试`
              : '加入购物车失败，请重试',
            type: 'error',
            duration: 3200,
          });
          return;
        }

        const product = productResult.data;
        const sku = product.skus.find((item) => item.id === product.defaultSkuId) ?? product.skus[0];
        const added = addCartItem(
          {
            ...product,
            maxPerOrder: sku?.maxPerOrder ?? null,
          },
          1,
          sku?.id ?? product.defaultSkuId,
          sku?.price ?? product.price,
        );

        if (added) {
          const confirmation = buildVoiceCartConfirmation({
            productName: preferredName || product.title,
          });
          setFeedbackText(confirmation.message);
          setFeedbackVisible(true);
          feedbackTimerRef.current = setTimeout(
            () => dismissFeedbackInternal(),
            confirmation.overlayDurationMs,
          );
          showToast({
            message: confirmation.message,
            type: 'success',
            duration: confirmation.toastDurationMs,
          });
        }
      }).catch((error: any) => {
        console.error('语音加购失败:', error?.message || error);
        if (!mountedRef.current) return;
        showToast({
          message: preferredName
            ? `已识别到${preferredName}，但加入购物车失败，请重试`
            : '加入购物车失败，请重试',
          type: 'error',
          duration: 3200,
        });
      });
      return;
    }

    switch (result.action) {
      case 'navigate':
        // 不显示 toast — 导航立即发生，toast 会残留在结果页上方造成"搜到了但还显示正在搜索"的错觉
        // 如需反馈文案，由目标页自行处理（如搜索页的 AI 摘要）
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
  }, [addCartItem, saveVoiceToStore, showToast]);

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
        // Android 改用 m4a + MPEG_4 + AAC（之前用 .wav + outputFormat:0 + audioEncoder:0
        // 即 MediaRecorder DEFAULT，实际并不产 WAV，会产出 3GPP/AMR 等格式，
        // 后端按 wav 喂阿里云 ASR 必识别为空 → "未能识别到语音内容"）
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
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

    // ── 阶段文案：首页带"正在"前缀，其他页面简洁 ──
    const isHome = page === 'home';
    const stageText = (home: string, other: string) => (isHome ? home : other);

    // 阶段 1：传输语音（松手即刻，真实事件）
    setFeedbackText(stageText('正在传输语音...', '传输语音...'));

    // 清理上一轮残留的阶段计时器
    stageTimerRefs.current.forEach(clearTimeout);
    stageTimerRefs.current = [];

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

      // 阶段 2：识别文字（调用 API 时，真实事件）
      if (mountedRef.current) {
        setFeedbackText(stageText('正在识别文字...', '识别文字...'));
      }

      // 阶段 3：思考中（API 发出 ~1.2s 后，估算计时器）
      stageTimerRefs.current.push(setTimeout(() => {
        if (mountedRef.current) {
          setFeedbackText(stageText('正在思考...', '思考中...'));
        }
      }, 1200));

      // 阶段 4：快好了（API 发出 ~2.8s 后，估算计时器）
      stageTimerRefs.current.push(setTimeout(() => {
        if (mountedRef.current) {
          setFeedbackText(stageText('马上就好...', '快好了...'));
        }
      }, 2800));

      // 解析语音意图
      const result = await AiAssistantRepo.parseVoiceIntent(uri, prepareId || undefined, { page });
      // 响应到达，清除剩余的阶段计时器
      stageTimerRefs.current.forEach(clearTimeout);
      stageTimerRefs.current = [];
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

  // ── processIntent：直接处理预构建意图（菜单快捷入口） ──
  const processIntent = useCallback(async (intent: AiVoiceIntent) => {
    dismissFeedbackInternal();
    setIsProcessing(true);
    setUserTranscript(intent.transcript);
    setFeedbackText(intent.feedback || '处理中...');

    try {
      const result = await resolveIntent(intent, {
        isLoggedIn,
        cartCount,
        selectedCartCount,
      });
      if (mountedRef.current) {
        applyIntentResult(result, intent);
      }
    } catch (error: any) {
      console.error('processIntent 失败:', error?.message || error);
      if (mountedRef.current) {
        setIsProcessing(false);
        setFeedbackText('处理失败，请重试');
        setFeedbackVisible(true);
        feedbackTimerRef.current = setTimeout(() => dismissFeedbackInternal(), 2000);
      }
    }
  }, [isLoggedIn, cartCount, selectedCartCount, applyIntentResult]);

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
    processIntent,
  };
}
