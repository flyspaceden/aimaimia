export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';

export type AvatarFrame = {
  id: string;
  type: string;
  label: string;
  expiresAt?: string;
};

export type UserProfile = {
  id: string;
  buyerNo?: string | null;
  name: string;
  phone?: string;
  wechatBound: boolean;
  wechatNickname?: string;
  hasAgreedReturnPolicy: boolean;
  avatar: string;
  gender: Gender;
  birthday: string | null;
  level: string;
  levelProgress: number;
  growthPoints: number;
  nextLevelPoints: number;
  points: number;
  location: string;
  interests: string[];
  avatarFrame?: AvatarFrame;
};

/** 小程序 PUT /me（App 兼容 PATCH）只接收 avatarFrameId，不接收展示用 avatarFrame 对象。 */
export type UpdateUserProfileInput = Partial<Pick<
  UserProfile,
  'name' | 'location' | 'interests' | 'avatar' | 'gender'
>> & {
  avatarFrameId?: string;
  /** 后端 UpdateProfileDto 要求 ISO 日期字符串，不接收 null。 */
  birthday?: string;
};
