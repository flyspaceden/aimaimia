import { useEffect, useMemo, useState } from 'react';
import type { UIEvent } from 'react';
import { Button, Select, Spin, Tag, Typography } from 'antd';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getCaptainScopeOptions } from '@/api/captain';
import type { CaptainScopeOption, CaptainScopeOptionType } from '@/types';

const { Text } = Typography;
const PAGE_SIZE = 12;

const TYPE_LABEL: Record<CaptainScopeOptionType, string> = {
  CATEGORY: '类目',
  PRODUCT: '商品',
  COMPANY: '商户',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '可用', color: 'green' },
  INACTIVE: { label: '已停用', color: 'default' },
  SUSPENDED: { label: '已暂停', color: 'orange' },
  BANNED: { label: '已禁用', color: 'red' },
  PENDING: { label: '待审核', color: 'gold' },
  APPROVED: { label: '已通过', color: 'green' },
};

function useDebouncedValue(value: string, delay = 220) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

type ScopeSelectOption = {
  value: string;
  label: string;
  item: CaptainScopeOption;
};

export default function ScopeEntitySelect({
  type,
  value,
  onChange,
  placeholder,
}: {
  type: CaptainScopeOptionType;
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim());
  const selectedIds = useMemo(
    () => (Array.isArray(value) ? value.filter(Boolean) : []),
    [value],
  );
  const selectedKey = useMemo(() => [...selectedIds].sort().join(','), [selectedIds]);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'captain', 'scope-options', type, debouncedKeyword, selectedKey],
    queryFn: ({ pageParam = 1 }) => getCaptainScopeOptions({
      type,
      page: pageParam as number,
      pageSize: PAGE_SIZE,
      keyword: debouncedKeyword || undefined,
      selectedIds,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    enabled: open || selectedIds.length > 0,
    staleTime: 30_000,
  });

  const options = useMemo<ScopeSelectOption[]>(() => {
    const byId = new Map<string, CaptainScopeOption>();
    for (const page of query.data?.pages || []) {
      for (const item of page.selectedItems || []) byId.set(item.id, item);
      for (const item of page.items || []) byId.set(item.id, item);
    }
    return [...byId.values()].map((item) => ({
      value: item.id,
      label: item.name,
      item,
    }));
  }, [query.data?.pages]);

  const handlePopupScroll = (event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (nearBottom && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  };

  const typeLabel = TYPE_LABEL[type];
  const notFoundContent = query.isError ? (
    <Button
      type="link"
      size="small"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => { void query.refetch(); }}
    >
      加载失败，点击重试
    </Button>
  ) : query.isFetching ? (
    <Spin size="small" />
  ) : debouncedKeyword ? (
    `没有找到包含“${debouncedKeyword}”的${typeLabel}`
  ) : (
    `暂无可选${typeLabel}`
  );

  return (
    <Select
      mode="multiple"
      showSearch
      filterOption={false}
      value={selectedIds}
      options={options}
      optionLabelProp="label"
      optionRender={(option) => {
        const item = (option.data as ScopeSelectOption).item;
        const status = STATUS_META[item.status] || { label: item.status, color: 'default' };
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '3px 0' }}>
            <div style={{ minWidth: 0 }}>
              <Text strong ellipsis={{ tooltip: item.name }} style={{ display: 'block' }}>{item.name}</Text>
              <Text type="secondary" ellipsis={{ tooltip: item.subtitle }} style={{ display: 'block', fontSize: 12 }}>
                {item.subtitle}
              </Text>
              <Text type="secondary" ellipsis={{ tooltip: item.id }} style={{ display: 'block', fontSize: 12, fontFamily: 'monospace' }}>
                ID：{item.id}
              </Text>
            </div>
            <Tag color={status.color} style={{ marginInlineEnd: 0 }}>{status.label}</Tag>
          </div>
        );
      }}
      loading={query.isFetching && !query.isFetchingNextPage}
      placeholder={placeholder}
      maxTagCount="responsive"
      style={{ width: '100%' }}
      open={open}
      onFocus={() => setOpen(true)}
      onDropdownVisibleChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setKeyword('');
      }}
      onSearch={(nextKeyword) => {
        setKeyword(nextKeyword);
        setOpen(true);
      }}
      onPopupScroll={handlePopupScroll}
      onChange={(nextValues) => onChange?.(nextValues)}
      notFoundContent={notFoundContent}
    />
  );
}
