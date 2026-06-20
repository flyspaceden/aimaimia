import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { copyDeliveryClientToDist } = require('./copy-delivery-client-to-dist.cjs');

describe('copyDeliveryClientToDist', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'delivery-client-copy-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('copies the generated delivery Prisma client into the runtime dist path', () => {
    const sourceDir = join(rootDir, 'src', 'generated', 'delivery-client');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'index.js'), 'module.exports = { ok: true };');

    copyDeliveryClientToDist(rootDir);

    const copiedIndex = join(
      rootDir,
      'dist',
      'src',
      'generated',
      'delivery-client',
      'index.js',
    );
    expect(existsSync(copiedIndex)).toBe(true);
    expect(readFileSync(copiedIndex, 'utf8')).toBe('module.exports = { ok: true };');
  });
});
