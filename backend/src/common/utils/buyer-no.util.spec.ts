import {
  BUYER_NO_REGEX,
  formatBuyerNo,
  isBuyerNo,
  nextBuyerNo,
  resolveBuyerUserId,
} from './buyer-no.util';

describe('buyer-no.util', () => {
  it('formats AIMM + 14 digit buyer numbers', () => {
    expect(formatBuyerNo(1)).toBe('AIMM00000000000001');
    expect(formatBuyerNo(99999999999999)).toBe('AIMM99999999999999');
  });

  it('rejects out-of-range sequence values', () => {
    expect(() => formatBuyerNo(0)).toThrow('buyerNo sequence out of range');
    expect(() => formatBuyerNo(100000000000000)).toThrow('buyerNo sequence out of range');
  });

  it('detects only canonical buyer numbers', () => {
    expect(BUYER_NO_REGEX.test('AIMM00000000000001')).toBe(true);
    expect(isBuyerNo('AIMM00000000000001')).toBe(true);
    expect(isBuyerNo('aimm00000000000001')).toBe(true);
    expect(isBuyerNo('AIMM000000000001')).toBe(false);
    expect(isBuyerNo('cmqc65zt2003rt7ki4i0e89cx')).toBe(false);
  });

  it('generates the next buyer number from PostgreSQL sequence output', async () => {
    const querySql: string[] = [];
    const tx = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        querySql.push(strings.join(' '));
        return Promise.resolve([{ nextval: BigInt(42) }]);
      }),
    } as any;

    await expect(nextBuyerNo(tx)).resolves.toBe('AIMM00000000000042');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(querySql[0]).toContain('pg_advisory_xact_lock');
    expect(querySql[0]).toContain("nextval('buyer_no_seq')");
  });

  it('resolves AIMM input to internal User.id and leaves internal ids unchanged', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-internal-1' }),
      },
    } as any;

    await expect(resolveBuyerUserId(tx, 'AIMM00000000000042')).resolves.toBe('user-internal-1');
    await expect(resolveBuyerUserId(tx, 'cmqc65zt2003rt7ki4i0e89cx')).resolves.toBe(
      'cmqc65zt2003rt7ki4i0e89cx',
    );
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { buyerNo: 'AIMM00000000000042' },
      select: { id: true },
    });
  });

});
