declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;
declare const require: any;

const {
  asStringArray,
  formatMoneyValue,
  getTrackingEvents,
  toFiniteNumber,
} = require('../afterSaleDetailSafety');

describe('afterSaleDetailSafety', () => {
  it('formats money from numbers and numeric strings without throwing', () => {
    expect(toFiniteNumber(18.5)).toBe(18.5);
    expect(toFiniteNumber('18.50')).toBe(18.5);
    expect(toFiniteNumber(null, 7)).toBe(7);
    expect(toFiniteNumber('not-a-number', 7)).toBe(7);
    expect(formatMoneyValue('12.3')).toBe('12.30');
    expect(formatMoneyValue(undefined)).toBe('0.00');
  });

  it('returns only string photos when backend data is malformed', () => {
    expect(asStringArray(['https://img.example/a.jpg', 3, '', null, 'https://img.example/b.jpg'])).toEqual([
      'https://img.example/a.jpg',
      'https://img.example/b.jpg',
    ]);
    expect(asStringArray('https://img.example/a.jpg')).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
  });

  it('normalizes logistics events to an array before rendering timelines', () => {
    expect(getTrackingEvents({ events: [{ time: '2026-06-01', message: '已揽收' }] })).toEqual([
      { time: '2026-06-01', message: '已揽收' },
    ]);
    expect(getTrackingEvents({ events: { time: 'bad-shape' } })).toEqual([]);
    expect(getTrackingEvents(null)).toEqual([]);
  });
});
