import { pickUniqueReferralCode } from './referral-code.util';

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSequenceForCodes(codes: string[]) {
  const values = codes.flatMap((code) => Array.from(code).map((char) => {
    const index = REFERRAL_CODE_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Unsupported referral code test character: ${char}`);
    }
    return (index + 0.01) / REFERRAL_CODE_ALPHABET.length;
  }));
  return jest.spyOn(Math, 'random').mockImplementation(() => values.shift() ?? 0);
}

describe('pickUniqueReferralCode', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips codes already used by normal share profiles', async () => {
    randomSequenceForCodes(['SAAAAAAA', 'BAAAAAAA']);
    const prisma: any = {
      memberProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      normalShareProfile: {
        findFirst: jest.fn(({ where }: any) => {
          if (where.code === 'SAAAAAAA') {
            return Promise.resolve({ id: 'normal-share-profile-1' });
          }
          return Promise.resolve(null);
        }),
      },
    };

    await expect(pickUniqueReferralCode(prisma, 2)).resolves.toBe('BAAAAAAA');
    expect(prisma.normalShareProfile.findFirst).toHaveBeenCalledWith({
      where: { code: 'SAAAAAAA' },
      select: { id: true },
    });
  });
});
