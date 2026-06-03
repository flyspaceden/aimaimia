// src/components/ui/Countdown.tsx
import React, { useEffect, useState } from 'react';
import { Text, TextProps } from 'react-native';

interface Props extends TextProps {
  /** ISO timestamp，绝对过期时间 */
  expiresAt: string;
  /** 显示格式 */
  format?: 'mm:ss' | 'hh:mm:ss' | 'days';
  /** 倒计时归零回调 */
  onExpire?: () => void;
  /** 前缀文案 */
  prefix?: string;
}

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export function Countdown({ expiresAt, format = 'mm:ss', onExpire, prefix, ...rest }: Props) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));

  useEffect(() => {
    if (remaining <= 0) { onExpire?.(); return; }
    const id = setInterval(() => {
      const r = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemaining(r);
      if (r <= 0) { clearInterval(id); onExpire?.(); }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire, remaining]);

  const totalSec = Math.floor(remaining / 1000);
  let label: string;
  if (format === 'days') {
    const days = Math.floor(totalSec / 86400);
    const hrs = Math.floor((totalSec % 86400) / 3600);
    label = `${days} 天 ${hrs} 小时`;
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
