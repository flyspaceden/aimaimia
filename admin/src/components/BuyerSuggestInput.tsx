import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, UIEvent } from 'react';
import { AutoComplete, Input, Select, Spin, Tag } from 'antd';
import type { AutoCompleteProps, SelectProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getAppUsers } from '@/api/app-users';
import BuyerIdentityText from '@/components/BuyerIdentityText';
import type { AppUser } from '@/types';

type BuyerTier = 'NORMAL' | 'VIP';

interface BuyerSuggestionOptions {
  keyword?: string;
  open: boolean;
  tier?: BuyerTier;
  activeOnly?: boolean;
}

interface BuyerSuggestInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  tier?: BuyerTier;
  activeOnly?: boolean;
  style?: CSSProperties;
  onBuyerSelect?: (buyer: AppUser) => void;
}

interface BuyerNoMultiSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  tier?: BuyerTier;
  activeOnly?: boolean;
}

type BuyerAutoCompleteOption = NonNullable<AutoCompleteProps['options']>[number] & {
  buyer: AppUser;
};

const BUYER_SUGGESTION_PAGE_SIZE = 10;
const BUYER_SUGGESTION_POPUP_WIDTH = 360;

function useDebouncedValue(value: string, delay = 220) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

function useBuyerSuggestions({ keyword = '', open, tier, activeOnly }: BuyerSuggestionOptions) {
  const debouncedKeyword = useDebouncedValue(keyword.trim());

  const query = useInfiniteQuery({
    queryKey: ['admin', 'buyer-suggestions', debouncedKeyword, tier ?? 'ALL', activeOnly ? 'ACTIVE' : 'ALL'],
    queryFn: ({ pageParam = 1 }) =>
      getAppUsers({
        page: pageParam as number,
        pageSize: BUYER_SUGGESTION_PAGE_SIZE,
        keyword: debouncedKeyword || undefined,
        tier,
        status: activeOnly ? 'ACTIVE' : undefined,
        sortField: 'createdAt',
        sortOrder: 'descend',
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled: open,
    staleTime: 30_000,
  });

  return {
    ...query,
    buyers: query.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

function buyerValue(buyer: AppUser) {
  return buyer.buyerNo || buyer.id;
}

function buyerOptionLabel(buyer: AppUser) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <BuyerIdentityText
          buyerNo={buyer.buyerNo}
          userId={buyer.id}
          nickname={buyer.nickname || buyer.phone || '未设置昵称'}
          phone={buyer.phone || undefined}
          compact
          showInternalId={false}
        />
      </div>
      <Tag color={buyer.memberTier === 'VIP' ? 'gold' : 'blue'} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
        {buyer.memberTier === 'VIP' ? 'VIP' : '普通'}
      </Tag>
    </div>
  );
}

function buildAutoCompleteOptions(buyers: AppUser[]): BuyerAutoCompleteOption[] {
  return buyers.map((buyer) => ({
    value: buyerValue(buyer),
    label: buyerOptionLabel(buyer),
    buyer,
  }));
}

function splitBuyerNos(value?: string) {
  return (value || '')
    .split(/[\n,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function BuyerSuggestInput({
  value,
  onChange,
  placeholder = '搜索买家编号、手机号或昵称',
  tier,
  activeOnly,
  style,
  onBuyerSelect,
}: BuyerSuggestInputProps) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState(value || '');
  const currentText = value ?? searchText;
  const {
    buyers,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBuyerSuggestions({
    keyword: currentText,
    open,
    tier,
    activeOnly,
  });

  useEffect(() => {
    if (value !== undefined) {
      setSearchText(value);
    }
  }, [value]);

  const options = useMemo(() => buildAutoCompleteOptions(buyers), [buyers]);

  const handleSearch = (nextValue: string) => {
    setSearchText(nextValue);
    onChange?.(nextValue);
    setOpen(true);
  };

  const handlePopupScroll = (event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (nearBottom && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  };

  return (
    <AutoComplete
      value={currentText}
      options={options}
      open={open}
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onChange={(nextValue) => {
        setSearchText(nextValue);
        onChange?.(nextValue);
      }}
      onSearch={handleSearch}
      onSelect={(nextValue, option) => {
        const buyer = (option as BuyerAutoCompleteOption).buyer;
        setSearchText(nextValue);
        onChange?.(nextValue);
        setOpen(false);
        if (buyer) onBuyerSelect?.(buyer);
      }}
      placeholder={placeholder}
      allowClear
      onPopupScroll={handlePopupScroll}
      popupMatchSelectWidth={BUYER_SUGGESTION_POPUP_WIDTH}
      notFoundContent={isFetching ? <Spin size="small" /> : '暂无匹配买家'}
      style={{ width: '100%', ...style }}
    >
      <Input prefix={<SearchOutlined style={{ color: '#94a3b8' }} />} />
    </AutoComplete>
  );
}

export function BuyerNoMultiSelect({
  value,
  onChange,
  placeholder = '搜索并选择买家',
  tier,
  activeOnly = true,
}: BuyerNoMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const selectedBuyerNos = useMemo(() => splitBuyerNos(value), [value]);
  const {
    buyers,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBuyerSuggestions({
    keyword,
    open,
    tier,
    activeOnly,
  });

  const options = useMemo<SelectProps['options']>(() => buyers.map((buyer) => ({
    value: buyerValue(buyer),
    label: buyerOptionLabel(buyer),
  })), [buyers]);

  const handlePopupScroll = (event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (nearBottom && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  };

  return (
    <Select
      mode="multiple"
      showSearch
      filterOption={false}
      value={selectedBuyerNos}
      options={options}
      loading={isFetching}
      placeholder={placeholder}
      optionLabelProp="value"
      maxTagCount="responsive"
      style={{ width: '100%' }}
      popupMatchSelectWidth={BUYER_SUGGESTION_POPUP_WIDTH}
      notFoundContent={isFetching ? <Spin size="small" /> : '暂无匹配买家'}
      onFocus={() => setOpen(true)}
      onDropdownVisibleChange={setOpen}
      onSearch={(nextKeyword) => {
        setKeyword(nextKeyword);
        setOpen(true);
      }}
      onPopupScroll={handlePopupScroll}
      onChange={(nextValues) => {
        onChange?.(nextValues.join('\n'));
      }}
    />
  );
}
