// 签到仓库：7 天连续签到占位
import type { Result } from '../types';

export type CheckInReward = {
  day: number;
  label: string;
  points?: number;
  growth?: number;
  highlight?: boolean;
};

export type CheckInStatus = {
  streakDays: number;
  todayChecked: boolean;
  rewards: CheckInReward[];
};

const STORAGE_KEY = 'nm_checkin_v1';

const baseRewards: CheckInReward[] = [
  { day: 1, label: '+10 成长值', growth: 10 },
  { day: 2, label: '+20 成长值', growth: 20 },
  { day: 3, label: '+30 积分', points: 30, highlight: true },
  { day: 4, label: '+20 成长值', growth: 20 },
  { day: 5, label: '+50 积分', points: 50 },
  { day: 6, label: '+30 成长值', growth: 30 },
  { day: 7, label: '+80 积分', points: 80, highlight: true },
];

const readStatus = (): CheckInStatus & { lastDate?: string } => {
  const raw = uni.getStorageSync(STORAGE_KEY);
  if (!raw) {
    return { streakDays: 0, todayChecked: false, rewards: baseRewards };
  }
  try {
    const parsed = JSON.parse(String(raw));
    return { streakDays: 0, todayChecked: false, rewards: baseRewards, ...(parsed as any) };
  } catch {
    return { streakDays: 0, todayChecked: false, rewards: baseRewards };
  }
};

const writeStatus = (status: CheckInStatus & { lastDate?: string }) => {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(status));
};

const isSameDay = (a: string, b: string) => a === b;

const isYesterday = (date: string, today: string) => {
  const prev = new Date(today);
  prev.setDate(prev.getDate() - 1);
  const prevKey = prev.toISOString().slice(0, 10);
  return date === prevKey;
};

export const CheckInRepo = {
  getStatus: async (): Promise<Result<CheckInStatus>> => {
    const today = new Date().toISOString().slice(0, 10);
    const data = readStatus();
    const next: CheckInStatus & { lastDate?: string } = {
      ...data,
      todayChecked: data.lastDate ? isSameDay(data.lastDate, today) : false,
    };
    writeStatus(next);
    return { ok: true, data: next };
  },

  checkIn: async (): Promise<Result<{ status: CheckInStatus; lastReward?: CheckInReward }>> => {
    const today = new Date().toISOString().slice(0, 10);
    const current = readStatus();
    if (current.lastDate && isSameDay(current.lastDate, today)) {
      return { ok: true, data: { status: current, lastReward: baseRewards[current.streakDays - 1] } };
    }
    const nextStreak = current.lastDate && isYesterday(current.lastDate, today) ? current.streakDays + 1 : 1;
    const streak = Math.min(7, nextStreak);
    const next: CheckInStatus & { lastDate?: string } = {
      streakDays: streak,
      todayChecked: true,
      rewards: baseRewards,
      lastDate: today,
    };
    writeStatus(next);
    return { ok: true, data: { status: next, lastReward: baseRewards[streak - 1] } };
  },
};
