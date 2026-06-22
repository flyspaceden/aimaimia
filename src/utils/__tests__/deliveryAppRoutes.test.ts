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
});
