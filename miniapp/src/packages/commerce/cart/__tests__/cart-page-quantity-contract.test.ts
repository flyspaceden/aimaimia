import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cartPage = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf8');
const cartStyles = fs.readFileSync(path.resolve(__dirname, '../index.scss'), 'utf8');

describe('cart page quantity mutation contract', () => {
  it('addresses quantity writes by cartItemId and never uses the structural whole-cart mutation', () => {
    expect(cartPage).toContain('changeQuantity(item.id, item.quantity, max, -1)');
    expect(cartPage).toContain('changeQuantity(item.id, item.quantity, max, 1)');
    expect(cartPage).not.toContain("actionMutation.mutate({ kind: 'quantity'");
    expect(cartPage).toContain("queryClient.cancelQueries({ queryKey: ['commerce', 'cart'] })");
    expect(cartPage).toContain('!quantityCoordinator.isPending() && !structuralWriteRef.current');
  });

  it('does not disable every row quantity control while one row is pending', () => {
    const quantityLine = cartPage.split('\n').find((line) => line.includes("<View className='cart-quantity'>"));
    expect(quantityLine).toContain('structuralMutating');
    expect(quantityLine).not.toContain('cartMutating ?');
  });

  it('keeps the header selection circle vertically centered', () => {
    expect(cartStyles).toMatch(
      /\.cart-check\.cart-check--header\s*\{[^}]*align-self:\s*center;[^}]*margin:\s*0 8px 0 0;/,
    );
  });
});
