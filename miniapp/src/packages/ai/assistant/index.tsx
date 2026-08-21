import { Button, Input, Text, View } from '@tarojs/components';
import Taro, { useDidHide, useUnload } from '@tarojs/taro';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { FunctionalIcon } from '@/components/functional-icon';
import { cancelVoiceRecording, startVoiceRecording, stopVoiceRecording } from '@/platform/voice';
import { useAuthStore } from '@/store/auth';
import { AiVoiceRepo } from '../repo';
import {
  aiReply,
  candidateToIntent,
  resolveAiAction,
} from '../intent';
import type { AiPageAction, AiVoiceIntent } from '../types';
import './index.scss';

type VoicePhase = 'idle' | 'starting' | 'recording' | 'recognizing';
const suggestions = ['帮我找时令水果', '看看我的订单', '推荐适合送礼的农产品'];

export default function AiAssistantPage() {
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [intent, setIntent] = useState<AiVoiceIntent>();
  const holdingRef = useRef(false);
  const finishingRef = useRef(false);
  const prepareRef = useRef<ReturnType<typeof AiVoiceRepo.prepare>>();
  const lifecycleRef = useRef(0);

  const discardRecording = () => {
    lifecycleRef.current += 1;
    holdingRef.current = false;
    finishingRef.current = false;
    prepareRef.current = undefined;
    cancelVoiceRecording();
  };
  useDidHide(discardRecording);
  useUnload(discardRecording);

  const openSearch = (raw = input) => {
    const query = raw.trim();
    if (!query) {
      Taro.showToast({ title: '请输入想找的内容', icon: 'none' });
      return;
    }
    setInput(query);
    void Taro.navigateTo({
      url: `/packages/commerce/catalog-search/index?q=${encodeURIComponent(query)}`,
    });
  };

  const performAction = async (action: AiPageAction | null) => {
    if (!action?.url) return;
    if (action.requiresAuth && !loggedIn) {
      const returnUrl = '/packages/ai/assistant/index';
      await Taro.navigateTo({
        url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}`,
      });
      return;
    }
    if (action.mode === 'switchTab') await Taro.switchTab({ url: action.url });
    else await Taro.navigateTo({ url: action.url });
  };

  const finishRecording = async (operation = lifecycleRef.current) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('recognizing');
    try {
      const recording = await stopVoiceRecording();
      if (operation !== lifecycleRef.current) return;
      if (recording.durationMs < 650) {
        Taro.showToast({ title: '说话时间太短，请再试一次', icon: 'none' });
        return;
      }
      const prepared = await prepareRef.current;
      if (operation !== lifecycleRef.current) return;
      const result = await AiVoiceRepo.recognize(recording, {
        prepareId: prepared?.ok ? prepared.data.prepareId : undefined,
        page: 'miniapp-ai-assistant',
      });
      if (!result.ok) {
        if (operation !== lifecycleRef.current) return;
        Taro.showToast({ title: result.error.displayMessage || '识别失败，请再试一次', icon: 'none' });
        return;
      }
      if (operation !== lifecycleRef.current) return;
      setIntent(result.data);
    } catch (error) {
      if (operation !== lifecycleRef.current) return;
      Taro.showToast({
        title: error instanceof Error && error.message ? error.message : '录音失败，请检查麦克风权限',
        icon: 'none',
      });
    } finally {
      if (operation !== lifecycleRef.current) return;
      prepareRef.current = undefined;
      finishingRef.current = false;
      setPhase('idle');
    }
  };

  const beginRecording = async () => {
    if (phase !== 'idle') return;
    const operation = lifecycleRef.current + 1;
    lifecycleRef.current = operation;
    holdingRef.current = true;
    setIntent(undefined);
    setPhase('starting');
    prepareRef.current = AiVoiceRepo.prepare();
    try {
      await startVoiceRecording();
      if (operation !== lifecycleRef.current) return;
      setPhase('recording');
      if (!holdingRef.current) await finishRecording(operation);
    } catch (error) {
      if (operation !== lifecycleRef.current) return;
      prepareRef.current = undefined;
      setPhase('idle');
      Taro.showToast({
        title: error instanceof Error && error.message ? error.message : '无法开始录音',
        icon: 'none',
      });
    }
  };

  const releaseRecording = () => {
    holdingRef.current = false;
    if (phase === 'recording') void finishRecording(lifecycleRef.current);
  };

  const chooseCandidate = (candidateIndex: number) => {
    const candidate = intent?.clarify?.candidates[candidateIndex];
    if (!candidate || !intent) return;
    setIntent(candidateToIntent(candidate, intent.transcript));
  };

  const action = intent ? resolveAiAction(intent) : null;
  const phaseText = phase === 'recording'
    ? '正在听，松开即可识别'
    : phase === 'recognizing'
      ? '正在理解你的需求…'
      : phase === 'starting'
        ? '正在打开麦克风…'
        : '按住说话';

  return (
    <View className='aim-page ai-assistant-page'>
      <PageHeader title='AI 助手' eyebrow='一句话找好物 · 办事情' />

      <View className='ai-assistant-search aim-card'>
        <Text className='ai-assistant-search__mark'>AI</Text>
        <Input
          className='ai-assistant-search__input'
          value={input}
          placeholder='输入商品、企业或场景'
          confirmType='search'
          onInput={(event) => setInput(event.detail.value)}
          onConfirm={() => openSearch()}
        />
        <Button className='ai-assistant-search__button' onClick={() => openSearch()}>搜索</Button>
      </View>

      <View className='ai-assistant-stage'>
        <View className={phase === 'recording' ? 'ai-assistant-orbit ai-assistant-orbit--active' : 'ai-assistant-orbit'}>
          <View
            className='ai-assistant-orbit__core'
            hoverClass='ai-assistant-orbit__core--pressed'
            onTouchStart={() => { void beginRecording(); }}
            onTouchEnd={releaseRecording}
            onTouchCancel={releaseRecording}
          >
            <FunctionalIcon name='microphone' className='ai-assistant-orbit__mic' />
          </View>
        </View>
        <Text className='ai-assistant-stage__status'>{phaseText}</Text>
        <Text className='ai-assistant-stage__hint'>最长 60 秒，仅用于本次语音识别</Text>
      </View>

      {intent ? (
        <View className='ai-assistant-result aim-card'>
          <View className='ai-assistant-result__rail' />
          <Text className='ai-assistant-result__label'>我听到</Text>
          <Text className='ai-assistant-result__transcript'>“{intent.transcript}”</Text>
          <Text className='ai-assistant-result__reply'>{aiReply(intent)}</Text>
          {intent.type === 'clarify' && intent.clarify?.candidates.length ? (
            <View className='ai-assistant-result__choices'>
              {intent.clarify.candidates.slice(0, 4).map((candidate, index) => (
                <Button key={candidate.id} className='ai-assistant-result__choice' onClick={() => chooseCandidate(index)}>
                  {candidate.label}
                </Button>
              ))}
            </View>
          ) : null}
          {action ? (
            <Button className='ai-assistant-result__action' onClick={() => { void performAction(action); }}>
              {action.label} <Text>→</Text>
            </Button>
          ) : null}
        </View>
      ) : (
        <View className='ai-assistant-suggestions'>
          <Text className='ai-assistant-suggestions__title'>可以这样说</Text>
          {suggestions.map((item, index) => (
            <View className='ai-assistant-suggestion' key={item} onClick={() => openSearch(item)}>
              <Text className='ai-assistant-suggestion__index'>0{index + 1}</Text>
              <Text className='ai-assistant-suggestion__text'>{item}</Text>
              <Text className='ai-assistant-suggestion__arrow'>↗</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
