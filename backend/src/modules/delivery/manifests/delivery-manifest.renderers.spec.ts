import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const sharp = require('sharp');

import { buildSimplePdf } from './delivery-manifest.renderers';

const PDFTOTEXT_BIN = '/opt/homebrew/bin/pdftotext';
const PDFTOPPM_BIN = '/opt/homebrew/bin/pdftoppm';

function hasExecutable(filePath: string) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-manifest-renderer-'));
}

describe('buildSimplePdf', () => {
  it('creates a non-empty PDF buffer for manifest lines', async () => {
    const pdf = await buildSimplePdf(['测试中文', '北京上海', '𠮷野家']);

    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(pdf.toString('latin1', 0, 8)).toMatch(/^%PDF-1\./);
  });

  it('renders Chinese text, preserves supplementary characters, and avoids tofu-only raster output', async () => {
    if (!hasExecutable(PDFTOTEXT_BIN) || !hasExecutable(PDFTOPPM_BIN)) {
      const missing = [PDFTOTEXT_BIN, PDFTOPPM_BIN].filter((item) => !hasExecutable(item));
      console.warn(`Skipping Poppler-backed PDF render assertion; missing: ${missing.join(', ')}`);
      return;
    }

    const workingDir = makeTempDir();
    const pdfPath = path.join(workingDir, 'sample.pdf');
    const pngPrefix = path.join(workingDir, 'sample');
    const pngPath = `${pngPrefix}.png`;

    try {
      const pdf = await buildSimplePdf(['测试中文', '北京上海', '𠮷野家']);
      fs.writeFileSync(pdfPath, pdf);

      const extractedText = execFileSync(PDFTOTEXT_BIN, [pdfPath, '-'], {
        encoding: 'utf8',
      });

      expect(extractedText).toContain('测试中文');
      expect(extractedText).toContain('北京上海');
      expect(extractedText).toContain('𠮷野家');
      expect(extractedText).not.toContain('?');

      execFileSync(PDFTOPPM_BIN, ['-r', '72', '-png', '-singlefile', pdfPath, pngPrefix], {
        stdio: 'pipe',
      });

      const lineA = await sharp(pngPath)
        .extract({ left: 36, top: 32, width: 180, height: 40 })
        .png()
        .toBuffer();
      const lineB = await sharp(pngPath)
        .extract({ left: 36, top: 60, width: 180, height: 40 })
        .png()
        .toBuffer();
      const lineC = await sharp(pngPath)
        .extract({ left: 36, top: 88, width: 180, height: 40 })
        .png()
        .toBuffer();

      expect(lineA.equals(lineB)).toBe(false);
      expect(lineB.equals(lineC)).toBe(false);
      expect(lineA.equals(lineC)).toBe(false);
    } finally {
      fs.rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
