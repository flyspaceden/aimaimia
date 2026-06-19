import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getRewardProducts } from '@/api/reward-products';
import type { RewardProduct, RewardProductSku } from '@/api/reward-products';

const { Text } = Typography;

export interface ProductPickerValue {
  productId?: string;
  skuId?: string;
}

interface RewardProductPickerProps {
  value?: ProductPickerValue;
  onChange?: (value: ProductPickerValue) => void;
  disabled?: boolean;
}

/**
 * 奖励商品选择器
 * 两级联动：先选商品，再选商品规格（包装/重量等）
 * 用于抽奖奖品关联奖励商品
 */
export default function RewardProductPicker({
  value,
  onChange,
  disabled,
}: RewardProductPickerProps) {
  const [keyword, setKeyword] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<RewardProduct | null>(null);

  // 获取奖励商品列表（带搜索）
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['reward-products-picker', keyword],
    queryFn: () => getRewardProducts({ page: 1, pageSize: 50, keyword: keyword || undefined }),
  });

  const products = useMemo(() => productsData?.items ?? [], [productsData]);

  // 当 value.productId 变化时，同步 selectedProduct
  useEffect(() => {
    if (value?.productId && products.length > 0) {
      const found = products.find((p) => p.id === value.productId);
      if (found) {
        setSelectedProduct(found);
      }
    } else if (!value?.productId) {
      setSelectedProduct(null);
    }
  }, [value?.productId, products]);

  // 防抖搜索
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = useCallback((val: string) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      setKeyword(val);
    }, 400);
  }, []);

  // 选择商品
  const handleProductChange = useCallback(
    (productId: string | undefined) => {
      if (!productId) {
        setSelectedProduct(null);
        onChange?.({ productId: undefined, skuId: undefined });
        return;
      }
      const product = products.find((p) => p.id === productId);
      setSelectedProduct(product ?? null);
      // 如果商品只有一个规格，自动选择
      if (product && product.skus.length === 1) {
        onChange?.({ productId, skuId: product.skus[0].id });
      } else {
        onChange?.({ productId, skuId: undefined });
      }
    },
    [products, onChange],
  );

  // 选择规格
  const handleSkuChange = useCallback(
    (skuId: string | undefined) => {
      onChange?.({ productId: value?.productId, skuId });
    },
    [value?.productId, onChange],
  );

  const skuOptions = useMemo(() => {
    if (!selectedProduct) return [];
    return selectedProduct.skus.map((sku: RewardProductSku) => ({
      label: `${sku.title} - ¥${sku.price.toFixed(2)} (库存: ${sku.stock})`,
      value: sku.id,
    }));
  }, [selectedProduct]);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {/* 商品选择器 */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
          选择奖励商品
        </Text>
        <Select
          showSearch
          allowClear
          placeholder="搜索并选择奖励商品"
          value={value?.productId || undefined}
          onChange={handleProductChange}
          onSearch={handleSearch}
          filterOption={false}
          loading={productsLoading}
          disabled={disabled}
          style={{ width: '100%' }}
          options={products.map((p) => ({
            label: `${p.title} (¥${p.basePrice.toFixed(2)})`,
            value: p.id,
          }))}
          notFoundContent={productsLoading ? '加载中...' : '暂无奖励商品'}
        />
      </div>

      {/* 商品规格选择器 — 选择商品后显示 */}
      {value?.productId && (
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
            选择商品规格（同一商品的不同包装/重量/口味）
          </Text>
          <Select
            allowClear
            placeholder="请选择商品规格"
            value={value?.skuId || undefined}
            onChange={handleSkuChange}
            disabled={disabled || !selectedProduct}
            style={{ width: '100%' }}
            options={skuOptions}
            notFoundContent={selectedProduct ? '该商品暂无规格' : '请先选择商品'}
          />
        </div>
      )}

      {/* 已选提示 */}
      {value?.productId && value?.skuId && selectedProduct && (
        <Text type="success" style={{ fontSize: 12 }}>
          已选: {selectedProduct.title} /{' '}
          {selectedProduct.skus.find((s) => s.id === value.skuId)?.title ?? value.skuId}
        </Text>
      )}
    </Space>
  );
}
