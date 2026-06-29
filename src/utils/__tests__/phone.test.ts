import { isMainlandPhone } from '../phone';

describe('isMainlandPhone', () => {
  it('accepts mainland mobile phone numbers', () => {
    expect(isMainlandPhone('13800000000')).toBe(true);
    expect(isMainlandPhone('19912345678')).toBe(true);
  });

  it('rejects short, service, and non-mainland-like numbers', () => {
    expect(isMainlandPhone('10086')).toBe(false);
    expect(isMainlandPhone('1380000000')).toBe(false);
    expect(isMainlandPhone('23800000000')).toBe(false);
    expect(isMainlandPhone('1380000000a')).toBe(false);
  });
});
