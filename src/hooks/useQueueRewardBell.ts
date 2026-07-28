import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import {
  InboxRepo,
  type QueueRewardBellCursor,
} from '../repos/InboxRepo';
import {
  drainQueueRewardBellEvents,
} from './queueRewardBellDrain';

const POLL_INTERVAL_MS = 20_000;
const PAGE_SIZE = 100;
const STORAGE_KEY_PREFIX = '@aimm/queue-reward-bell/seen/';
const BELL_FILE_NAME = 'aimm-queue-reward-bell.wav';

// 8 kHz / 16-bit mono 的短铃声。放在代码内可让 OTA 更新直接生效，
// 首次播放前再写入缓存，不需要新增原生资源或重新打包 APK。
const BELL_WAV_BASE64 =
  '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';

async function getBellUri(): Promise<string | null> {
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) {
    return null;
  }
  const uri = `${FileSystem.cacheDirectory}${BELL_FILE_NAME}`;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(uri, BELL_WAV_BASE64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  return uri;
}

function createBellPlayer() {
  let soundPromise:
    | Promise<Audio.Sound | null>
    | null = null;
  const getSound = async () => {
    if (!soundPromise) {
      soundPromise = (async () => {
        const uri = await getBellUri();
        if (!uri) return null;
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });
        const loaded = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, volume: 0.72 },
        );
        return loaded.sound;
      })();
    }
    return soundPromise;
  };
  return {
    playOne: async () => {
      const sound = await getSound();
      if (!sound) return;
      await sound.setPositionAsync(0);
      await sound.playAsync();
      await new Promise((resolve) => setTimeout(resolve, 220));
    },
    dispose: async () => {
      if (!soundPromise) return;
      const sound = await soundPromise;
      await sound?.unloadAsync();
    },
  };
}

/**
 * App 前台轮询持久化的钱包消息；一条新的队列红包消息只响一次。
 * 首次启用时把历史消息作为基线，避免升级后把旧红包一次性全部重放。
 */
export function useQueueRewardBell(
  enabled: boolean,
  userId?: string,
): void {
  useEffect(() => {
    if (!enabled) return undefined;

    let stopped = false;
    let running = false;
    const storageKey =
      `${STORAGE_KEY_PREFIX}${userId ?? 'current-user'}`;

    const poll = async () => {
      if (
        stopped ||
        running ||
        AppState.currentState !== 'active'
      ) {
        return;
      }
      running = true;
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        let cursor: QueueRewardBellCursor | null = null;
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (
              parsed &&
              typeof parsed.createdAt === 'string' &&
              (
                typeof parsed.id === 'string' ||
                Array.isArray(parsed.idsAtCreatedAt)
              )
            ) {
              cursor = {
                createdAt: parsed.createdAt,
                // 兼容这一功能尚未上线前的本地开发游标格式。
                id:
                  typeof parsed.id === 'string'
                    ? parsed.id
                    : parsed.idsAtCreatedAt
                        .filter(
                          (item: unknown): item is string =>
                            typeof item === 'string',
                        )
                        .sort()
                        .at(-1) ?? '',
              };
            }
          } catch {
            cursor = null;
          }
        }

        // 第一次启用用服务端最后一条消息建立基线，不重放历史红包；
        // 禁止使用设备本地时间，避免设备时钟偏快时永久漏掉后续红包。
        if (!cursor) {
          const baseline =
            await InboxRepo.getQueueRewardBellBaseline();
          if (!baseline.ok) {
            throw new Error(
              baseline.error.displayMessage ||
                baseline.error.message,
            );
          }
          await AsyncStorage.setItem(
            storageKey,
            JSON.stringify(baseline.data),
          );
          return;
        }

        const player = createBellPlayer();
        try {
          await drainQueueRewardBellEvents({
            cursor,
            fetchPage: async (after) => {
              const result =
                await InboxRepo.listQueueRewardEvents(
                  after,
                  PAGE_SIZE,
                );
              if (!result.ok) {
                throw new Error(
                  result.error.displayMessage ||
                    result.error.message,
                );
              }
              return result.data;
            },
            playOne: player.playOne,
            saveCursor: async (nextCursor) => {
              await AsyncStorage.setItem(
                storageKey,
                JSON.stringify(nextCursor),
              );
            },
            shouldStop: () =>
              stopped ||
              AppState.currentState !== 'active',
          });
        } finally {
          await player.dispose();
        }
      } catch {
        // 铃声是附加提醒；网络、缓存或音频失败都不能影响下单和钱包主流程。
      } finally {
        running = false;
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') void poll();
      },
    );

    return () => {
      stopped = true;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [enabled, userId]);
}
