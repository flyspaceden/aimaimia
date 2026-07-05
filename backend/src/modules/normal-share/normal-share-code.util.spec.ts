import { pickUniqueNormalShareCode } from './normal-share-code.util';

const NORMAL_SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSequenceForNormalShareCodes(codes: string[]) {
  const values = codes.flatMap((code) => Array.from(code.slice(1)).map((char) => {
    const index = NORMAL_SHARE_CODE_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Unsupported normal share code test character: ${char}`);
    }
    return (index + 0.01) / NORMAL_SHARE_CODE_ALPHABET.length;
  }));
  return jest.spyOn(Math, 'random').mockImplementation(() => values.shift() ?? 0);
}

describe('pickUniqueNormalShareCode', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips codes already used as VIP referral codes', async () => {
    randomSequenceForNormalShareCodes(['SABCDEFG', 'SBCDEFGH']);
    const tx: any = {
      normalShareProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      memberProfile: {
        findFirst: jest.fn(({ where }: any) => {
          if (where.referralCode === 'SABCDEFG') {
            return Promise.resolve({ id: 'vip-member-profile-1' });
          }
          return Promise.resolve(null);
        }),
      },
    };

    await expect(pickUniqueNormalShareCode(tx)).resolves.toBe('SBCDEFGH');
    expect(tx.memberProfile.findFirst).toHaveBeenCalledWith({
      where: { referralCode: 'SABCDEFG' },
      select: { id: true },
    });
  });
});
