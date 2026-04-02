/**
 * AI 对话缓存状态（Store）— 纯本地持久化，不依赖登录
 *
 * 数据流：
 * - 所有对话记录通过 AsyncStorage 持久化到本地
 * - 支持多会话管理（创建/切换/删除）
 * - 页面退出再进入，历史对话不丢失
 * - 登录后可选同步到服务端（未来扩展）
 */
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { AiChatMessage } from '../types';

/** AsyncStorage 适配器 */
const chatStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (Platform.OS === 'web') return localStorage.getItem(name);
    return AsyncStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(name, value);
      return;
    }
    await AsyncStorage.setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(name);
      return;
    }
    await AsyncStorage.removeItem(name);
  },
};

/** 本地会话 */
export type AiChatSession = {
  id: string;
  /** 会话标题（取自第一条用户消息，截断 20 字） */
  title: string;
  messages: AiChatMessage[];
  createdAt: string;
  updatedAt: string;
};

/** 最多保留的本地会话数 */
const MAX_SESSIONS = 50;
const AI_CHAT_STORAGE_KEY = 'nongmai-ai-chat-v2';

type AiChatState = {
  /** 所有本地会话（按 updatedAt 降序） */
  sessions: AiChatSession[];
  /** 当前活跃会话 ID */
  activeSessionId: string | null;

  /** 创建新会话，返回会话 ID */
  createSession: () => string;
  /** 切换到指定会话 */
  setActiveSession: (sessionId: string) => void;
  /** 删除会话 */
  deleteSession: (sessionId: string) => void;
  /** 清空所有会话 */
  clearAllSessions: () => void;

  /** 往当前会话追加消息 */
  addMessage: (message: AiChatMessage) => void;
  /** 获取当前会话消息 */
  getActiveMessages: () => AiChatMessage[];
  /** 获取当前会话 */
  getActiveSession: () => AiChatSession | undefined;
};

export const useAiChatStore = create<AiChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

      createSession: () => {
        const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date().toISOString();
        const session: AiChatSession = {
          id,
          title: '新对话',
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => {
          // 新会话插入头部，超过上限时移除最旧的
          const updated = [session, ...state.sessions];
          if (updated.length > MAX_SESSIONS) {
            updated.splice(MAX_SESSIONS);
          }
          return { sessions: updated, activeSessionId: id };
        });
        return id;
      },

      setActiveSession: (sessionId) => {
        set({ activeSessionId: sessionId });
      },

      deleteSession: (sessionId) => {
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== sessionId);
          const activeSessionId =
            state.activeSessionId === sessionId ? null : state.activeSessionId;
          return { sessions, activeSessionId };
        });
      },

      clearAllSessions: () => {
        set({ sessions: [], activeSessionId: null });
      },

      addMessage: (message) => {
        set((state) => {
          const { activeSessionId, sessions } = state;
          if (!activeSessionId) return state;

          return {
            sessions: sessions.map((s) => {
              if (s.id !== activeSessionId) return s;
              const messages = [...s.messages, message];
              // 用第一条用户消息作为标题
              const title =
                s.title === '新对话' && message.role === 'user'
                  ? message.content.slice(0, 20) + (message.content.length > 20 ? '...' : '')
                  : s.title;
              return { ...s, messages, title, updatedAt: new Date().toISOString() };
            }),
          };
        });
      },

      getActiveMessages: () => {
        const { activeSessionId, sessions } = get();
        if (!activeSessionId) return [];
        return sessions.find((s) => s.id === activeSessionId)?.messages ?? [];
      },

      getActiveSession: () => {
        const { activeSessionId, sessions } = get();
        if (!activeSessionId) return undefined;
        return sessions.find((s) => s.id === activeSessionId);
      },
    }),
    {
      name: AI_CHAT_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => chatStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
      migrate: async () => ({
        sessions: [],
        activeSessionId: null,
      }),
    },
  ),
);
