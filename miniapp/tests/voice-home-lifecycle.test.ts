import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function recordingFlow() {
  // 执行首页真实闭包，重现页面隐藏后异步上传响应迟到；不导出产品代码中的测试接口。
  const source = readFileSync(path.resolve('src/pages/home/index.tsx'), 'utf8');
  const code = source.slice(source.indexOf('  const discardRecording ='), source.indexOf('  const beginRecording ='));
  const context = {
    lifecycleRef: { current: 1 }, holdingVoiceRef: { current: true },
    recorderStartedRef: { current: true }, finishingRef: { current: false },
    prepareRef: { current: Promise.resolve({ ok: true, data: { prepareId: 'prepared' } }) as Promise<unknown> | undefined },
    cancelVoiceRecording: vi.fn(),
    stopVoiceRecording: vi.fn().mockResolvedValue({ durationMs: 1000, tempFilePath: 'recording.mp3' }),
    AiVoiceRepo: { recognize: vi.fn() }, Taro: { showToast: vi.fn() },
    setVoicePhase: vi.fn(), setVoiceIntent: vi.fn(), useDidHide: vi.fn(), useUnload: vi.fn(),
  };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const flow = new Function('context', `const {${Object.keys(context).join(',')}} = context; ${compiled}; return {finishRecording, discardRecording};`)(context) as {
    finishRecording: (operation: number) => Promise<void>; discardRecording: () => void;
  };
  return { ...context, ...flow };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('home voice lifecycle', () => {
  it.each([true, false])('ignores a hidden-page upload response (ok=%s)', async (ok) => {
    const flow = recordingFlow();
    let respond!: (value: unknown) => void;
    flow.AiVoiceRepo.recognize.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
    const finished = flow.finishRecording(1);
    await flush();
    flow.discardRecording();
    respond(ok ? { ok: true, data: { transcript: '旧录音' } } : { ok: false, error: { displayMessage: '旧错误' } });
    await finished;
    expect(flow.setVoiceIntent).not.toHaveBeenCalled();
    expect(flow.Taro.showToast).not.toHaveBeenCalled();
  });

  it('keeps the newer result when an older upload finishes afterward', async () => {
    const flow = recordingFlow();
    let respondOld!: (value: unknown) => void;
    flow.AiVoiceRepo.recognize.mockReturnValueOnce(new Promise((resolve) => { respondOld = resolve; }));
    const old = flow.finishRecording(1);
    await flush();
    flow.discardRecording();
    flow.lifecycleRef.current = 3;
    flow.recorderStartedRef.current = true;
    flow.prepareRef.current = Promise.resolve({ ok: true, data: { prepareId: 'new' } });
    flow.AiVoiceRepo.recognize.mockResolvedValueOnce({ ok: true, data: { transcript: '新录音' } });
    await flow.finishRecording(3);
    respondOld({ ok: true, data: { transcript: '旧录音' } });
    await old;
    expect(flow.setVoiceIntent.mock.calls).toEqual([[{ transcript: '新录音' }]]);
  });
});
