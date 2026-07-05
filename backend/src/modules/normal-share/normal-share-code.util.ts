export const NORMAL_SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateNormalShareCode(random: () => number = Math.random) {
  let code = 'S';
  for (let i = 0; i < 7; i += 1) {
    code += NORMAL_SHARE_CODE_ALPHABET.charAt(Math.floor(random() * NORMAL_SHARE_CODE_ALPHABET.length));
  }
  return code;
}

type NormalShareCodeClient = {
  normalShareProfile: {
    findUnique: (args: { where: { code: string } }) => Promise<{ id: string } | null>;
  };
  memberProfile?: {
    findFirst: (args: {
      where: { referralCode: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

async function isNormalShareCodeOccupied(tx: NormalShareCodeClient, code: string) {
  const existingNormalShareCode = await tx.normalShareProfile.findUnique({
    where: { code },
  });
  if (existingNormalShareCode) return true;

  if (!tx.memberProfile) return false;
  const existingVipReferralCode = await tx.memberProfile.findFirst({
    where: { referralCode: code },
    select: { id: true },
  });
  return Boolean(existingVipReferralCode);
}

export async function pickUniqueNormalShareCode(tx: NormalShareCodeClient) {
  for (let i = 0; i < 10; i += 1) {
    const code = generateNormalShareCode();
    const occupied = await isNormalShareCodeOccupied(tx, code);
    if (!occupied) {
      return code;
    }
  }
  throw new Error('pickUniqueNormalShareCode: 10 次尝试均冲突');
}
