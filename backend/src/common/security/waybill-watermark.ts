import sharp from 'sharp';

type PrintWatermarkOptions = {
  documentLabel: string;
  staffId: string;
  printedAt: Date;
};

const CONTENT_TYPE_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

type OutputFormat = keyof typeof CONTENT_TYPE_BY_FORMAT;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveOutputFormat(format?: string | null): OutputFormat {
  if (format === 'jpeg' || format === 'jpg') return 'jpeg';
  if (format === 'webp') return 'webp';
  return 'png';
}

function formatPrintedAt(printedAt: Date): string {
  return printedAt.toISOString().slice(0, 16).replace('T', ' ');
}

function buildWatermarkSvg(
  width: number,
  height: number,
  message: string,
  subtitle: string,
) {
  const rows = 4;
  const cols = 2;
  const startY = Math.round(height * 0.38);
  const rowGap = Math.max(Math.round(height * 0.14), 140);
  const colGap = Math.max(Math.round(width * 0.44), 260);
  const baseX = Math.round(width * 0.08);
  const messageText = escapeXml(message);
  const subtitleText = escapeXml(subtitle);

  let body = '';
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = baseX + col * colGap;
      const y = startY + row * rowGap;
      body += `
        <g transform="translate(${x} ${y}) rotate(-18)">
          <text
            x="0"
            y="0"
            font-size="${Math.max(Math.round(width * 0.026), 26)}"
            font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif"
            font-weight="700"
            fill="rgba(180, 0, 0, 0.18)"
          >${messageText}</text>
          <text
            x="0"
            y="${Math.max(Math.round(width * 0.032), 36)}"
            font-size="${Math.max(Math.round(width * 0.018), 18)}"
            font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif"
            fill="rgba(80, 0, 0, 0.15)"
          >${subtitleText}</text>
        </g>
      `;
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      ${body}
    </svg>
  `;
}

export async function applyWaybillWatermark(
  buffer: Buffer,
  options: PrintWatermarkOptions,
) {
  const source = sharp(buffer, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  const width = Math.max(metadata.width ?? 1200, 720);
  const height = Math.max(metadata.height ?? 1600, 960);
  const outputFormat = resolveOutputFormat(metadata.format);
  const watermark = buildWatermarkSvg(
    width,
    height,
    `仅限${options.documentLabel}履约使用`,
    `${options.staffId} · ${formatPrintedAt(options.printedAt)}`,
  );

  let pipeline = sharp(buffer, { failOn: 'none' })
    .rotate()
    .composite([{ input: Buffer.from(watermark), blend: 'over' }]);

  if (outputFormat === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 92 });
  } else if (outputFormat === 'webp') {
    pipeline = pipeline.webp({ quality: 92 });
  } else {
    pipeline = pipeline.png();
  }

  return {
    buffer: await pipeline.toBuffer(),
    contentType: CONTENT_TYPE_BY_FORMAT[outputFormat],
  };
}
