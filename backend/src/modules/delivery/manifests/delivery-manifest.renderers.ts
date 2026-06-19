const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN_LEFT = 40;
const PDF_MARGIN_TOP = 760;
const PDF_LINE_HEIGHT = 16;
const PDF_LINES_PER_PAGE = 44;

function normalizePdfLine(value: unknown) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
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

function chunkLines(lines: string[]) {
  if (!lines.length) {
    return [['']];
  }

  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += PDF_LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + PDF_LINES_PER_PAGE));
  }
  return pages;
}

function buildPdfTextStream(lines: string[]) {
  const normalizedLines = lines.map((line) => normalizePdfLine(line));
  const textBlocks = normalizedLines.map((line) => `<FEFF${toUtf16BeHex(line)}> Tj`);
  const content = [
    'BT',
    '/F1 11 Tf',
    `${PDF_LINE_HEIGHT} TL`,
    `${PDF_MARGIN_LEFT} ${PDF_MARGIN_TOP} Td`,
    ...textBlocks.flatMap((block, index) => (index === 0 ? [block] : ['T*', block])),
    'ET',
  ].join('\n');

  return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
}

export function buildSimplePdf(lines: string[]): Buffer {
  const pages = chunkLines(lines);
  const pageCount = pages.length;
  const firstPageObjectNumber = 3;
  const firstContentObjectNumber = firstPageObjectNumber + pageCount;
  const type0FontObjectNumber = firstContentObjectNumber + pageCount;
  const cidFontObjectNumber = type0FontObjectNumber + 1;

  const pageObjectNumbers = Array.from({ length: pageCount }, (_, index) => firstPageObjectNumber + index);
  const contentObjectNumbers = Array.from(
    { length: pageCount },
    (_, index) => firstContentObjectNumber + index,
  );

  const pageRefs = pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(' ');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`,
    ...pageObjectNumbers.map(
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${type0FontObjectNumber} 0 R >> >> /Contents ${contentObjectNumbers[index]} 0 R >>`,
    ),
    ...pages.map((pageLines) => buildPdfTextStream(pageLines)),
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontObjectNumber} 0 R] >>`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
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
