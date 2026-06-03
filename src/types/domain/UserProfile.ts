/**
 * 域模型：用户资料（UserProfile）
 *
 * 用途：
 * - 我的页身份名片（等级/成长值/积分/头像框）、发帖/评论作者信息
 */
import { AvatarFrame } from './Me';

export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';

export type UserProfile = {
  id: string;
  name: string;
  phone?: string;
  /** 微信是否已绑定（绑定状态权威判定字段，与昵称解耦） */
  wechatBound?: boolean;
  wechatNickname?: string;
  avatar: string;
  gender?: Gender;
  birthday?: string | null;
  level: string;
  levelProgress: number;
  growthPoints: number;
  nextLevelPoints: number;
  points: number;
  location: string;
  interests?: string[];
  avatarFrame?: AvatarFrame;
  /** 用户是否已同意退换货政策 */
  hasAgreedReturnPolicy?: boolean;
};
