const sharp = require('sharp') as typeof import('sharp').default;

/** EAN-13 5901234123457，包含静区；生成真实像素以测试解码器输入。 */
export async function productEan13Fixture() {
  const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const invert = (value: string) => value.replace(/[01]/g, (bit) => bit === '0' ? '1' : '0');
  const parity = 'LGGLLG';
  const first = [...'901234'].map((digit, index) => parity[index] === 'L'
    ? left[Number(digit)] : invert([...left[Number(digit)]].reverse().join(''))).join('');
  const last = [...'123457'].map((digit) => invert(left[Number(digit)])).join('');
  const bits = '000000000000101' + first + '01010' + last + '101000000000000';
  const width = bits.length * 4;
  const height = 240;
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (let y = 24; y < height - 24; y++) {
    for (let x = 0; x < width; x++) {
      if (bits[Math.floor(x / 4)] === '1') pixels.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
