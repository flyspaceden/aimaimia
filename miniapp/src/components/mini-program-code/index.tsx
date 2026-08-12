import { Button, Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MiniProgramCodeRepo, persistMiniProgramCode, removePersistedMiniProgramCode, type MiniProgramCodeKind } from '@/platform/miniProgramCode';
import { useAuthStore } from '@/store/auth';
import './index.scss';

export function MiniProgramCodePanel({ kind, enabled = true }: { kind: MiniProgramCodeKind; enabled?: boolean }) {
  const authRevision = useAuthStore((state) => state.revision);
  const userId = useAuthStore((state) => state.userId || '');
  const [filePath, setFilePath] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const filePathRef = useRef('');
  const autoGenerationKeyRef = useRef('');
  useEffect(() => () => {
    mounted.current = false;
    generation.current += 1;
    const persistedPath = filePathRef.current;
    filePathRef.current = '';
    if (persistedPath) void removePersistedMiniProgramCode(persistedPath);
  }, []);
  useEffect(() => {
    generation.current += 1;
    autoGenerationKeyRef.current = '';
    const persistedPath = filePathRef.current;
    filePathRef.current = '';
    setFilePath('');
    setBusy(false);
    if (persistedPath) void removePersistedMiniProgramCode(persistedPath);
  }, [authRevision, userId, kind]);

  const generate = useCallback(async () => {
    if (!enabled || busy) return;
    const revisionAtStart = authRevision;
    const userIdAtStart = userId;
    const generationAtStart = generation.current + 1;
    generation.current = generationAtStart;
    setBusy(true);
    try {
      const result = await MiniProgramCodeRepo.create(kind);
      const afterRequest = useAuthStore.getState();
      if (!mounted.current || generation.current !== generationAtStart
        || afterRequest.revision !== revisionAtStart || afterRequest.userId !== userIdAtStart) return;
      if (!result.ok) {
        await Taro.showToast({ title: result.error.displayMessage || '生成失败', icon: 'none' });
        return;
      }
      const persistedPath = await persistMiniProgramCode(result.data);
      const afterPersist = useAuthStore.getState();
      if (!mounted.current || generation.current !== generationAtStart
        || afterPersist.revision !== revisionAtStart || afterPersist.userId !== userIdAtStart) {
        await removePersistedMiniProgramCode(persistedPath);
        return;
      }
      const previousPath = filePathRef.current;
      filePathRef.current = persistedPath;
      setFilePath(persistedPath);
      if (previousPath && previousPath !== persistedPath) {
        await removePersistedMiniProgramCode(previousPath);
      }
    } catch {
      const current = useAuthStore.getState();
      if (mounted.current && generation.current === generationAtStart
        && current.revision === revisionAtStart && current.userId === userIdAtStart) {
        await Taro.showToast({ title: '小程序码写入失败', icon: 'none' });
      }
    } finally {
      const current = useAuthStore.getState();
      if (mounted.current && generation.current === generationAtStart
        && current.revision === revisionAtStart && current.userId === userIdAtStart) {
        setBusy(false);
      }
    }
  }, [authRevision, busy, enabled, kind, userId]);
  useEffect(() => {
    if (!enabled || !userId || filePath) return;
    const key = `${authRevision}:${userId}:${kind}`;
    if (autoGenerationKeyRef.current === key) return;
    autoGenerationKeyRef.current = key;
    void generate();
  }, [authRevision, enabled, filePath, generate, kind, userId]);
  const save = async () => {
    if (!filePath) return;
    try {
      await Taro.saveImageToPhotosAlbum({ filePath });
      await Taro.showToast({ title: '已保存到相册', icon: 'success' });
    } catch {
      await Taro.showToast({ title: '未保存，可在微信设置中管理相册权限', icon: 'none' });
    }
  };

  return <View className='mini-code-panel aim-card'>
    <View className='mini-code-panel__heading'><View><Text>微信小程序码</Text><Text>{busy ? '正在生成专属小程序码' : '好友扫码后可打开推荐页并完成绑定'}</Text></View><Button disabled={!enabled || busy} loading={busy} onClick={() => { void generate(); }}>{filePath ? '重新生成' : busy ? '生成中' : '重试'}</Button></View>
    {filePath ? <View className='mini-code-panel__result'><Image src={filePath} mode='aspectFit' /><Text>好友扫码即可打开对应页面，分享码不会展示账号内部信息。</Text><Button onClick={() => { void save(); }}>保存到相册</Button></View> : null}
  </View>;
}
