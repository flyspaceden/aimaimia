import { describe, expect, it, vi } from 'vitest';

import { startVoiceRecording, stopVoiceRecording, uploadVoiceIntent } from '@/platform/voice';

const uploadFileMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
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
  default: { getRecorderManager: vi.fn(() => recorder) },
}));
vi.mock('@/api/client', () => ({
  ApiClient: { uploadFile: uploadFileMock, post: postMock },
}));

describe('miniapp voice adapter', () => {
  it('records 16k mono MP3 and uploads it as the audio field', async () => {
    const starting = startVoiceRecording();
    callbacks.start?.();
    await starting;
    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      sampleRate: 16_000,
      numberOfChannels: 1,
      encodeBitRate: 64_000,
      format: 'mp3',
      audioSource: 'auto',
    }));

    const stopping = stopVoiceRecording();
    callbacks.stop?.({ tempFilePath: 'wxfile://voice.mp3', duration: 1800, fileSize: 2048 });
    const recording = await stopping;
    uploadFileMock.mockResolvedValue({ ok: true, data: { type: 'search', transcript: '蓝莓' } });
    await uploadVoiceIntent(recording, { prepareId: 'prepare-1', page: 'home' });
    expect(uploadFileMock).toHaveBeenCalledWith('/ai/voice-intent', {
      filePath: 'wxfile://voice.mp3',
      name: 'audio',
      params: { prepareId: 'prepare-1', page: 'home' },
      formData: { format: 'mp3' },
    });
  });

  it('does not upload an empty recording', async () => {
    await expect(uploadVoiceIntent({
      tempFilePath: '',
      durationMs: 0,
      fileSize: 0,
      format: 'mp3',
    })).resolves.toMatchObject({ ok: false, error: { code: 'VOICE_FILE_EMPTY' } });
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('preserves a recording that auto-stops at the duration limit', async () => {
    const stopCallsBeforeAutoStop = recorder.stop.mock.calls.length;
    const starting = startVoiceRecording();
    callbacks.start?.();
    await starting;
    callbacks.stop?.({ tempFilePath: 'wxfile://auto.mp3', duration: 60_000, fileSize: 8192 });

    await expect(stopVoiceRecording()).resolves.toEqual({
      tempFilePath: 'wxfile://auto.mp3',
      durationMs: 60_000,
      fileSize: 8192,
      format: 'mp3',
    });
    expect(recorder.stop).toHaveBeenCalledTimes(stopCallsBeforeAutoStop);
  });
});
