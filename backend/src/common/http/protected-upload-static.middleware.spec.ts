import { blockManagedProductAssetStaticRead } from './protected-upload-static.middleware';

describe('blockManagedProductAssetStaticRead', () => {
  const run = (url: string) => {
    const res = { status: jest.fn().mockReturnThis(), end: jest.fn() };
    const next = jest.fn();
    blockManagedProductAssetStaticRead({ url } as any, res as any, next);
    return { res, next };
  };

  it.each([
    '/seller-product-assets/pending.webp',
    '/seller-product-assets%2Fpending.webp',
    '//seller-product-assets/pending.webp',
    '/%73eller-product-assets/pending.webp',
  ])('blocks encoded or repeated-separator managed asset path %s', (url) => {
    const { res, next } = run(url);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('passes unrelated upload paths to the normal static middleware', () => {
    const { res, next } = run('/avatars/user.webp');
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
