/**
 * 域模型：内容运营（Ops）
 *
 * 用途：
 * - 精华内容/贡献值榜单/运营队列（v2 占位）
 */
export type ContributionRole = 'company' | 'user';

export type ContributionRankItem = {
  id: string;
  name: string;
  avatar?: string;
  role: ContributionRole;
  score: number;
  badge?: string;
  city?: string;
};
