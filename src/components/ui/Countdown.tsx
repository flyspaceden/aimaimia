// src/components/ui/Countdown.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Text, TextProps } from 'react-native';

interface Props extends TextProps {
  /** ISO timestamp，绝对过期时间 */
  expiresAt: string;
  /** 显示格式 */
  format?: 'mm:ss' | 'hh:mm:ss' | 'days' | 'days-hours-minutes';
  /** 倒计时归零回调 */
  onExpire?: () => void;
  /** 每次刷新回传剩余毫秒数，供父组件切换紧急态 */
  onTick?: (remainingMs: number) => void;
  /** 前缀文案 */
  prefix?: string;
}

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export function Countdown({ expiresAt, format = 'mm:ss', onExpire, onTick, prefix, ...rest }: Props) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  const expiredNotifiedRef = useRef(false);

  useEffect(() => {
    expiredNotifiedRef.current = false;
    setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  }, [expiresAt]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const r = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemaining(r);
      onTick?.(r);
      if (r <= 0 && !expiredNotifiedRef.current) {
        expiredNotifiedRef.current = true;
        onExpire?.();
      }
      if (r <= 0 && id) {
        clearInterval(id);
        id = null;
      }
    };
    tick();
    if (!expiredNotifiedRef.current) {
      id = setInterval(() => {
        tick();
      }, 1000);
    }
    return () => {
      if (id) clearInterval(id);
    };
  }, [expiresAt, onExpire, onTick]);

  const totalSec = Math.floor(remaining / 1000);
  let label: string;
  if (format === 'days' || format === 'days-hours-minutes') {
    const days = Math.floor(totalSec / 86400);
    const hrs = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    label = format === 'days'
      ? `${days} 天 ${hrs} 小时`
      : days > 0
        ? `${days} 天 ${hrs} 小时 ${mins} 分钟`
        : `${hrs} 小时 ${mins} 分钟`;
  } else if (format === 'hh:mm:ss') {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    label = `${pad(h)}:${pad(m)}:${pad(s)}`;
  } else {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    label = `${pad(m)}:${pad(s)}`;
  }

  return <Text {...rest}>{prefix ? `${prefix} ` : ''}{label}</Text>;
}
