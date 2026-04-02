import { CartMergeResultItem } from '../types';

export type PrizeMergeNotice = {
  title: string;
  message: string;
};

export function getPrizeMergeNotice(mergeResults?: CartMergeResultItem[]): PrizeMergeNotice | null {
  if (!mergeResults || mergeResults.length === 0) return null;

  const rejectedPrizeResults = mergeResults.filter(
    (item) => item.isPrize && item.status !== 'MERGED',
  );
  if (rejectedPrizeResults.length === 0) return null;

  if (rejectedPrizeResults.some((item) => item.status === 'REJECTED_ALREADY_DRAWN_TODAY')) {
    return {
      title: '匿名奖品未领取',
      message: '该账号今日已抽奖，匿名中奖奖品未合并到购物车',
    };
  }

  if (rejectedPrizeResults.some((item) =>
    item.status === 'REJECTED_TOKEN_INVALID' ||
    item.status === 'REJECTED_TOKEN_EXPIRED' ||
    item.status === 'REJECTED_TOKEN_USED' ||
    item.status === 'REJECTED_PRIZE_INACTIVE'
  )) {
    return {
      title: '部分奖品已失效',
      message: '匿名中奖奖品凭证已失效，请重新抽奖领取',
    };
  }

  return {
    title: '部分奖品合并失败',
    message: '请重新抽奖领取',
  };
}
