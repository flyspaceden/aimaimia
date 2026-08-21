import { Button, Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { Product } from '@/types';
import { useAppConfig } from '@/hooks/use-app-config';
import { catalogCardStockText, formatCatalogPrice, resolveCatalogQuickAddAction, resolveProductStock } from './catalog-utils';
import './catalog-product-card.scss';

type Props = {
  product: Product;
  compact?: boolean;
  onClick: (product: Product) => void;
  onAdd?: (product: Product) => void;
  adding?: boolean;
  aiRecommend?: boolean;
  aiReason?: string;
};

export function CatalogProductCard({ product, compact = false, onClick, onAdd, adding = false, aiRecommend = false, aiReason }: Props) {
  const { lowStockDisplayThreshold } = useAppConfig();
  const stockText = catalogCardStockText(resolveProductStock(product), lowStockDisplayThreshold);
  const quickAdd = onAdd ? resolveCatalogQuickAddAction(product) : undefined;
  const tags = (product.tags || []).filter(Boolean).slice(0, 2);
  const showSales = typeof product.monthlySales === 'number' && product.monthlySales > 0;
  const showLimit = typeof product.maxPerOrder === 'number' && product.maxPerOrder > 0;
  return (
    <View
      className={`catalog-product-card aim-card${compact ? ' catalog-product-card--compact' : ''}`}
      hoverClass='catalog-product-card--pressed'
      onClick={() => onClick(product)}
    >
      <View className='catalog-product-card__media'>
        <Image className='catalog-product-card__image' src={product.image} mode='aspectFill' lazyLoad />
        {product.type === 'BUNDLE' ? <Text className='catalog-product-card__bundle'>组合装</Text> : null}
        {stockText ? <Text className={stockText === '已售完' ? 'catalog-product-card__stock-badge catalog-product-card__stock-badge--out' : 'catalog-product-card__stock-badge'}>{stockText}</Text> : null}
      </View>
      <View className='catalog-product-card__body'>
        {aiRecommend ? <Text className='catalog-product-card__ai-badge'>AI 推荐</Text> : null}
        <Text className='catalog-product-card__title'>{product.title}</Text>
        {product.origin ? <Text className='catalog-product-card__origin'>{product.origin}</Text> : null}
        {tags.length ? <View className='catalog-product-card__tags'>{tags.map((tag) => <Text className='catalog-product-card__tag' key={tag}>{tag}</Text>)}</View> : <View className='catalog-product-card__tags catalog-product-card__tags--empty' />}
        {aiReason ? <Text className='catalog-product-card__ai-reason'>{aiReason}</Text> : null}
        <View className='catalog-product-card__footer'>
          <View className='catalog-product-card__price-row'>
            <Text className='catalog-product-card__currency'>¥</Text>
            <Text className='catalog-product-card__price'>{formatCatalogPrice(product.price)}</Text>
            {product.priceFrom ? <Text className='catalog-product-card__from'>起</Text> : null}
            {typeof product.strikePrice === 'number' && product.strikePrice > product.price ? <Text className='catalog-product-card__strike'>¥{formatCatalogPrice(product.strikePrice)}</Text> : null}
          </View>
          <View className='catalog-product-card__actions'>
            {quickAdd ? <Button
              className='catalog-product-card__quick-add'
              loading={adding}
              disabled={adding}
              onClick={(event) => {
                event.stopPropagation();
                onAdd?.(product);
              }}
            >{quickAdd.label}</Button> : null}
          </View>
        </View>
        {showSales || showLimit ? <View className='catalog-product-card__sales-row'>
          {showSales ? <Text>月销 {product.monthlySales}</Text> : null}
          {showSales && showLimit ? <Text>·</Text> : null}
          {showLimit ? <Text>限购 {product.maxPerOrder} 件</Text> : null}
        </View> : null}
        {product.companyName ? <View
          className='catalog-product-card__company'
          onClick={(event) => {
            event.stopPropagation();
            if (product.companyId) void Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(product.companyId)}` });
          }}
        ><Text>{product.companyName}</Text>{product.companyId ? <Text>›</Text> : null}</View> : null}
      </View>
    </View>
  );
}
