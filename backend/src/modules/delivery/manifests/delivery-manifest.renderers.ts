import * as fs from 'node:fs';

import * as fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib';
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
const PDF_VISIBLE_IMAGE_QUALITY = 88;
const PDF_BUILT_IN_CJK_FONT_NAME = 'FST';
const SOURCE_HAN_SANS_VF_PATH = require.resolve('@fontpkg/source-han-sans-vf/SourceHanSans-VF.ttf.woff2');

let cachedFontBytes: Uint8Array | null = null;
let cachedFontBase64: string | null = null;

type PdfOverlayLine = {
  index: number;
  text: string;
};

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

function containsNonBmpCharacters(value: string) {
  for (const symbol of value) {
    if ((symbol.codePointAt(0) ?? 0) > 0xffff) {
      return true;
    }
  }
  return false;
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

function toUtf16BeHex(value: string) {
  const codeUnits: number[] = [];

  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0xffff) {
      codeUnits.push(codePoint);
      continue;
    }

    const adjusted = codePoint - 0x10000;
    codeUnits.push(0xd800 + (adjusted >> 10));
    codeUnits.push(0xdc00 + (adjusted & 0x3ff));
  }

  return codeUnits.map((unit) => unit.toString(16).toUpperCase().padStart(4, '0')).join('');
}

function createBuiltInCjkFontRef(pdfDoc: PDFDocument) {
  const cidFontRef = pdfDoc.context.register(
    pdfDoc.context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType0',
      BaseFont: 'STSong-Light',
      CIDSystemInfo: pdfDoc.context.obj({
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('GB1'),
        Supplement: 4,
      }),
      DW: 1000,
    }),
  );

  return pdfDoc.context.register(
    pdfDoc.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'STSong-Light',
      Encoding: 'UniGB-UCS2-H',
      DescendantFonts: [cidFontRef],
    }),
  );
}

function addBuiltInCjkTextOverlay(
  pdfDoc: PDFDocument,
  page: any,
  builtInCjkFontRef: any,
  lines: PdfOverlayLine[],
) {
  if (!lines.length) {
    return;
  }

  page.node.setFontDictionary(PDFName.of(PDF_BUILT_IN_CJK_FONT_NAME), builtInCjkFontRef);

  const content = ['BT', '3 Tr', `/${PDF_BUILT_IN_CJK_FONT_NAME} ${PDF_FONT_SIZE} Tf`, `${PDF_LINE_HEIGHT} TL`];

  let previousIndex = 0;
  lines.forEach((line, index) => {
    if (index === 0) {
      content.push(`${PDF_MARGIN_LEFT} ${getPdfLineY(line.index)} Td`);
    } else {
      content.push(`0 ${-(line.index - previousIndex) * PDF_LINE_HEIGHT} Td`);
    }
    content.push(`<FEFF${toUtf16BeHex(normalizePdfLine(line.text))}> Tj`);
    previousIndex = line.index;
  });

  content.push('ET');

  const contentRef = pdfDoc.context.register(pdfDoc.context.stream(content.join('\n')));
  page.node.addContentStream(contentRef);
}

async function renderPdfPageJpeg(lines: string[]) {
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

  return sharp(Buffer.from(svg))
    .flatten({ background: '#ffffff' })
    .jpeg({
      quality: PDF_VISIBLE_IMAGE_QUALITY,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer();
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
  const builtInCjkFontRef = createBuiltInCjkFontRef(pdfDoc);

  for (const pageLines of pages) {
    const page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    const pageJpeg = await renderPdfPageJpeg(pageLines);
    const image = await pdfDoc.embedJpg(pageJpeg);

    page.drawImage(image, {
      x: 0,
      y: 0,
      width: PDF_PAGE_WIDTH,
      height: PDF_PAGE_HEIGHT,
    });

    const builtInOverlayLines: PdfOverlayLine[] = [];
    for (let index = 0; index < pageLines.length; index += 1) {
      if (containsNonBmpCharacters(pageLines[index])) {
        page.drawText(pageLines[index], {
          x: PDF_MARGIN_LEFT,
          y: getPdfLineY(index),
          size: PDF_FONT_SIZE,
          font,
          color: PDF_TEXT_COLOR,
          opacity: 0,
        });
        continue;
      }

      builtInOverlayLines.push({
        index,
        text: pageLines[index],
      });
    }

    addBuiltInCjkTextOverlay(pdfDoc, page, builtInCjkFontRef, builtInOverlayLines);
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
