import type { NextFunction, Request, Response } from 'express';

/**
 * Blocks the managed product-image namespace before express.static sees it.
 * It deliberately normalizes encoded and repeated path separators: static
 * middleware decodes them later, so checking only an Express mount path would
 * leave `%2F` and `//` variants as bypasses.
 */
export function blockManagedProductAssetStaticRead(req: Request, res: Response, next: NextFunction) {
  const rawPath = req.url.split('?', 1)[0] || '';
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return res.status(404).end();
  }
  const normalizedKey = decodedPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (normalizedKey === 'seller-product-assets' || normalizedKey.startsWith('seller-product-assets/')) {
    return res.status(404).end();
  }
  return next();
}
