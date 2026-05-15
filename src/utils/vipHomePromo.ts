type VipGiftItemLike = {
  productTitle: string;
  skuTitle: string | null;
  quantity: number;
};

type VipGiftOptionLike = {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  totalPrice: number;
  available: boolean;
  items: VipGiftItemLike[];
};

type VipPackageLike = {
  id: string;
  price: number;
  giftOptions: VipGiftOptionLike[];
};

export type VipHomePromoCard = {
  packageId: string;
  giftOptionId: string;
  price: number;
  title: string;
  subtitle: string;
  badge: string | null;
  totalPrice: number;
  giftCount: number;
  available: boolean;
  itemLines: string[];
  hasMoreItems: boolean;
};

type MemberLike = {
  tier?: string | null;
  referralCode?: string | null;
};

export type VipReferralHomePrompt = {
  title: string;
  actionLabel: string;
  targetPath: '/me/referral';
};

type BuildOptions = {
  maxCards?: number;
  maxItemLines?: number;
};

function formatGiftItem(item: VipGiftItemLike) {
  const skuTitle = item.skuTitle?.trim();
  const name = skuTitle ? `${item.productTitle} ${skuTitle}` : item.productTitle;
  return `${name} ×${item.quantity}`;
}

export function buildVipHomePromoCards(
  packages: VipPackageLike[],
  options: BuildOptions = {},
): VipHomePromoCard[] {
  const maxCards = options.maxCards ?? 3;
  const maxItemLines = options.maxItemLines ?? 2;

  return packages
    .map((pkg) => {
      const gift = pkg.giftOptions.find((item) => item.available);
      if (!gift) return null;

      const allItemLines = gift.items.map(formatGiftItem);
      const itemLines = allItemLines.slice(0, maxItemLines);
      const hasMoreItems = allItemLines.length > itemLines.length;
      const itemSummary = itemLines.join(' + ');
      const subtitle = gift.subtitle?.trim()
        || (itemSummary ? `${itemSummary}${hasMoreItems ? '等' : ''}` : '开通 VIP 即可选择该档位赠品');

      return {
        packageId: pkg.id,
        giftOptionId: gift.id,
        price: pkg.price,
        title: gift.title,
        subtitle,
        badge: gift.badge,
        totalPrice: gift.totalPrice,
        giftCount: pkg.giftOptions.length,
        available: gift.available,
        itemLines,
        hasMoreItems,
      };
    })
    .filter((item): item is VipHomePromoCard => item !== null)
    .slice(0, maxCards);
}

export function buildVipReferralHomePrompt(member: MemberLike | null | undefined): VipReferralHomePrompt | null {
  if (member?.tier !== 'VIP' || !member.referralCode?.trim()) return null;

  return {
    title: '推荐好友开通 VIP，有高额奖励',
    actionLabel: '去分享',
    targetPath: '/me/referral',
  };
}
