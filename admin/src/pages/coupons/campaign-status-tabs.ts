import type { CouponCampaignStatus } from '@/api/coupon';

export type CampaignStatusTabKey = CouponCampaignStatus | 'ALL';

export const DEFAULT_CAMPAIGN_STATUS_TAB: CampaignStatusTabKey = 'ACTIVE';

export const campaignStatusTabs: Array<{
  key: CampaignStatusTabKey;
  label: string;
  status: CouponCampaignStatus | undefined;
}> = [
  { key: 'ACTIVE', label: '进行中', status: 'ACTIVE' },
  { key: 'PAUSED', label: '已暂停', status: 'PAUSED' },
  { key: 'DRAFT', label: '草稿', status: 'DRAFT' },
  { key: 'ENDED', label: '已结束', status: 'ENDED' },
  { key: 'ALL', label: '全部', status: undefined },
];

export function getCampaignStatusQuery(tabKey: CampaignStatusTabKey): CouponCampaignStatus | undefined {
  return campaignStatusTabs.find((tab) => tab.key === tabKey)?.status;
}
