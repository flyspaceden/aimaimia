import { useEffect, useMemo, useState } from 'react';
import type { UIEvent } from 'react';
import { Avatar, Select, Spin, Typography } from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  getAnnouncementTargetProducts,
  type AnnouncementTargetProduct,
} from '@/api/announcements';

const { Text } = Typography;
const PAGE_SIZE = 20;
const POPUP_WIDTH = 480;

interface AnnouncementProductSelectProps {
  value?: string;
  onChange?: (value?: string) => void;
}

function useDebouncedValue(value: string, delay = 220) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

export default function AnnouncementProductSelect({ value, onChange }: AnnouncementProductSelectProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<AnnouncementTargetProduct | null>(null);
  const debouncedKeyword = useDebouncedValue(keyword.trim());

  const query = useInfiniteQuery({
    queryKey: ['admin', 'announcement-target-products', debouncedKeyword],
    queryFn: ({ pageParam = 1 }) => getAnnouncementTargetProducts({
      page: pageParam as number,
      pageSize: PAGE_SIZE,
      keyword: debouncedKeyword || undefined,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled: open,
    staleTime: 30_000,
  });

  const products = useMemo(() => {
    const loaded = query.data?.pages.flatMap((page) => page.items) ?? [];
    if (!selectedProduct || loaded.some((product) => product.id === selectedProduct.id)) return loaded;
    return [selectedProduct, ...loaded];
  }, [query.data, selectedProduct]);

  const options = useMemo(() => products.map((product) => ({
    value: product.id,
    label: product.title,
    product,
  })), [products]);

  const handlePopupScroll = (event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (nearBottom && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  };

  return (
    <Select
      showSearch
      allowClear
      filterOption={false}
      value={value}
      open={open}
      options={options}
      loading={query.isFetching}
      placeholder="搜索并选择买家将打开的商品"
      popupMatchSelectWidth={POPUP_WIDTH}
      listHeight={320}
      notFoundContent={query.isFetching ? <Spin size="small" /> : '暂无可跳转商品'}
      onFocus={() => setOpen(true)}
      onDropdownVisibleChange={setOpen}
      onSearch={(nextKeyword) => {
        setKeyword(nextKeyword);
        setOpen(true);
      }}
      onPopupScroll={handlePopupScroll}
      onChange={(nextValue) => {
        const nextProduct = products.find((product) => product.id === nextValue) ?? null;
        setSelectedProduct(nextProduct);
        onChange?.(nextValue);
      }}
      optionRender={(option) => {
        const product = (option.data as { product: AnnouncementTargetProduct }).product;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto', gap: 12, alignItems: 'center' }}>
            <Avatar
              shape="square"
              size={44}
              src={product.imageUrl || undefined}
              icon={product.imageUrl ? undefined : <PictureOutlined />}
            />
            <div style={{ minWidth: 0 }}>
              <Text strong ellipsis style={{ display: 'block' }}>{product.title}</Text>
              <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
                {product.companyName} · {product.id}
              </Text>
            </div>
            <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
              ¥{Number(product.basePrice).toFixed(2)}
            </Text>
          </div>
        );
      }}
      style={{ width: '100%' }}
    />
  );
}
