import { DEFAULT_INBOX_FILTERS, resetInboxFilters } from '../inboxFilters';

describe('inbox filters', () => {
  it('resets category and unread filters together', () => {
    const filtered = { activeTab: 'interaction' as const, unreadOnly: true };
    expect(filtered).not.toEqual(DEFAULT_INBOX_FILTERS);
    expect(resetInboxFilters()).toEqual({ activeTab: 'all', unreadOnly: false });
  });

  it('returns a fresh object so React receives a state transition', () => {
    expect(resetInboxFilters()).not.toBe(DEFAULT_INBOX_FILTERS);
  });
});
