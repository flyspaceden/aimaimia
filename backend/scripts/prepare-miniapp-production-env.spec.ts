const dotenv = require('dotenv');
const {
  parseValue,
  serializeValue,
} = require('./prepare-miniapp-production-env.cjs');

describe('prepare mini-program production env value encoding', () => {
  it.each([
    '{"reference":"character_string6","status":"phrase18"}',
    '[{"info_type":"岗位类型","info_content":"平台推广人员"}]',
    'hex-secret-0123456789',
    'contains\\nslash-n',
    'contains"double',
  ])('round-trips through the real dotenv parser: %s', (value: string) => {
    const encoded = serializeValue(value);
    expect(dotenv.parse(Buffer.from(`VALUE=${encoded}\n`)).VALUE).toBe(value);
    expect(parseValue(encoded)).toBe(value);
  });

  it('fails closed for single quotes and physical line breaks', () => {
    expect(() => serializeValue("contains'single")).toThrow();
    expect(() => serializeValue('contains\nline-break')).toThrow();
  });
});
