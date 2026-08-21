import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('product detail action bar', () => {
  it('keeps quantity in the SKU section and only purchase actions in the fixed bar', () => {
    const page = source('src/packages/commerce/catalog-product/index.tsx');
    const quantityRow = page.indexOf("className='catalog-product-quantity-row'");
    const fixedBar = page.indexOf("className='catalog-product-bar'");

    expect(quantityRow).toBeGreaterThan(0);
    expect(fixedBar).toBeGreaterThan(quantityRow);
    expect(page.slice(fixedBar)).not.toContain("className='catalog-product-quantity'");
  });

  it('uses a real cart glyph and count badge instead of the placeholder character', () => {
    const page = source('src/packages/commerce/catalog-product/index.tsx');

    expect(page).toContain("<FunctionalIcon name='cart' />");
    expect(source('src/components/functional-icon.tsx')).toContain("functional-icon__cart-basket");
    expect(page).toContain("className='catalog-product-cart-entry__badge'");
    expect(page).toContain("queryKey: ['commerce', 'cart']");
    expect(page).not.toContain("catalog-product-cart-entry__icon'>购");
  });

  it('prevents the two primary actions from wrapping on narrow screens', () => {
    const styles = source('src/packages/commerce/catalog-product/index.scss');

    expect(styles).toContain('.catalog-product-bar__button text');
    expect(styles).toMatch(/\.catalog-product-bar__button text \{[^}]*white-space: nowrap;/);
    expect(styles).toContain('.catalog-product-bar__button::after { border: 0; }');
  });
});
