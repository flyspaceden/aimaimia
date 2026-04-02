import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_RECENT_SEARCHES_KEY = '@nongmai_recent_searches';
const RECENT_SEARCHES_KEY = '@nongmai_recent_searches_v2';
const MAX_RECENT = 10;

// 最近搜索 hook：读取/添加/清空搜索历史
export function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.removeItem(LEGACY_RECENT_SEARCHES_KEY).catch(() => undefined);
    AsyncStorage.getItem(RECENT_SEARCHES_KEY).then((val) => {
      if (val) setRecent(JSON.parse(val));
    });
  }, []);

  const add = useCallback(async (keyword: string) => {
    setRecent((prev) => {
      const next = [keyword, ...prev.filter((k) => k !== keyword)].slice(0, MAX_RECENT);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(async () => {
    setRecent([]);
    await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
  }, []);

  return { recent, add, clear };
}
