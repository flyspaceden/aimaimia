declare const require: (moduleName: string) => any;
declare const __dirname: string;

const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};
const { join } = require('path') as {
  join: (...paths: string[]) => string;
};

const root = join(__dirname, '../../..');

describe('delivery app route contracts', () => {
  it('keeps every delivery tool route declared in the delivery stack layout', () => {
    const layout = readFileSync(join(root, 'app/delivery/_layout.tsx'), 'utf8');

    expect(layout).toContain('<Stack.Screen name="cs" />');
  });

  it('keeps buyer delivery interactions retryable and protected from duplicate actions', () => {
    const products = readFileSync(join(root, 'app/delivery/(tabs)/products.tsx'), 'utf8');
    const productDetail = readFileSync(join(root, 'app/delivery/product/[id].tsx'), 'utf8');
    const orders = readFileSync(join(root, 'app/delivery/orders/index.tsx'), 'utf8');
    const orderDetail = readFileSync(join(root, 'app/delivery/orders/[id].tsx'), 'utf8');
    const customerService = readFileSync(join(root, 'app/delivery/cs.tsx'), 'utf8');
    const unitSelect = readFileSync(join(root, 'app/delivery/unit-select.tsx'), 'utf8');

    expect(products).toContain('event.stopPropagation()');
    expect(products).toContain('quickAddingId');
    expect(products).toContain('item.stock >= (item.minOrderQuantity || 1)');
    expect(products).toContain('重新加载');
    expect(productDetail).toContain('adding');
    expect(productDetail).toContain('库存不足');
    expect(orders).toContain('配送订单加载失败');
    expect(orders).toContain('重新加载');
    expect(customerService).toContain('配送客服加载失败');
    expect(customerService).toContain('重新加载');
    expect(unitSelect).toContain('selectingId');
    expect(orderDetail).toContain('面单打开失败');
  });
});
