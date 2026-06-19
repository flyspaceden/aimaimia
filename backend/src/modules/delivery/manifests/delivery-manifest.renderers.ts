import * as fs from 'node:fs';

import * as fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp = require('sharp');

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN_LEFT = 40;
const PDF_MARGIN_RIGHT = 40;
const PDF_MARGIN_TOP = 40;
const PDF_MARGIN_BOTTOM = 40;
const PDF_FONT_SIZE = 16;
const PDF_LINE_HEIGHT = 28;
const PDF_TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const PDF_RENDER_SCALE = 3;
const SOURCE_HAN_SANS_VF_PATH = require.resolve('@fontpkg/source-han-sans-vf/SourceHanSans-VF.ttf.woff2');

let cachedFontBytes: Uint8Array | null = null;
let cachedFontBase64: string | null = null;

function normalizePdfLine(value: unknown) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}

function getSourceHanSansBytes() {
  if (!cachedFontBytes) {
    cachedFontBytes = fs.readFileSync(SOURCE_HAN_SANS_VF_PATH);
  }
  return cachedFontBytes;
}

function getSourceHanSansBase64() {
  if (!cachedFontBase64) {
    cachedFontBase64 = Buffer.from(getSourceHanSansBytes()).toString('base64');
  }
  return cachedFontBase64;
}

function wrapPdfLine(line: string, maxWidth: number, widthOfTextAtSize: (text: string) => number) {
  const normalized = normalizePdfLine(line);
  if (!normalized) {
    return [''];
  }

  const wrapped: string[] = [];
  let current = '';

  for (const symbol of normalized) {
    const candidate = `${current}${symbol}`;
    if (!current || widthOfTextAtSize(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    wrapped.push(current);
    current = symbol;
  }

  if (current) {
    wrapped.push(current);
  }

  return wrapped;
}

function chunkPdfLines(lines: string[]) {
  const pages: string[][] = [];
  const maxLinesPerPage = Math.max(
    1,
    Math.floor((PDF_PAGE_HEIGHT - PDF_MARGIN_TOP - PDF_MARGIN_BOTTOM) / PDF_LINE_HEIGHT),
  );

  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }

  return pages.length ? pages : [['']];
}

function getPdfLineY(index: number) {
  return PDF_PAGE_HEIGHT - PDF_MARGIN_TOP - PDF_FONT_SIZE - index * PDF_LINE_HEIGHT;
}

async function renderPdfPagePng(lines: string[]) {
  const fontBase64 = getSourceHanSansBase64();
  const textNodes = lines
    .map((line, index) => {
      const baselineY = PDF_MARGIN_TOP + PDF_FONT_SIZE + index * PDF_LINE_HEIGHT;
      return `<text x="${PDF_MARGIN_LEFT}" y="${baselineY}">${escapeXml(line)}</text>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  width="${PDF_PAGE_WIDTH * PDF_RENDER_SCALE}"
  height="${PDF_PAGE_HEIGHT * PDF_RENDER_SCALE}"
  viewBox="0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}">
  <style>
    @font-face { font-family: 'SourceHanSans'; src: url(data:font/woff2;base64,${fontBase64}) format('woff2'); }
    text { font-family: 'SourceHanSans'; font-size: ${PDF_FONT_SIZE}px; fill: #111111; }
  </style>
  <rect width="100%" height="100%" fill="#ffffff" />
  ${textNodes}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function buildSimplePdf(lines: string[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await pdfDoc.embedFont(getSourceHanSansBytes(), { subset: true });
  const maxTextWidth = PDF_PAGE_WIDTH - PDF_MARGIN_LEFT - PDF_MARGIN_RIGHT;
  const widthOfTextAtSize = (text: string) => font.widthOfTextAtSize(text, PDF_FONT_SIZE);
  const wrappedLines = (lines.length ? lines : ['']).flatMap((line) =>
    wrapPdfLine(line, maxTextWidth, widthOfTextAtSize),
  );
  const pages = chunkPdfLines(wrappedLines);

  for (const pageLines of pages) {
    const page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    const pagePng = await renderPdfPagePng(pageLines);
    const image = await pdfDoc.embedPng(pagePng);

    page.drawImage(image, {
      x: 0,
      y: 0,
      width: PDF_PAGE_WIDTH,
      height: PDF_PAGE_HEIGHT,
    });

    for (let index = 0; index < pageLines.length; index += 1) {
      page.drawText(pageLines[index], {
        x: PDF_MARGIN_LEFT,
        y: getPdfLineY(index),
        size: PDF_FONT_SIZE,
        font,
        color: PDF_TEXT_COLOR,
        opacity: 0,
      });
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSpreadsheetXml(headers: string[], rows: string[][]): Buffer {
  const headerRow = headers
    .map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`)
    .join('');
  const bodyRows = rows
    .map(
      (row) =>
        `<Row>${row
          .map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`)
          .join('')}</Row>`,
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Manifest">
    <Table>
      <Row>${headerRow}</Row>
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`;

  return Buffer.from(xml, 'utf8');
}
