/**
 * 心愿仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/wishes.ts` 作为数据源
 * - 在前端侧计算“心愿力/徽章/榜单/企业接单/众筹/积分兑换”等 v2 逻辑，用于演示闭环
 *
 * 后端接入说明：
 * - 建议把“心愿力/徽章/榜单/履约/众筹/兑换”等都放到后端做计算与状态流转，前端只做展示与触发动作
 * - 前端页面只依赖本 Repo 的方法；接入后端时替换方法内部实现即可
 *
 * 建议接口（节选）：
 * - `GET /api/v1/wishes` / `GET /api/v1/wishes?type=...`
 * - `GET /api/v1/wishes/{id}`
 * - `POST /api/v1/wishes`
 * - `PATCH /api/v1/wishes/{id}/status`
 * - `POST /api/v1/wishes/{id}/like`
 * - `GET /api/v1/wishes/rankings?period=weekly|monthly`
 * - `POST /api/v1/wishes/{id}/accept`
 * - `POST /api/v1/wishes/{id}/crowdfunding/pledge`
 * - `POST /api/v1/wishes/{id}/exchange/redeem`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#3-心愿池wish--comments--ai`
 */
import { mockCompanies, mockUserProfile, mockWishes } from '../mocks';
import { wishBadges, wishPowerLevels } from '../constants';
import { Result, Wish, WishBadge, WishPower, WishPowerLevel, WishRankingEntry, WishStatus, WishType, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

const resolveWishPowerLevel = (score: number): WishPowerLevel => {
  const ordered = [...wishPowerLevels].sort((a, b) => b.min - a.min);
  const current = ordered.find((level) => score >= level.min);
  return current?.id ?? 'seed';
};

const buildWishPower = (wish: Wish): WishPower => {
  const base =
    wish.wishPower?.score ??
    Math.round(wish.likeCount * 4 + wish.commentCount * 3 + (wish.isPinned ? 20 : 0));
  return {
    score: Math.max(0, base),
    level: resolveWishPowerLevel(base),
  };
};

const buildWishBadges = (wish: Wish): WishBadge[] => {
  const badges: string[] = [];
  if (wish.isPinned) {
    badges.push('popular');
  }
  if (wish.likeCount >= 25) {
    badges.push('popular');
  }
  if (wish.commentCount >= 6) {
    badges.push('helper');
  }
  if (wish.status === 'done') {
    badges.push('fulfilled');
  }
  if (wish.fulfillment?.status === 'accepted' || wish.fulfillment?.status === 'producing') {
    badges.push('accepted');
  }
  if (wish.crowdfunding?.status === 'open') {
    badges.push('crowdfunding');
  }
  if (wish.type === 'platform') {
    badges.push('creative');
  }

  const unique = badges.filter((item, index) => badges.indexOf(item) === index);
  return unique
    .map((id) => wishBadges.find((badge) => badge.id === id))
    .filter((badge): badge is WishBadge => Boolean(badge));
};

const enrichWish = (wish: Wish): Wish => {
  const wishPower = buildWishPower(wish);
  return {
    ...wish,
    wishPower,
    badges: buildWishBadges({ ...wish, wishPower }),
  };
};

// 心愿仓储：用于心愿池列表与详情
export const WishRepo = {
  /**
   * 心愿列表（综合排序）
   * - 用途：心愿池“发现心愿”
   * - 后端建议：`GET /api/v1/wishes`
   */
  list: async (): Promise<Result<Wish[]>> => {
    const sorted = [...mockWishes].map(enrichWish).sort((a, b) => {
      const pin = Number(b.isPinned ?? false) - Number(a.isPinned ?? false);
      if (pin !== 0) {
        return pin;
      }
      return b.wishPower.score - a.wishPower.score;
    });
    return simulateRequest(sorted);
  },
  /**
   * 按类型筛选心愿
   * - 用途：心愿池“给平台/给企业”分流
   * - 后端建议：`GET /api/v1/wishes?type=platform|company`
   */
  listByType: async (type: WishType): Promise<Result<Wish[]>> =>
    simulateRequest(mockWishes.filter((item) => item.type === type).map(enrichWish)),
  /**
   * 企业相关心愿
   * - 用途：企业页联动（用户对本企业的心愿）
   * - 后端建议：`GET /api/v1/companies/{companyId}/wishes`
   */
  listByCompany: async (companyId: string): Promise<Result<Wish[]>> =>
    simulateRequest(mockWishes.filter((item) => item.companyId === companyId).map(enrichWish)),
  /**
   * 心愿详情
   * - 用途：心愿详情页
   * - 后端建议：`GET /api/v1/wishes/{id}`
   */
  getById: async (id: string): Promise<Result<Wish>> => {
    const wish = mockWishes.find((item) => item.id === id);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${id}`, '心愿未找到'));
    }
    const enriched = enrichWish(wish);
    Object.assign(wish, enriched);
    return simulateRequest(enriched);
  },
  /**
   * 创建心愿
   * - 用途：心愿发布页（允许先不选企业，后续再关联；支持 @ 企业 mentions）
   * - 后端建议：`POST /api/v1/wishes`
   * - body：`{ title, description, tags, type, companyId?, mentions? }`
   */
  create: async (payload: {
    title: string;
    description: string;
    tags: string[];
    type: WishType;
    companyId?: string;
    mentions?: Array<{ id: string; name: string }>;
  }): Promise<Result<Wish>> => {
    const newWish: Wish = {
      id: `w-${Date.now()}`,
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      type: payload.type,
      status: 'planning',
      progress: 10,
      createdAt: new Date().toISOString().slice(0, 10),
      companyId: payload.companyId,
      mentions: payload.mentions,
      author: {
        id: mockUserProfile.id,
        name: mockUserProfile.name,
        avatar: mockUserProfile.avatar,
      },
      likeCount: 0,
      commentCount: 0,
      likedBy: [],
      wishPower: {
        score: 20,
        level: 'seed',
      },
      badges: [],
      fulfillment: {
        status: 'open',
      },
      crowdfunding: {
        targetAmount: 5000,
        pledgedAmount: 0,
        supporters: 0,
        status: 'open',
      },
      exchange: {
        pointsRequired: 80,
        stock: 40,
        redeemed: false,
      },
    };
    const enriched = enrichWish(newWish);
    mockWishes.unshift(enriched);
    return simulateRequest(enriched, { delay: 300 });
  },
  /**
   * 修改心愿状态（仅发起人）
   * - 用途：发起人推动“规划中/已采纳/已完成”等状态流转
   * - 后端建议：`PATCH /api/v1/wishes/{id}/status`
   * - body：`{ status }`
   * - 鉴权：后端通过 token 判断是否为发起人
   */
  updateStatus: async (id: string, status: WishStatus, actorId: string): Promise<Result<Wish>> => {
    const wish = mockWishes.find((item) => item.id === id);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${id}`, '心愿未找到'));
    }
    if (wish.author.id !== actorId) {
      return err(createAppError('FORBIDDEN', '仅发起人可修改心愿状态', '仅发起人可修改'));
    }
    wish.status = status;
    wish.progress = status === 'adopted' ? 60 : status === 'planning' ? 30 : 100;
    const enriched = enrichWish(wish);
    Object.assign(wish, enriched);
    return simulateRequest(enriched, { delay: 300 });
  },
  /**
   * 点赞/取消点赞（心愿）
   * - 用途：心愿详情/心愿列表互动
   * - 后端建议：`POST /api/v1/wishes/{id}/like`（由后端根据是否已点赞决定 toggle）
   */
  toggleLike: async (id: string, userId: string): Promise<Result<Wish>> => {
    const wish = mockWishes.find((item) => item.id === id);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${id}`, '心愿未找到'));
    }
    const hasLiked = wish.likedBy.includes(userId);
    wish.likedBy = hasLiked ? wish.likedBy.filter((item) => item !== userId) : [...wish.likedBy, userId];
    wish.likeCount = wish.likedBy.length;
    const delta = hasLiked ? -4 : 4;
    const nextScore = Math.max(0, (wish.wishPower?.score ?? 0) + delta);
    wish.wishPower = {
      score: nextScore,
      level: resolveWishPowerLevel(nextScore),
    };
    const enriched = enrichWish(wish);
    Object.assign(wish, enriched);
    return simulateRequest(enriched, { delay: 200 });
  },
  // 心愿榜单：根据心愿力综合得分排序（复杂业务逻辑需中文注释）
  /**
   * 心愿榜单
   * - 用途：心愿池 v2“周榜/月榜”
   * - 后端建议：`GET /api/v1/wishes/rankings?period=weekly|monthly`
   */
  listRankings: async (period: 'weekly' | 'monthly'): Promise<Result<WishRankingEntry[]>> => {
    const score = (wish: Wish) => wish.wishPower.score + wish.likeCount * 2 + wish.commentCount;
    const sorted = [...mockWishes]
      .map(enrichWish)
      .sort((a, b) => score(b) - score(a))
      .slice(0, period === 'weekly' ? 6 : 10)
      .map((wish, index) => ({
        id: `${period}-${wish.id}`,
        wishId: wish.id,
        title: wish.title,
        authorName: wish.author.name,
        score: score(wish),
        rank: index + 1,
      }));
    return simulateRequest(sorted, { delay: 240 });
  },
  // 企业接单：模拟企业接单与进度流转（复杂业务逻辑需中文注释）
  /**
   * 企业接单
   * - 用途：心愿 v2 闭环（企业“接单生产”）
   * - 后端建议：`POST /api/v1/wishes/{id}/accept`
   * - body：`{ companyId? }`（不传则由后端按绑定企业/默认企业策略决定）
   */
  acceptByCompany: async (wishId: string, companyId?: string): Promise<Result<Wish>> => {
    const wish = mockWishes.find((item) => item.id === wishId);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${wishId}`, '心愿未找到'));
    }
    if (wish.fulfillment?.status && wish.fulfillment.status !== 'open') {
      return err(createAppError('INVALID', '心愿已进入履约阶段', '当前无需重复接单'));
    }
    const company = mockCompanies.find((item) => item.id === companyId) ?? mockCompanies[0];
    wish.fulfillment = {
      status: 'accepted',
      companyId: company?.id,
      companyName: company?.name,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    if (wish.status === 'planning') {
      wish.status = 'adopted';
      wish.progress = 60;
    }
    const nextScore = (wish.wishPower?.score ?? 0) + 12;
    wish.wishPower = { score: nextScore, level: resolveWishPowerLevel(nextScore) };
    const enriched = enrichWish(wish);
    Object.assign(wish, enriched);
    return simulateRequest(enriched, { delay: 260 });
  },
  // 众筹支持：更新众筹进度与心愿力（复杂业务逻辑需中文注释）
  /**
   * 众筹支持
   * - 用途：心愿 v2 闭环（用户支持众筹，推进生产）
   * - 后端建议：`POST /api/v1/wishes/{id}/crowdfunding/pledge`
   * - body：`{ amount }`
   * - 说明：真实场景需走支付；支付回调成功后再更新 pledgedAmount
   */
  pledgeCrowdfunding: async (wishId: string, amount: number): Promise<Result<Wish>> => {
    const wish = mockWishes.find((item) => item.id === wishId);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${wishId}`, '心愿未找到'));
    }
    if (!wish.crowdfunding) {
      return err(createAppError('INVALID', '该心愿未开放众筹', '暂不可众筹'));
    }
    if (wish.crowdfunding.status !== 'open') {
      return err(createAppError('INVALID', '众筹已结束', '当前不可继续支持'));
    }
    const nextAmount = wish.crowdfunding.pledgedAmount + amount;
    const nextStatus =
      nextAmount >= wish.crowdfunding.targetAmount ? 'success' : wish.crowdfunding.status;
    wish.crowdfunding = {
      ...wish.crowdfunding,
      pledgedAmount: nextAmount,
      supporters: wish.crowdfunding.supporters + 1,
      status: nextStatus,
    };
    if (nextStatus === 'success') {
      wish.progress = Math.max(wish.progress ?? 0, 85);
    }
    const nextScore = (wish.wishPower?.score ?? 0) + Math.round(amount / 5);
    wish.wishPower = { score: nextScore, level: resolveWishPowerLevel(nextScore) };
    const enriched = enrichWish(wish);
    Object.assign(wish, enriched);
    return simulateRequest(enriched, { delay: 240 });
  },
  // 积分兑换：扣减库存并标记已兑换（复杂业务逻辑需中文注释）
  /**
   * 积分兑换
   * - 用途：心愿 v2 闭环（积分兑换福利/试吃名额等）
   * - 后端建议：`POST /api/v1/wishes/{id}/exchange/redeem`
   * - 说明：需要后端做幂等（防重复兑换）、扣减库存、扣减用户积分
   */
  redeemWithPoints: async (wishId: string): Promise<Result<Wish>> => {
    const wish = mockWishes.find((item) => item.id === wishId);
    if (!wish) {
      return err(createAppError('NOT_FOUND', `心愿不存在: ${wishId}`, '心愿未找到'));
    }
    if (!wish.exchange || wish.exchange.stock <= 0) {
      return err(createAppError('INVALID', '积分兑换已售罄', '当前无法兑换'));
    }
    if (wish.exchange.redeemed) {
      return err(createAppError('INVALID', '已完成兑换', '无需重复兑换'));
    }
    wish.exchange = {
      ...wish.exchange,
      stock: Math.max(0, wish.exchange.stock - 1),
      redeemed: true,
    };
    const nextScore = (wish.wishPower?.score ?? 0) + 8;
    wish.wishPower = { score: nextScore, level: resolveWishPowerLevel(nextScore) };
    const enriched = enrichWish(wish);
    Object.assign(wish, enriched);
    return simulateRequest(enriched, { delay: 220 });
  },
};
