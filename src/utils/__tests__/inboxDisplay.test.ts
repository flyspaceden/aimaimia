import { formatInboxDetailTimestamp, formatInboxTimestamp } from '../inboxDisplay';

describe('formatInboxTimestamp', () => {
  const now = new Date(2026, 6, 11, 23, 45);

  it('shows only local time for messages from today', () => {
    const value = new Date(2026, 6, 11, 18, 5).toISOString();
    expect(formatInboxTimestamp(value, now)).toBe('18:05');
  });

  it('shows month day and time for earlier messages in the same year', () => {
    const value = new Date(2026, 6, 10, 8, 4).toISOString();
    expect(formatInboxTimestamp(value, now)).toBe('07-10 08:04');
  });

  it('keeps the year for older messages and preserves invalid input', () => {
    const value = new Date(2025, 11, 31, 9, 30).toISOString();
    expect(formatInboxTimestamp(value, now)).toBe('2025-12-31 09:30');
    expect(formatInboxTimestamp('unknown-time', now)).toBe('unknown-time');
  });
});

describe('formatInboxDetailTimestamp', () => {
  it('renders a full local timestamp on the detail page', () => {
    expect(formatInboxDetailTimestamp('2026-07-12T01:25:00')).toBe('2026年7月12日 01:25');
  });
});
