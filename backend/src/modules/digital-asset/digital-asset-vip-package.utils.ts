export type VipPackageRuleLike = {
  id: string;
  price: number;
  status?: string | null;
  selfSeedAssetAmount?: number;
  referralSeedAssetAmount?: number;
};

export function resolveVipBackfillPackage<T extends VipPackageRuleLike>(params: {
  packageId: string | null;
  vipAmount: number;
  vipPackages: T[];
}): T | null {
  const { packageId, vipAmount, vipPackages } = params;

  if (packageId) {
    const matchedById = vipPackages.find((pkg) => pkg.id === packageId);
    if (matchedById) return matchedById;
  }

  return vipPackages.find((pkg) => (pkg.status ?? 'ACTIVE') === 'ACTIVE' && pkg.price === vipAmount) ?? null;
}
