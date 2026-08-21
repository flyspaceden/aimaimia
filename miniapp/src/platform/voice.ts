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
let recorderState: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle';
let discardCurrentRecording = false;
let completedRecording: VoiceRecording | null = null;
let startPending: { resolve: () => void; reject: (error: Error) => void } | null = null;
let stopPending: {
  resolve: (recording: VoiceRecording) => void;
  reject: (error: Error) => void;
} | null = null;

function recorderManager(): Taro.RecorderManager {
  if (manager) return manager;
  manager = Taro.getRecorderManager();
  manager.onStart(() => {
    if (discardCurrentRecording) {
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
    const recording: VoiceRecording = {
      tempFilePath: result.tempFilePath,
      durationMs: result.duration,
      fileSize: result.fileSize,
      format: 'mp3',
    };
    recorderState = 'idle';
    if (discardCurrentRecording) {
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
    const error = new Error(result.errMsg || '录音失败');
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
    startPending = { resolve, reject };
    recorderState = 'starting';
    try {
      recorderManager().start({
        duration: 60_000,
        sampleRate: 16_000,
        numberOfChannels: 1,
        encodeBitRate: 64_000,
        format: 'mp3',
        // `voice_recognition` is Android-only in the WeChat recorder API.
        // `auto` keeps the same recording contract on both iOS and Android.
        audioSource: 'auto',
      });
    } catch (error) {
      recorderState = 'idle';
      startPending = null;
      reject(error instanceof Error ? error : new Error('录音启动失败'));
    }
  });
}

/**
 * 页面离开时立即释放微信录音器，并丢弃这次音频。
 * 取消不得将自动 stop 的结果留给下一个页面使用。
 */
export function cancelVoiceRecording(): void {
  const cancellation = new Error('录音已取消');
  completedRecording = null;
  discardCurrentRecording = recorderState !== 'idle';
  startPending?.reject(cancellation);
  stopPending?.reject(cancellation);
  startPending = null;
  stopPending = null;
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
