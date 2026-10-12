import Taro from '@tarojs/taro';
import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';

export type VoiceRecording = {
  tempFilePath: string;
  durationMs: number;
  fileSize: number;
  format: 'mp3';
};

export type AiVoiceIntent = {
  type: string;
  transcript: string;
  intent?: string;
  confidence?: number;
  [key: string]: unknown;
};

let manager: Taro.RecorderManager | null = null;
let recorderState: 'idle' | 'authorizing' | 'starting' | 'recording' | 'stopping' = 'idle';
let startTimer: ReturnType<typeof setTimeout> | undefined;
let discardCurrentRecording = false;
let completedRecording: VoiceRecording | null = null;
let startPending: { resolve: () => void; reject: (error: Error) => void } | null = null;
let stopPending: {
  resolve: (recording: VoiceRecording) => void;
  reject: (error: Error) => void;
} | null = null;

function clearStartTimer(): void {
  clearTimeout(startTimer);
  startTimer = undefined;
}

function recordingError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message
    : (error as { errMsg?: string } | null)?.errMsg || '';
  if (message.includes('scope is not declared')) {
    return new Error('语音功能暂不可用，请联系客服完善隐私声明');
  }
  return new Error(fallback);
}

function recorderManager(): Taro.RecorderManager {
  if (manager) return manager;
  manager = Taro.getRecorderManager();
  manager.onStart(() => {
    clearStartTimer();
    if (discardCurrentRecording || !startPending || recorderState !== 'starting') {
      discardCurrentRecording = true;
      recorderState = 'stopping';
      try {
        manager?.stop();
      } catch {
        recorderState = 'idle';
        discardCurrentRecording = false;
      }
      return;
    }
    recorderState = 'recording';
    startPending?.resolve();
    startPending = null;
  });
  manager.onStop((result) => {
    clearStartTimer();
    const failedStart = startPending !== null;
    startPending?.reject(new Error('录音未能启动，请重试'));
    startPending = null;
    const recording: VoiceRecording = {
      tempFilePath: result.tempFilePath,
      durationMs: result.duration,
      fileSize: result.fileSize,
      format: 'mp3',
    };
    recorderState = 'idle';
    if (discardCurrentRecording || failedStart) {
      discardCurrentRecording = false;
      completedRecording = null;
      startPending = null;
      stopPending = null;
      return;
    }
    if (stopPending) {
      stopPending.resolve(recording);
    } else {
      // RecorderManager auto-stops at the configured duration. Preserve that result
      // until the UI asks for it instead of issuing a second stop that never resolves.
      completedRecording = recording;
    }
    stopPending = null;
  });
  manager.onError((result) => {
    clearStartTimer();
    const error = recordingError(result, '录音失败，请检查微信麦克风权限后重试');
    startPending?.reject(error);
    stopPending?.reject(error);
    recorderState = 'idle';
    discardCurrentRecording = false;
    completedRecording = null;
    startPending = null;
    stopPending = null;
  });
  return manager;
}

export function startVoiceRecording(): Promise<void> {
  if (recorderState !== 'idle' || startPending || stopPending) {
    return Promise.reject(new Error('录音操作进行中'));
  }
  completedRecording = null;
  discardCurrentRecording = false;
  return new Promise((resolve, reject) => {
    const pending = { resolve, reject };
    startPending = pending;
    recorderState = 'authorizing';
    let failureMessage = '请同意隐私保护指引后再使用语音';
    // 不注册自定义隐私监听，由微信展示原生授权弹窗。
    void (async () => {
      if (typeof Taro.requirePrivacyAuthorize === 'function') {
        await Taro.requirePrivacyAuthorize();
      }
      if (startPending !== pending) return;
      failureMessage = '未获得麦克风权限，请在小程序设置中开启';
      await Taro.authorize({ scope: 'scope.record' });
      if (startPending !== pending) return;
      failureMessage = '录音启动失败，请稍后重试';
      recorderState = 'starting';
      const recorder = recorderManager();
      // 用户阅读授权弹窗不计时，只限制真正启动录音的等待时间。
      startTimer = setTimeout(() => {
        if (startPending !== pending) return;
        pending.reject(new Error('麦克风启动超时，请退出小程序后重试'));
        cancelVoiceRecording();
      }, 10_000);
      recorder.start({
        duration: 60_000,
        sampleRate: 16_000,
        numberOfChannels: 1,
        encodeBitRate: 64_000,
        format: 'mp3',
        // `voice_recognition` is Android-only in the WeChat recorder API.
        // `auto` keeps the same recording contract on both iOS and Android.
        audioSource: 'auto',
      });
    })().catch((error: unknown) => {
      if (startPending !== pending) return;
      clearStartTimer();
      recorderState = 'idle';
      startPending = null;
      reject(recordingError(error, failureMessage));
    });
  });
}

/**
 * 页面离开时立即释放微信录音器，并丢弃这次音频。
 * 取消不得将自动 stop 的结果留给下一个页面使用。
 */
export function cancelVoiceRecording(): void {
  clearStartTimer();
  const cancellation = new Error('录音已取消');
  completedRecording = null;
  const wasAuthorizing = recorderState === 'authorizing';
  discardCurrentRecording = recorderState !== 'idle' && !wasAuthorizing;
  startPending?.reject(cancellation);
  stopPending?.reject(cancellation);
  startPending = null;
  stopPending = null;
  if (wasAuthorizing) recorderState = 'idle';
  if (recorderState === 'idle') return;
  recorderState = 'stopping';
  try {
    recorderManager().stop();
  } catch {
    recorderState = 'idle';
    discardCurrentRecording = false;
  }
}

export function stopVoiceRecording(): Promise<VoiceRecording> {
  if (completedRecording) {
    const recording = completedRecording;
    completedRecording = null;
    return Promise.resolve(recording);
  }
  if (stopPending) return Promise.reject(new Error('正在停止录音'));
  if (recorderState !== 'recording') return Promise.reject(new Error('当前没有正在录音'));
  return new Promise((resolve, reject) => {
    stopPending = { resolve, reject };
    recorderState = 'stopping';
    try {
      recorderManager().stop();
    } catch (error) {
      recorderState = 'recording';
      stopPending = null;
      reject(error instanceof Error ? error : new Error('录音停止失败'));
    }
  });
}

export function prepareVoiceIntent() {
  return ApiClient.post<{ prepareId: string }>('/ai/voice-intent/prepare');
}

export async function uploadVoiceIntent(
  recording: VoiceRecording,
  options?: { prepareId?: string; sessionId?: string; page?: string },
): Promise<Result<AiVoiceIntent>> {
  if (!recording.tempFilePath || recording.fileSize <= 0) {
    return {
      ok: false,
      error: { code: 'VOICE_FILE_EMPTY', message: 'recording file is empty' },
    };
  }
  return ApiClient.uploadFile<AiVoiceIntent>('/ai/voice-intent', {
    filePath: recording.tempFilePath,
    name: 'audio',
    params: options,
    formData: { format: recording.format },
  });
}
