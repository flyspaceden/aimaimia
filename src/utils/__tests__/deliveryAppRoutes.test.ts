import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');

describe('delivery app route contracts', () => {
  it('keeps every delivery tool route declared in the delivery stack layout', () => {
    const layout = readFileSync(join(root, 'app/delivery/_layout.tsx'), 'utf8');

    expect(layout).toContain('<Stack.Screen name="cs" />');
  });
});
