import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadFileMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const privacyMock = vi.hoisted(() => vi.fn());
const authorizeMock = vi.hoisted(() => vi.fn());
const callbacks = vi.hoisted(() => ({
  start: undefined as undefined | (() => void),
  stop: undefined as undefined | ((result: { tempFilePath: string; duration: number; fileSize: number }) => void),
  error: undefined as undefined | ((result: { errMsg: string }) => void),
}));
const recorder = vi.hoisted(() => ({
  onStart: vi.fn((callback) => { callbacks.start = callback; }),
  onStop: vi.fn((callback) => { callbacks.stop = callback; }),
  onError: vi.fn((callback) => { callbacks.error = callback; }),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    getRecorderManager: vi.fn(() => recorder),
    requirePrivacyAuthorize: privacyMock,
    authorize: authorizeMock,
  },
}));
vi.mock('@/api/client', () => ({
  ApiClient: { uploadFile: uploadFileMock, post: postMock },
}));

let voice: typeof import('@/platform/voice');
const recording = { tempFilePath: 'wxfile://voice.mp3', duration: 1800, fileSize: 2048 };
const flushAuthorization = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  privacyMock.mockReset().mockResolvedValue({ errMsg: 'ok' });
  authorizeMock.mockReset().mockResolvedValue({ errMsg: 'ok' });
  recorder.start.mockReset();
  recorder.stop.mockReset();
  callbacks.start = callbacks.stop = callbacks.error = undefined;
  voice = await import('@/platform/voice');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('miniapp voice adapter', () => {
  it('waits for native privacy and microphone consent before starting', async () => {
    let agreePrivacy!: () => void;
    let agreeMicrophone!: () => void;
    privacyMock.mockReturnValue(new Promise<void>((resolve) => { agreePrivacy = resolve; }));
    authorizeMock.mockReturnValue(new Promise<void>((resolve) => { agreeMicrophone = resolve; }));
    const starting = voice.startVoiceRecording();
    expect(privacyMock).toHaveBeenCalledOnce();
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(recorder.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    agreePrivacy();
    await flushAuthorization();
    expect(authorizeMock).toHaveBeenCalledWith({ scope: 'scope.record' });
    expect(recorder.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    agreeMicrophone();
    await flushAuthorization();
    expect(recorder.start).toHaveBeenCalledOnce();
    callbacks.start?.();
    await starting;
  });

  it.each([
    ['privacy', '请同意隐私保护指引'],
    ['microphone', '未获得麦克风权限'],
  ])('does not record after %s refusal and allows retry', async (stage, message) => {
    (stage === 'privacy' ? privacyMock : authorizeMock).mockRejectedValueOnce({ errMsg: 'authorize:fail auth deny' });
    await expect(voice.startVoiceRecording()).rejects.toThrow(message);
    expect(recorder.start).not.toHaveBeenCalled();
    const retry = voice.startVoiceRecording();
    await flushAuthorization();
    callbacks.start?.();
    await expect(retry).resolves.toBeUndefined();
  });

  it('explains a missing platform privacy declaration', async () => {
    privacyMock.mockRejectedValueOnce({ errMsg: 'requirePrivacyAuthorize:fail api scope is not declared in the privacy agreement' });
    await expect(voice.startVoiceRecording()).rejects.toThrow('完善隐私声明');
    expect(recorder.start).not.toHaveBeenCalled();
  });

  it.each(['privacy', 'microphone'])('does not start after leaving during %s authorization', async (stage) => {
    let agree!: () => void;
    (stage === 'privacy' ? privacyMock : authorizeMock).mockReturnValueOnce(new Promise<void>((resolve) => { agree = resolve; }));
    const starting = voice.startVoiceRecording();
    const rejected = expect(starting).rejects.toThrow('录音已取消');
    await flushAuthorization();
    voice.cancelVoiceRecording();
    await rejected;
    // 新操作已开始，旧授权返回不得替新操作启动或清理状态。
    let agreeNew!: () => void;
    privacyMock.mockReturnValueOnce(new Promise<void>((resolve) => { agreeNew = resolve; }));
    const retry = voice.startVoiceRecording();
    agree();
    await flushAuthorization();
    expect(recorder.start).not.toHaveBeenCalled();
    expect(recorder.stop).not.toHaveBeenCalled();
    agreeNew();
    await flushAuthorization();
    callbacks.start?.();
    await retry;
    expect(recorder.start).toHaveBeenCalledOnce();
  });

  it('times out a missing start callback and discards a late recording', async () => {
    const starting = voice.startVoiceRecording();
    const rejected = expect(starting).rejects.toThrow('麦克风启动超时');
    await flushAuthorization();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(recorder.stop).toHaveBeenCalledOnce();
    await expect(voice.startVoiceRecording()).rejects.toThrow('录音操作进行中');
    callbacks.start?.();
    expect(recorder.stop).toHaveBeenCalledTimes(2);
    callbacks.stop?.(recording);
    await expect(voice.stopVoiceRecording()).rejects.toThrow('当前没有正在录音');
    const retry = voice.startVoiceRecording();
    await flushAuthorization();
    callbacks.start?.();
    await retry;
  });

  it('recovers when the native recorder emits an error before starting', async () => {
    const starting = voice.startVoiceRecording();
    const rejected = expect(starting).rejects.toThrow('录音失败');
    await flushAuthorization();
    callbacks.error?.({ errMsg: 'start:fail' });
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    const retry = voice.startVoiceRecording();
    await flushAuthorization();
    callbacks.start?.();
    await retry;
  });

  it('rejects a stop-before-start instead of waiting forever', async () => {
    const starting = voice.startVoiceRecording();
    const rejected = expect(starting).rejects.toThrow('录音未能启动');
    await flushAuthorization();
    callbacks.stop?.(recording);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await expect(voice.stopVoiceRecording()).rejects.toThrow('当前没有正在录音');
  });

  it('records 16k mono MP3 and uploads it as the audio field', async () => {
    const starting = voice.startVoiceRecording();
    await flushAuthorization();
    callbacks.start?.();
    await starting;
    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      sampleRate: 16_000, numberOfChannels: 1, encodeBitRate: 64_000,
      format: 'mp3', audioSource: 'auto',
    }));
    expect(vi.getTimerCount()).toBe(0);
    const stopping = voice.stopVoiceRecording();
    callbacks.stop?.(recording);
    const result = await stopping;
    uploadFileMock.mockResolvedValue({ ok: true, data: { type: 'search', transcript: '蓝莓' } });
    await voice.uploadVoiceIntent(result, { prepareId: 'prepare-1', page: 'home' });
    expect(uploadFileMock).toHaveBeenCalledWith('/ai/voice-intent', {
      filePath: recording.tempFilePath, name: 'audio',
      params: { prepareId: 'prepare-1', page: 'home' }, formData: { format: 'mp3' },
    });
  });

  it('does not upload an empty recording', async () => {
    await expect(voice.uploadVoiceIntent({ tempFilePath: '', durationMs: 0, fileSize: 0, format: 'mp3' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'VOICE_FILE_EMPTY' } });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('preserves a recording that auto-stops at the duration limit', async () => {
    const starting = voice.startVoiceRecording();
    await flushAuthorization();
    callbacks.start?.();
    await starting;
    callbacks.stop?.({ ...recording, duration: 60_000 });
    await expect(voice.stopVoiceRecording()).resolves.toMatchObject({ durationMs: 60_000 });
    expect(recorder.stop).not.toHaveBeenCalled();
  });
});
