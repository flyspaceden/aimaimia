export type InboxFilterTab = 'all' | 'interaction' | 'transaction' | 'system';

export type InboxFilterState = {
  activeTab: InboxFilterTab;
  unreadOnly: boolean;
};

export const DEFAULT_INBOX_FILTERS: InboxFilterState = {
  activeTab: 'all',
  unreadOnly: false,
};

export const resetInboxFilters = (): InboxFilterState => ({ ...DEFAULT_INBOX_FILTERS });
