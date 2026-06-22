import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const sharp = require('sharp');

import { buildSimplePdf } from './delivery-manifest.renderers';

function findCommandInPath(commandName: string) {
  const pathValue = process.env.PATH ?? '';
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.join(entry, commandName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveRequiredCommand(commandName: string) {
  const resolved = findCommandInPath(commandName);
  if (resolved) {
    return resolved;
  }

  if (process.env.DELIVERY_PDF_RENDER_TEST_SKIP === '1') {
    return null;
  }

  throw new Error(
    `Missing required Poppler command "${commandName}" in PATH. Install Poppler or set DELIVERY_PDF_RENDER_TEST_SKIP=1 to skip render verification.`,
  );
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-manifest-renderer-'));
}

function buildMultiPageSampleLines() {
  return Array.from({ length: 80 }, (_, index) => {
    const lineNo = String(index + 1).padStart(2, '0');
    const orderNo = String(index + 1).padStart(4, '0');
    return `第${lineNo}行测试中文北京上海订单${orderNo}`;
  });
}

describe('buildSimplePdf', () => {
  it('creates a non-empty PDF buffer for manifest lines', async () => {
    const pdf = await buildSimplePdf(['测试中文', '北京上海', '𠮷野家']);

    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(pdf.toString('latin1', 0, 8)).toMatch(/^%PDF-1\./);
  }, 20_000);

  it('fails clearly when Poppler is absent unless DELIVERY_PDF_RENDER_TEST_SKIP=1 is set', () => {
    const originalPath = process.env.PATH;
    const originalSkip = process.env.DELIVERY_PDF_RENDER_TEST_SKIP;

    try {
      process.env.PATH = '';
      delete process.env.DELIVERY_PDF_RENDER_TEST_SKIP;
      expect(() => resolveRequiredCommand('pdftotext')).toThrow(
        'Missing required Poppler command "pdftotext" in PATH.',
      );

      process.env.DELIVERY_PDF_RENDER_TEST_SKIP = '1';
      expect(resolveRequiredCommand('pdftotext')).toBeNull();
    } finally {
      process.env.PATH = originalPath;
      if (originalSkip === undefined) {
        delete process.env.DELIVERY_PDF_RENDER_TEST_SKIP;
      } else {
        process.env.DELIVERY_PDF_RENDER_TEST_SKIP = originalSkip;
      }
    }
  });

  it('renders high-resolution CJK text, preserves supplementary characters, and verifies output with Poppler from PATH', async () => {
    const pdftotextBin = resolveRequiredCommand('pdftotext');
    const pdftoppmBin = resolveRequiredCommand('pdftoppm');
    if (!pdftotextBin || !pdftoppmBin) {
      return;
    }

    const workingDir = makeTempDir();
    const pdfPath = path.join(workingDir, 'sample.pdf');
    const pngPrefix = path.join(workingDir, 'sample');
    const pngPath = `${pngPrefix}.png`;

    try {
      const pdf = await buildSimplePdf(['测试中文', '北京上海', '𠮷野家']);
      fs.writeFileSync(pdfPath, pdf);
      const pdfText = pdf.toString('latin1');
      const imageMatch = pdfText.match(/\/Subtype \/Image[\s\S]*?\/Width (\d+)[\s\S]*?\/Height (\d+)/);

      expect(imageMatch).not.toBeNull();
      expect(Number(imageMatch?.[1])).toBeGreaterThan(612);
      expect(Number(imageMatch?.[2])).toBeGreaterThan(792);

      const extractedText = execFileSync(pdftotextBin, [pdfPath, '-'], {
        encoding: 'utf8',
      });

      expect(extractedText).toContain('测试中文');
      expect(extractedText).toContain('北京上海');
      expect(extractedText).toContain('𠮷野家');
      expect(extractedText).not.toContain('?');

      execFileSync(pdftoppmBin, ['-r', '144', '-png', '-singlefile', pdfPath, pngPrefix], {
        stdio: 'pipe',
      });

      const pngStats = fs.statSync(pngPath);
      expect(pngStats.size).toBeGreaterThan(3_000);

      const { data, info } = await sharp(pngPath).removeAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      let darkPixelCount = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
          darkPixelCount += 1;
        }
      }
      expect(darkPixelCount).toBeGreaterThan(500);

      const lineA = await sharp(pngPath)
        .extract({ left: 72, top: 72, width: 360, height: 60 })
        .png()
        .toBuffer();
      const lineB = await sharp(pngPath)
        .extract({ left: 72, top: 128, width: 360, height: 60 })
        .png()
        .toBuffer();

      expect(lineA.equals(lineB)).toBe(false);
    } finally {
      fs.rmSync(workingDir, { recursive: true, force: true });
    }
  }, 20_000);

  it(
    'keeps a multi-page sample PDF operationally small while preserving extraction and pagination',
    async () => {
    const pdftotextBin = resolveRequiredCommand('pdftotext');
    if (!pdftotextBin) {
      return;
    }

    const workingDir = makeTempDir();
    const pdfPath = path.join(workingDir, 'multi-page.pdf');
    const lines = buildMultiPageSampleLines();

    try {
      const pdf = await buildSimplePdf(lines);
      fs.writeFileSync(pdfPath, pdf);

      expect(pdf.byteLength).toBeLessThan(4_000_000);

      const extractedText = execFileSync(pdftotextBin, [pdfPath, '-'], {
        encoding: 'utf8',
      });

      expect(extractedText).toContain(lines[0]);
      expect(extractedText).toContain(lines[lines.length - 1]);
    } finally {
      fs.rmSync(workingDir, { recursive: true, force: true });
    }
    },
    20_000,
  );
});
